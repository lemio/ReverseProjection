(function() {
  function generateRoomId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
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
  const examples = { map: window.MapExample, pong: window.PongExample };
  const panelEl = document.getElementById('example-panel');

  function switchExample(name) {
    if (activeExample && activeExample.destroy) activeExample.destroy();
    document.querySelectorAll('.example-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.example === name);
    });
    activeExample = examples[name] || null;
    if (activeExample && activeExample.init) activeExample.init(panelEl);
    socket.emit('config:change', { example: name });
  }

  document.querySelectorAll('.example-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { switchExample(btn.dataset.example); });
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

  const DETECT_W = 320, DETECT_H = 240;
  let frameCount = 0;

  function detectLoop() {
    requestAnimationFrame(detectLoop);
    frameCount++;
    if (frameCount % 3 !== 0) return;
    if (!webcamVideo.videoWidth) return;

    detectionCanvas.width  = DETECT_W;
    detectionCanvas.height = DETECT_H;
    detCtx.drawImage(webcamVideo, 0, 0, DETECT_W, DETECT_H);
    const imageData = detCtx.getImageData(0, 0, DETECT_W, DETECT_H);
    let corners = ColorDetector.detect(imageData);

    if (corners) {
      const scaleX = webcamVideo.videoWidth  / DETECT_W;
      const scaleY = webcamVideo.videoHeight / DETECT_H;
      Object.keys(corners).forEach(function(key) {
        corners[key] = { x: corners[key].x * scaleX, y: corners[key].y * scaleY };
      });
      document.getElementById('detection-status').textContent = '👁️ Detection: tracking ✓';
    } else {
      document.getElementById('detection-status').textContent = '👁️ Detection: searching…';
    }

    drawOverlay(corners);

    if (corners && activeExample && activeExample.onPhonePosition) {
      const W = webcamVideo.videoWidth, H = webcamVideo.videoHeight;
      const center = {
        x: (corners.topLeft.x + corners.topRight.x + corners.bottomLeft.x + corners.bottomRight.x) / 4,
        y: (corners.topLeft.y + corners.topRight.y + corners.bottomLeft.y + corners.bottomRight.y) / 4
      };
      const dx = corners.topRight.x - corners.topLeft.x;
      const dy = corners.topRight.y - corners.topLeft.y;
      const rotation = Math.atan2(dy, dx);
      activeExample.onPhonePosition(center.x / W, center.y / H, rotation);

      if (activeExample.getState) {
        socket.emit('laptop:state', activeExample.getState());
      }
    }
  }

  function drawOverlay(corners) {
    overlayCanvas.width  = webcamVideo.videoWidth  || overlayCanvas.width;
    overlayCanvas.height = webcamVideo.videoHeight || overlayCanvas.height;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (!corners) {
      overlayCtx.fillStyle = 'rgba(255,0,0,0.6)';
      overlayCtx.beginPath();
      overlayCtx.arc(20, 20, 8, 0, Math.PI * 2);
      overlayCtx.fill();
      return;
    }

    const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];

    // Draw quadrilateral outline
    overlayCtx.strokeStyle = '#00ff00';
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
      overlayCtx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.fillStyle = '#fff';
      overlayCtx.font = '10px sans-serif';
      overlayCtx.fillText(labels[i], pt.x + 10, pt.y + 4);
    });

    // Centre crosshair
    const cx = pts.reduce(function(s, p) { return s + p.x; }, 0) / 4;
    const cy = pts.reduce(function(s, p) { return s + p.y; }, 0) / 4;
    overlayCtx.strokeStyle = '#fff';
    overlayCtx.lineWidth = 1;
    overlayCtx.beginPath();
    overlayCtx.moveTo(cx - 10, cy); overlayCtx.lineTo(cx + 10, cy);
    overlayCtx.moveTo(cx, cy - 10); overlayCtx.lineTo(cx, cy + 10);
    overlayCtx.stroke();
  }

  // Start with the map example
  switchExample('map');
})();
