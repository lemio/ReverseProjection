window.MapExample = (function() {
  var map = null;
  var drawingLayer = null;
  var phoneMarker = null;
  var currentPath = null;
  var isDrawing = false;
  var panel = null;
  var detected = false;
  // Normalised camera-frame position of the phone centre (0–1)
  var phoneNX = 0.5, phoneNY = 0.5;
  var positionLogCount = 0;

  function init(panelEl) {
    panel = panelEl;
    panel.innerHTML = '<div id="map-container" style="width:100%;height:100%;min-height:400px;"></div>';
    map = L.map('map-container', { zoomControl: true }).setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      opacity: 0.85
    }).addTo(map);
    drawingLayer = L.layerGroup().addTo(map);

    // Custom pulsing icon for the phone marker
    var phoneIcon = L.divIcon({
      className: 'phone-map-icon',
      html: '<div class="phone-dot"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    phoneMarker = L.marker([51.505, -0.09], { icon: phoneIcon }).addTo(map);
    phoneMarker.bindTooltip('📱 Phone', { permanent: false });
    console.log('[MapExample] Leaflet map initialized at', map.getCenter(), 'zoom', map.getZoom());
  }

  // Convert normalised camera position to lat/lng using the map's current bounds
  function cameraToLatLng(nx, ny) {
    var bounds = map.getBounds();
    var north = bounds.getNorth(), south = bounds.getSouth();
    var west  = bounds.getWest(),  east  = bounds.getEast();
    return L.latLng(north - ny * (north - south), west + nx * (east - west));
  }

  function onPhonePosition(nx, ny) {
    phoneNX = nx;
    phoneNY = ny;
    detected = true;
    if (!map) return;
    var latlng = cameraToLatLng(nx, ny);
    phoneMarker.setLatLng(latlng);

    positionLogCount++;
    if (positionLogCount % 60 === 1) {
      var bounds = map.getBounds();
      console.log('[MapExample] onPhonePosition #' + positionLogCount +
        ' | nx=' + nx.toFixed(3) + ' ny=' + ny.toFixed(3) +
        ' → lat=' + latlng.lat.toFixed(5) + ' lng=' + latlng.lng.toFixed(5) +
        ' | mapBounds N=' + bounds.getNorth().toFixed(4) +
        ' S=' + bounds.getSouth().toFixed(4) +
        ' W=' + bounds.getWest().toFixed(4) +
        ' E=' + bounds.getEast().toFixed(4));
    }
  }

  function onDetectionChange(isDetected) {
    detected = isDetected;
    if (phoneMarker) {
      phoneMarker.setOpacity(isDetected ? 1 : 0.25);
    }
    console.log('[MapExample] onDetectionChange → detected=' + isDetected);
  }

  function onPhoneTouch(data) {
    if (!map) return;
    var latlng;
    if (data.lat !== undefined && data.lng !== undefined) {
      // Phone sends lat/lng directly
      latlng = L.latLng(data.lat, data.lng);
    } else {
      // Legacy: x,y within the phone's mini-map area
      var containerSize = map.getContainer().getBoundingClientRect();
      latlng = map.containerPointToLatLng([data.x * containerSize.width, data.y * containerSize.height]);
    }

    if (data.type === 'start') {
      isDrawing = true;
      currentPath = L.polyline([latlng], { color: '#e94560', weight: 3, opacity: 0.9 }).addTo(drawingLayer);
      console.log('[MapExample] Drawing start at lat=' + latlng.lat.toFixed(5) + ' lng=' + latlng.lng.toFixed(5));
    } else if (data.type === 'move' && isDrawing && currentPath) {
      currentPath.addLatLng(latlng);
    } else if (data.type === 'end') {
      isDrawing = false;
      currentPath = null;
      console.log('[MapExample] Drawing end');
    }
  }

  function getState() {
    if (!map) return null;
    var bounds = map.getBounds();
    var phoneLat = null, phoneLng = null;
    if (detected) {
      var ll = cameraToLatLng(phoneNX, phoneNY);
      phoneLat = ll.lat;
      phoneLng = ll.lng;
    }
    return {
      type: 'map',
      detected: detected,
      phoneLat: phoneLat,
      phoneLng: phoneLng,
      mapZoom: map.getZoom(),
      mapBounds: {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        west:  bounds.getWest(),
        east:  bounds.getEast()
      }
    };
  }

  function destroy() {
    if (map) { map.remove(); map = null; }
    drawingLayer = null;
    currentPath = null;
    phoneMarker = null;
    isDrawing = false;
    detected = false;
    positionLogCount = 0;
    console.log('[MapExample] destroyed');
  }

  return { init, onPhonePosition, onDetectionChange, onPhoneTouch, getState, destroy };
})();
