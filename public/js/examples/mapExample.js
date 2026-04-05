window.MapExample = (function() {
  let map = null;
  let drawingLayer = null;
  let currentPath = null;
  let isDrawing = false;
  let panel = null;
  let lastPanTime = 0;

  function init(panelEl) {
    panel = panelEl;
    panel.innerHTML = '<div id="map-container" style="width:100%;height:100%;min-height:400px;"></div>';
    map = L.map('map-container').setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);
    drawingLayer = L.layerGroup().addTo(map);
  }

  function onPhonePosition(normalizedX, normalizedY) {
    if (!map) return;
    const now = Date.now();
    if (now - lastPanTime < 100) return;
    lastPanTime = now;
    const offsetX = (normalizedX - 0.5) * 0.5;
    const offsetY = (normalizedY - 0.5) * 0.5;
    const center = map.getCenter();
    map.panTo([center.lat - offsetY * 5, center.lng + offsetX * 5], { animate: false });
  }

  function onPhoneTouch(data) {
    if (!map) return;
    const containerSize = map.getContainer().getBoundingClientRect();
    const px = data.x * containerSize.width;
    const py = data.y * containerSize.height;
    const latlng = map.containerPointToLatLng([px, py]);

    if (data.type === 'start') {
      isDrawing = true;
      currentPath = L.polyline([latlng], { color: '#e94560', weight: 3, opacity: 0.8 }).addTo(drawingLayer);
    } else if (data.type === 'move' && isDrawing && currentPath) {
      currentPath.addLatLng(latlng);
    } else if (data.type === 'end') {
      isDrawing = false;
      currentPath = null;
    }
  }

  function destroy() {
    if (map) { map.remove(); map = null; }
    drawingLayer = null;
    currentPath = null;
    isDrawing = false;
  }

  return { init, onPhonePosition, onPhoneTouch, destroy };
})();
