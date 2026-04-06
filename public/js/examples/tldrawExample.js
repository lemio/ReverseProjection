/*
 * TldrawExample — shared canvas-based whiteboard for the laptop side.
 *
 * Phones draw freehand strokes and add sticky-note post-its on their viewport.
 * Multiple phones are supported; each has a unique marker ID and colour.
 * The laptop canvas shows all strokes, notes and phone-viewport outlines.
 *
 * Coordinate system: WB (whiteboard) coords are 0-10000 × 0-10000, mapped
 * from normalised camera frame positions (nx·10000, ny·10000).
 */
window.TldrawExample = (function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────── */
  var WB_W = 10000, WB_H = 10000;
  var NOTE_WB_W = 280, NOTE_WB_H = 200; // sticky-note size in WB units

  // Per-marker colours (index = markerId % length)
  var PHONE_COLORS = ['#e94560', '#4d7cfe', '#f59e0b', '#34d399', '#a78bfa'];

  /* ── State ─────────────────────────────────────────────────────────── */
  var canvas = null, ctx = null, panel = null, animFrame = null;
  var panelW = 0, panelH = 0;

  // Camera / view
  var camera = { x: WB_W / 2, y: WB_H / 2, zoom: 0.06 };

  // Drawing content
  var completedStrokes = []; // [{markerId, color, pts:[{x,y}]}]
  var activeStrokes    = {}; // {markerId: {markerId, color, pts}}
  var notes            = []; // [{id, markerId, color, x, y, text}]
  var noteId           = 0;

  // Phone viewports (from detection)
  var phoneViewports = {}; // {markerId: {wbLeft, wbTop, wbW, wbH, rotation, color, label, drawAreaW, drawAreaH}}
  var phoneDetected  = {}; // {markerId: bool}

  // Mouse pan
  var mouseDown = false, lastMX = 0, lastMY = 0;

  var rotationEnabled = false;
  var resizeHandler   = null;

  /* ── Init ──────────────────────────────────────────────────────────── */
  function init(panelEl) {
    panel = panelEl;
    panel.innerHTML =
      '<div style="position:relative;width:100%;height:100%;">' +
      '  <canvas id="tldraw-canvas" style="display:block;width:100%;height:100%;' +
      '    cursor:grab;background:#f8f7f6;"></canvas>' +
      '  <div style="position:absolute;top:8px;left:8px;display:flex;gap:6px;z-index:10;">' +
      '    <button id="tdl-clear" style="font-size:11px;padding:3px 10px;' +
      '      background:rgba(15,15,15,0.75);color:#e2e2e2;border:1px solid #444;' +
      '      border-radius:4px;cursor:pointer;">Clear All</button>' +
      '    <button id="tdl-fit" style="font-size:11px;padding:3px 10px;' +
      '      background:rgba(15,15,15,0.75);color:#e2e2e2;border:1px solid #444;' +
      '      border-radius:4px;cursor:pointer;">Fit View</button>' +
      '  </div>' +
      '  <div style="position:absolute;top:6px;right:8px;font:600 9px/1 monospace;' +
      '    letter-spacing:.08em;color:rgba(77,124,254,.9);background:rgba(0,0,0,.6);' +
      '    padding:3px 7px;border-radius:3px;pointer-events:none;">WHITEBOARD</div>' +
      '</div>';

    canvas = document.getElementById('tldraw-canvas');
    resizeCanvas();

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup',   onMouseUp);
    canvas.addEventListener('mouseleave',onMouseUp);
    canvas.addEventListener('wheel',     onWheel, { passive: false });

    document.getElementById('tdl-clear').addEventListener('click', function () {
      completedStrokes = [];
      activeStrokes = {};
      notes = [];
      noteId = 0;
    });
    document.getElementById('tdl-fit').addEventListener('click', fitView);

    resizeHandler = function () { resizeCanvas(); };
    window.addEventListener('resize', resizeHandler);

    if (animFrame) cancelAnimationFrame(animFrame);
    renderLoop();
    console.log('[TldrawExample] init');
  }

  function resizeCanvas() {
    if (!canvas) return;
    panelW = canvas.offsetWidth  || 400;
    panelH = canvas.offsetHeight || 500;
    canvas.width  = panelW;
    canvas.height = panelH;
    ctx = canvas.getContext('2d');
  }

  /* ── View helpers ──────────────────────────────────────────────────── */
  function wbToScreen(wbX, wbY) {
    return {
      x: (wbX - camera.x) * camera.zoom + panelW / 2,
      y: (wbY - camera.y) * camera.zoom + panelH / 2
    };
  }
  function screenToWB(sx, sy) {
    return {
      x: (sx - panelW / 2) / camera.zoom + camera.x,
      y: (sy - panelH / 2) / camera.zoom + camera.y
    };
  }

  function fitView() {
    var vps = Object.values(phoneViewports);
    if (vps.length === 0) {
      camera.x = WB_W / 2;
      camera.y = WB_H / 2;
      camera.zoom = 0.06;
    } else {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      vps.forEach(function (vp) {
        minX = Math.min(minX, vp.wbLeft - 600);
        minY = Math.min(minY, vp.wbTop  - 600);
        maxX = Math.max(maxX, vp.wbLeft + vp.wbW + 600);
        maxY = Math.max(maxY, vp.wbTop  + vp.wbH + 600);
      });
      camera.x = (minX + maxX) / 2;
      camera.y = (minY + maxY) / 2;
      var zx = panelW / Math.max(1, maxX - minX);
      var zy = panelH / Math.max(1, maxY - minY);
      camera.zoom = Math.min(zx, zy, 3);
    }
  }

  /* ── Mouse pan / zoom ──────────────────────────────────────────────── */
  function onMouseDown(e) {
    mouseDown = true;
    lastMX = e.clientX;
    lastMY = e.clientY;
    canvas.style.cursor = 'grabbing';
  }
  function onMouseMove(e) {
    if (!mouseDown) return;
    camera.x -= (e.clientX - lastMX) / camera.zoom;
    camera.y -= (e.clientY - lastMY) / camera.zoom;
    lastMX = e.clientX;
    lastMY = e.clientY;
  }
  function onMouseUp() {
    mouseDown = false;
    canvas.style.cursor = 'grab';
  }
  function onWheel(e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var wbPt = screenToWB(mx, my);
    camera.zoom *= e.deltaY < 0 ? 1.1 : 0.9;
    camera.zoom = Math.max(0.005, Math.min(10, camera.zoom));
    // Keep the mouse-pointed WB position under the cursor
    var after = wbToScreen(wbPt.x, wbPt.y);
    camera.x += (after.x - mx) / camera.zoom;
    camera.y += (after.y - my) / camera.zoom;
  }

  /* ── Example API ───────────────────────────────────────────────────── */
  function setRotationEnabled(enabled) {
    rotationEnabled = !!enabled;
  }

  /* Called by app.js with a map of {markerId: markerInfo} for every detected marker */
  function onAllMarkersPosition(markerInfos) {
    Object.values(markerInfos).forEach(function (info) {
      phoneDetected[info.id] = true;
      phoneViewports[info.id] = {
        wbLeft:    info.wbX - info.wbVpW / 2,
        wbTop:     info.wbY - info.wbVpH / 2,
        wbW:       info.wbVpW,
        wbH:       info.wbVpH,
        rotation:  rotationEnabled ? info.rotation : 0,
        color:     PHONE_COLORS[info.id % PHONE_COLORS.length],
        label:     'Phone ' + info.id,
        drawAreaW: info.drawAreaW,
        drawAreaH: info.drawAreaH
      };
    });
  }

  function onDetectionChange(isDetected) {
    if (!isDetected) {
      Object.keys(phoneDetected).forEach(function (id) { phoneDetected[id] = false; });
    }
  }

  /* phone:touch events carry WB coords (wbX, wbY) computed on the phone */
  function onPhoneTouch(data) {
    var mid = data.markerId != null ? data.markerId : 0;
    var color = PHONE_COLORS[mid % PHONE_COLORS.length];

    if (data.type === 'start') {
      activeStrokes[mid] = { markerId: mid, color: color, pts: [] };
      if (data.wbX != null) activeStrokes[mid].pts.push({ x: data.wbX, y: data.wbY });

    } else if (data.type === 'move') {
      if (activeStrokes[mid] && data.wbX != null) {
        activeStrokes[mid].pts.push({ x: data.wbX, y: data.wbY });
      }

    } else if (data.type === 'end') {
      if (activeStrokes[mid] && activeStrokes[mid].pts.length > 1) {
        completedStrokes.push(activeStrokes[mid]);
      }
      delete activeStrokes[mid];

    } else if (data.type === 'note' && data.wbX != null) {
      notes.push({
        id:      ++noteId,
        markerId: mid,
        color:   color,
        x:       data.wbX,
        y:       data.wbY,
        text:    data.text || ''
      });
    }
  }

  function getState() {
    var phonesState = {};
    Object.keys(phoneViewports).forEach(function (id) {
      var vp = phoneViewports[id];
      phonesState[id] = {
        wbLeft:    vp.wbLeft,
        wbTop:     vp.wbTop,
        wbW:       vp.wbW,
        wbH:       vp.wbH,
        rotation:  vp.rotation,
        color:     vp.color,
        drawAreaW: vp.drawAreaW,
        drawAreaH: vp.drawAreaH
      };
    });

    var allStrokes = completedStrokes.concat(Object.values(activeStrokes));
    return {
      type:     'tldraw',
      detected: Object.values(phoneDetected).some(Boolean),
      phones:   phonesState,
      strokes:  allStrokes,
      notes:    notes
    };
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderLoop() {
    animFrame = requestAnimationFrame(renderLoop);
    render();
  }

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, panelW, panelH);

    // White paper background
    ctx.fillStyle = '#f8f7f6';
    ctx.fillRect(0, 0, panelW, panelH);

    // Dot-grid
    var gridPx = 40 * camera.zoom;
    if (gridPx > 6) {
      var x0wb = Math.floor((camera.x - panelW / (2 * camera.zoom)) / 40) * 40;
      var y0wb = Math.floor((camera.y - panelH / (2 * camera.zoom)) / 40) * 40;
      ctx.fillStyle = '#d0cece';
      for (var gx = x0wb; gx < camera.x + panelW / (2 * camera.zoom) + 40; gx += 40) {
        for (var gy = y0wb; gy < camera.y + panelH / (2 * camera.zoom) + 40; gy += 40) {
          var sp = wbToScreen(gx, gy);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, Math.min(1.5, gridPx / 20), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Completed strokes
    completedStrokes.forEach(drawStroke);

    // Active (in-progress) strokes
    Object.values(activeStrokes).forEach(drawStroke);

    // Notes
    notes.forEach(drawNote);

    // Phone viewport outlines
    Object.values(phoneViewports).forEach(drawViewport);
  }

  function drawStroke(stroke) {
    if (!stroke.pts || stroke.pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth   = Math.max(1.5, 3 / camera.zoom);
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    var p0 = wbToScreen(stroke.pts[0].x, stroke.pts[0].y);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    for (var i = 1; i < stroke.pts.length; i++) {
      var p = wbToScreen(stroke.pts[i].x, stroke.pts[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawNote(note) {
    var p  = wbToScreen(note.x, note.y);
    var nw = NOTE_WB_W * camera.zoom;
    var nh = NOTE_WB_H * camera.zoom;

    ctx.save();
    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.fillRect(p.x + 3, p.y + 3, nw, nh);
    // Yellow body
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(p.x, p.y, nw, nh);
    // Top colour stripe
    ctx.fillStyle = note.color;
    ctx.fillRect(p.x, p.y, nw, Math.max(4, 7 * camera.zoom));
    // Text
    var fs = Math.max(9, Math.round(12 * camera.zoom));
    ctx.fillStyle = '#1a1a1a';
    ctx.font      = fs + 'px sans-serif';
    ctx.textBaseline = 'top';
    wrapText(note.text, p.x + 5, p.y + 10 * camera.zoom + Math.max(4, 7 * camera.zoom),
      nw - 10, fs * 1.35);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  function wrapText(text, x, y, maxW, lineH) {
    var words = String(text).split(' ');
    var line  = '';
    var cy    = y;
    for (var i = 0; i < words.length; i++) {
      var test = line + words[i] + ' ';
      if (ctx.measureText(test).width > maxW && line !== '') {
        ctx.fillText(line.trim(), x, cy);
        line = words[i] + ' ';
        cy  += lineH;
      } else {
        line = test;
      }
    }
    if (line.trim()) ctx.fillText(line.trim(), x, cy);
  }

  function drawViewport(vp) {
    if (!vp.wbW || !vp.wbH) return;
    var p  = wbToScreen(vp.wbLeft, vp.wbTop);
    var sw = vp.wbW * camera.zoom;
    var sh = vp.wbH * camera.zoom;
    var cx = p.x + sw / 2;
    var cy = p.y + sh / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(vp.rotation || 0);
    ctx.translate(-cx, -cy);

    ctx.strokeStyle = vp.color;
    ctx.lineWidth   = 2;
    ctx.setLineDash([7, 4]);
    ctx.strokeRect(p.x, p.y, sw, sh);
    ctx.setLineDash([]);

    var fs = Math.max(9, Math.round(11 * camera.zoom));
    ctx.fillStyle    = vp.color;
    ctx.font         = 'bold ' + fs + 'px sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(vp.label || 'Phone', p.x + 4, p.y - 3);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /* ── Destroy ────────────────────────────────────────────────────────── */
  function destroy() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    completedStrokes = [];
    activeStrokes    = {};
    notes            = [];
    phoneViewports   = {};
    phoneDetected    = {};
    canvas = null; ctx = null; panel = null;
    console.log('[TldrawExample] destroyed');
  }

  return {
    init,
    onAllMarkersPosition,
    onDetectionChange,
    onPhoneTouch,
    getState,
    setRotationEnabled,
    destroy
  };
})();
