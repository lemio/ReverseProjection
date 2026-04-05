(function() {
  var socket = null;
  var currentExample = 'map';
  var examples = { map: window.MapPhone };
  var activePhoneExample = null;
  var stateCount = 0;

  function connect() {
    socket = io();

    socket.on('connect', function() {
      // All devices share one session — no room code required
      socket.emit('device:register', { type: 'phone' });
      stateCount = 0;
      document.getElementById('connecting-screen').style.display = 'none';
      document.getElementById('example-area').style.display = 'flex';
      var indicator = document.getElementById('connection-indicator');
      indicator.className = 'connected';
      indicator.textContent = 'Live';
      console.log('[PhoneApp] Connected');
      switchExample(currentExample);
    });

    socket.on('disconnect', function() {
      var indicator = document.getElementById('connection-indicator');
      indicator.className = '';
      indicator.textContent = 'Disconnected';
    });

    socket.on('config:change', function(data) {
      if (data.example && data.example !== currentExample) switchExample(data.example);
      if (data.detectionMode !== undefined) {
        var phoneApp = document.getElementById('phone-app');
        if (data.detectionMode === 'single') {
          phoneApp.classList.add('single-marker-mode');
          phoneApp.classList.remove('four-corner-mode');
          var s = document.getElementById('marker-single');
          if (s) drawJSARMarker(s, parseInt(s.dataset.markerId, 10), s.offsetWidth || 200);
          console.log('[PhoneApp] Switched to single-marker mode');
        } else {
          phoneApp.classList.remove('single-marker-mode');
          phoneApp.classList.add('four-corner-mode');
          document.querySelectorAll('.corner-marker[data-marker-id]').forEach(function(canvas) {
            drawJSARMarker(canvas, parseInt(canvas.dataset.markerId, 10), canvas.offsetWidth || 110);
          });
          console.log('[PhoneApp] Switched to four-corner mode');
        }
      }
    });

    socket.on('laptop:state', function(state) {
      stateCount++;
      if (stateCount % 30 === 1) {
        console.log('[PhoneApp] laptop:state #' + stateCount +
          ' | type=' + (state && state.type) +
          ' | detected=' + (state && state.detected) +
          ' | hasExample=' + (activePhoneExample !== null));
      }

      if (activePhoneExample && activePhoneExample.onState) {
        activePhoneExample.onState(state);
      }
      // Toggle searching class on phone-app to grow markers when not detected
      var phoneApp = document.getElementById('phone-app');
      var wasSearching = phoneApp.classList.contains('searching');
      var nowSearching = state && state.detected === false;
      if (nowSearching !== wasSearching) {
        if (nowSearching) {
          phoneApp.classList.add('searching');
        } else {
          phoneApp.classList.remove('searching');
        }
        console.log('[PhoneApp] searching class ' + (nowSearching ? 'ADDED' : 'REMOVED'));
        setTimeout(function() {
          var app = document.getElementById('phone-app');
          if (app.classList.contains('single-marker-mode')) {
            var s = document.getElementById('marker-single');
            if (s) drawJSARMarker(s, parseInt(s.dataset.markerId, 10), s.offsetWidth || 200);
          } else {
            document.querySelectorAll('.corner-marker[data-marker-id]').forEach(function(canvas) {
              var id = parseInt(canvas.dataset.markerId, 10);
              drawJSARMarker(canvas, id, canvas.offsetWidth);
            });
          }
        }, 450);
      }
    });
  }

  function switchExample(name) {
    currentExample = name;
    document.getElementById('example-name').textContent = name === 'map' ? 'Map' : name;
    if (activePhoneExample && activePhoneExample.destroy) activePhoneExample.destroy();
    activePhoneExample = examples[name] || null;
    var contentEl = document.getElementById('example-content');
    if (activePhoneExample && activePhoneExample.init) {
      activePhoneExample.init(contentEl, function(data) {
        if (socket) socket.emit('phone:touch', data);
      });
    }
  }

  // Auto-connect immediately — no room code needed
  connect();
})();
