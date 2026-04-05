(function() {
  var socket = null;
  var currentExample = 'map';
  var examples = { map: window.MapPhone };
  var activePhoneExample = null;
  var stateCount = 0;

  function redrawMarker() {
    var s = document.getElementById('marker-single');
    if (s) drawJSARMarker(s, parseInt(s.dataset.markerId, 10), s.offsetWidth || 280);
  }

  function connect() {
    socket = io();

    socket.on('connect', function() {
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
    });

    socket.on('laptop:state', function(state) {
      stateCount++;
      if (stateCount % 30 === 1) {
        console.log('[PhoneApp] laptop:state #' + stateCount +
          ' | detected=' + (state && state.detected) +
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
        // Redraw marker after CSS transition finishes (size changed)
        setTimeout(redrawMarker, 450);
        // Notify the active example that its container may have changed size
        if (activePhoneExample && activePhoneExample.invalidate) {
          setTimeout(function() { activePhoneExample.invalidate(); }, 450);
        }
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
