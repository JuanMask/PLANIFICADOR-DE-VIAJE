// ==============================
// ===============================

// Configuración: estadio (lng, lat)
const stadium = [-99.1507, 19.3029];

// Inicializar mapa (Leaflet usa [lat, lng])
const map = L.map('map').setView([stadium[1], stadium[0]], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© OpenStreetMap contributors'
}).addTo(map);

// marcador estadio
L.marker([stadium[1], stadium[0]]).addTo(map).bindPopup('Estadio Azteca').openPopup();

// iconos (hoteles/rest)
const icons = {
  hotel: L.icon({ iconUrl: "https://cdn-icons-png.flaticon.com/512/139/139899.png", iconSize:[32,32], iconAnchor:[16,32]}),
  restaurant: L.icon({ iconUrl: "https://cdn-icons-png.flaticon.com/512/3595/3595455.png", iconSize:[32,32], iconAnchor:[16,32]})
};

// Estado global / UI refs
let hotelMarkers = [], restaurantMarkers = [], routeGroups = []; // routeGroups: [{layers:[], combo, highlighted:false, meta}]
let combosStored = []; // combos con meta (hotel, restaurant, prices, meta)
const resultsDiv = document.getElementById('results');
const btnGenerate = document.getElementById('btnGenerate');
const btnClear = document.getElementById('btnClear');
const btnBest = document.getElementById('btnBest');
const btnExportPDF = document.getElementById('btnExportPDF');
const modeSelect = document.getElementById('mode');
const budgetInput = document.getElementById('budget');

// Parámetros de simulación / tasas
const TAXI_RATE_PER_KM = 8.0; // MXN por km (para driving)
const CYCLING_RATE_PER_KM = 0; // asumido gratuito
const WALKING_RATE = 0;

btnGenerate.addEventListener('click', generateRoutes);
btnClear.addEventListener('click', clearAll);
btnBest.addEventListener('click', highlightBestRoute);
btnExportPDF.addEventListener('click', exportPDF);

// ---------------------------

// Para diversidad usamos mezcla: si deseas Nominatim en vivo, reutiliza findPlacesByCategory.
// ---------------------------
function simulatePlaces() {
  // Generamos 6 hoteles y 6 restaurantes con coordenadas alrededor del estadio (simples)
  const h = [
    { name:"Hotel Sol", cost: rand(600,1400), lat:19.3008, lon:-99.1532 },
    { name:"Hotel Luna", cost: rand(700,1600), lat:19.3052, lon:-99.1479 },
    { name:"Hotel Estrella", cost: rand(800,1800), lat:19.2989, lon:-99.1487 },
    { name:"Hotel Pueblo", cost: rand(500,1200), lat:19.3070, lon:-99.1490 },
    { name:"Hotel Central", cost: rand(900,2000), lat:19.3020, lon:-99.1425 },
    { name:"Hotel Plaza", cost: rand(650,1300), lat:19.2965, lon:-99.1555 }
  ];
  const r = [
    { name:"El Sabor", cost: rand(120,450), lat:19.3041, lon:-99.1481 },
    { name:"Mexicano", cost: rand(180,550), lat:19.2992, lon:-99.1512 },
    { name:"Gourmet", cost: rand(250,800), lat:19.3033, lon:-99.1437 },
    { name:"Taquería 24", cost: rand(80,220), lat:19.2970, lon:-99.1499 },
    { name:"Mar & Tierra", cost: rand(200,700), lat:19.3065, lon:-99.1462 },
    { name:"Café Azteca", cost: rand(90,300), lat:19.3000, lon:-99.1440 }
  ];
  return { hotels: h, restaurants: r };
}
function rand(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }

// ---------------------------
// GENERAR RUTAS: lógica principal
// ---------------------------
async function generateRoutes() {
  clearAll();
  const budget = Number(budgetInput.value) || 0;
  if (budget <= 0) { resultsDiv.innerHTML = '<em>Ingresa un presupuesto válido.</em>'; return; }

  resultsDiv.innerHTML = `<em>Generando combinaciones dentro de ${budget} MXN...</em>`;

  // 1. obtener (simular) lugares
  const { hotels, restaurants } = simulatePlaces();

  // 2. generar combos que cumplan presupuesto (hotel.cost + rest.cost + transporteEstimado <= budget)
  // Para estimar transporte inicialmente, pedimos distancia entre hotel-stadium and stadium-restaurant
  combosStored = []; // reset

  // limit combos to avoid muchas requests
  const MAX_H = Math.min(6, hotels.length);
  const MAX_R = Math.min(6, restaurants.length);

  for (let i=0;i<MAX_H;i++){
    for (let j=0;j<MAX_R;j++){
      const h = hotels[i], r = restaurants[j];
      // pedimos metadatos OSRM para cada segmento (hotel->stadium, stadium->restaurant)
      const meta1 = await fetchOSRMMeta([h.lon,h.lat],[stadium[0],stadium[1]], modeSelect.value);
      const meta2 = await fetchOSRMMeta([stadium[0],stadium[1]],[r.lon,r.lat], modeSelect.value);
      // distancia en km y duración en min
      const dist1 = (meta1.distance||0)/1000;
      const dist2 = (meta2.distance||0)/1000;
      const durMin = Math.round(((meta1.duration||0)+(meta2.duration||0))/60);
      // transporte estimado (simple)
      const transportCost = estimateTransportCost(dist1 + dist2, modeSelect.value);
      const total = h.cost + r.cost + transportCost;

      // si cumple presupuesto -> guardar combo
      if (total <= budget) {
        combosStored.push({
          hotel: h, restaurant: r,
          dist_km: +(dist1+dist2).toFixed(2),
          duration_min: durMin,
          transportCost: +transportCost.toFixed(2),
          totalCost: +total.toFixed(2),
          meta1, meta2 // guardamos metadatos para luego obtener geometrías si se decide dibujar
        });
      }
    }
  }

  if (!combosStored.length) {
    // sugerencias: mostrar combos más baratos si no hay combos dentro del presupuesto
    resultsDiv.innerHTML = '<em>No se encontraron combinaciones dentro del presupuesto.</em>';
    return;
  }

  // 3. mostrar tabla comparativa y dibujar todas las rutas (limitado)
  resultsDiv.innerHTML = '<strong>Combinaciones encontradas:</strong><br>';
  buildComparisonTable(combosStored);

  // dibujar capas para cada combo (no pedimos geometría completa aún: preferimos obtener geometría cuando usuario "mostrar" o al resaltar)
  // para la demo pedimos geometrías de cada combo y las guardamos en routeGroups
  routeGroups = [];
  const colors = ['#0078ff','#ff7a00','#00b050','#8e44ad','#ff2e63','#00c2ff'];
  for (let k=0;k<combosStored.length;k++){
    const combo = combosStored[k];
    const color = colors[k % colors.length];
    // obtener geojson de ambos segmentos
    const g1 = await fetchOSRMRouting([combo.hotel.lon, combo.hotel.lat],[stadium[0],stadium[1]], modeSelect.value);
    const g2 = await fetchOSRMRouting([stadium[0],stadium[1]],[combo.restaurant.lon,combo.restaurant.lat], modeSelect.value);
    const layers = [];
    if (g1) layers.push(L.geoJSON(g1,{style:{color,weight:4,opacity:0.9}}).addTo(map));
    if (g2) layers.push(L.geoJSON(g2,{style:{color,weight:4,opacity:0.7,dashArray:'6,6'}}).addTo(map));
    // markers
    const hm = L.marker([combo.hotel.lat, combo.hotel.lon],{icon:icons.hotel}).addTo(map).bindPopup(`${combo.hotel.name}<br>${combo.hotel.cost} MXN`);
    const rm = L.marker([combo.restaurant.lat, combo.restaurant.lon],{icon:icons.restaurant}).addTo(map).bindPopup(`${combo.restaurant.name}<br>${combo.restaurant.cost} MXN`);
    hotelMarkers.push(hm); restaurantMarkers.push(rm);
    routeGroups.push({layers, combo, highlighted:false});
  }

  resultsDiv.scrollIntoView({behavior:'smooth'});
}

// ---------------------------
// ESTIMACIONES Y UTILIDADES
// ---------------------------

function estimateTransportCost(totalKm, mode) {
  if (mode === 'driving') return totalKm * TAXI_RATE_PER_KM;
  if (mode === 'cycling') return totalKm * CYCLING_RATE_PER_KM;
  return WALKING_RATE;
}

// Obtener meta (distance,duration) de OSRM
async function fetchOSRMMeta(startLonLat,endLonLat,profile='driving') {
  const coords = `${startLonLat[0]},${startLonLat[1]};${endLonLat[0]},${endLonLat[1]}`;
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=false&geometries=geojson&alternatives=false&steps=false`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes||!data.routes.length) return {};
    const r = data.routes[0];
    return { distance: r.distance, duration: r.duration };
  } catch(err) {
    console.error('OSRM meta error',err);
    return {};
  }
}

// Obtener geometría GeoJSON de OSRM
async function fetchOSRMRouting(startLonLat,endLonLat,profile='driving') {
  const coords = `${startLonLat[0]},${startLonLat[1]};${endLonLat[0]},${endLonLat[1]}`;
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes||!data.routes.length) return null;
    return data.routes[0].geometry;
  } catch(err) { console.error('OSRM route error', err); return null; }
}

// ---------------------------
// TABLA DE COMPARACIÓN
// ---------------------------
function buildComparisonTable(combos) {
  // Construye una tabla con columnas: #, Hotel, Hotel$, Restaurante, Rest$, Transporte$, Dist km, Tiempo min, Total$, Acción
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>#</th><th>Hotel</th><th>Hotel $</th><th>Restaurante</th><th>Rest $</th><th>Transporte $</th><th>Dist (km)</th><th>Tiempo (min)</th><th>Total $</th><th>Acción</th>
  </tr>`;
  table.appendChild(thead);
  const tbody = document.createElement('tbody');

  combos.forEach((c,i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td>
      <td>${c.hotel.name}</td>
      <td>${c.hotel.cost}</td>
      <td>${c.restaurant.name}</td>
      <td>${c.restaurant.cost}</td>
      <td>${c.transportCost.toFixed(2)}</td>
      <td>${c.dist_km}</td>
      <td>${c.duration_min}</td>
      <td><strong>${c.totalCost}</strong></td>
      <td></td>`;
    // botón "Mostrar" en acción
    const btn = document.createElement('button');
    btn.textContent = 'Mostrar';
    btn.addEventListener('click', () => {
      // encontrar grupo correspondiente y centrar en sus layers bounds
      const group = routeGroups.find(g => g.combo === c);
      if (group && group.layers && group.layers.length) {
        // ajustar bounds a todas las geometrías del grupo
        const allCoords = [];
        group.layers.forEach(layer => {
          layer.eachLayer(l => {
            if (l.feature && l.feature.geometry && l.feature.geometry.coordinates) {
              l.feature.geometry.coordinates.forEach(coord => allCoords.push([coord[1],coord[0]]));
            }
          });
        });
        if (allCoords.length) map.fitBounds(L.latLngBounds(allCoords).pad(0.2));
      }
    });
    const tdAction = tr.querySelector('td:last-child');
    tdAction.appendChild(btn);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  // añadir a results div (limpia contenido anterior)
  resultsDiv.appendChild(table);
}

// ---------------------------
// MEJOR RUTA (según menor totalCost, desempata con menor duration)
// ---------------------------
function highlightBestRoute() {
  if (!routeGroups.length) { alert('Primero genera rutas.'); return; }
  // calcular mejor index
  let best = null;
  for (let i=0;i<routeGroups.length;i++){
    const meta = routeGroups[i].combo;
    if (!best) { best = {i, meta}; continue; }
    if (meta.totalCost < best.meta.totalCost) best = {i,meta};
    else if (meta.totalCost === best.meta.totalCost && meta.duration_min < best.meta.duration_min) best = {i,meta};
  }
  if (!best) return;
  // limpiar resaltados previos
  routeGroups.forEach((g,idx) => {
    if (g.highlighted) {
      // restablecer estilo (removemos y volvemos a añadir con original style)
      g.layers.forEach(layer => { map.removeLayer(layer); });
      // re-dibujar con estilo base del combo
      const color = (idx===best.i) ? '#ff0000' : '#0078ff'; // best en rojo
      const newLayers = [];
      for (const geoLayer of g.layers) {
        // cada geoLayer originalmente era L.GeoJSON; pero al removerlos perdimos los objetos; para simplicidad no los re-dibujamos aquí
      }
      g.highlighted = false;
    }
  });

  // En vez de restablecer todas (para simplicidad), resaltamos mejor route sobre lo existente:
  const bestGroup = routeGroups[best.i];
  if (!bestGroup) return;
  // dibujar un nuevo overlay más visible encima (grosor mayor)
  const highlightLayers = [];
  bestGroup.layers.forEach(layer => {
    // extraer geojson desde layer (si existe) o usar fetchOSRMRouting nuevamente
    // Intentamos extraer feature (si layer tiene toGeoJSON)
    let gj = null;
    try { gj = layer.toGeoJSON ? layer.toGeoJSON() : null; } catch(e){ gj = null; }
    if (gj && gj.features && gj.features.length) {
      // dibujar cada feature con estilo destacado
      const hl = L.geoJSON(gj, { style: { color:'#ff0000', weight:7, opacity:0.95 } }).addTo(map);
      highlightLayers.push(hl);
    }
  });
  // guardar highlightLayers para limpiar luego
  routeGroups[best.i].highlighted = true;
  routeGroups[best.i].highlightOverlays = highlightLayers;

  // centrar mapa en bounds de best
  const allCoords = [];
  bestGroup.layers.forEach(layer => {
    layer.eachLayer(l => {
      if (l.feature && l.feature.geometry && l.feature.geometry.coordinates) {
        l.feature.geometry.coordinates.forEach(c => allCoords.push([c[1],c[0]]));
      }
    });
  });
  if (allCoords.length) map.fitBounds(L.latLngBounds(allCoords).pad(0.2));
}

// ---------------------------
// EXPORTAR PDF (texto resumido de combos)
// ---------------------------
async function exportPDF() {
  if (!combosStored || combosStored.length === 0) { alert('Primero genera rutas.'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  // Tomar el contenedor completo (resultsDiv) y generar PDF con doc.html
  const element = document.getElementById('results');

  // Opciones: margin y escala para que quepa en A4
  await doc.html(element, {
    x: 20,
    y: 20,
    html2canvas: { scale: 1.2 }, // ajustar si quieres mejor resolución
    callback: function (doc) {
      doc.save('rutas_cityfanplanner.pdf');
    },
    windowWidth: document.body.scrollWidth // importante para que renderice correctamente
  });
}



// ---------------------------
// LIMPIEZA
// ---------------------------
function clearAll(){
  // limpiar markers
  hotelMarkers.forEach(m=>map.removeLayer(m)); hotelMarkers=[];
  restaurantMarkers.forEach(m=>map.removeLayer(m)); restaurantMarkers=[];
  // limpiar rutas y highlights
  routeGroups.forEach(g=>{
    if (g.layers) g.layers.forEach(l=>{ if (l) map.removeLayer(l); });
    if (g.highlightOverlays) g.highlightOverlays.forEach(h=>{ if (h) map.removeLayer(h); });
  });
  routeGroups = [];
  combosStored = [];
  resultsDiv.innerHTML = 'Resultados...';
  map.setView([stadium[1],stadium[0]],14);
}

// ---------------------------
// Helpers (si necesitas obtener meta o route por separado desde UI)
// ---------------------------
// fetchOSRMMeta y fetchOSRMRouting ya definidos arriba; reutilízalos si los mueves de lugar.

async function fetchOSRMMeta(startLonLat,endLonLat,profile='driving') {
  const coords = `${startLonLat[0]},${startLonLat[1]};${endLonLat[0]},${endLonLat[1]}`;
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=false&geometries=geojson&alternatives=false&steps=false`;
  try{
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes.length) return {};
    const r = data.routes[0];
    return { distance: r.distance, duration: r.duration };
  }catch(e){ console.error('OSRM meta error',e); return {}; }
}
async function fetchOSRMRouting(startLonLat,endLonLat,profile='driving'){
  const coords = `${startLonLat[0]},${startLonLat[1]};${endLonLat[0]},${endLonLat[1]}`;
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  try{
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes.length) return null;
    return data.routes[0].geometry;
  }catch(e){ console.error('OSRM route',e); return null; }
}
