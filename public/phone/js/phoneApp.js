(function() {
  function getRoomFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return params.get('room');
  }

  var urlRoom = getRoomFromUrl();
  var socket = null;
  var currentExample = 'map';
  var examples = { map: window.MapPhone, pong: window.PongPhone };
  var activePhoneExample = null;

  function connect(roomId) {
    socket = io();

    socket.on('connect', function() {
      socket.emit('device:register', { type: 'phone', roomId: roomId });
      var indicator = document.getElementById('connection-indicator');
      indicator.className = 'connected';
      indicator.textContent = '● Live';
    });

    socket.on('disconnect', function() {
      var indicator = document.getElementById('connection-indicator');
      indicator.className = '';
      indicator.textContent = '○ Disconnected';
    });

    socket.on('config:change', function(data) {
      switchExample(data.example);
    });

    socket.on('laptop:state', function(state) {
      if (activePhoneExample && activePhoneExample.onState) {
        activePhoneExample.onState(state);
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
