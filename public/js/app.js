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
    socket.emit('config:change', { example: name, detectionMode: ArucoDetector.getMode() });
  }

  document.querySelectorAll('.example-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { switchExample(btn.dataset.example); });
  });

  // ── Detection mode toggle ──────────────────────────────────────────────────
  const modeBtn = document.getElementById('detection-mode-btn');
  modeBtn.addEventListener('click', function() {
    const newMode = ArucoDetector.getMode() === 'four-corner' ? 'single' : 'four-corner';
    ArucoDetector.setMode(newMode);
    modeBtn.textContent = newMode === 'single' ? '🎯 Single marker' : '🎯 4-corner';
    modeBtn.classList.toggle('active', newMode === 'single');
    console.log('[App] Detection mode switched to', newMode);
    socket.emit('config:change', { example: currentExampleName, detectionMode: newMode });
  });

  // ── Webcam ─────────────────────────────────────────────────────────────────
  const webcamVideo       = document.getElementById('webcam');
  const detectionCanvas   = document.getElementById('detection-canvas');
  const overlayCanvas     = document.getElementById('overlay-canvas');
  const detCtx            = detectionCanvas.getContext('2d');
  const overlayCtx        = overlayCanvas.getContext('2d');

  navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }
  }).then(function(stream) {
    webcamVideo.srcObject = stream;
    webcamVideo.onloadedmetadata = function() {
      overlayCanvas.width  = webcamVideo.videoWidth;
      overlayCanvas.height = webcamVideo.videoHeight;
      document.getElementById('detection-status').textContent = '👁️ Detection: running';
      detectLoop();
    };
  }).catch(function(err) {
    document.getElementById('detection-status').textContent = '👁️ Webcam: error – ' + err.message;
  });

  // Base detection dimensions for four-corner mode.
  // Single-marker mode uses a larger canvas so the one small marker occupies
  // enough pixels to be reliably found by js-aruco2's candidate detector.
  const DETECT_W = 480, DETECT_H = 360;
  const DETECT_W_SINGLE = 640, DETECT_H_SINGLE = 480;
  let frameCount = 0;
  let phoneDetected = false;
  let stateEmitCount = 0;

  function detectLoop() {
    requestAnimationFrame(detectLoop);
    frameCount++;
    if (frameCount % 3 !== 0) return;
    if (!webcamVideo.videoWidth) return;

    const singleMode = ArucoDetector.getMode() === 'single';
    const detectW = singleMode ? DETECT_W_SINGLE : DETECT_W;
    const detectH = singleMode ? DETECT_H_SINGLE : DETECT_H;

    detectionCanvas.width  = detectW;
    detectionCanvas.height = detectH;
    detCtx.drawImage(webcamVideo, 0, 0, detectW, detectH);
    const imageData = detCtx.getImageData(0, 0, detectW, detectH);
    let corners = ArucoDetector.detect(imageData);

    let phoneNX = null, phoneNY = null;

    if (corners) {
      const scaleX = webcamVideo.videoWidth  / detectW;
      const scaleY = webcamVideo.videoHeight / detectH;
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
      phoneNX = center.x / W;
      phoneNY = center.y / H;
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
            ' | phoneLat=' + (state && state.phoneLat != null ? state.phoneLat.toFixed(5) : 'null') +
            ' | phoneLng=' + (state && state.phoneLng != null ? state.phoneLng.toFixed(5) : 'null') +
            ' | detected=' + (state && state.detected));
        }
      }
    } else if (!corners && activeExample && activeExample.getState) {
      // Still emit state so phone knows detection is lost
      socket.emit('laptop:state', activeExample.getState());
    }

    drawOverlay(corners, phoneNX, phoneNY, activeExample && activeExample.getState ? activeExample.getState() : null, ArucoDetector.getMode());
  }

  function drawOverlay(corners, phoneNX, phoneNY, state, detMode) {
    // Only resize when video dimensions actually change (avoids clearing every frame).
    // Guard: skip if video hasn't started yet.
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
        ? ('SEARCHING ID ' + ArucoDetector.getSingleMarkerId() + '…')
        : 'SEARCHING 4-CORNER…';
      overlayCtx.fillText(modeLabel, 42, 29);
      return;
    }

    const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
    // In single-marker mode the corners are the marker's own quad; show the single ID.
    // In four-corner mode show each corner's ArUco ID.
    const markerIds = detMode === 'single'
      ? [ArucoDetector.getSingleMarkerId(), ArucoDetector.getSingleMarkerId(),
         ArucoDetector.getSingleMarkerId(), ArucoDetector.getSingleMarkerId()]
      : [0, 42, 127, 85];

    // Semi-transparent fill so the phone outline is visible
    overlayCtx.fillStyle = 'rgba(0,255,128,0.08)';
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) overlayCtx.lineTo(pts[i].x, pts[i].y);
    overlayCtx.closePath();
    overlayCtx.fill();

    // Draw quadrilateral outline
    overlayCtx.strokeStyle = '#00ff88';
    overlayCtx.lineWidth = 3;
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) overlayCtx.lineTo(pts[i].x, pts[i].y);
    overlayCtx.closePath();
    overlayCtx.stroke();

    // Corner dots + labels showing marker ID + position name
    const dotColors = ['#ff4444', '#44ff44', '#ffff44', '#4444ff'];
    const labels    = ['TL', 'TR', 'BR', 'BL'];
    pts.forEach(function(pt, i) {
      overlayCtx.fillStyle = dotColors[i];
      overlayCtx.beginPath();
      overlayCtx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
      overlayCtx.fill();
      // White border
      overlayCtx.strokeStyle = '#fff';
      overlayCtx.lineWidth = 1.5;
      overlayCtx.stroke();
      // Label: corner name + marker ID
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

    // Rotation indicator — small arrow from centre
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
