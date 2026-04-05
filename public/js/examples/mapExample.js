window.MapExample = (function() {
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
  var drawingLayer = null;
  var phoneViewRect = null;    // L.rectangle showing the phone's visible map area
  var currentPath = null;
  var isDrawing = false;
  var panel = null;
  var detected = false;
  // Normalised camera-frame position of the phone centre (0–1)
  var phoneNX = 0.5, phoneNY = 0.5;
  var phoneRotation = 0;     // radians, from the detection layer
  var rotationEnabled = false;
  var positionLogCount = 0;

  function init(panelEl) {
    panel = panelEl;
    panel.innerHTML = '<div id="map-container" style="width:100%;height:100%;min-height:400px;"></div>';
    map = L.map('map-container', { zoomControl: true }).setView([51.505, -0.09], 13);
    new BufferedTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
      opacity: 0.85
    }).addTo(map);
    drawingLayer = L.layerGroup().addTo(map);

    // Custom pane for drawn paths — z-index 650 keeps them above tiles (200)
    // and the default overlayPane (400) at all times.
    // overflow:visible prevents Leaflet's default clip from cutting strokes at the pane edge.
    map.createPane('drawPane');
    map.getPane('drawPane').style.zIndex = 650;
    map.getPane('drawPane').style.overflow = 'visible';

    console.log('[MapExample] Leaflet map initialized at', map.getCenter(), 'zoom', map.getZoom());
  }

  // Enable/disable rotation forwarding to the phone's mini-map
  function setRotationEnabled(enabled) {
    rotationEnabled = !!enabled;
    console.log('[MapExample] rotationEnabled=' + rotationEnabled);
  }

  // Convert normalised camera position to lat/lng using the map's current bounds
  function cameraToLatLng(nx, ny) {
    var bounds = map.getBounds();
    var north = bounds.getNorth(), south = bounds.getSouth();
    var west  = bounds.getWest(),  east  = bounds.getEast();
    return L.latLng(north - ny * (north - south), west + nx * (east - west));
  }

  function onPhonePosition(nx, ny, rotation) {
    phoneNX = nx;
    phoneNY = ny;
    phoneRotation = rotation || 0;
    detected = true;
    if (!map) return;

    // Draw / update the bounding box showing the phone's visible map area
    updatePhoneViewRect();

    positionLogCount++;
    if (positionLogCount % 60 === 1) {
      var center = cameraToLatLng(nx, ny);
      var bounds = map.getBounds();
      console.log('[MapExample] onPhonePosition #' + positionLogCount +
        ' | nx=' + nx.toFixed(3) + ' ny=' + ny.toFixed(3) +
        ' rot=' + (rotation || 0).toFixed(2) +
        ' → lat=' + center.lat.toFixed(5) + ' lng=' + center.lng.toFixed(5) +
        ' | mapBounds N=' + bounds.getNorth().toFixed(4) +
        ' S=' + bounds.getSouth().toFixed(4) +
        ' W=' + bounds.getWest().toFixed(4) +
        ' E=' + bounds.getEast().toFixed(4));
    }
  }

  function onDetectionChange(isDetected) {
    detected = isDetected;
    if (!isDetected && phoneViewRect) {
      phoneViewRect.setStyle({ opacity: 0.25, fillOpacity: 0.03 });
    } else if (isDetected && phoneViewRect) {
      phoneViewRect.setStyle({ opacity: 1, fillOpacity: 0.06 });
    }
    console.log('[MapExample] onDetectionChange → detected=' + isDetected);
  }

  // Calculate and draw the rectangle representing the phone's visible map area.
  // The phone renders its mini-map at (mapZoom + 3) centred on the phone's lat/lng.
  // A representative phone viewport of 200 x 400 px is used for the calculation.
  function updatePhoneViewRect() {
    var center = cameraToLatLng(phoneNX, phoneNY);
    var phoneZoom = Math.min(18, map.getZoom() + 3);
    var halfW = 100; // half of representative phone viewport width in px
    var halfH = 200; // half of representative phone viewport height in px
    var centerPx = map.project(center, phoneZoom);
    var sw = map.unproject(L.point(centerPx.x - halfW, centerPx.y + halfH), phoneZoom);
    var ne = map.unproject(L.point(centerPx.x + halfW, centerPx.y - halfH), phoneZoom);
    var bounds = L.latLngBounds(sw, ne);

    if (!phoneViewRect) {
      phoneViewRect = L.rectangle(bounds, {
        color: '#4d7cfe',
        weight: 2,
        fill: true,
        fillColor: '#4d7cfe',
        fillOpacity: 0.06,
        dashArray: '6 4',
        interactive: false
      }).addTo(map);
      phoneViewRect.bindTooltip('Phone viewport', { permanent: false, direction: 'top' });
    } else {
      phoneViewRect.setBounds(bounds);
    }
  }

  function onPhoneTouch(data) {
    if (!map) return;

    // Handle end-of-drawing first — it carries no lat/lng
    if (data.type === 'end') {
      isDrawing = false;
      currentPath = null;
      console.log('[MapExample] Drawing end');
      return;
    }

    var latlng;
    if (data.lat !== undefined && data.lng !== undefined) {
      // Phone sends lat/lng directly
      latlng = L.latLng(data.lat, data.lng);
    } else if (data.x != null && data.y != null) {
      // Legacy: x,y within the phone's mini-map area
      var containerSize = map.getContainer().getBoundingClientRect();
      latlng = map.containerPointToLatLng([data.x * containerSize.width, data.y * containerSize.height]);
    } else {
      return; // no usable position data
    }

    if (data.type === 'start') {
      isDrawing = true;
      currentPath = L.polyline([latlng], { color: '#e94560', weight: 3, opacity: 0.9, pane: 'drawPane' }).addTo(drawingLayer);
      console.log('[MapExample] Drawing start at lat=' + latlng.lat.toFixed(5) + ' lng=' + latlng.lng.toFixed(5));
    } else if (data.type === 'move' && isDrawing && currentPath) {
      currentPath.addLatLng(latlng);
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
      },
      // Only forward rotation when the feature is enabled on the laptop
      mapRotation: rotationEnabled ? phoneRotation : 0
    };
  }

  function destroy() {
    if (map) { map.remove(); map = null; }
    drawingLayer = null;
    currentPath = null;
    phoneViewRect = null;
    isDrawing = false;
    detected = false;
    positionLogCount = 0;
    console.log('[MapExample] destroyed');
  }

  return { init, onPhonePosition, onDetectionChange, onPhoneTouch, getState, destroy, setRotationEnabled };
})();
