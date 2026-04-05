(function() {
  function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  let roomId = localStorage.getItem('rpRoomId') || generateRoomId();
  localStorage.setItem('rpRoomId', roomId);
  document.getElementById('room-id').textContent = roomId;

  // ── Socket.io ──────────────────────────────────────────────────────────────
  const socket = io();
  socket.emit('device:register', { type: 'laptop', roomId });

  socket.on('device:status', function(data) {
    if (data.type === 'phone') {
      document.getElementById('phone-status').textContent =
        data.connected ? '📱 Phone: connected ✓' : '📱 Phone: not connected';
    }
  });

  socket.on('phone:touch', function(data) {
    if (activeExample && activeExample.onPhoneTouch) activeExample.onPhoneTouch(data);
  });

  // ── Copy phone link ────────────────────────────────────────────────────────
  document.getElementById('copy-link').addEventListener('click', function() {
    const url = `${window.location.origin}/phone?room=${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      this.textContent = 'Copied!';
      setTimeout(() => { this.textContent = 'Copy Phone Link'; }, 2000);
    }).catch(() => {
      prompt('Copy this link:', url);
    });
  });

  // ── Example switching ──────────────────────────────────────────────────────
  let activeExample = null;
  let currentExampleName = 'map';
  const examples = { map: window.MapExample, pong: window.PongExample };
  const panelEl = document.getElementById('example-panel');

  function switchExample(name) {
    if (activeExample && activeExample.destroy) activeExample.destroy();
    document.querySelectorAll('.example-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.example === name);
    });
    currentExampleName = name;
    activeExample = examples[name] || null;
    if (activeExample && activeExample.init) activeExample.init(panelEl);
    // Propagate rotation state to freshly-initialised example
    if (activeExample && activeExample.setRotationEnabled) {
      activeExample.setRotationEnabled(useRotation);
    }
    socket.emit('config:change', { example: name, detectionMode: JSARDetector.getMode() });
  }

  document.querySelectorAll('.example-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { switchExample(btn.dataset.example); });
  });

  // ── Detection mode toggle ──────────────────────────────────────────────────
  const modeBtn = document.getElementById('detection-mode-btn');
  modeBtn.addEventListener('click', function() {
    const newMode = JSARDetector.getMode() === 'four-corner' ? 'single' : 'four-corner';
    JSARDetector.setMode(newMode);
    modeBtn.textContent = newMode === 'single' ? '🎯 Single marker' : '🎯 4-corner';
    modeBtn.classList.toggle('active', newMode === 'single');
    console.log('[App] Detection mode switched to', newMode);
    socket.emit('config:change', { example: currentExampleName, detectionMode: newMode });
  });

  // ── Invert controls toggle ─────────────────────────────────────────────────
  // When inverted, moving the phone up moves the map up (natural direction).
  // Without inversion the camera y-axis is preserved (top-of-frame = north).
  let invertControls = false;
  const invertBtn = document.getElementById('invert-btn');
  invertBtn.addEventListener('click', function() {
    invertControls = !invertControls;
    invertBtn.textContent = invertControls ? '↕️ Inverted ✓' : '↕️ Invert';
    invertBtn.classList.toggle('active', invertControls);
    console.log('[App] invertControls =', invertControls);
  });

  // ── Rotation toggle ────────────────────────────────────────────────────────
  // When enabled, phone rotation (yaw in camera plane) is forwarded to the
  // phone's mini-map so the map rotates with the phone.
  let useRotation = false;
  const rotateBtn = document.getElementById('rotate-btn');
  rotateBtn.addEventListener('click', function() {
    useRotation = !useRotation;
    rotateBtn.textContent = useRotation ? '🔄 Rotating ✓' : '🔄 No rotation';
    rotateBtn.classList.toggle('active', useRotation);
    if (activeExample && activeExample.setRotationEnabled) {
      activeExample.setRotationEnabled(useRotation);
    }
    console.log('[App] useRotation =', useRotation);
  });

  // ── Webcam ─────────────────────────────────────────────────────────────────
  const webcamVideo     = document.getElementById('webcam');
  const overlayCanvas   = document.getElementById('overlay-canvas');
  const overlayCtx      = overlayCanvas.getContext('2d');

  navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }
  }).then(function(stream) {
    webcamVideo.srcObject = stream;
    webcamVideo.onloadedmetadata = function() {
      overlayCanvas.width  = webcamVideo.videoWidth;
      overlayCanvas.height = webcamVideo.videoHeight;
      document.getElementById('detection-status').textContent = '👁️ Detection: searching…';
      // Kick-start jsartoolkit5 async initialisation
      JSARDetector.init();
      detectLoop();
    };
  }).catch(function(err) {
    document.getElementById('detection-status').textContent = '👁️ Webcam: error – ' + err.message;
  });

  // jsartoolkit5 uses an internal 640×480 canvas; all returned coordinates are
  // in that space and must be scaled up to the native video resolution here.
  const DETECT_W = 640, DETECT_H = 480;
  let frameCount = 0;
  let phoneDetected = false;
  let stateEmitCount = 0;

  function detectLoop() {
    requestAnimationFrame(detectLoop);
    frameCount++;
    if (frameCount % 3 !== 0) return;
    if (!webcamVideo.videoWidth) return;

    // JSARDetector handles its own internal canvas; just pass the video element
    let corners = JSARDetector.detect(webcamVideo);

    let phoneNX = null, phoneNY = null;

    if (corners) {
      // Scale from jsartoolkit5 detection resolution to native video resolution
      const scaleX = webcamVideo.videoWidth  / DETECT_W;
      const scaleY = webcamVideo.videoHeight / DETECT_H;
      Object.keys(corners).forEach(function(key) {
        corners[key] = { x: corners[key].x * scaleX, y: corners[key].y * scaleY };
      });
    }

    // Notify examples when detection status changes
    const nowDetected = corners !== null;
    if (nowDetected !== phoneDetected) {
      phoneDetected = nowDetected;
      document.getElementById('detection-status').textContent =
        phoneDetected ? '👁️ Detection: tracking ✓' : '👁️ Detection: searching…';
      console.log('[App] Detection status changed → ' + (phoneDetected ? 'TRACKING' : 'LOST'));
      if (activeExample && activeExample.onDetectionChange) {
        activeExample.onDetectionChange(phoneDetected);
      }
    }

    if (corners && activeExample && activeExample.onPhonePosition) {
      const W = webcamVideo.videoWidth, H = webcamVideo.videoHeight;
      const center = {
        x: (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4,
        y: (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4
      };
      const dx = corners.topRight.x - corners.topLeft.x;
      const dy = corners.topRight.y - corners.topLeft.y;
      const rotation = Math.atan2(dy, dx);

      // Apply invert: flip X and Y so "phone up → map up" (natural direction)
      phoneNX = invertControls ? 1 - center.x / W : center.x / W;
      phoneNY = invertControls ? 1 - center.y / H : center.y / H;

      activeExample.onPhonePosition(phoneNX, phoneNY, rotation);

      stateEmitCount++;
      if (activeExample.getState) {
        const state = activeExample.getState();
        socket.emit('laptop:state', state);
        // Throttled log every 60 state emissions (~3 s at 20 fps)
        if (stateEmitCount % 60 === 1) {
          console.log('[App] State emitted #' + stateEmitCount +
            ' | nx=' + phoneNX.toFixed(3) + ' ny=' + phoneNY.toFixed(3) +
            ' | rot=' + rotation.toFixed(2) + 'rad' +
            ' | inverted=' + invertControls +
            ' | phoneLat=' + (state && state.phoneLat != null ? state.phoneLat.toFixed(5) : 'null') +
            ' | phoneLng=' + (state && state.phoneLng != null ? state.phoneLng.toFixed(5) : 'null') +
            ' | detected=' + (state && state.detected));
        }
      }
    } else if (!corners && activeExample && activeExample.getState) {
      // Still emit state so phone knows detection is lost
      socket.emit('laptop:state', activeExample.getState());
    }

    drawOverlay(corners, phoneNX, phoneNY,
      activeExample && activeExample.getState ? activeExample.getState() : null,
      JSARDetector.getMode());
  }

  function drawOverlay(corners, phoneNX, phoneNY, state, detMode) {
    // Only resize when video dimensions actually change
    if (!webcamVideo.videoWidth) return;
    const vw = webcamVideo.videoWidth;
    const vh = webcamVideo.videoHeight;
    if (overlayCanvas.width !== vw || overlayCanvas.height !== vh) {
      overlayCanvas.width  = vw;
      overlayCanvas.height = vh;
    }
    overlayCtx.clearRect(0, 0, vw, vh);

    if (!corners) {
      // Searching indicator — red circle top-left
      overlayCtx.fillStyle = 'rgba(255,0,0,0.8)';
      overlayCtx.beginPath();
      overlayCtx.arc(24, 24, 10, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.fillStyle = '#fff';
      overlayCtx.font = 'bold 13px monospace';
      const modeLabel = detMode === 'single'
        ? ('SEARCHING ID ' + JSARDetector.getSingleMarkerId() + '…')
        : 'SEARCHING 4-CORNER…';
      overlayCtx.fillText(modeLabel, 42, 29);
      return;
    }

    const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
    // Show barcode IDs matching the 3×3 corner markers on the phone
    const markerIds = detMode === 'single'
      ? [JSARDetector.getSingleMarkerId(), JSARDetector.getSingleMarkerId(),
         JSARDetector.getSingleMarkerId(), JSARDetector.getSingleMarkerId()]
      : [0, 8, 56, 40];

    // Semi-transparent fill
    overlayCtx.fillStyle = 'rgba(0,255,128,0.08)';
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) overlayCtx.lineTo(pts[i].x, pts[i].y);
    overlayCtx.closePath();
    overlayCtx.fill();

    // Quadrilateral outline
    overlayCtx.strokeStyle = '#00ff88';
    overlayCtx.lineWidth = 3;
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) overlayCtx.lineTo(pts[i].x, pts[i].y);
    overlayCtx.closePath();
    overlayCtx.stroke();

    // Corner dots + labels
    const dotColors = ['#ff4444', '#44ff44', '#ffff44', '#4444ff'];
    const labels    = ['TL', 'TR', 'BR', 'BL'];
    pts.forEach(function(pt, i) {
      overlayCtx.fillStyle = dotColors[i];
      overlayCtx.beginPath();
      overlayCtx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.strokeStyle = '#fff';
      overlayCtx.lineWidth = 1.5;
      overlayCtx.stroke();
      overlayCtx.fillStyle = '#fff';
      overlayCtx.font = 'bold 11px monospace';
      const label = labels[i] + ' #' + markerIds[i];
      overlayCtx.fillText(label, pt.x + 12, pt.y - 4);
      overlayCtx.font = '10px monospace';
      overlayCtx.fillText('(' + Math.round(pt.x) + ',' + Math.round(pt.y) + ')', pt.x + 12, pt.y + 9);
    });

    // Centre crosshair + info
    const cx = pts.reduce(function(s, p) { return s + p.x; }, 0) / 4;
    const cy = pts.reduce(function(s, p) { return s + p.y; }, 0) / 4;
    overlayCtx.strokeStyle = '#00ff88';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.beginPath();
    overlayCtx.moveTo(cx - 14, cy); overlayCtx.lineTo(cx + 14, cy);
    overlayCtx.moveTo(cx, cy - 14); overlayCtx.lineTo(cx, cy + 14);
    overlayCtx.stroke();

    // Phone position info box
    if (phoneNX !== null && phoneNY !== null) {
      const lines = [
        'nx=' + phoneNX.toFixed(3) + '  ny=' + phoneNY.toFixed(3)
      ];
      if (state && state.phoneLat != null) {
        lines.push('lat=' + state.phoneLat.toFixed(5));
        lines.push('lng=' + state.phoneLng.toFixed(5));
      }
      if (invertControls) lines.push('[INVERTED]');
      const boxX = Math.min(cx + 18, vw - 160);
      const boxY = cy - 8;
      const lineH = 16;
      overlayCtx.fillStyle = 'rgba(0,0,0,0.65)';
      overlayCtx.fillRect(boxX - 4, boxY - 14, 158, lines.length * lineH + 6);
      overlayCtx.fillStyle = '#00ff88';
      overlayCtx.font = 'bold 12px monospace';
      lines.forEach(function(line, i) {
        overlayCtx.fillText(line, boxX, boxY + i * lineH);
      });
    }

    // Rotation indicator — small yellow arrow from centre
    const dx = corners.topRight.x - corners.topLeft.x;
    const dy = corners.topRight.y - corners.topLeft.y;
    const angle = Math.atan2(dy, dx);
    const arrowLen = 30;
    overlayCtx.strokeStyle = '#ffff00';
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(cx, cy);
    overlayCtx.lineTo(cx + Math.cos(angle) * arrowLen, cy + Math.sin(angle) * arrowLen);
    overlayCtx.stroke();
  }

  // Start with the map example
  switchExample('map');
})();
