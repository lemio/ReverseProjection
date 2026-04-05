(function() {
  function getRoomCodeFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return params.get('room');
  }

  var urlRoom = getRoomCodeFromUrl();
  var socket = null;
  var currentExample = 'map';
  var examples = { map: window.MapPhone, pong: window.PongPhone };
  var activePhoneExample = null;
  var stateCount = 0;

  function connect(roomId) {
    socket = io();

    socket.on('connect', function() {
      socket.emit('device:register', { type: 'phone', roomId: roomId });
      stateCount = 0;
      var indicator = document.getElementById('connection-indicator');
      indicator.className = 'connected';
      indicator.textContent = '● Live';
      console.log('[PhoneApp] Connected to room', roomId);
    });

    socket.on('disconnect', function() {
      var indicator = document.getElementById('connection-indicator');
      indicator.className = '';
      indicator.textContent = '○ Disconnected';
    });

    socket.on('config:change', function(data) {
      // Only reinitialise the example when it has actually changed.
      // Switching detection mode emits the same example name; recreating the
      // phone example every time causes a needless 80 ms map teardown/rebuild.
      if (data.example && data.example !== currentExample) switchExample(data.example);
      if (data.detectionMode !== undefined) {
        var phoneApp = document.getElementById('phone-app');
        if (data.detectionMode === 'single') {
          phoneApp.classList.add('single-marker-mode');
          phoneApp.classList.remove('four-corner-mode');
          // Redraw single marker at its new rendered size
          var s = document.getElementById('marker-single');
          if (s) drawArucoMarker(s, parseInt(s.dataset.markerId, 10), s.offsetWidth || 200);
          console.log('[PhoneApp] Switched to single-marker mode');
        } else {
          phoneApp.classList.remove('single-marker-mode');
          phoneApp.classList.add('four-corner-mode');
          // Redraw corner markers at their rendered size
          document.querySelectorAll('.corner-marker[data-marker-id]').forEach(function(canvas) {
            drawArucoMarker(canvas, parseInt(canvas.dataset.markerId, 10), canvas.offsetWidth || 110);
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
          ' | phoneLat=' + (state && state.phoneLat != null ? state.phoneLat.toFixed(5) : 'null') +
          ' | phoneLng=' + (state && state.phoneLng != null ? state.phoneLng.toFixed(5) : 'null') +
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
        // Redraw markers after CSS transition completes (size changed)
        setTimeout(function() {
          var phoneApp = document.getElementById('phone-app');
          if (phoneApp.classList.contains('single-marker-mode')) {
            var s = document.getElementById('marker-single');
            if (s) drawArucoMarker(s, parseInt(s.dataset.markerId, 10), s.offsetWidth || 200);
          } else {
            document.querySelectorAll('.corner-marker[data-marker-id]').forEach(function(canvas) {
              var id = parseInt(canvas.dataset.markerId, 10);
              drawArucoMarker(canvas, id, canvas.offsetWidth);
            });
          }
        }, 450); // slightly longer than the 0.4s CSS transition
      }
    });

    // Show example area
    document.getElementById('connection-screen').style.display = 'none';
    document.getElementById('example-area').style.display = 'flex';
    switchExample(currentExample);
  }

  function switchExample(name) {
    currentExample = name;
    document.getElementById('example-name').textContent = name === 'map' ? '🗺️ Map' : '🏓 Pong';
    if (activePhoneExample && activePhoneExample.destroy) activePhoneExample.destroy();
    activePhoneExample = examples[name] || null;
    var contentEl = document.getElementById('example-content');
    if (activePhoneExample && activePhoneExample.init) {
      activePhoneExample.init(contentEl, function(data) {
        if (socket) socket.emit('phone:touch', data);
      });
    }
  }

  if (urlRoom) {
    connect(urlRoom);
  } else {
    document.getElementById('connection-screen').style.display = 'flex';

    document.getElementById('join-btn').addEventListener('click', function() {
      var roomId = document.getElementById('room-input').value.trim().toUpperCase();
      if (roomId.length >= 4) {
        connect(roomId);
      } else {
        document.getElementById('connect-status').textContent = 'Please enter a valid room code';
      }
    });

    document.getElementById('room-input').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') document.getElementById('join-btn').click();
    });
  }
})();
