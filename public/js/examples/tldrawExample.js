/*
 * TldrawExample — laptop-side whiteboard using the real tldraw library.
 *
 * Phones draw directly in tldraw (including native sticky notes).
 * Incremental store diffs are synced via socket.io 'tldraw:diff' events.
 * Phone viewport positions (from AR detection) are shown as a canvas overlay
 * drawn on top of the tldraw canvas.
 *
 * The laptop user can zoom/pan the tldraw canvas freely — we never forcibly
 * re-centre the camera.  We only update the overlay rectangles.
 */
window.TldrawExample = (function () {
  'use strict';

  var TL_VERSION  = '2';
  var TL_ESM      = 'https://esm.sh/tldraw@' + TL_VERSION + '?deps=react@18,react-dom@18';
  var REACT_ESM   = 'https://esm.sh/react@18';
  var RDCLIENT    = 'https://esm.sh/react-dom@18/client';
  var TL_CSS_URL  = 'https://esm.sh/tldraw@' + TL_VERSION + '/tldraw.css';

  var PHONE_COLORS = ['#e94560', '#4d7cfe', '#f59e0b', '#34d399', '#a78bfa'];

  /* ── Module state ──────────────────────────────────────────────────── */
  var _panel         = null;
  var _socket        = null;
  var _root          = null;
  var _editor        = null;
  var _storeUnsub    = null;
  var _syncTimer     = null;
  var _pendingDiff   = null;
  var _snapshotTimer = null;
  var _pendingSnap   = null;

  // Overlay canvas (phone viewport indicators on top of tldraw)
  var _overlayCanvas = null;
  var _overlayCtx    = null;
  var _animFrame     = null;
  var _resizeHandler = null;

  // Phone viewport data (from tracking) — rotation is not used for tldraw
  var _phoneViewports = {};
  var _phoneDetected  = {};

  /* ── CSS injection ─────────────────────────────────────────────────── */
  function _injectCss() {
    if (document.getElementById('tldraw-laptop-css')) return;
    var link = document.createElement('link');
    link.id   = 'tldraw-laptop-css';
    link.rel  = 'stylesheet';
    link.href = TL_CSS_URL;
    document.head.appendChild(link);
  }

  /* ── Init ──────────────────────────────────────────────────────────── */
  function init(panelEl, socket) {
    _panel  = panelEl;
    _socket = socket || null;
    _phoneViewports = {};
    _phoneDetected  = {};
    _track          = {};

    _injectCss();

    _panel.innerHTML =
      '<div style="position:relative;width:100%;height:100%;">' +
      '  <div id="tdl-react-root" style="position:absolute;inset:0;"></div>' +
      '  <canvas id="tdl-vp-overlay" style="position:absolute;inset:0;' +
      '    pointer-events:none;z-index:500;"></canvas>' +
      '  <div id="tdl-loading" style="position:absolute;inset:0;display:flex;' +
      '    align-items:center;justify-content:center;background:#f8f7f6;' +
      '    color:#999;font-size:13px;font-family:sans-serif;">' +
      '    Loading whiteboard\u2026</div>' +
      '</div>';

    // Socket listeners — receive remote changes
    if (_socket) {
      _socket.on('tldraw:diff',     _onRemoteDiff);
      _socket.on('tldraw:snapshot', _onRemoteSnapshot);
      _socket.emit('tldraw:init-request');
    }

    Promise.all([
      import(REACT_ESM),
      import(RDCLIENT),
      import(TL_ESM)
    ]).then(function (mods) {
      var React      = mods[0];
      var createRoot = mods[1].createRoot;
      var TL         = mods[2];

      var rootEl = document.getElementById('tdl-react-root');
      if (!rootEl) return;

      _root = createRoot(rootEl);
      _root.render(
        React.createElement(TL.Tldraw, {
          onMount: function (editor) { _onMount(editor); }
        })
      );

      // Hide loading overlay
      var loading = document.getElementById('tdl-loading');
      if (loading) loading.style.display = 'none';

      // Set up overlay canvas animation loop
      _overlayCanvas = document.getElementById('tdl-vp-overlay');
      _overlayCtx    = _overlayCanvas ? _overlayCanvas.getContext('2d') : null;
      _resizeOverlay();
      _animFrame = requestAnimationFrame(_renderOverlay);

      _resizeHandler = function () { _resizeOverlay(); };
      window.addEventListener('resize', _resizeHandler);

    }).catch(function (err) {
      console.error('[TldrawExample] Failed to load tldraw:', err);
      var loading = document.getElementById('tdl-loading');
      if (loading) loading.textContent = 'Whiteboard failed to load';
    });
  }

  function _onMount(editor) {
    _editor = editor;

    // Apply any snapshot that arrived before the editor was ready
    if (_pendingSnap) {
      editor.store.loadSnapshot(_pendingSnap);
      _pendingSnap = null;
    }

    // Subscribe to user-initiated changes and forward as diffs
    _storeUnsub = editor.store.listen(function (change) {
      if (change.source !== 'user') return;
      _accumulateDiff(change.changes);
    });

    console.log('[TldrawExample] tldraw editor ready');
  }

  /* ── Store sync ────────────────────────────────────────────────────── */
  function _accumulateDiff(changes) {
    if (!_pendingDiff) _pendingDiff = { added: {}, updated: {}, removed: {} };
    Object.assign(_pendingDiff.added,   changes.added   || {});
    var upd = changes.updated || {};
    Object.keys(upd).forEach(function (id) {
      _pendingDiff.updated[id] = upd[id][1]; // keep the 'next' version
    });
    Object.assign(_pendingDiff.removed, changes.removed || {});
    if (_syncTimer) return;
    _syncTimer = setTimeout(function () {
      _syncTimer = null;
      _flushDiff();
    }, 80);
  }

  function _flushDiff() {
    if (!_pendingDiff || !_socket) return;
    var diff = {
      added:   Object.values(_pendingDiff.added),
      updated: Object.values(_pendingDiff.updated),
      removed: Object.keys(_pendingDiff.removed)
    };
    _pendingDiff = null;
    _socket.emit('tldraw:diff', diff);
    // Throttle full-snapshot upload for late joiners
    if (_snapshotTimer) clearTimeout(_snapshotTimer);
    _snapshotTimer = setTimeout(function () {
      _snapshotTimer = null;
      if (_editor && _socket) {
        _socket.emit('tldraw:snapshot', _editor.store.getSnapshot());
      }
    }, 3000);
  }

  // Called by app.js when a 'tldraw:diff' arrives from any phone or laptop
  function onTldrawDiff(diff) {
    if (!_editor) return;
    _editor.store.mergeRemoteChanges(function () {
      var records = [].concat(diff.added || [], diff.updated || []);
      // Filter out per-device records that must not be shared across clients:
      //   camera   — stores each client's viewport position (x, y, z pan/zoom)
      //   instance — stores per-client UI state (current tool, selected shapes, etc.)
      // All other record types (shapes, pages, assets, etc.) are shared normally.
      records = records.filter(function (r) {
        return r && r.typeName !== 'camera' && r.typeName !== 'instance';
      });
      if (records.length) _editor.store.put(records);
      var removed = diff.removed || [];
      if (removed.length) _editor.store.remove(removed);
    });
  }

  function _onRemoteDiff(diff)     { onTldrawDiff(diff); }
  function _onRemoteSnapshot(snap) {
    if (_editor) {
      // Preserve the laptop's own camera position — loading a snapshot would
      // otherwise reset it to whatever camera was in the snapshot (from a phone).
      var cam = _editor.getCamera();
      _editor.store.loadSnapshot(snap);
      _editor.setCamera(cam, { immediate: true });
    } else {
      _pendingSnap = snap;
    }
  }

  /* ── Overlay: phone viewport rectangles ────────────────────────────── */
  function _resizeOverlay() {
    if (!_overlayCanvas || !_panel) return;
    _overlayCanvas.width  = _panel.offsetWidth  || 800;
    _overlayCanvas.height = _panel.offsetHeight || 600;
  }

  function _renderOverlay() {
    _animFrame = requestAnimationFrame(_renderOverlay);
    if (!_overlayCtx || !_overlayCanvas) return;
    var W = _overlayCanvas.width, H = _overlayCanvas.height;
    _overlayCtx.clearRect(0, 0, W, H);
    if (!_editor) return;

    var cam = _editor.getCamera();
    if (!cam) return;

    Object.values(_phoneViewports).forEach(function (vp) {
      if (!vp.wbW || !vp.wbH) return;
      var detected = !!_phoneDetected[vp.id];
      var color    = vp.color || '#4d7cfe';

      // WB → screen: screenX = (worldX + cam.x) * cam.z
      var sx = (vp.wbLeft + cam.x) * cam.z;
      var sy = (vp.wbTop  + cam.y) * cam.z;
      var sw = vp.wbW * cam.z;
      var sh = vp.wbH * cam.z;

      _overlayCtx.globalAlpha = detected ? 1 : 0.3;
      _overlayCtx.strokeStyle = color;
      _overlayCtx.lineWidth   = 2;
      _overlayCtx.setLineDash([8, 4]);
      _overlayCtx.strokeRect(sx, sy, sw, sh);
      _overlayCtx.setLineDash([]);

      // Label above the rectangle
      var fs = Math.max(9, Math.min(14, sw / 8));
      _overlayCtx.font      = 'bold ' + fs + 'px sans-serif';
      _overlayCtx.fillStyle = color;
      _overlayCtx.fillText(vp.label || ('Phone ' + vp.id), sx + 4, sy - 4);

      _overlayCtx.globalAlpha = 1;
    });
  }

  /* ── Example API (called by app.js) ────────────────────────────────── */

  // Rotation is not forwarded to tldraw — it does not make sense to rotate
  // the whiteboard based on phone tilt.  The method is kept so app.js can
  // call it without errors when the toggle is clicked.
  function setRotationEnabled() { /* no-op for tldraw */ }

  /*
   * Phone movement → whiteboard movement, in the phone's own frame.
   *
   * The phone shows drawAreaW × drawAreaH CSS px of whiteboard at zoom
   * 1/contentZoom (a page rectangle of drawArea × contentZoom), always upright
   * on its own screen. So movement must be measured along the phone's own
   * axes and in its own pixels: moving the phone two active-area widths along
   * its screen's x axis moves that rectangle two widths in page x — also when
   * the phone is held rotated (landscape) or seen mirrored, and at any
   * distance from the webcam.
   *
   * From the tracked screen corners we build the homography phone px ↔ camera
   * px. When the phone is (re)found we remember the camera point under the
   * centre of its active area (the anchor). Each frame that camera point is
   * mapped back into the phone's current screen coordinates; how far the
   * phone's centre has moved away from it (in phone px, phone axes) is how far
   * the page rectangle moves. Being anchor-based, noise doesn't accumulate as
   * drift, and the view doesn't jump when the phone is found again.
   */
  var POS_SMOOTH = 0.5;     // EMA factor for the page position (1 = no smoothing)
  var _track = {};          // id → {active, page:{x,y}, anchor:{cam, px, py, zoom}}

  function _initialPageCenter() {
    if (!_editor) return { x: 0, y: 0 };
    var b = _editor.getViewportPageBounds();
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  function _updatePhone(info) {
    var t    = _track[info.id] || (_track[info.id] = { active: false, page: null });
    var zoom = info.contentZoom || 1;

    // Homographies between phone screen px and camera px
    var sw = info.screenW, sh = info.screenH;
    var phoneRect = [{ x: 0, y: 0 }, { x: sw, y: 0 }, { x: sw, y: sh }, { x: 0, y: sh }];
    var toCam   = Homography.computeH(phoneRect, info.screenCorners);
    var toPhone = Homography.computeH(info.screenCorners, phoneRect);
    if (!toCam || !toPhone) return _phoneViewports[info.id] || null;

    // Centre of the active (tldraw) area, in phone px
    var centre = { x: sw / 2, y: info.borderPx + info.drawAreaH / 2 };

    if (!t.page) t.page = _initialPageCenter();
    // New anchor when (re)found, zoom changed, or the phone switched between
    // portrait and landscape (its layout axes changed)
    var layout = sw + 'x' + sh;
    if (!t.active || !t.anchor || t.anchor.zoom !== zoom || t.anchor.layout !== layout) {
      t.active = true;
      t.anchor = { cam: Homography.applyH(toCam, centre), px: t.page.x, py: t.page.y, zoom: zoom, layout: layout };
    }

    // Where the anchor is now, seen from the phone → how far the phone moved
    var a = Homography.applyH(toPhone, t.anchor.cam);
    var target = {
      x: t.anchor.px + (centre.x - a.x) * zoom,
      y: t.anchor.py + (centre.y - a.y) * zoom
    };
    t.page = {
      x: t.page.x + (target.x - t.page.x) * POS_SMOOTH,
      y: t.page.y + (target.y - t.page.y) * POS_SMOOTH
    };

    var w = info.drawAreaW * zoom, h = info.drawAreaH * zoom;
    return {
      id:        info.id,
      wbLeft:    t.page.x - w / 2,
      wbTop:     t.page.y - h / 2,
      wbW:       w,
      wbH:       h,
      color:     PHONE_COLORS[info.id % PHONE_COLORS.length],
      label:     'Phone ' + info.id,
      drawAreaW: info.drawAreaW,
      drawAreaH: info.drawAreaH
    };
  }

  function onAllMarkersPosition(markerInfos) {
    Object.keys(_track).forEach(function (id) {
      if (!markerInfos[id]) { _track[id].active = false; _phoneDetected[id] = false; }
    });
    Object.values(markerInfos).forEach(function (info) {
      var vp = _updatePhone(info);
      if (!vp) return;
      _phoneDetected[info.id] = true;
      _phoneViewports[info.id] = vp;
    });
  }

  function onDetectionChange(isDetected) {
    if (!isDetected) {
      Object.keys(_phoneDetected).forEach(function (id) { _phoneDetected[id] = false; });
      Object.keys(_track).forEach(function (id) { _track[id].active = false; });
    }
  }

  // getState is called each detection frame by app.js; result → laptop:state → phones.
  // Phones use phones[myId] to position their tldraw camera over the correct WB area.
  // Rotation is NOT included — tldraw on the phone always shows the canvas upright.
  function getState() {
    var phonesState = {};
    Object.keys(_phoneViewports).forEach(function (id) {
      var vp = _phoneViewports[id];
      phonesState[id] = {
        wbLeft:    vp.wbLeft,
        wbTop:     vp.wbTop,
        wbW:       vp.wbW,
        wbH:       vp.wbH,
        color:     vp.color,
        drawAreaW: vp.drawAreaW,
        drawAreaH: vp.drawAreaH
      };
    });
    return {
      type:     'tldraw',
      detected: Object.values(_phoneDetected).some(Boolean),
      phones:   phonesState
    };
  }

  /* ── Destroy ────────────────────────────────────────────────────────── */
  function destroy() {
    if (_animFrame)     { cancelAnimationFrame(_animFrame);   _animFrame     = null; }
    if (_storeUnsub)    { _storeUnsub();                      _storeUnsub    = null; }
    if (_syncTimer)     { clearTimeout(_syncTimer);           _syncTimer     = null; }
    if (_snapshotTimer) { clearTimeout(_snapshotTimer);       _snapshotTimer = null; }
    if (_resizeHandler) {
      window.removeEventListener('resize', _resizeHandler);
      _resizeHandler = null;
    }
    if (_socket) {
      _socket.off('tldraw:diff',     _onRemoteDiff);
      _socket.off('tldraw:snapshot', _onRemoteSnapshot);
    }
    if (_root) { _root.unmount(); _root = null; }

    _editor         = null;
    _pendingDiff    = null;
    _pendingSnap    = null;
    _overlayCanvas  = null;
    _overlayCtx     = null;
    _phoneViewports = {};
    _phoneDetected  = {};
    _track          = {};
    console.log('[TldrawExample] destroyed');
  }

  return {
    init,
    onAllMarkersPosition,
    onDetectionChange,
    onTldrawDiff,
    getState,
    setRotationEnabled,
    destroy
  };
})();
