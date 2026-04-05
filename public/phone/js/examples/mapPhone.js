window.MapPhone = (function() {
  // Tile layer subclass that loads +1 extra tile on every side of the
  // visible viewport for smoother panning without blank edges.
  var BufferedTileLayer = L.TileLayer.extend({
    _getTiledPixelBounds: function(center) {
      var bounds = L.TileLayer.prototype._getTiledPixelBounds.call(this, center);
      var ts = this.getTileSize();
      return new L.Bounds(
        bounds.min.subtract([ts.x, ts.y]),
        bounds.max.add([ts.x, ts.y])
      );
    }
  });

  var map = null;
  var drawLayer = null;
  var currentPath = null;
  var isDrawing = false;
  var mouseDown = false;
  var sendTouch = null;
  var lastState = null;
  var lastZoom = null;
  var stateLogCount = 0;

  function init(el, sendFn) {
    sendTouch = sendFn;
    el.innerHTML = '<div id="phone-map" style="width:100%;height:100%;min-height:0;flex:1;"></div>';
    console.log('[MapPhone] init: creating Leaflet map after 80ms delay');
    // Slight delay so the container has layout dimensions
    setTimeout(function() {
      var container = document.getElementById('phone-map');
      console.log('[MapPhone] container size:', container.offsetWidth, 'x', container.offsetHeight);
      map = L.map('phone-map', {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        touchZoom: false,
        doubleClickZoom: false,
        scrollWheelZoom: false,
        keyboard: false
      }).setView([51.505, -0.09], 16);

      new BufferedTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      drawLayer = L.layerGroup().addTo(map);

      // Custom pane for drawn paths — z-index 650 keeps them above tiles (200)
      // and the default overlayPane (400) at all times, including after rotation.
      map.createPane('drawPane');
      map.getPane('drawPane').style.zIndex = 650;

      // Force Leaflet to re-measure the container after layout settles
      map.invalidateSize();
      console.log('[MapPhone] Leaflet map created at zoom', map.getZoom());

      // Touch drawing
      var mapContainer = map.getContainer();
      mapContainer.addEventListener('touchstart', onTouchStart, { passive: false });
      mapContainer.addEventListener('touchmove',  onTouchMove,  { passive: false });
      mapContainer.addEventListener('touchend',   onTouchEnd,   { passive: false });
      mapContainer.addEventListener('mousedown',  onMouseDown);
      mapContainer.addEventListener('mousemove',  onMouseMove);
      mapContainer.addEventListener('mouseup',    onMouseUp);

      // Re-apply last received state if we got it before init
      if (lastState) {
        console.log('[MapPhone] Replaying lastState after init');
        onState(lastState);
      }
    }, 80);
  }

  function onState(state) {
    lastState = state;
    stateLogCount++;

    if (stateLogCount % 30 === 1) {
      // Log every 30th state (throttled) — always log the first one
      console.log('[MapPhone] onState #' + stateLogCount +
        ' | detected=' + (state && state.detected) +
        ' | phoneLat=' + (state && state.phoneLat != null ? state.phoneLat.toFixed(5) : 'null') +
        ' | phoneLng=' + (state && state.phoneLng != null ? state.phoneLng.toFixed(5) : 'null') +
        ' | mapZoom=' + (state && state.mapZoom) +
        ' | mapRotation=' + (state && state.mapRotation != null ? state.mapRotation.toFixed(2) : '0') +
        ' | map ready=' + (map !== null));
    }

    if (!map || !state) return;
    if (state.type !== 'map') return;

    if (state.detected && state.phoneLat != null && state.phoneLng != null) {
      var newZoom = Math.min(18, (state.mapZoom || 13) + 3);

      if (stateLogCount % 30 === 1) {
        console.log('[MapPhone] Moving map to [' + state.phoneLat.toFixed(5) + ', ' +
          state.phoneLng.toFixed(5) + '] zoom ' + newZoom);
      }

      // Use animate:false so rapid position updates aren't lost to interrupted animations
      if (lastZoom !== newZoom) {
        lastZoom = newZoom;
        map.setView([state.phoneLat, state.phoneLng], newZoom, { animate: false });
      } else {
        map.panTo([state.phoneLat, state.phoneLng], { animate: false });
      }
    } else if (!state.detected && stateLogCount % 30 === 1) {
      console.log('[MapPhone] Phone not detected — map stays at current view');
    }

    // Apply rotation: rotate the map container to match the phone's physical orientation
    var rotation = (state.mapRotation != null) ? state.mapRotation : 0;
    var container = map.getContainer();
    if (rotation !== 0) {
      container.style.transformOrigin = 'center center';
      container.style.transform = 'rotate(' + rotation.toFixed(4) + 'rad)';
    } else {
      container.style.transform = '';
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
      currentPath = L.polyline([ll], { color: '#e94560', weight: 4, opacity: 0.9, pane: 'drawPane' }).addTo(drawLayer);
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
      currentPath = L.polyline([ll], { color: '#e94560', weight: 4, opacity: 0.9, pane: 'drawPane' }).addTo(drawLayer);
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
    drawLayer    = null;
    currentPath  = null;
    sendTouch    = null;
    lastState    = null;
    lastZoom     = null;
    stateLogCount = 0;
    isDrawing    = false;
    mouseDown    = false;
  }

  return { init, onState, destroy };
})();
