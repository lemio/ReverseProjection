(function() {
  // ── Socket.io — auto-join the shared session ──────────────────────────────
  const socket = io();
  socket.emit('device:register', { type: 'laptop' });

  socket.on('device:status', function(data) {
    if (data.type === 'phone') {
      var dot = document.querySelector('#phone-status .status-dot');
      var label = document.getElementById('phone-status');
      if (data.connected) {
        dot.className = 'status-dot connected';
        label.lastChild.textContent = 'Phone Connected';
      } else {
        dot.className = 'status-dot';
        label.lastChild.textContent = 'Phone';
      }
    }
  });

  socket.on('phone:touch', function(data) {
    if (activeExample && activeExample.onPhoneTouch) activeExample.onPhoneTouch(data);
  });

  // ── Phone link & QR code ──────────────────────────────────────────────────
  var phoneUrl = window.location.origin + '/phone';

  document.getElementById('copy-link').addEventListener('click', function() {
    var btn = this;
    navigator.clipboard.writeText(phoneUrl).then(function() {
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = 'Copy Phone Link'; }, 2000);
    }).catch(function() {
      prompt('Copy this link:', phoneUrl);
    });
  });

  document.getElementById('qr-btn').addEventListener('click', function() {
    document.getElementById('qr-modal').classList.remove('hidden');
    document.getElementById('qr-url').textContent = phoneUrl;
    var img = document.getElementById('qr-image');
    if (!img.src || img.src === window.location.href) {
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' +
        encodeURIComponent(phoneUrl);
    }
  });
  document.getElementById('qr-close').addEventListener('click', function() {
    document.getElementById('qr-modal').classList.add('hidden');
  });
  document.getElementById('qr-backdrop').addEventListener('click', function() {
    document.getElementById('qr-modal').classList.add('hidden');
  });

  // ── Example switching ─────────────────────────────────────────────────────
  var activeExample = null;
  var currentExampleName = 'map';
  var examples = { map: window.MapExample };
  var panelEl = document.getElementById('example-panel');

  function switchExample(name) {
    if (activeExample && activeExample.destroy) activeExample.destroy();
    document.querySelectorAll('.tool-btn[data-example]').forEach(function(b) {
      b.classList.toggle('active', b.dataset.example === name);
    });
    currentExampleName = name;
    activeExample = examples[name] || null;
    if (activeExample && activeExample.init) activeExample.init(panelEl);
    if (activeExample && activeExample.setRotationEnabled) {
      activeExample.setRotationEnabled(useRotation);
    }
    socket.emit('config:change', { example: name, detectionMode: JSARDetector.getMode() });
  }

  document.querySelectorAll('.tool-btn[data-example]').forEach(function(btn) {
    btn.addEventListener('click', function() { switchExample(btn.dataset.example); });
  });

  // ── Detection mode toggle ─────────────────────────────────────────────────
  var modeBtn = document.getElementById('detection-mode-btn');
  modeBtn.addEventListener('click', function() {
    var newMode = JSARDetector.getMode() === 'four-corner' ? 'single' : 'four-corner';
    JSARDetector.setMode(newMode);
    modeBtn.textContent = newMode === 'single' ? 'Single Marker' : 'Four Markers';
    modeBtn.classList.toggle('active', newMode === 'single');
    console.log('[App] Detection mode switched to', newMode);
    socket.emit('config:change', { example: currentExampleName, detectionMode: newMode });
  });

  // ── Invert toggle ─────────────────────────────────────────────────────────
  var invertControls = false;
  var invertBtn = document.getElementById('invert-btn');
  invertBtn.addEventListener('click', function() {
    invertControls = !invertControls;
    invertBtn.textContent = invertControls ? 'Inverted' : 'Invert';
    invertBtn.classList.toggle('active', invertControls);
    console.log('[App] invertControls =', invertControls);
  });

  // ── Rotation toggle ───────────────────────────────────────────────────────
  var useRotation = false;
  var rotateBtn = document.getElementById('rotate-btn');
  rotateBtn.addEventListener('click', function() {
    useRotation = !useRotation;
    rotateBtn.textContent = useRotation ? 'Rotating' : 'No Rotation';
    rotateBtn.classList.toggle('active', useRotation);
    if (activeExample && activeExample.setRotationEnabled) {
      activeExample.setRotationEnabled(useRotation);
    }
    console.log('[App] useRotation =', useRotation);
  });

  // ── Webcam ────────────────────────────────────────────────────────────────
  var webcamVideo   = document.getElementById('webcam');
  var overlayCanvas = document.getElementById('overlay-canvas');
  var overlayCtx    = overlayCanvas.getContext('2d');

  var detectionDot   = document.querySelector('#detection-status .status-dot');
  var detectionLabel = document.getElementById('detection-status');

  function setDetectionStatus(text, dotClass) {
    detectionDot.className = 'status-dot ' + dotClass;
    // Replace only the text node (last child), preserving the dot span
    detectionLabel.lastChild.textContent = text;
  }

  navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }
  }).then(function(stream) {
    webcamVideo.srcObject = stream;
    webcamVideo.onloadedmetadata = function() {
      overlayCanvas.width  = webcamVideo.videoWidth;
      overlayCanvas.height = webcamVideo.videoHeight;
      setDetectionStatus('Searching', 'searching');
      JSARDetector.init();
      detectLoop();
    };
  }).catch(function(err) {
    setDetectionStatus('Webcam error', 'error');
    console.error('[App] Webcam error:', err.message);
  });

  var DETECT_W = 640, DETECT_H = 480;
  var frameCount = 0;
  var phoneDetected = false;
  var stateEmitCount = 0;

  function detectLoop() {
    requestAnimationFrame(detectLoop);
    frameCount++;
    if (frameCount % 3 !== 0) return;
    if (!webcamVideo.videoWidth) return;

    var corners = JSARDetector.detect(webcamVideo);
    var phoneNX = null, phoneNY = null;

    if (corners) {
      var scaleX = webcamVideo.videoWidth  / DETECT_W;
      var scaleY = webcamVideo.videoHeight / DETECT_H;
      Object.keys(corners).forEach(function(key) {
        corners[key] = { x: corners[key].x * scaleX, y: corners[key].y * scaleY };
      });
    }

    var nowDetected = corners !== null;
    if (nowDetected !== phoneDetected) {
      phoneDetected = nowDetected;
      if (phoneDetected) {
        setDetectionStatus('Tracking', 'tracking');
      } else {
        setDetectionStatus('Searching', 'searching');
      }
      console.log('[App] Detection status changed to ' + (phoneDetected ? 'TRACKING' : 'LOST'));
      if (activeExample && activeExample.onDetectionChange) {
        activeExample.onDetectionChange(phoneDetected);
      }
    }

    if (corners && activeExample && activeExample.onPhonePosition) {
      var W = webcamVideo.videoWidth, H = webcamVideo.videoHeight;
      var center = {
        x: (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4,
        y: (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4
      };
      var dx = corners.topRight.x - corners.topLeft.x;
      var dy = corners.topRight.y - corners.topLeft.y;
      var rotation = Math.atan2(dy, dx);

      phoneNX = invertControls ? 1 - center.x / W : center.x / W;
      phoneNY = invertControls ? 1 - center.y / H : center.y / H;

      activeExample.onPhonePosition(phoneNX, phoneNY, rotation);

      stateEmitCount++;
      if (activeExample.getState) {
        var state = activeExample.getState();
        socket.emit('laptop:state', state);
        if (stateEmitCount % 60 === 1) {
          console.log('[App] State emitted #' + stateEmitCount +
            ' | nx=' + phoneNX.toFixed(3) + ' ny=' + phoneNY.toFixed(3) +
            ' | rot=' + rotation.toFixed(2) + 'rad' +
            ' | inverted=' + invertControls +
            ' | phoneLat=' + (state && state.phoneLat != null ? state.phoneLat.toFixed(5) : 'null') +
            ' | detected=' + (state && state.detected));
        }
      }
    } else if (!corners && activeExample && activeExample.getState) {
      socket.emit('laptop:state', activeExample.getState());
    }

    drawOverlay(corners, phoneNX, phoneNY,
      activeExample && activeExample.getState ? activeExample.getState() : null,
      JSARDetector.getMode());
  }

  function drawOverlay(corners, phoneNX, phoneNY, state, detMode) {
    if (!webcamVideo.videoWidth) return;
    var vw = webcamVideo.videoWidth;
    var vh = webcamVideo.videoHeight;
    if (overlayCanvas.width !== vw || overlayCanvas.height !== vh) {
      overlayCanvas.width  = vw;
      overlayCanvas.height = vh;
    }
    overlayCtx.clearRect(0, 0, vw, vh);

    if (!corners) {
      // Searching indicator — amber circle
      overlayCtx.fillStyle = 'rgba(245,158,11,0.9)';
      overlayCtx.beginPath();
      overlayCtx.arc(20, 20, 7, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.fillStyle = '#e2e2e2';
      overlayCtx.font = 'bold 12px monospace';
      var modeLabel = detMode === 'single'
        ? ('SEARCHING MARKER ' + JSARDetector.getSingleMarkerId())
        : 'SEARCHING — FOUR MARKERS';
      overlayCtx.fillText(modeLabel, 34, 24);
      return;
    }

    var pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
    var markerIds = detMode === 'single'
      ? [JSARDetector.getSingleMarkerId(), JSARDetector.getSingleMarkerId(),
         JSARDetector.getSingleMarkerId(), JSARDetector.getSingleMarkerId()]
      : [0, 8, 56, 40];

    // Semi-transparent fill
    overlayCtx.fillStyle = 'rgba(77,124,254,0.07)';
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) overlayCtx.lineTo(pts[i].x, pts[i].y);
    overlayCtx.closePath();
    overlayCtx.fill();

    // Quadrilateral outline
    overlayCtx.strokeStyle = '#4d7cfe';
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (var j = 1; j < pts.length; j++) overlayCtx.lineTo(pts[j].x, pts[j].y);
    overlayCtx.closePath();
    overlayCtx.stroke();

    // Corner dots + labels
    var dotColors = ['#f87171', '#34d399', '#fbbf24', '#60a5fa'];
    var labels    = ['TL', 'TR', 'BR', 'BL'];
    pts.forEach(function(pt, i) {
      overlayCtx.fillStyle = dotColors[i];
      overlayCtx.beginPath();
      overlayCtx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.strokeStyle = 'rgba(0,0,0,0.5)';
      overlayCtx.lineWidth = 1;
      overlayCtx.stroke();
      overlayCtx.fillStyle = '#e2e2e2';
      overlayCtx.font = 'bold 10px monospace';
      overlayCtx.fillText(labels[i] + ' #' + markerIds[i], pt.x + 10, pt.y - 4);
      overlayCtx.font = '9px monospace';
      overlayCtx.fillStyle = '#aaa';
      overlayCtx.fillText('(' + Math.round(pt.x) + ',' + Math.round(pt.y) + ')', pt.x + 10, pt.y + 8);
    });

    // Centre crosshair
    var cx = pts.reduce(function(s, p) { return s + p.x; }, 0) / 4;
    var cy = pts.reduce(function(s, p) { return s + p.y; }, 0) / 4;
    overlayCtx.strokeStyle = '#4d7cfe';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.beginPath();
    overlayCtx.moveTo(cx - 12, cy); overlayCtx.lineTo(cx + 12, cy);
    overlayCtx.moveTo(cx, cy - 12); overlayCtx.lineTo(cx, cy + 12);
    overlayCtx.stroke();

    // Info box
    if (phoneNX !== null && phoneNY !== null) {
      var lines = ['nx=' + phoneNX.toFixed(3) + '  ny=' + phoneNY.toFixed(3)];
      if (state && state.phoneLat != null) {
        lines.push('lat=' + state.phoneLat.toFixed(5));
        lines.push('lng=' + state.phoneLng.toFixed(5));
      }
      if (invertControls) lines.push('INVERTED');
      var boxX = Math.min(cx + 16, vw - 160);
      var boxY = cy - 8;
      var lineH = 15;
      overlayCtx.fillStyle = 'rgba(0,0,0,0.6)';
      overlayCtx.fillRect(boxX - 4, boxY - 13, 155, lines.length * lineH + 6);
      overlayCtx.fillStyle = '#4d7cfe';
      overlayCtx.font = 'bold 11px monospace';
      lines.forEach(function(line, i) {
        overlayCtx.fillText(line, boxX, boxY + i * lineH);
      });
    }

    // Rotation arrow
    var adx = corners.topRight.x - corners.topLeft.x;
    var ady = corners.topRight.y - corners.topLeft.y;
    var angle = Math.atan2(ady, adx);
    var arrowLen = 28;
    overlayCtx.strokeStyle = '#fbbf24';
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(cx, cy);
    overlayCtx.lineTo(cx + Math.cos(angle) * arrowLen, cy + Math.sin(angle) * arrowLen);
    overlayCtx.stroke();
  }

  // Start with the map example
  switchExample('map');
})();
