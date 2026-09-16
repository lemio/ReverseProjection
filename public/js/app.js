(function() {
  // ── Socket.io — auto-join the shared session ──────────────────────────────
  const socket = io();
  socket.emit('device:register', { type: 'laptop' });

  // ── Connected phones registry (socketId → {socketId, markerId}) ──────────
  var connectedPhones = {};

  socket.on('device:status', function(data) {
    if (data.type === 'phone') {
      var dot   = document.querySelector('#phone-status .status-dot');
      var label = document.getElementById('phone-status');
      if (data.connected) {
        dot.className = 'status-dot connected';
        label.lastChild.textContent = 'Phone Connected';
        if (data.socketId) connectedPhones[data.socketId] = data;
        emitSharedConfig();
      } else {
        dot.className = 'status-dot';
        label.lastChild.textContent = 'Phone';
        if (data.socketId) delete connectedPhones[data.socketId];
      }
    }

    if (activeExample && activeExample.onDeviceStatus) {
      activeExample.onDeviceStatus(data);
    }
  });

  socket.on('phone:touch', function(data) {
    if (activeExample && activeExample.onPhoneTouch) activeExample.onPhoneTouch(data);
  });

  // ── tldraw store sync (from phones or other laptops) ──────────────────────
  socket.on('tldraw:diff', function(diff) {
    if (activeExample && activeExample.onTldrawDiff) activeExample.onTldrawDiff(diff);
  });

  // ── WebRTC signaling for screen streaming ───────────────────────────────
  socket.on('webrtc:ready', function(data) {
    if (activeExample && activeExample.onWebrtcReady) activeExample.onWebrtcReady(data);
  });

  socket.on('webrtc:signal', function(data) {
    if (activeExample && activeExample.onWebrtcSignal) activeExample.onWebrtcSignal(data);
  });

  // ── Phone viewport dimensions (phone → laptop) ─────────────────────────────
  // Keyed by markerId. screenW/H select the image targets to track;
  // borderPx + drawArea locate the content area inside the tracking border.
  var phoneViewportData = {};
  socket.on('phone:viewport', function(data) {
    if (data && data.markerId != null) {
      phoneViewportData[data.markerId] = {
        screenW:   data.screenW   || 0,       // physical (portrait) size — image targets
        screenH:   data.screenH   || 0,
        cssW:      data.cssW      || data.screenW || 0,   // current layout (rotates with the phone)
        cssH:      data.cssH      || data.screenH || 0,
        cssCorners: data.cssCorners || null,  // layout corners TL,TR,BR,BL in physical px
        borderPx:  data.borderPx  || 0,
        drawAreaW: data.drawAreaW || 375,
        drawAreaH: data.drawAreaH || 500
      };
      console.log('[App] phone:viewport for markerId=' + data.markerId +
        ' | screen=' + data.screenW + 'x' + data.screenH +
        ' | border=' + data.borderPx +
        ' | drawArea=' + data.drawAreaW + 'x' + data.drawAreaH);
      updateTrackedPhones();
    }
  });

  socket.on('device:status', function(data) {
    if (data.type === 'phone' && !data.connected && data.markerId != null) {
      delete phoneViewportData[data.markerId];
      updateTrackedPhones();
    }
  });

  function updateTrackedPhones() {
    XR8Tracker.setPhones(Object.keys(phoneViewportData).map(function(id) {
      var vp = phoneViewportData[id];
      return { id: Number(id), screenW: vp.screenW, screenH: vp.screenH };
    }));
  }

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
  var phoneScalePercent = parseInt(localStorage.getItem('rpPhoneSizePercent') || '100', 10);
  if (!isFinite(phoneScalePercent)) phoneScalePercent = 100;
  phoneScalePercent = Math.max(75, Math.min(140, phoneScalePercent));

  var phoneSizeSlider = document.getElementById('phone-size-slider');
  var phoneSizeValue  = document.getElementById('phone-size-value');

  function getPhoneScale() {
    return phoneScalePercent / 100;
  }

  function emitSharedConfig(options) {
    options = options || {};
    socket.emit('config:change', {
      example: currentExampleName,
      phoneScale: getPhoneScale(),
      reannounce: !!options.reannounce
    });
  }

  function updatePhoneSizeUi() {
    if (phoneSizeSlider) phoneSizeSlider.value = String(phoneScalePercent);
    if (phoneSizeValue) phoneSizeValue.textContent = phoneScalePercent + '%';
  }

  updatePhoneSizeUi();

  // Debounce the config emission so rapid slider drags don't flood the phone
  // with scale changes (each triggers a phone:viewport re-emit that disturbs
  // the position calculations while the user is still dragging).
  var sliderEmitTimer = null;
  if (phoneSizeSlider) {
    phoneSizeSlider.addEventListener('input', function() {
      phoneScalePercent = parseInt(phoneSizeSlider.value, 10) || 100;
      phoneScalePercent = Math.max(75, Math.min(140, phoneScalePercent));
      localStorage.setItem('rpPhoneSizePercent', String(phoneScalePercent));
      updatePhoneSizeUi();
      clearTimeout(sliderEmitTimer);
      sliderEmitTimer = setTimeout(function() {
        emitSharedConfig({ reannounce: false });
      }, 80);
    });
  }

  var examples = {
    map: window.MapExample,
    tldraw: window.TldrawExample,
    screen: window.ScreenExample
  };
  var panelEl  = document.getElementById('example-panel');

  function switchExample(name) {
    if (activeExample && activeExample.destroy) activeExample.destroy();
    document.querySelectorAll('.tool-btn[data-example]').forEach(function(b) {
      b.classList.toggle('active', b.dataset.example === name);
    });
    currentExampleName = name;
    activeExample = examples[name] || null;
    if (activeExample && activeExample.init) activeExample.init(panelEl, socket, connectedPhones);
    if (activeExample && activeExample.setRotationEnabled) {
      activeExample.setRotationEnabled(useRotation);
    }
    emitSharedConfig({ reannounce: name === 'screen' });
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

  // ── Camera + 8th Wall tracking ────────────────────────────────────────────
  var xrCanvas      = document.getElementById('xr-canvas');
  var overlayCanvas = document.getElementById('overlay-canvas');
  var overlayCtx    = overlayCanvas.getContext('2d');

  var detectionDot   = document.querySelector('#detection-status .status-dot');
  var detectionLabel = document.getElementById('detection-status');

  function setDetectionStatus(text, dotClass) {
    detectionDot.className = 'status-dot ' + dotClass;
    detectionLabel.lastChild.textContent = text;
  }

  // Whiteboard coordinate space: 10 000 × 10 000 gives sub-pixel precision
  // when mapping normalised camera positions (0-1) → integer WB coords while
  // keeping arithmetic simple.  tldraw uses its own separate coordinate system
  // and is not bound by these values.
  var WB_W       = 10000, WB_H = 10000;
  var frameCount = 0;
  var anyDetected = false;
  var stateEmitCount = 0;

  XR8Tracker.start({
    canvas: xrCanvas,
    onStatus: function(text, level) { setDetectionStatus(text, level); },
    onFrame: onTrackingFrame
  });

  // ── Per camera frame: tracked phones → marker infos → examples ────────────
  function onTrackingFrame(frame) {
    var W = frame.camW, H = frame.camH;
    var markerInfos = {};

    Object.keys(frame.phones).forEach(function(idStr) {
      var phone = frame.phones[idStr];
      var id    = phone.id;
      var vp    = phoneViewportData[id];
      if (!vp) return;

      // Everything below is in the phone's current CSS layout (sw × sh), which
      // may be rotated relative to the physical frame the targets are tracked
      // in; cssCorners gives that layout's corners in physical px.
      var sw = vp.cssW, sh = vp.cssH;
      var b  = vp.borderPx, daW = vp.drawAreaW, daH = vp.drawAreaH;
      var cc = vp.cssCorners || [{ x: 0, y: 0 }, { x: sw, y: 0 }, { x: sw, y: sh }, { x: 0, y: sh }];
      function project(x, y) {   // layout px → canvas px (the layout is a rotation of the physical frame)
        var fx = x / sw, fy = y / sh;
        return phone.project(cc[0].x + (cc[1].x - cc[0].x) * fx + (cc[3].x - cc[0].x) * fy,
                             cc[0].y + (cc[1].y - cc[0].y) * fx + (cc[3].y - cc[0].y) * fy);
      }

      // Phone screen and content-area corners in canvas px
      var screen = [project(0, 0), project(sw, 0), project(sw, sh), project(0, sh)];
      var cx0 = (sw - daW) / 2, cy0 = b;
      var content = [project(cx0, cy0), project(cx0 + daW, cy0),
                     project(cx0 + daW, cy0 + daH), project(cx0, cy0 + daH)];
      var drawC  = project(sw / 2, cy0 + daH / 2);
      var phoneC = project(sw / 2, sh / 2);
      if (screen.concat(content, [drawC, phoneC]).some(function(p) { return !p; })) return;

      var dx = content[1].x - content[0].x;
      var dy = content[1].y - content[0].y;
      var rotation = Math.atan2(dy, dx);
      // Camera pixels per phone CSS pixel
      var scale = Math.sqrt(dx * dx + dy * dy) / daW;

      var phoneNX       = invertControls ? 1 - drawC.x  / W : drawC.x  / W;
      var phoneNY       = invertControls ? 1 - drawC.y  / H : drawC.y  / H;
      var phoneCenterNX = invertControls ? 1 - phoneC.x / W : phoneC.x / W;
      var phoneCenterNY = invertControls ? 1 - phoneC.y / H : phoneC.y / H;

      // Content zoom from the size slider (controls how much content is shown)
      var contentZoom = getPhoneScale();

      markerInfos[id] = {
        id:            id,
        nx:            phoneNX,
        ny:            phoneNY,
        phoneCenterNX: phoneCenterNX,
        phoneCenterNY: phoneCenterNY,
        rotation:      rotation,
        drawAreaW:     daW,
        drawAreaH:     daH,
        scale:         scale,
        camW:          W,
        camH:          H,
        wbX:           phoneNX * WB_W,
        wbY:           phoneNY * WB_H,
        wbVpW:         (daW * scale / W) * WB_W * contentZoom,
        wbVpH:         (daH * scale / H) * WB_H * contentZoom,
        contentZoom:   contentZoom,
        parts:         phone.parts,
        screenW:       sw,
        screenH:       sh,
        borderPx:      b,
        screenCorners: screen,
        contentCorners: content,
        regionTop:     phone.projectRegion('top'),
        regionBottom:  phone.projectRegion('bottom')
      };
    });

    // Detection-status change
    var nowDetected = Object.keys(markerInfos).length > 0;
    if (nowDetected !== anyDetected) {
      anyDetected = nowDetected;
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
      var m0 = markerInfos[0] || Object.values(markerInfos)[0] || null;
      if (m0 && activeExample.onPhonePosition) {
        activeExample.onPhonePosition(m0.nx, m0.ny, m0.rotation);
      }
    }

    // ── Emit state to phone(s) — every 2nd camera frame ──────────────────
    frameCount++;
    if (frameCount % 2 === 0 && activeExample && activeExample.getState) {
      stateEmitCount++;
      socket.emit('laptop:state', activeExample.getState());
      if (stateEmitCount % 60 === 1) {
        var s0 = markerInfos[0] || Object.values(markerInfos)[0] || null;
        console.log('[App] State #' + stateEmitCount +
          ' | detected=' + nowDetected +
          (s0 ? ' | nx=' + s0.nx.toFixed(3) + ' ny=' + s0.ny.toFixed(3) +
                ' rot=' + s0.rotation.toFixed(2) + ' parts=' + s0.parts.join('+') : '') +
          ' | inverted=' + invertControls);
      }
    }

    drawOverlay(markerInfos);
  }

  // ── Overlay drawing (canvas CSS px, same box as the 8th Wall canvas) ──────
  var PHONE_COLORS = ['#4d7cfe', '#e94560', '#f59e0b', '#34d399', '#a78bfa'];

  function strokePoly(pts, color, width, dash) {
    if (!pts || pts.some(function(p) { return !p; })) return;
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = width;
    overlayCtx.setLineDash(dash || []);
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) overlayCtx.lineTo(pts[i].x, pts[i].y);
    overlayCtx.closePath();
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);
  }

  function drawOverlay(markerInfos) {
    var cw = overlayCanvas.clientWidth, ch = overlayCanvas.clientHeight;
    if (overlayCanvas.width !== cw || overlayCanvas.height !== ch) {
      overlayCanvas.width  = cw;
      overlayCanvas.height = ch;
    }
    overlayCtx.clearRect(0, 0, cw, ch);

    var ids = Object.keys(markerInfos);
    if (ids.length === 0) {
      overlayCtx.fillStyle = 'rgba(245,158,11,0.9)';
      overlayCtx.beginPath();
      overlayCtx.arc(20, 20, 7, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.fillStyle = '#e2e2e2';
      overlayCtx.font = 'bold 12px monospace';
      overlayCtx.fillText(Object.keys(phoneViewportData).length ? 'SEARCHING PHONE' : 'WAITING FOR PHONE', 34, 24);
      return;
    }

    ids.forEach(function(idStr) {
      var info  = markerInfos[idStr];
      var color = PHONE_COLORS[info.id % PHONE_COLORS.length];

      // Found target regions (thin dashed), phone screen, content area
      strokePoly(info.regionTop,    'rgba(255,255,255,0.6)', 1, [4, 4]);
      strokePoly(info.regionBottom, 'rgba(255,255,255,0.6)', 1, [4, 4]);
      strokePoly(info.screenCorners, color, 3);
      strokePoly(info.contentCorners, '#34d399', 1.5, [8, 4]);

      // Phone centre cross + rotation arrow
      var pcx = (invertControls ? 1 - info.phoneCenterNX : info.phoneCenterNX) * info.camW;
      var pcy = (invertControls ? 1 - info.phoneCenterNY : info.phoneCenterNY) * info.camH;
      overlayCtx.strokeStyle = '#34d399';
      overlayCtx.lineWidth = 1.5;
      overlayCtx.beginPath();
      overlayCtx.moveTo(pcx - 10, pcy); overlayCtx.lineTo(pcx + 10, pcy);
      overlayCtx.moveTo(pcx, pcy - 10); overlayCtx.lineTo(pcx, pcy + 10);
      overlayCtx.stroke();
      overlayCtx.strokeStyle = '#fbbf24';
      overlayCtx.lineWidth = 2;
      overlayCtx.beginPath();
      overlayCtx.moveTo(pcx, pcy);
      overlayCtx.lineTo(pcx + Math.cos(info.rotation) * 28, pcy + Math.sin(info.rotation) * 28);
      overlayCtx.stroke();

      // Label
      overlayCtx.fillStyle = 'rgba(0,0,0,0.6)';
      overlayCtx.fillRect(pcx + 14, pcy - 13, 150, 18);
      overlayCtx.fillStyle = color;
      overlayCtx.font = 'bold 11px monospace';
      overlayCtx.fillText('ID ' + info.id + '  ' + info.nx.toFixed(2) + ',' + info.ny.toFixed(2) +
        '  ' + info.parts.join('+'), pcx + 17, pcy);
    });
  }

  // Start with the tldraw example (8th Wall tracking is developed against it first)
  switchExample('tldraw');
})();
