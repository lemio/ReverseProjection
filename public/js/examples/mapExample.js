window.MapExample = (function() {
  let map = null;
  let drawingLayer = null;
  let currentPath = null;
  let isDrawing = false;
  let panel = null;
  let panAnimFrame = null;
  let phoneX = 0.5;
  let phoneY = 0.5;

  function init(panelEl) {
    panel = panelEl;
    panel.innerHTML = '<div id="map-container" style="width:100%;height:100%;min-height:400px;"></div>';
    map = L.map('map-container').setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);
    drawingLayer = L.layerGroup().addTo(map);
    panAnimFrame = requestAnimationFrame(panLoop);
  }

  // Velocity-based panning: phone offset from centre drives pan speed
  function panLoop() {
    panAnimFrame = requestAnimationFrame(panLoop);
    if (!map) return;
    const deadzone = 0.08;
    const dx = phoneX - 0.5;
    const dy = phoneY - 0.5;
    if (Math.abs(dx) < deadzone && Math.abs(dy) < deadzone) return;
    const speed = 0.00015; // degrees per frame at max offset
    const center = map.getCenter();
    map.panTo(
      [center.lat - dy * speed * 60, center.lng + dx * speed * 60],
      { animate: false }
    );
  }

  function onPhonePosition(normalizedX, normalizedY) {
    phoneX = normalizedX;
    phoneY = normalizedY;
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
    if (panAnimFrame) { cancelAnimationFrame(panAnimFrame); panAnimFrame = null; }
    if (map) { map.remove(); map = null; }
    drawingLayer = null;
    currentPath = null;
    isDrawing = false;
  }

  return { init, onPhonePosition, onPhoneTouch, destroy };
})();
