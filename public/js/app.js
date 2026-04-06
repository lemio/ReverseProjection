(function() {
  // ── Socket.io — auto-join the shared session ──────────────────────────────
  const socket = io();
  socket.emit('device:register', { type: 'laptop' });

  socket.on('device:status', function(data) {
    if (data.type === 'phone') {
      var dot   = document.querySelector('#phone-status .status-dot');
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

  // ── Phone viewport dimensions (phone → laptop) ─────────────────────────────
  // Keyed by markerId; defaults used until the phone reports its own dims.
  var phoneViewportData = {};
  socket.on('phone:viewport', function(data) {
    if (data && data.markerId != null) {
      phoneViewportData[data.markerId] = {
        markerDisplayPx: data.markerDisplayPx || 280,
        drawAreaW:       data.drawAreaW       || 375,
        drawAreaH:       data.drawAreaH       || 500
      };
      console.log('[App] phone:viewport for markerId=' + data.markerId +
        ' | markerDisplayPx=' + data.markerDisplayPx +
        ' | drawArea=' + data.drawAreaW + 'x' + data.drawAreaH);
    }
  });

  // ── Phone link & QR code ───────────────────────────────────────────────────
  var phoneUrl = window.location.origin + '/phone';

  fetch('/api/config')
    .then(function(r) { return r.json(); })
    .then(function(cfg) {
      if (cfg.phoneUrl) {
        phoneUrl = cfg.phoneUrl;
        console.log('[App] Phone URL resolved to', phoneUrl);
      }
    })
    .catch(function() { /* keep localhost fallback */ });

  document.getElementById('copy-link').addEventListener('click', function() {
    var btn = this;
    navigator.clipboard.writeText(phoneUrl).then(function() {
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = 'Copy Phone Link'; }, 2000);
    }).catch(function() { prompt('Copy this link:', phoneUrl); });
  });

  document.getElementById('qr-btn').addEventListener('click', function() {
    document.getElementById('qr-modal').classList.remove('hidden');
    document.getElementById('qr-url').textContent = phoneUrl;
    var img = document.getElementById('qr-image');
    img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' +
      encodeURIComponent(phoneUrl);
  });
  document.getElementById('qr-close').addEventListener('click', function() {
    document.getElementById('qr-modal').classList.add('hidden');
  });
  document.getElementById('qr-backdrop').addEventListener('click', function() {
    document.getElementById('qr-modal').classList.add('hidden');
  });

  // ── Example switching ─────────────────────────────────────────────────────
  var activeExample       = null;
  var currentExampleName  = 'map';
  var examples = { map: window.MapExample, tldraw: window.TldrawExample };
  var panelEl  = document.getElementById('example-panel');

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
    socket.emit('config:change', { example: name });
  }

  document.querySelectorAll('.tool-btn[data-example]').forEach(function(btn) {
    btn.addEventListener('click', function() { switchExample(btn.dataset.example); });
  });

  // ── Invert toggle ─────────────────────────────────────────────────────────
  var invertControls = false;
  var invertBtn      = document.getElementById('invert-btn');
  invertBtn.addEventListener('click', function() {
    invertControls = !invertControls;
    invertBtn.textContent = invertControls ? 'Inverted' : 'Invert';
    invertBtn.classList.toggle('active', invertControls);
  });

  // ── Rotation toggle ───────────────────────────────────────────────────────
  var useRotation = false;
  var rotateBtn   = document.getElementById('rotate-btn');
  rotateBtn.addEventListener('click', function() {
    useRotation = !useRotation;
    rotateBtn.textContent = useRotation ? 'Rotating' : 'No Rotation';
    rotateBtn.classList.toggle('active', useRotation);
    if (activeExample && activeExample.setRotationEnabled) {
      activeExample.setRotationEnabled(useRotation);
    }
  });

  // ── Webcam ────────────────────────────────────────────────────────────────
  var webcamVideo   = document.getElementById('webcam');
  var overlayCanvas = document.getElementById('overlay-canvas');
  var overlayCtx    = overlayCanvas.getContext('2d');

  var detectionDot   = document.querySelector('#detection-status .status-dot');
  var detectionLabel = document.getElementById('detection-status');

  function setDetectionStatus(text, dotClass) {
    detectionDot.className = 'status-dot ' + dotClass;
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

  var DETECT_W   = 640, DETECT_H = 480;
  var WB_W       = 10000, WB_H = 10000;  // Whiteboard coordinate space
  var frameCount = 0;
  var anyDetected = false;
  var stateEmitCount = 0;

  // ── Main detect loop ──────────────────────────────────────────────────────
  function detectLoop() {
    requestAnimationFrame(detectLoop);
    frameCount++;
    if (frameCount % 3 !== 0) return;
    if (!webcamVideo.videoWidth) return;

    var W = webcamVideo.videoWidth;
    var H = webcamVideo.videoHeight;

    // Detect all visible markers
    var allCorners = JSARDetector.detectAll(webcamVideo);

    // Scale corners from detection resolution to actual video resolution
    if (allCorners) {
      var scaleX = W / DETECT_W;
      var scaleY = H / DETECT_H;
      Object.keys(allCorners).forEach(function(idStr) {
        var c = allCorners[idStr];
        ['topLeft','topRight','bottomRight','bottomLeft'].forEach(function(key) {
          c[key] = { x: c[key].x * scaleX, y: c[key].y * scaleY };
        });
      });
    }

    // Compute per-marker information
    var markerInfos = {};
    if (allCorners) {
      Object.keys(allCorners).forEach(function(idStr) {
        var id      = parseInt(idStr, 10);
        var corners = allCorners[idStr];
        var vp      = phoneViewportData[id] || { markerDisplayPx: 280, drawAreaW: 375, drawAreaH: 500 };

        // Marker centre and apparent side length in camera pixels
        var cx = (corners.topLeft.x + corners.topRight.x +
                  corners.bottomLeft.x + corners.bottomRight.x) / 4;
        var cy = (corners.topLeft.y + corners.topRight.y +
                  corners.bottomLeft.y + corners.bottomRight.y) / 4;
        var dx = corners.topRight.x - corners.topLeft.x;
        var dy = corners.topRight.y - corners.topLeft.y;
        var markerSidePx = Math.sqrt(dx * dx + dy * dy);
        var rotation     = Math.atan2(dy, dx);

        // Physical scale: camera pixels per phone CSS pixel
        var scale = markerSidePx / (vp.markerDisplayPx || 280);

        // ── Position fix ──────────────────────────────────────────────────
        // The marker is at the top of the phone; the drawing area is below it.
        // The "downward" direction on the phone expressed in camera coordinates
        // is (-sin θ, cos θ) where θ = rotation (atan2 of the top-right edge).
        // Offset from marker centre to drawing-area centre (in phone CSS px):
        //   vertical = markerDisplayPx/2 + 8px gap + drawAreaH/2
        var mdisp     = vp.markerDisplayPx || 280;
        var daH       = vp.drawAreaH       || 500;
        var daW       = vp.drawAreaW       || 375;
        var offsetPhonePx = mdisp / 2 + 8 + daH / 2;
        var offCamX   = -Math.sin(rotation) * offsetPhonePx * scale;
        var offCamY   =  Math.cos(rotation) * offsetPhonePx * scale;

        var drawCX = cx + offCamX;
        var drawCY = cy + offCamY;

        // Normalised position of the drawing-area centre
        var phoneNX = invertControls ? 1 - drawCX / W : drawCX / W;
        var phoneNY = invertControls ? 1 - drawCY / H : drawCY / H;

        // WB viewport dimensions
        var wbX   = phoneNX * WB_W;
        var wbY   = phoneNY * WB_H;
        var wbVpW = (daW * scale / W) * WB_W;
        var wbVpH = (daH * scale / H) * WB_H;

        markerInfos[id] = {
          id:            id,
          nx:            phoneNX,
          ny:            phoneNY,
          rotation:      rotation,
          markerSidePx:  markerSidePx,
          drawAreaW:     daW,
          drawAreaH:     daH,
          markerDisplayPx: mdisp,
          scale:         scale,
          wbX:           wbX,
          wbY:           wbY,
          wbVpW:         wbVpW,
          wbVpH:         wbVpH,
          corners:       corners
        };
      });
    }

    // Detection-status change
    var nowDetected = Object.keys(markerInfos).length > 0;
    if (nowDetected !== anyDetected) {
      anyDetected = nowDetected;
      setDetectionStatus(anyDetected ? 'Tracking' : 'Searching', anyDetected ? 'tracking' : 'searching');
      console.log('[App] Detection status → ' + (anyDetected ? 'TRACKING' : 'LOST'));
      if (activeExample && activeExample.onDetectionChange) {
        activeExample.onDetectionChange(anyDetected);
      }
    }

    // ── Notify examples ───────────────────────────────────────────────────
    if (nowDetected && activeExample) {
      // Multi-marker API (e.g. TldrawExample)
      if (activeExample.onAllMarkersPosition) {
        activeExample.onAllMarkersPosition(markerInfos);
      }

      // Single-marker API for backward compat (MapExample, PongExample)
      // Use marker 0 if present, otherwise the first detected marker
      var m0 = markerInfos[0] || Object.values(markerInfos)[0] || null;
      if (m0 && activeExample.onPhonePosition) {
        activeExample.onPhonePosition(m0.nx, m0.ny, m0.rotation);
      }
    }

    // ── Emit state to phone(s) ────────────────────────────────────────────
    stateEmitCount++;
    if (activeExample && activeExample.getState) {
      var state = activeExample.getState();
      socket.emit('laptop:state', state);
      if (stateEmitCount % 60 === 1) {
        var m0 = markerInfos[0] || Object.values(markerInfos)[0] || null;
        console.log('[App] State #' + stateEmitCount +
          ' | detected=' + nowDetected +
          (m0 ? ' | nx=' + m0.nx.toFixed(3) + ' ny=' + m0.ny.toFixed(3) +
                ' rot=' + m0.rotation.toFixed(2) : '') +
          ' | inverted=' + invertControls);
      }
    }

    // ── Overlay ───────────────────────────────────────────────────────────
    drawOverlay(markerInfos);
  }

  // ── Overlay drawing ───────────────────────────────────────────────────────
  var PHONE_COLORS = ['#4d7cfe', '#e94560', '#f59e0b', '#34d399', '#a78bfa'];

  function drawOverlay(markerInfos) {
    if (!webcamVideo.videoWidth) return;
    var vw = webcamVideo.videoWidth, vh = webcamVideo.videoHeight;
    if (overlayCanvas.width !== vw || overlayCanvas.height !== vh) {
      overlayCanvas.width  = vw;
      overlayCanvas.height = vh;
    }
    overlayCtx.clearRect(0, 0, vw, vh);

    var ids = Object.keys(markerInfos);
    if (ids.length === 0) {
      // Searching indicator
      overlayCtx.fillStyle = 'rgba(245,158,11,0.9)';
      overlayCtx.beginPath();
      overlayCtx.arc(20, 20, 7, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.fillStyle = '#e2e2e2';
      overlayCtx.font = 'bold 12px monospace';
      overlayCtx.fillText('SEARCHING MARKER', 34, 24);
      return;
    }

    ids.forEach(function(idStr) {
      var info   = markerInfos[idStr];
      var corners = info.corners;
      var color  = PHONE_COLORS[info.id % PHONE_COLORS.length];
      var pts    = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];

      // Semi-transparent fill
      overlayCtx.fillStyle = 'rgba(77,124,254,0.07)';
      overlayCtx.beginPath();
      overlayCtx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) overlayCtx.lineTo(pts[i].x, pts[i].y);
      overlayCtx.closePath();
      overlayCtx.fill();

      // Outline
      overlayCtx.strokeStyle = color;
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.moveTo(pts[0].x, pts[0].y);
      for (var j = 1; j < pts.length; j++) overlayCtx.lineTo(pts[j].x, pts[j].y);
      overlayCtx.closePath();
      overlayCtx.stroke();

      // Centre cross
      var cx2 = pts.reduce(function(s, p) { return s + p.x; }, 0) / 4;
      var cy2 = pts.reduce(function(s, p) { return s + p.y; }, 0) / 4;
      overlayCtx.strokeStyle = color;
      overlayCtx.lineWidth = 1.5;
      overlayCtx.beginPath();
      overlayCtx.moveTo(cx2 - 12, cy2); overlayCtx.lineTo(cx2 + 12, cy2);
      overlayCtx.moveTo(cx2, cy2 - 12); overlayCtx.lineTo(cx2, cy2 + 12);
      overlayCtx.stroke();

      // Draw-area centre cross (corrected position)
      overlayCtx.strokeStyle = '#34d399';
      overlayCtx.lineWidth = 1.5;
      var dcx = info.nx * vw, dcy = info.ny * vh;
      overlayCtx.beginPath();
      overlayCtx.moveTo(dcx - 10, dcy); overlayCtx.lineTo(dcx + 10, dcy);
      overlayCtx.moveTo(dcx, dcy - 10); overlayCtx.lineTo(dcx, dcy + 10);
      overlayCtx.stroke();

      // Rotation arrow from marker centre
      var arrowLen = 28;
      overlayCtx.strokeStyle = '#fbbf24';
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.moveTo(cx2, cy2);
      overlayCtx.lineTo(cx2 + Math.cos(info.rotation) * arrowLen,
                         cy2 + Math.sin(info.rotation) * arrowLen);
      overlayCtx.stroke();

      // Label
      overlayCtx.fillStyle = 'rgba(0,0,0,0.6)';
      overlayCtx.fillRect(cx2 + 14, cy2 - 13, 80, 18);
      overlayCtx.fillStyle = color;
      overlayCtx.font = 'bold 11px monospace';
      overlayCtx.fillText('ID ' + info.id +
        '  ' + info.nx.toFixed(2) + ',' + info.ny.toFixed(2),
        cx2 + 17, cy2);
    });
  }

  // Start with the map example
  switchExample('map');
})();
