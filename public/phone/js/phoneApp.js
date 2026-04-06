(function() {
  // ── Stable client ID (from localStorage) ─────────────────────────────────
  // This is generated once per device so the server can assign the same marker
  // ID across page refreshes, which prevents phantom markers from accumulating.
  var CLIENT_ID = window.RP_CLIENT_ID || 'unknown';

  // Marker ID is assigned by the server after registration.
  // Default 0 is only used until the server responds.
  var PHONE_MARKER_ID = 0;

  var socket = null;
  var currentExample = 'map';
  var examples = { map: window.MapPhone, tldraw: window.TldrawPhone };
  var activePhoneExample = null;
  var stateCount = 0;

  function redrawMarker() {
    var s = document.getElementById('marker-single');
    if (s) drawJSARMarker(s, PHONE_MARKER_ID, s.offsetWidth || 280);
  }

  // Emit viewport dimensions so the laptop can compute the correct scale.
  function emitViewport() {
    if (!socket) return;
    var s       = document.getElementById('marker-single');
    var content = document.getElementById('example-content');
    socket.emit('phone:viewport', {
      markerId:        PHONE_MARKER_ID,
      markerDisplayPx: s ? (s.offsetWidth || 280) : 280,
      drawAreaW:       content ? (content.offsetWidth  || 375) : 375,
      drawAreaH:       content ? (content.offsetHeight || 500) : 500
    });
  }

  function connect() {
    socket = io();

    socket.on('connect', function() {
      stateCount = 0;
      // Send clientId so the server can give us a stable markerId
      socket.emit('device:register', { type: 'phone', clientId: CLIENT_ID });
    });

    // Server ack — contains the assigned markerId
    socket.on('device:registered', function(data) {
      PHONE_MARKER_ID = (data && data.markerId != null) ? data.markerId : 0;
      console.log('[PhoneApp] Registered | clientId=' + CLIENT_ID + ' | markerId=' + PHONE_MARKER_ID);

      document.getElementById('connecting-screen').style.display = 'none';
      document.getElementById('example-area').style.display = 'flex';
      var indicator = document.getElementById('connection-indicator');
      indicator.className = 'connected';
      indicator.textContent = 'Live';

      // Redraw marker with the correct ID
      redrawMarker();

      // Switch / re-init example with the correct marker ID
      switchExample(currentExample);

      setTimeout(emitViewport, 200);

      // Request any existing tldraw state
      socket.emit('tldraw:init-request');
    });

    socket.on('disconnect', function() {
      var indicator = document.getElementById('connection-indicator');
      indicator.className = '';
      indicator.textContent = 'Disconnected';
    });

    socket.on('config:change', function(data) {
      if (data.example && data.example !== currentExample) switchExample(data.example);
    });

    socket.on('laptop:state', function(state) {
      stateCount++;
      if (stateCount % 30 === 1) {
        console.log('[PhoneApp] laptop:state #' + stateCount +
          ' | detected=' + (state && state.detected) +
          ' | type=' + (state && state.type));
      }

      if (activePhoneExample && activePhoneExample.onState) {
        activePhoneExample.onState(state);
      }

      // Toggle searching class for spinner visibility — no marker resize
      var phoneApp = document.getElementById('phone-app');
      var wasSearching = phoneApp.classList.contains('searching');
      var nowSearching = state && state.detected === false;
      if (nowSearching !== wasSearching) {
        phoneApp.classList.toggle('searching', nowSearching);
        console.log('[PhoneApp] searching ' + (nowSearching ? 'ON' : 'OFF'));
      }
    });

    // ── tldraw store sync ──────────────────────────────────────────────────
    socket.on('tldraw:diff', function(diff) {
      if (activePhoneExample && activePhoneExample.onTldrawDiff) {
        activePhoneExample.onTldrawDiff(diff);
      }
    });
    socket.on('tldraw:snapshot', function(snapshot) {
      if (activePhoneExample && activePhoneExample.onTldrawSnapshot) {
        activePhoneExample.onTldrawSnapshot(snapshot);
      }
    });
  }

  function switchExample(name) {
    currentExample = name;
    var displayNames = { map: 'Map', tldraw: 'Draw' };
    document.getElementById('example-name').textContent = displayNames[name] || name;

    // tldraw-mode class adds extra top margin so the tldraw toolbar is accessible
    var phoneApp = document.getElementById('phone-app');
    phoneApp.classList.toggle('tldraw-mode', name === 'tldraw');

    if (activePhoneExample && activePhoneExample.destroy) activePhoneExample.destroy();
    activePhoneExample = examples[name] || null;
    var contentEl = document.getElementById('example-content');
    if (activePhoneExample && activePhoneExample.init) {
      activePhoneExample.init(
        contentEl,
        function(data) {
          if (!socket) return;
          if (data && data.type === 'tldraw:diff') {
            socket.emit('tldraw:diff', data.diff);
          } else if (data && data.type === 'tldraw:snapshot') {
            socket.emit('tldraw:snapshot', data.snapshot);
          } else {
            socket.emit('phone:touch', data);
          }
        },
        PHONE_MARKER_ID
      );
    }
    setTimeout(emitViewport, 300);
  }

  // Re-emit viewport on orientation / resize changes
  window.addEventListener('resize', function() { setTimeout(emitViewport, 200); });

  // Auto-connect immediately — no room code needed
  connect();
})();
