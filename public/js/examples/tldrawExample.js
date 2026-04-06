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

  // Phone viewport data (from AR detection) — rotation is not used for tldraw
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

  function onAllMarkersPosition(markerInfos) {
    Object.values(markerInfos).forEach(function (info) {
      _phoneDetected[info.id] = true;
      _phoneViewports[info.id] = {
        id:        info.id,
        wbLeft:    info.wbX - info.wbVpW / 2,
        wbTop:     info.wbY - info.wbVpH / 2,
        wbW:       info.wbVpW,
        wbH:       info.wbVpH,
        color:     PHONE_COLORS[info.id % PHONE_COLORS.length],
        label:     'Phone ' + info.id,
        drawAreaW: info.drawAreaW,
        drawAreaH: info.drawAreaH
      };
    });
  }

  function onDetectionChange(isDetected) {
    if (!isDetected) {
      Object.keys(_phoneDetected).forEach(function (id) { _phoneDetected[id] = false; });
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
