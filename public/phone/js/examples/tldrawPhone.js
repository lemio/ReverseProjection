/*
 * TldrawPhone — phone-side viewport into the shared whiteboard.
 *
 * The phone shows the region of the whiteboard that corresponds to its
 * physical position (determined by the laptop's AR detection).
 * Touch events are converted to WB (whiteboard) coordinates and sent to
 * the laptop via socket.
 *
 * Supports two interaction modes:
 *   draw — freehand strokes
 *   note — double-tap to place a sticky-note post-it
 */
window.TldrawPhone = (function () {
  'use strict';

  var PHONE_COLORS = ['#e94560', '#4d7cfe', '#f59e0b', '#34d399', '#a78bfa'];
  var NOTE_WB_W = 280, NOTE_WB_H = 200;

  var canvas = null, ctx = null, el = null;
  var sendTouch    = null;
  var lastState    = null;
  var mode         = 'draw'; // 'draw' | 'note'
  var myMarkerId   = 0;

  // Local in-progress stroke (for immediate visual feedback before server echo)
  var localStroke  = null; // {color, pts:[{x,y}]}  – WB coords
  var pointerActive = false;

  // Double-tap detection for note mode
  var lastTapTime = 0, lastTapCX = 0, lastTapCY = 0;

  // Note input overlay
  var noteOverlay = null, notePendingWB = null;

  var resizeHandler = null;

  /* ── Init ─────────────────────────────────────────────────────────── */
  function init(contentEl, sendFn, markerId) {
    el          = contentEl;
    sendTouch   = sendFn;
    myMarkerId  = (markerId != null) ? parseInt(markerId, 10) : 0;

    el.innerHTML =
      '<div style="position:relative;width:100%;height:100%;display:flex;' +
      '     flex-direction:column;overflow:hidden;background:#f8f7f6;">' +

      // Drawing canvas
      '  <div style="flex:1;position:relative;min-height:0;">' +
      '    <canvas id="tdlp-canvas" style="display:block;width:100%;height:100%;' +
      '      touch-action:none;"></canvas>' +
      '  </div>' +

      // Bottom toolbar
      '  <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;' +
      '       background:#1a1a1a;border-top:1px solid #2e2e2e;flex-shrink:0;">' +
      '    <button id="tdlp-draw-btn" style="flex:1;height:32px;border-radius:6px;' +
      '      border:1px solid #555;background:#2a2a2a;color:#e2e2e2;' +
      '      font-size:13px;cursor:pointer;">' +
      '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
      'Draw</button>' +
      '    <button id="tdlp-note-btn" style="flex:1;height:32px;border-radius:6px;' +
      '      border:1px solid #333;background:transparent;color:#777;' +
      '      font-size:13px;cursor:pointer;">' +
      '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>' +
      'Note</button>' +
      '  </div>' +

      // Note input overlay (hidden by default)
      '  <div id="tdlp-note-overlay" style="display:none;position:absolute;inset:0;' +
      '       background:rgba(0,0,0,0.55);z-index:50;' +
      '       align-items:center;justify-content:center;">' +
      '    <div style="background:#1e1e1e;border:1px solid #3a3a3a;border-radius:10px;' +
      '         padding:16px;width:82%;max-width:300px;">' +
      '      <p style="color:#e2e2e2;font-size:13px;margin-bottom:8px;">Add a note</p>' +
      '      <textarea id="tdlp-note-text" placeholder="Type your note…"' +
      '        style="width:100%;height:80px;background:#2a2a2a;color:#e2e2e2;' +
      '               border:1px solid #444;border-radius:6px;padding:8px;' +
      '               font-size:13px;resize:none;font-family:inherit;"></textarea>' +
      '      <div style="display:flex;gap:8px;margin-top:8px;">' +
      '        <button id="tdlp-note-cancel" style="flex:1;height:32px;' +
      '          background:transparent;color:#888;border:1px solid #444;' +
      '          border-radius:6px;cursor:pointer;">Cancel</button>' +
      '        <button id="tdlp-note-confirm" style="flex:1;height:32px;' +
      '          background:#4d7cfe;color:#fff;border:none;' +
      '          border-radius:6px;font-weight:600;cursor:pointer;">Add</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +

      '</div>';

    setTimeout(function () {
      canvas = document.getElementById('tdlp-canvas');
      if (!canvas) return;

      resizeCanvas();

      noteOverlay = document.getElementById('tdlp-note-overlay');

      // Touch / mouse events
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
      canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });
      canvas.addEventListener('mousedown',  onMouseDown);
      canvas.addEventListener('mousemove',  onMouseMove);
      canvas.addEventListener('mouseup',    onMouseUp);
      canvas.addEventListener('mouseleave', onMouseUp);

      // Mode buttons
      document.getElementById('tdlp-draw-btn').addEventListener('click', function () { setMode('draw'); });
      document.getElementById('tdlp-note-btn').addEventListener('click', function () { setMode('note'); });

      // Note overlay buttons
      document.getElementById('tdlp-note-cancel').addEventListener('click', function () {
        noteOverlay.style.display = 'none';
        notePendingWB = null;
      });
      document.getElementById('tdlp-note-confirm').addEventListener('click', submitNote);

      resizeHandler = function () { resizeCanvas(); };
      window.addEventListener('resize', resizeHandler);

      if (lastState) onState(lastState);
    }, 50);
  }

  function setMode(m) {
    mode = m;
    var drawBtn = document.getElementById('tdlp-draw-btn');
    var noteBtn = document.getElementById('tdlp-note-btn');
    if (!drawBtn) return;
    drawBtn.style.background = m === 'draw' ? '#2a2a2a' : 'transparent';
    drawBtn.style.color      = m === 'draw' ? '#e2e2e2' : '#777';
    noteBtn.style.background = m === 'note' ? '#2a2a2a' : 'transparent';
    noteBtn.style.color      = m === 'note' ? '#e2e2e2' : '#777';
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width  = canvas.offsetWidth  || 320;
    canvas.height = canvas.offsetHeight || 480;
    ctx = canvas.getContext('2d');
    render();
  }

  function invalidate() { resizeCanvas(); }

  /* ── State from laptop ────────────────────────────────────────────── */
  function onState(state) {
    lastState = state;
    if (!canvas || !state || state.type !== 'tldraw') return;
    render();
  }

  function getMyViewport() {
    if (!lastState || !lastState.phones) return null;
    // Try numeric key then string key (object keys are always strings in JS)
    return lastState.phones[myMarkerId] ||
           lastState.phones[String(myMarkerId)] || null;
  }

  /* ── Coordinate helpers ───────────────────────────────────────────── */
  function canvasToWB(cx, cy) {
    var vp = getMyViewport();
    if (!vp || !vp.wbW || !vp.wbH) return null;
    return {
      wbX: vp.wbLeft + (cx / canvas.width)  * vp.wbW,
      wbY: vp.wbTop  + (cy / canvas.height) * vp.wbH
    };
  }

  function eventToCanvas(e) {
    var touch = e.touches ? e.touches[0] : e;
    var rect  = canvas.getBoundingClientRect();
    return {
      cx: (touch.clientX - rect.left) * (canvas.width  / rect.width),
      cy: (touch.clientY - rect.top)  * (canvas.height / rect.height)
    };
  }

  /* ── Pointer handlers ────────────────────────────────────────────── */
  function onTouchStart(e) { e.preventDefault(); var p = eventToCanvas(e); pointerStart(p.cx, p.cy); }
  function onTouchMove(e)  { e.preventDefault(); var p = eventToCanvas(e); pointerMove(p.cx, p.cy); }
  function onTouchEnd(e)   { e.preventDefault(); pointerEnd(); }
  function onMouseDown(e)  { var p = eventToCanvas(e); pointerStart(p.cx, p.cy); }
  function onMouseMove(e)  { if (!pointerActive) return; var p = eventToCanvas(e); pointerMove(p.cx, p.cy); }
  function onMouseUp()     { pointerEnd(); }

  function pointerStart(cx, cy) {
    if (mode === 'note') {
      // Double-tap detection: two taps < 400 ms within 30 px
      var now = Date.now();
      var ddx = cx - lastTapCX, ddy = cy - lastTapCY;
      if (now - lastTapTime < 400 && Math.sqrt(ddx * ddx + ddy * ddy) < 30) {
        openNoteInput(cx, cy);
      } else {
        lastTapTime = now;
        lastTapCX = cx; lastTapCY = cy;
      }
      return;
    }

    // Draw mode
    pointerActive = true;
    var color = PHONE_COLORS[myMarkerId % PHONE_COLORS.length];
    localStroke = { color: color, pts: [] };
    var wb = canvasToWB(cx, cy);
    if (wb) {
      localStroke.pts.push({ x: wb.wbX, y: wb.wbY });
      sendTouch({ type: 'start', markerId: myMarkerId, wbX: wb.wbX, wbY: wb.wbY });
    }
    render();
  }

  function pointerMove(cx, cy) {
    if (!pointerActive || !localStroke) return;
    var wb = canvasToWB(cx, cy);
    if (wb) {
      localStroke.pts.push({ x: wb.wbX, y: wb.wbY });
      sendTouch({ type: 'move', markerId: myMarkerId, wbX: wb.wbX, wbY: wb.wbY });
    }
    render();
  }

  function pointerEnd() {
    if (!pointerActive) return;
    pointerActive = false;
    sendTouch({ type: 'end', markerId: myMarkerId });
    localStroke = null;
    render();
  }

  /* ── Note input ───────────────────────────────────────────────────── */
  function openNoteInput(cx, cy) {
    var wb = canvasToWB(cx, cy);
    if (!wb) return;
    notePendingWB = wb;
    if (noteOverlay) {
      noteOverlay.style.display = 'flex';
      var ta = document.getElementById('tdlp-note-text');
      if (ta) { ta.value = ''; ta.focus(); }
    }
  }

  function submitNote() {
    if (!notePendingWB) return;
    var ta   = document.getElementById('tdlp-note-text');
    var text = ta ? ta.value.trim() : '';
    if (noteOverlay) noteOverlay.style.display = 'none';
    if (!text) { notePendingWB = null; return; }
    sendTouch({
      type:     'note',
      markerId: myMarkerId,
      wbX:      notePendingWB.wbX,
      wbY:      notePendingWB.wbY,
      text:     text
    });
    notePendingWB = null;
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  function render() {
    if (!ctx || !canvas) return;
    var W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8f7f6';
    ctx.fillRect(0, 0, W, H);

    var vp = getMyViewport();
    if (!vp || !vp.wbW || !vp.wbH) {
      // Not yet detected
      ctx.fillStyle    = '#999';
      ctx.font         = '14px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for detection…', W / 2, H / 2);
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'alphabetic';
      return;
    }

    var scaleX = W / vp.wbW;
    var scaleY = H / vp.wbH;
    var lw     = Math.max(2, 3 / Math.min(scaleX, scaleY));

    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.translate(-vp.wbLeft, -vp.wbTop);

    // Draw all server strokes
    if (lastState && lastState.strokes) {
      lastState.strokes.forEach(function (s) { renderStroke(s, lw); });
    }

    // Draw local in-progress stroke (before server echo)
    if (localStroke && localStroke.pts.length > 1) {
      renderStroke(localStroke, lw);
    }

    // Draw notes
    if (lastState && lastState.notes) {
      lastState.notes.forEach(renderNote);
    }

    ctx.restore();
  }

  function renderStroke(stroke, lw) {
    var pts = stroke.pts;
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = stroke.color || '#e94560';
    ctx.lineWidth   = lw;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function renderNote(note) {
    ctx.save();
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(note.x + 4, note.y + 4, NOTE_WB_W, NOTE_WB_H);
    // Body
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(note.x, note.y, NOTE_WB_W, NOTE_WB_H);
    // Top stripe
    ctx.fillStyle = note.color || '#4d7cfe';
    ctx.fillRect(note.x, note.y, NOTE_WB_W, 8);
    // Text (scale-independent font)
    var vp = getMyViewport();
    var scaleX = canvas.width / (vp ? vp.wbW : 1);
    var fs = Math.max(8, Math.round(13 / scaleX));
    ctx.fillStyle    = '#1a1a1a';
    ctx.font         = fs + 'px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(note.text || '', note.x + 6, note.y + 14, NOTE_WB_W - 12);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /* ── Destroy ──────────────────────────────────────────────────────── */
  function destroy() {
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    if (canvas) {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
      canvas.removeEventListener('touchend',   onTouchEnd);
      canvas.removeEventListener('mousedown',  onMouseDown);
      canvas.removeEventListener('mousemove',  onMouseMove);
      canvas.removeEventListener('mouseup',    onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseUp);
    }
    canvas = null; ctx = null; el = null;
    sendTouch = null; lastState = null;
    localStroke = null; pointerActive = false;
    noteOverlay = null; notePendingWB = null;
    console.log('[TldrawPhone] destroyed');
  }

  return { init, onState, invalidate, destroy };
})();
