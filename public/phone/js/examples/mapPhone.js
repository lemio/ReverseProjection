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
  var resizeHandler = null;

  // The EXPAND factor makes the map container larger than its wrapper so that
  // rotation does not clip the tiles at the edges.
  var EXPAND = 1.5; // inner map is 150% width & height, centred via negative margin

  function init(el, sendFn) {
    sendTouch = sendFn;
    // Outer wrapper clips to the visible area; inner div is oversized for rotation.
    el.innerHTML =
      '<div id="phone-map-wrap" style="position:relative;width:100%;height:100%;' +
      '     overflow:hidden;flex:1;min-height:0;">' +
      '  <div id="phone-map" style="position:absolute;' +
      '    width:' + (EXPAND * 100) + '%;height:' + (EXPAND * 100) + '%;' +
      '    top:' + (-(EXPAND - 1) / 2 * 100) + '%;' +
      '    left:' + (-(EXPAND - 1) / 2 * 100) + '%;"></div>' +
      '</div>';

    console.log('[MapPhone] init: creating Leaflet map after 80ms delay');
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
      // overflow:visible prevents Leaflet's default clip from cutting strokes at the pane edge.
      map.createPane('drawPane');
      map.getPane('drawPane').style.zIndex = 650;
      map.getPane('drawPane').style.overflow = 'visible';

      // Force Leaflet to re-measure the container after layout settles
      map.invalidateSize();
      console.log('[MapPhone] Leaflet map created at zoom', map.getZoom());

      // Re-measure whenever the window resizes (e.g. orientation change)
      resizeHandler = function() { if (map) map.invalidateSize(); };
      window.addEventListener('resize', resizeHandler);

      // Touch drawing — attach to wrapper so events fire before CSS rotation
      var wrapper = document.getElementById('phone-map-wrap');
      wrapper.addEventListener('touchstart', onTouchStart, { passive: false });
      wrapper.addEventListener('touchmove',  onTouchMove,  { passive: false });
      wrapper.addEventListener('touchend',   onTouchEnd,   { passive: false });
      wrapper.addEventListener('mousedown',  onMouseDown);
      wrapper.addEventListener('mousemove',  onMouseMove);
      wrapper.addEventListener('mouseup',    onMouseUp);

      // Re-apply last received state if we got it before init
      if (lastState) {
        console.log('[MapPhone] Replaying lastState after init');
        onState(lastState);
      }
    }, 80);
  }

  function invalidate() {
    if (map) map.invalidateSize();
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

      // Don't pan/zoom while the user is actively drawing — it would shift the canvas
      // under their finger and produce jagged strokes.
      if (!isDrawing && !mouseDown) {
        // Use animate:false so rapid position updates aren't lost to interrupted animations
        if (lastZoom !== newZoom) {
          lastZoom = newZoom;
          map.setView([state.phoneLat, state.phoneLng], newZoom, { animate: false });
        } else {
          map.panTo([state.phoneLat, state.phoneLng], { animate: false });
        }
      }
    } else if (!state.detected && stateLogCount % 30 === 1) {
      console.log('[MapPhone] Phone not detected — map stays at current view');
    }

    // Apply rotation: rotate the oversized inner map container.
    // The outer wrapper (overflow:hidden) clips to the visible viewport so the
    // oversized inner div absorbs any edge that would otherwise be cut off.
    var rotation = (state.mapRotation != null) ? state.mapRotation : 0;
    var container = map.getContainer();
    if (rotation !== 0) {
      container.style.transformOrigin = 'center center';
      container.style.transform = 'rotate(' + (-rotation).toFixed(4) + 'rad)';
    } else {
      container.style.transform = '';
    }
  }

  // Convert a touch/mouse event to a Leaflet LatLng.
  // When the map container is rotated we must un-rotate the touch point relative
  // to the wrapper centre before passing it to Leaflet's coordinate system.
  function eventToLatLng(e) {
    if (!map) return null;
    var touch   = e.touches ? e.touches[0] : e;
    var rotation = (lastState && lastState.mapRotation) ? lastState.mapRotation : 0;

    // The map container (inner div) is EXPAND× larger than the wrapper.
    // Touch events are captured on the wrapper — convert to the inner map's space.
    var wrapper = document.getElementById('phone-map-wrap');
    var wrapRect = wrapper ? wrapper.getBoundingClientRect() : map.getContainer().getBoundingClientRect();

    // Centre of the visible (wrapper) area in screen pixels
    var wx = wrapRect.left + wrapRect.width  / 2;
    var wy = wrapRect.top  + wrapRect.height / 2;

    // Touch position relative to wrapper centre
    var dx = touch.clientX - wx;
    var dy = touch.clientY - wy;

    // Un-rotate: apply inverse of CSS rotation.
    // CSS rotate(-θ) was applied; to invert, rotate by +θ.
    var ux = Math.cos(rotation) * dx - Math.sin(rotation) * dy;
    var uy = Math.sin(rotation) * dx + Math.cos(rotation) * dy;

    // The Leaflet container is EXPAND× the wrapper.
    // Leaf's containerPointToLatLng expects coords relative to the map container's
    // own top-left corner. The container is centred in (and extends beyond) the
    // wrapper, so the container's top-left is at:
    //   wrapper_centre - EXPAND * wrapper_size / 2
    // In relative terms (from wrapper centre):
    //   container_half_w = EXPAND * wrapRect.width  / 2
    //   container_half_h = EXPAND * wrapRect.height / 2
    var cHalfW = EXPAND * wrapRect.width  / 2;
    var cHalfH = EXPAND * wrapRect.height / 2;
    var px = ux + cHalfW;
    var py = uy + cHalfH;

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
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    // Remove listeners from wrapper (new) or container (fallback)
    var wrapper = document.getElementById('phone-map-wrap');
    var evtTarget = wrapper || (map && map.getContainer());
    if (evtTarget) {
      evtTarget.removeEventListener('touchstart', onTouchStart);
      evtTarget.removeEventListener('touchmove',  onTouchMove);
      evtTarget.removeEventListener('touchend',   onTouchEnd);
      evtTarget.removeEventListener('mousedown',  onMouseDown);
      evtTarget.removeEventListener('mousemove',  onMouseMove);
      evtTarget.removeEventListener('mouseup',    onMouseUp);
    }
    if (map) { map.remove(); map = null; }
    drawLayer    = null;
    currentPath  = null;
    sendTouch    = null;
    lastState    = null;
    lastZoom     = null;
    stateLogCount = 0;
    isDrawing    = false;
    mouseDown    = false;
  }

  return { init, onState, invalidate, destroy };
})();
