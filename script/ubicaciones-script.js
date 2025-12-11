// ===============================
// CONFIGURACIÓN INICIAL DEL MAPA
// ===============================

// Coordenadas del Estadio Azteca [lng, lat]
const stadium = [-99.1507, 19.3029];

// Crear mapa centrado en el estadio
const map = L.map('map').setView([stadium[1], stadium[0]], 14);

// Capa base OSM (mapa)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Marcador del estadio
const stadiumMarker = L.marker([stadium[1], stadium[0]])
    .addTo(map)
    .bindPopup('Estadio Banorte')
    .openPopup();


// ===============================
// ICONOS PERSONALIZADOS
// ===============================

const icons = {
    hotel: L.icon({
        iconUrl: "https://cdn-icons-png.flaticon.com/512/139/139899.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32]
    }),
    restaurant: L.icon({
        iconUrl: "https://cdn-icons-png.flaticon.com/512/3595/3595455.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32]
    }),
    bank: L.icon({
        iconUrl: "https://cdn-icons-png.flaticon.com/512/483/483361.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32]
    }),
    tourism: L.icon({
        iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32]
    })
};


// ===============================
// VARIABLES GLOBALES
// ===============================

let placeMarkers = [];     // marcadores de lugares encontrados
let routeLayer = null;     // capa de la ruta
let lastSelectedPlace = null;

const resultsDiv = document.getElementById('results');
const btnSearch = document.getElementById('btnSearch');
const btnClear = document.getElementById('btnClear');
const modeSelect = document.getElementById('mode');
const categorySelect = document.getElementById('category');


// ===============================
// MANEJO DE EVENTOS
// ===============================

btnSearch.addEventListener('click', () => searchPlaces());

btnClear.addEventListener('click', () => clearResults());

modeSelect.addEventListener('change', () => {
    if (lastSelectedPlace) {
        drawRouteOSRM(
            [stadium[0], stadium[1]],
            lastSelectedPlace,
            modeSelect.value
        );
    }
});


// ===============================
// BUSCAR LUGARES (NOMINATIM)
// ===============================

async function searchPlaces() {
    clearResults();

    const category = categorySelect.value; // hotel, restaurant, bank, tourism
    resultsDiv.innerHTML = `<em>Buscando ${category} cerca...</em>`;

    const lat = stadium[1], lon = stadium[0];
    const delta = 0.03;
    const viewbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    const q = encodeURIComponent(category);
    const url = `https://nominatim.openstreetmap.org/search.php?q=${q}&format=jsonv2&viewbox=${viewbox}&bounded=1&limit=30`;

    try {
        const res = await fetch(url, {
            headers: {
                "Accept-Language": "es",
                "User-Agent": "MiMapaWeb/1.0"
            }
        });

        const data = await res.json();

        if (!data.length) {
            resultsDiv.innerHTML = `<em>No se encontraron ${category} cerca.</em>`;
            return;
        }

        resultsDiv.innerHTML = "";

        data.forEach(place => {
            const name = place.display_name.split(',')[0];
            const lat = parseFloat(place.lat);
            const lon = parseFloat(place.lon);

            // ===============================
            // ASIGNAR ICONO SEGÚN CATEGORÍA
            // ===============================
            const categoryIcon = icons[category] || icons.hotel;

            const marker = L.marker([lat, lon], { icon: categoryIcon })
                .addTo(map)
                .bindPopup(place.display_name);

            placeMarkers.push(marker);

            const item = document.createElement("div");
            item.className = "place";
            item.innerHTML = `<strong>${name}</strong><br><small>${place.display_name}</small>`;

            item.addEventListener("click", () => {
                map.setView([lat, lon], 16);
                lastSelectedPlace = [lon, lat];

                drawRouteOSRM(
                    [stadium[0], stadium[1]],
                    [lon, lat],
                    modeSelect.value
                );
            });

            resultsDiv.appendChild(item);
        });

        resultsDiv.scrollIntoView({ behavior: "smooth" });

    } catch (e) {
        console.error(e);
        resultsDiv.innerHTML = "<em>Error buscando lugares.</em>";
    }
}


// ===============================
// RUTA OSRM
// ===============================

async function drawRouteOSRM(startLonLat, endLonLat, profile = "driving") {

    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }

    resultsDiv.innerHTML = `<em>Obteniendo ruta (${profile})...</em>`;

    const coords = `${startLonLat[0]},${startLonLat[1]};${endLonLat[0]},${endLonLat[1]}`;
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (!data.routes || !data.routes.length) {
            resultsDiv.innerHTML = "<em>No se pudo calcular la ruta.</em>";
            return;
        }

        const route = data.routes[0];
        const geojson = route.geometry;

        routeLayer = L.geoJSON(geojson, {
            style: { color: "#0078ff", weight: 5, opacity: 0.9 }
        }).addTo(map);

        const coordsLatLng = geojson.coordinates.map(c => [c[1], c[0]]);
        map.fitBounds(L.latLngBounds(coordsLatLng).pad(0.2));

        const km = (route.distance / 1000).toFixed(2);
        const min = Math.round(route.duration / 60);

        resultsDiv.innerHTML = `<strong>Ruta:</strong> ${km} km • ${min} min`;

    } catch (err) {
        console.error(err);
        resultsDiv.innerHTML = "<em>Error obteniendo la ruta.</em>";
    }
}


// ===============================
// LIMPIAR
// ===============================

function clearResults() {
    resultsDiv.innerHTML = "Resultados...";

    placeMarkers.forEach(m => map.removeLayer(m));
    placeMarkers = [];

    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }

    lastSelectedPlace = null;

    map.setView([stadium[1], stadium[0]], 14);
}
