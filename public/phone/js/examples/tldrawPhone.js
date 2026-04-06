/*
 * TldrawPhone — phone-side whiteboard using the real tldraw library.
 *
 * The tldraw editor is loaded via ESM from esm.sh (no build step needed).
 * Native sticky notes are used — tap the note tool then tap the canvas to
 * place a note, and type directly on it in tldraw's inline editor.
 *
 * Camera position is driven by the AR detection: the laptop sends viewport
 * bounds (wbLeft, wbTop, wbW, wbH) via laptop:state, and this module sets
 * the tldraw camera to match, acting as a window into the shared whiteboard.
 *
 * No CSS rotation is applied — the tldraw canvas always remains upright.
 *
 * Store changes are synced to/from the server via 'tldraw:diff' socket events.
 * phoneApp.js manages the socket relay; this module exposes onTldrawDiff /
 * onTldrawSnapshot for incoming events.
 */
window.TldrawPhone = (function () {
  'use strict';

  var TL_VERSION = '2';
  var TL_ESM     = 'https://esm.sh/tldraw@' + TL_VERSION + '?deps=react@18,react-dom@18';
  var REACT_ESM  = 'https://esm.sh/react@18';
  var RDCLIENT   = 'https://esm.sh/react-dom@18/client';
  var TL_CSS_URL = 'https://esm.sh/tldraw@' + TL_VERSION + '/tldraw.css';

  /* ── State ─────────────────────────────────────────────────────────── */
  var _root          = null;
  var _editor        = null;
  var _sendFn        = null;
  var _markerId      = 0;
  var _lastVp        = null;
  var _storeUnsub    = null;
  var _syncTimer     = null;
  var _pendingDiff   = null;
  var _snapshotTimer = null;
  var _pendingSnap   = null;

  /* ── CSS injection ─────────────────────────────────────────────────── */
  function _injectCss() {
    if (document.getElementById('tldraw-phone-css')) return;
    var link = document.createElement('link');
    link.id   = 'tldraw-phone-css';
    link.rel  = 'stylesheet';
    link.href = TL_CSS_URL;
    document.head.appendChild(link);
  }

  /* ── Init ──────────────────────────────────────────────────────────── */
  function init(contentEl, sendFn, markerId) {
    _sendFn    = sendFn;
    _markerId  = parseInt(markerId != null ? markerId : 0, 10);

    _injectCss();

    contentEl.innerHTML =
      '<div id="tdlp-root" style="position:absolute;inset:0;overflow:hidden;"></div>' +
      '<div id="tdlp-msg" style="position:absolute;inset:0;display:flex;' +
      '     align-items:center;justify-content:center;background:#0f0f0f;' +
      '     color:#555;font-size:12px;font-family:sans-serif;pointer-events:none;">' +
      '     Loading whiteboard\u2026</div>';

    Promise.all([
      import(REACT_ESM),
      import(RDCLIENT),
      import(TL_ESM)
    ]).then(function (mods) {
      var React      = mods[0];
      var createRoot = mods[1].createRoot;
      var TL         = mods[2];

      var rootEl = document.getElementById('tdlp-root');
      if (!rootEl) return;

      _root = createRoot(rootEl);
      _root.render(
        React.createElement(TL.Tldraw, {
          onMount: function (editor) { _onMount(editor); }
        })
      );

      var msg = document.getElementById('tdlp-msg');
      if (msg) msg.style.display = 'none';

    }).catch(function (err) {
      console.error('[TldrawPhone] Failed to load tldraw:', err);
      var msg = document.getElementById('tdlp-msg');
      if (msg) msg.textContent = 'Whiteboard failed to load';
    });
  }

  function _onMount(editor) {
    _editor = editor;

    // Start with the draw (pen) tool selected
    editor.setCurrentTool('draw');

    // Apply any snapshot or viewport that arrived before the editor was ready
    if (_pendingSnap) {
      editor.store.loadSnapshot(_pendingSnap);
      _pendingSnap = null;
    }
    if (_lastVp) _setCamera(_lastVp);

    // Listen to user-initiated store changes and forward as diffs
    _storeUnsub = editor.store.listen(function (change) {
      if (change.source !== 'user') return;
      _accumulateDiff(change.changes);
    });

    // Send our current state to any device that already asked for it
    // (covers the case where the editor was slow to load but init-request arrived
    //  before _onMount fired; in that case we push a snapshot now)
    if (_sendFn) {
      _sendFn({ type: 'tldraw:snapshot', snapshot: editor.store.getSnapshot() });
    }

    console.log('[TldrawPhone] tldraw ready, markerId=' + _markerId);
  }

  /* ── Store sync ────────────────────────────────────────────────────── */
  function _accumulateDiff(changes) {
    if (!_pendingDiff) _pendingDiff = { added: {}, updated: {}, removed: {} };
    Object.assign(_pendingDiff.added,   changes.added   || {});
    var upd = changes.updated || {};
    Object.keys(upd).forEach(function (id) {
      _pendingDiff.updated[id] = upd[id][1]; // take 'next' version from [prev, next]
    });
    Object.assign(_pendingDiff.removed, changes.removed || {});
    if (_syncTimer) return;
    _syncTimer = setTimeout(function () {
      _syncTimer = null;
      _flushDiff();
    }, 80);
  }

  function _flushDiff() {
    if (!_pendingDiff || !_sendFn) return;
    var diff = {
      added:   Object.values(_pendingDiff.added),
      updated: Object.values(_pendingDiff.updated),
      removed: Object.keys(_pendingDiff.removed)
    };
    _pendingDiff = null;
    _sendFn({ type: 'tldraw:diff', diff: diff });
    // Send a full snapshot for late joiners (throttled to every 3 s)
    if (_snapshotTimer) clearTimeout(_snapshotTimer);
    _snapshotTimer = setTimeout(function () {
      _snapshotTimer = null;
      if (_editor && _sendFn) {
        _sendFn({ type: 'tldraw:snapshot', snapshot: _editor.store.getSnapshot() });
      }
    }, 3000);
  }

  // Called by phoneApp.js when a 'tldraw:diff' socket event arrives
  function onTldrawDiff(diff) {
    if (!_editor) return;
    _editor.store.mergeRemoteChanges(function () {
      var records = [].concat(diff.added || [], diff.updated || []);
      if (records.length) _editor.store.put(records);
      var removed = diff.removed || [];
      if (removed.length) _editor.store.remove(removed);
    });
  }

  // Called by phoneApp.js when a 'tldraw:snapshot' socket event arrives
  function onTldrawSnapshot(snapshot) {
    if (_editor) {
      _editor.store.loadSnapshot(snapshot);
    } else {
      _pendingSnap = snapshot;
    }
  }

  /* ── Camera positioning ────────────────────────────────────────────── */
  // Position the tldraw viewport over the AR-detected WB area.
  // No rotation is applied — the canvas always stays upright.
  function _setCamera(vp) {
    if (!vp || !vp.wbW || !vp.wbH || !_editor) return;

    var rootEl  = document.getElementById('tdlp-root');
    var canvasW = rootEl ? (rootEl.clientWidth  || 375) : 375;

    // Zoom so the viewport width exactly fills the canvas width.
    // tldraw camera: screenX = (worldX + camera.x) * camera.z
    // To show world point wbLeft at screen x=0: camera.x = -wbLeft
    var zoom = canvasW / vp.wbW;

    _editor.setCamera(
      { x: -vp.wbLeft, y: -vp.wbTop, z: zoom },
      { immediate: true }
    );
  }

  /* ── Incoming laptop state ─────────────────────────────────────────── */
  function onState(state) {
    if (!state || state.type !== 'tldraw') return;
    var vp = state.phones &&
      (state.phones[_markerId] || state.phones[String(_markerId)]);
    if (vp && vp.wbW) {
      _lastVp = vp;
      _setCamera(vp);
    }
  }

  function invalidate() {
    if (_lastVp) _setCamera(_lastVp);
  }

  /* ── Destroy ────────────────────────────────────────────────────────── */
  function destroy() {
    if (_storeUnsub)    { _storeUnsub();                _storeUnsub    = null; }
    if (_syncTimer)     { clearTimeout(_syncTimer);     _syncTimer     = null; }
    if (_snapshotTimer) { clearTimeout(_snapshotTimer); _snapshotTimer = null; }
    if (_root)          { _root.unmount();              _root          = null; }
    _editor      = null;
    _pendingDiff = null;
    _pendingSnap = null;
    _lastVp      = null;
    console.log('[TldrawPhone] destroyed');
  }

  return { init, onState, invalidate, destroy, onTldrawDiff, onTldrawSnapshot };
})();
