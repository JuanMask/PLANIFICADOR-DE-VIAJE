// Coordenadas del Estadio Azteca (lon, lat)
const stadium = [-99.1507, 19.3029]; // [lng, lat]

// Inicializar mapa
const map = L.map('map').setView([stadium[1], stadium[0]], 14);

// Capa OSM con estilo mejorado
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | TravelPlanner',
    className: 'map-tiles'
}).addTo(map);

// Marker origen con icono personalizado
const stadiumIcon = L.divIcon({
    html: '<div class="stadium-marker"><i class="fas fa-futbol"></i></div>',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    className: 'stadium-icon'
});

const stadiumMarker = L.marker([stadium[1], stadium[0]], { 
    icon: stadiumIcon 
}).addTo(map).bindPopup(`
    <div class="popup-content">
        <h6><i class="fas fa-futbol text-primary"></i> Estadio Azteca</h6>
        <p class="mb-1"><small>El coloso de Santa Úrsula</small></p>
        <p class="mb-0"><small>Capacidad: 87,000 espectadores</small></p>
    </div>
`).openPopup();

// Variables globales
let hotelMarkers = [];
let routeLayer = null;
let selectedHotel = null;

// Elementos del DOM
const resultsDiv = document.getElementById('results');
const btnSearch = document.getElementById('btnSearch');
const btnClear = document.getElementById('btnClear');
const modeSelect = document.getElementById('mode');
const loadingSpinner = document.getElementById('loadingSpinner');
const hotelCount = document.getElementById('hotelCount');
const routeInfo = document.getElementById('routeInfo');

// Event Listeners mejorados
btnSearch.addEventListener('click', () => {
    btnSearch.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Buscando...';
    btnSearch.disabled = true;
    searchHotelsNearStadium();
});

btnClear.addEventListener('click', () => {
    clearResults();
    showNotification('Mapa limpiado correctamente', 'info');
});

modeSelect.addEventListener('change', () => {
    if (selectedHotel) {
        updateRoute();
    }
});

// Mostrar notificación
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    notification.style.cssText = `
        top: 20px;
        right: 20px;
        z-index: 9999;
        min-width: 300px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border-radius: 10px;
    `;
    
    notification.innerHTML = `
        <strong>${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</strong> ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Ocultar spinner de carga
function hideLoadingSpinner() {
    loadingSpinner.classList.add('hidden');
    setTimeout(() => {
        loadingSpinner.style.display = 'none';
    }, 500);
}

// Mostrar spinner de carga
function showLoadingSpinner() {
    loadingSpinner.style.display = 'flex';
    loadingSpinner.classList.remove('hidden');
}

// 1) Buscar hoteles usando Nominatim (OpenStreetMap)
async function searchHotelsNearStadium() {
    clearResults();
    showLoadingSpinner();
    
    // construir bbox pequeño alrededor del estadio (0.03° ~ 3km aprox)
    const lat = stadium[1], lon = stadium[0];
    const delta = 0.03;
    const viewbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

    // Nominatim search: tipo "hotel"
    const q = encodeURIComponent('hotel');
    const url = `https://nominatim.openstreetmap.org/search.php?q=${q}&format=jsonv2&viewbox=${viewbox}&bounded=1&limit=10`;

    try {
        const res = await fetch(url, { 
            headers: { 
                'Accept-Language': 'es',
                'User-Agent': 'TravelPlanner/1.0'
            } 
        });
        const data = await res.json();
        
        hideLoadingSpinner();
        btnSearch.innerHTML = '<i class="fas fa-hotel me-2"></i>Buscar hoteles';
        btnSearch.disabled = false;
        
        if (!data || data.length === 0) {
            resultsDiv.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-hotel fa-2x text-muted mb-3"></i>
                    <p class="mb-0">No se encontraron hoteles cerca del estadio</p>
                    <small class="text-muted">Intenta ampliar el área de búsqueda</small>
                </div>`;
            hotelCount.textContent = '0';
            showNotification('No se encontraron hoteles en el área', 'warning');
            return;
        }

        // Actualizar contador
        hotelCount.textContent = data.length;
        showNotification(`Encontrados ${data.length} hoteles`, 'success');
        
        // Limpiar y mostrar resultados
        resultsDiv.innerHTML = '';
        data.forEach((place, idx) => {
            const name = place.display_name || `Hotel ${idx+1}`;
            const latp = parseFloat(place.lat);
            const lonp = parseFloat(place.lon);
            
            // Calcular distancia aproximada
            const distance = calculateDistance(stadium[1], stadium[0], latp, lonp);

            // Crear elemento de hotel
            const div = document.createElement('div');
            div.className = 'place';
            div.dataset.idx = idx;
            div.innerHTML = `
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <strong>${name.split(',')[0]}</strong>
                        <div class="place-distance">${distance} km</div>
                    </div>
                    <i class="fas fa-bed text-primary"></i>
                </div>
                <small class="text-muted">${name.split(',').slice(0, 3).join(',')}</small>
            `;
            
            div.addEventListener('click', () => {
                // Remover clase active de todos los lugares
                document.querySelectorAll('.place').forEach(p => p.classList.remove('active'));
                // Añadir clase active al seleccionado
                div.classList.add('active');
                selectedHotel = { lon: lonp, lat: latp, name: name };
                
                // Centrar y dibujar ruta
                map.setView([latp, lonp], 16);
                addHotelMarker(lonp, latp, name);
                drawRouteOSRM([stadium[0], stadium[1]], [lonp, latp], modeSelect.value);
            });

            resultsDiv.appendChild(div);

            // Marcador en mapa
            const hotelIcon = L.divIcon({
                html: `<div class="hotel-marker"><i class="fas fa-bed"></i></div>`,
                iconSize: [35, 35],
                iconAnchor: [17, 35],
                className: 'hotel-icon'
            });
            
            const m = L.marker([latp, lonp], { icon: hotelIcon })
                .addTo(map)
                .bindPopup(`
                    <div class="popup-content">
                        <h6><i class="fas fa-bed text-primary"></i> ${name.split(',')[0]}</h6>
                        <p class="mb-1"><small>${distance} km del estadio</small></p>
                        <p class="mb-0"><small>${name.split(',').slice(1, 3).join(',')}</small></p>
                    </div>
                `);
            hotelMarkers.push(m);
        });

        // Scroll suave a resultados
        resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
    } catch (err) {
        console.error(err);
        hideLoadingSpinner();
        btnSearch.innerHTML = '<i class="fas fa-hotel me-2"></i>Buscar hoteles';
        btnSearch.disabled = false;
        
        resultsDiv.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle fa-2x text-danger mb-3"></i>
                <p class="mb-0">Error buscando hoteles</p>
                <small class="text-muted">Intenta nuevamente en unos momentos</small>
            </div>`;
        showNotification('Error de conexión con el servidor', 'error');
    }
}

// Calcular distancia entre dos puntos (fórmula Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return (R * c).toFixed(1);
}

function addHotelMarker(lon, lat, title) {
    // Remover markers previos de selección
    hotelMarkers.forEach(m => map.removeLayer(m));
    hotelMarkers = [];

    const selectedHotelIcon = L.divIcon({
        html: `<div class="selected-hotel-marker"><i class="fas fa-star"></i></div>`,
        iconSize: [45, 45],
        iconAnchor: [22, 45],
        className: 'selected-hotel-icon'
    });
    
    const marker = L.marker([lat, lon], { 
        icon: selectedHotelIcon,
        zIndexOffset: 1000 
    }).addTo(map).bindPopup(`
        <div class="popup-content">
            <h6><i class="fas fa-star text-warning"></i> ${title.split(',')[0]}</h6>
            <p class="mb-0"><small>Hotel seleccionado</small></p>
        </div>
    `).openPopup();
    hotelMarkers.push(marker);
}

// 2) Pedir ruta a OSRM Public Server y dibujarla
async function drawRouteOSRM(startLonLat, endLonLat, profile = 'driving') {
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }

    const coords = `${startLonLat[0]},${startLonLat[1]};${endLonLat[0]},${endLonLat[1]}`;
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;

    routeInfo.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i>Calculando ruta...`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data || !data.routes || data.routes.length === 0) {
            routeInfo.innerHTML = `<i class="fas fa-exclamation-triangle text-warning me-2"></i>No se encontró ruta disponible`;
            showNotification('No hay ruta disponible para este destino', 'warning');
            return;
        }

        const route = data.routes[0];
        const geojson = route.geometry;

        // Dibujar ruta con estilo según el modo
        const routeStyle = {
            driving: { color: '#4361ee', weight: 6, opacity: 0.8 },
            walking: { color: '#2ec4b6', weight: 4, opacity: 0.8, dashArray: '10, 10' },
            cycling: { color: '#ff9f1c', weight: 4, opacity: 0.8 }
        };

        routeLayer = L.geoJSON(geojson, {
            style: routeStyle[profile] || routeStyle.driving
        }).addTo(map);

        // Ajustar vista
        const coordsLatLng = geojson.coordinates.map(c => [c[1], c[0]]);
        const bounds = L.latLngBounds(coordsLatLng);
        map.fitBounds(bounds.pad(0.2));

        // Mostrar información de la ruta
        const distKm = (route.distance / 1000).toFixed(2);
        const durMin = Math.round(route.duration / 60);
        
        const modeIcons = {
            driving: 'fa-car',
            walking: 'fa-walking',
            cycling: 'fa-bicycle'
        };
        
        routeInfo.innerHTML = `
            <i class="fas ${modeIcons[profile] || 'fa-route'} text-primary me-2"></i>
            <strong>Ruta (${profile}):</strong> ${distKm} km • ${durMin} min
        `;
        
        showNotification(`Ruta calculada: ${distKm} km (${durMin} min)`, 'success');
        
    } catch (err) {
        console.error(err);
        routeInfo.innerHTML = `<i class="fas fa-exclamation-triangle text-danger me-2"></i>Error calculando ruta`;
        showNotification('Error al calcular la ruta', 'error');
    }
}

// Actualizar ruta cuando cambia el modo
function updateRoute() {
    if (selectedHotel) {
        drawRouteOSRM([stadium[0], stadium[1]], [selectedHotel.lon, selectedHotel.lat], modeSelect.value);
    }
}

function clearResults() {
    resultsDiv.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-search fa-2x text-muted mb-3"></i>
            <p class="mb-0">Presiona "Buscar hoteles" para encontrar alojamientos cerca del Estadio Azteca</p>
        </div>`;
    
    hotelMarkers.forEach(m => map.removeLayer(m));
    hotelMarkers = [];
    
    if (routeLayer) { 
        map.removeLayer(routeLayer); 
        routeLayer = null; 
    }
    
    selectedHotel = null;
    map.setView([stadium[1], stadium[0]], 14);
    hotelCount.textContent = '0';
    routeInfo.innerHTML = `<i class="fas fa-info-circle text-info me-2"></i>Selecciona un hotel para ver la ruta`;
    
    // Remover clase active de todos los lugares
    document.querySelectorAll('.place').forEach(p => p.classList.remove('active'));
}

// Ocultar spinner inicial después de cargar el mapa
map.whenReady(() => {
    setTimeout(() => {
        hideLoadingSpinner();
    }, 1000);
});

// Añadir estilos para los iconos personalizados
const style = document.createElement('style');
style.textContent = `
    .stadium-marker {
        background: linear-gradient(135deg, #4361ee, #3a0ca3);
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 1.2rem;
        box-shadow: 0 4px 12px rgba(67, 97, 238, 0.4);
        border: 3px solid white;
        animation: pulse 2s infinite;
    }
    
    .hotel-marker {
        background: linear-gradient(135deg, #2ec4b6, #4361ee);
        width: 35px;
        height: 35px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 1rem;
        box-shadow: 0 3px 10px rgba(46, 196, 182, 0.4);
        border: 2px solid white;
    }
    
    .selected-hotel-marker {
        background: linear-gradient(135deg, #ff9f1c, #e71d36);
        width: 45px;
        height: 45px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 1.3rem;
        box-shadow: 0 4px 15px rgba(255, 159, 28, 0.5);
        border: 3px solid white;
        animation: bounce 1s infinite alternate;
    }
    
    @keyframes bounce {
        from { transform: translateY(0); }
        to { transform: translateY(-5px); }
    }
    
    .popup-content {
        font-family: 'Poppins', sans-serif;
        min-width: 200px;
    }
    
    .popup-content h6 {
        color: #3a0ca3;
        margin-bottom: 0.5rem;
    }
`;
document.head.appendChild(style);