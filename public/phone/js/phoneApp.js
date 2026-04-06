(function() {
  // ── Marker ID — read from ?id= URL param (default 0) ─────────────────────
  var PHONE_MARKER_ID = (function() {
    var p = new URLSearchParams(window.location.search);
    return parseInt(p.get('id') || '0', 10);
  })();

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
    var s      = document.getElementById('marker-single');
    var content = document.getElementById('example-content');
    socket.emit('phone:viewport', {
      markerId:       PHONE_MARKER_ID,
      markerDisplayPx: s ? (s.offsetWidth || 280) : 280,
      drawAreaW:       content ? (content.offsetWidth  || 375) : 375,
      drawAreaH:       content ? (content.offsetHeight || 500) : 500
    });
  }

  function connect() {
    socket = io();

    socket.on('connect', function() {
      socket.emit('device:register', { type: 'phone', markerId: PHONE_MARKER_ID });
      stateCount = 0;
      document.getElementById('connecting-screen').style.display = 'none';
      document.getElementById('example-area').style.display = 'flex';
      var indicator = document.getElementById('connection-indicator');
      indicator.className = 'connected';
      indicator.textContent = 'Live';
      console.log('[PhoneApp] Connected | markerId=' + PHONE_MARKER_ID);
      switchExample(currentExample);
      // Small delay so the layout is ready before measuring
      setTimeout(emitViewport, 200);
      // Request any existing tldraw state from the server
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
          ' | type=' + (state && state.type) +
          ' | hasExample=' + (activePhoneExample !== null));
      }

      if (activePhoneExample && activePhoneExample.onState) {
        activePhoneExample.onState(state);
      }

      // Toggle searching class to grow the marker when the laptop can't see us
      var phoneApp = document.getElementById('phone-app');
      var wasSearching = phoneApp.classList.contains('searching');
      var nowSearching = state && state.detected === false;
      if (nowSearching !== wasSearching) {
        phoneApp.classList.toggle('searching', nowSearching);
        console.log('[PhoneApp] searching ' + (nowSearching ? 'ON' : 'OFF'));
        // Redraw marker after CSS transition finishes (size changed) then re-emit
        setTimeout(function() {
          redrawMarker();
          emitViewport();
        }, 450);
        if (activePhoneExample && activePhoneExample.invalidate) {
          setTimeout(function() { activePhoneExample.invalidate(); }, 450);
        }
      }
    });

    // ── tldraw store sync ────────────────────────────────────────────────
    // Forward incoming diffs / snapshots to the active example.
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
    if (activePhoneExample && activePhoneExample.destroy) activePhoneExample.destroy();
    activePhoneExample = examples[name] || null;
    var contentEl = document.getElementById('example-content');
    if (activePhoneExample && activePhoneExample.init) {
      activePhoneExample.init(
        contentEl,
        function(data) {
          if (!socket) return;
          // tldrawPhone sends typed envelopes for the tldraw sync channel;
          // everything else (map lat/lng touches) goes via phone:touch.
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
    // Re-send viewport after switching (layout may have changed)
    setTimeout(emitViewport, 300);
  }

  // Re-emit viewport on orientation / resize changes
  window.addEventListener('resize', function() { setTimeout(emitViewport, 200); });

  // Auto-connect immediately — no room code needed
  connect();
})();
