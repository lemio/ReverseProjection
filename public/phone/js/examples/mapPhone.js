window.MapPhone = (function() {
  var map = null;
  var drawLayer = null;
  var currentPath = null;
  var isDrawing = false;
  var mouseDown = false;
  var sendTouch = null;
  var lastState = null;

  function init(el, sendFn) {
    sendTouch = sendFn;
    el.innerHTML = '<div id="phone-map" style="width:100%;height:100%;"></div>';
    // Slight delay so the container has layout dimensions
    setTimeout(function() {
      map = L.map('phone-map', {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        touchZoom: false,
        doubleClickZoom: false,
        scrollWheelZoom: false,
        keyboard: false
      }).setView([51.505, -0.09], 16);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      drawLayer = L.layerGroup().addTo(map);

      // Touch drawing
      var container = map.getContainer();
      container.addEventListener('touchstart', onTouchStart, { passive: false });
      container.addEventListener('touchmove',  onTouchMove,  { passive: false });
      container.addEventListener('touchend',   onTouchEnd,   { passive: false });
      container.addEventListener('mousedown',  onMouseDown);
      container.addEventListener('mousemove',  onMouseMove);
      container.addEventListener('mouseup',    onMouseUp);

      // Re-apply last received state if we got it before init
      if (lastState) onState(lastState);
    }, 60);
  }

  function onState(state) {
    lastState = state;
    if (!map || !state) return;
    if (state.type !== 'map') return;

    // Centre mini-map on phone's current geographic position
    if (state.detected && state.phoneLat !== null && state.phoneLng !== null) {
      var zoom = Math.min(18, (state.mapZoom || 13) + 3);
      map.setView([state.phoneLat, state.phoneLng], zoom, { animate: true });
    }
  }

  // Convert a touch/mouse event to a Leaflet LatLng
  function eventToLatLng(e) {
    if (!map) return null;
    var touch = e.touches ? e.touches[0] : e;
    var rect  = map.getContainer().getBoundingClientRect();
    var px = touch.clientX - rect.left;
    var py = touch.clientY - rect.top;
    return map.containerPointToLatLng([px, py]);
  }

  function onTouchStart(e) {
    e.preventDefault();
    isDrawing = true;
    var ll = eventToLatLng(e);
    if (ll) {
      currentPath = L.polyline([ll], { color: '#e94560', weight: 4, opacity: 0.9 }).addTo(drawLayer);
      sendTouch({ type: 'start', lat: ll.lat, lng: ll.lng });
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (!isDrawing || !currentPath) return;
    var ll = eventToLatLng(e);
    if (ll) {
      currentPath.addLatLng(ll);
      sendTouch({ type: 'move', lat: ll.lat, lng: ll.lng });
    }
  }

  function onTouchEnd(e) {
    e.preventDefault();
    isDrawing = false;
    currentPath = null;
    sendTouch({ type: 'end' });
  }

  function onMouseDown(e) {
    mouseDown = true;
    var ll = eventToLatLng(e);
    if (ll) {
      currentPath = L.polyline([ll], { color: '#e94560', weight: 4, opacity: 0.9 }).addTo(drawLayer);
      sendTouch({ type: 'start', lat: ll.lat, lng: ll.lng });
    }
  }

  function onMouseMove(e) {
    if (!mouseDown || !currentPath) return;
    var ll = eventToLatLng(e);
    if (ll) {
      currentPath.addLatLng(ll);
      sendTouch({ type: 'move', lat: ll.lat, lng: ll.lng });
    }
  }

  function onMouseUp() {
    mouseDown = false;
    currentPath = null;
    sendTouch({ type: 'end' });
  }

  function destroy() {
    if (map) {
      var container = map.getContainer();
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove',  onTouchMove);
      container.removeEventListener('touchend',   onTouchEnd);
      container.removeEventListener('mousedown',  onMouseDown);
      container.removeEventListener('mousemove',  onMouseMove);
      container.removeEventListener('mouseup',    onMouseUp);
      map.remove();
      map = null;
    }
    drawLayer   = null;
    currentPath = null;
    sendTouch   = null;
    lastState   = null;
    isDrawing   = false;
    mouseDown   = false;
  }

  return { init, onState, destroy };
})();
