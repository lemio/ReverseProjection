/*
 * JSARDetector — wraps jsartoolkit5's ARController to detect a single 3×3
 * barcode marker (ID 0) placed at the top-centre of the phone screen.
 *
 * The marker's four corner vertices are returned as topLeft / topRight /
 * bottomRight / bottomLeft so the rest of the app can compute phone position
 * and rotation from one compact target.
 *
 * Detection canvas fixed at 640×480; callers must scale the returned
 * coordinates by (videoWidth/640, videoHeight/480).
 *
 * Requires: artoolkit.min.js loaded before this file.
 */
window.JSARDetector = (function () {
  'use strict';

  var DETECT_W = 640, DETECT_H = 480;
  var MARKER_ID = 0;

  var ALPHA = 0.3;
  // smoothed is now a map: {markerId: {tl, tr, br, bl}}
  var smoothed = {};

  var controller  = null;
  var initStarted = false;
  var isReady     = false;
  var callCount   = 0;

  /* ── Exponential smoothing ──────────────────────────────────────────── */
  function smooth(prev, next) {
    if (!prev) return { x: next.x, y: next.y };
    return {
      x: prev.x + ALPHA * (next.x - prev.x),
      y: prev.y + ALPHA * (next.y - prev.y)
    };
  }

  /* ── Async initialisation ───────────────────────────────────────────── */
  function init() {
    if (initStarted) return;
    initStarted = true;

    if (!window.ARCameraParam || !window.ARController || !window.artoolkit) {
      console.warn('[JSARDetector] artoolkit not ready yet, retrying in 500 ms...');
      initStarted = false;
      setTimeout(init, 500);
      return;
    }

    console.log('[JSARDetector] Loading camera parameters from /data/camera_para.dat...');
    var cam = new ARCameraParam('/data/camera_para.dat',
      function () {
        controller = new ARController(DETECT_W, DETECT_H, cam);

        var AR_MATRIX_CODE_DETECTION =
          (artoolkit.AR_MATRIX_CODE_DETECTION !== undefined) ? artoolkit.AR_MATRIX_CODE_DETECTION : 2;
        var AR_MATRIX_CODE_3x3 =
          (artoolkit.AR_MATRIX_CODE_3x3 !== undefined) ? artoolkit.AR_MATRIX_CODE_3x3 : 3;

        controller.setPatternDetectionMode(AR_MATRIX_CODE_DETECTION);
        controller.setMatrixCodeType(AR_MATRIX_CODE_3x3);

        isReady = true;
        console.log('[JSARDetector] ARController ready (' + DETECT_W + 'x' + DETECT_H +
          ') | tracking marker ID ' + MARKER_ID);
      },
      function (err) {
        console.error('[JSARDetector] Failed to load camera_para.dat:', err);
      }
    );
  }

  /* ── Extract corners from a raw marker ─────────────────────────────── */
  function extractCorners(target) {
    var dir = target.dir;
    var v   = target.vertex;
    return {
      topLeft:     { x: v[(4 - dir) % 4][0], y: v[(4 - dir) % 4][1] },
      topRight:    { x: v[(5 - dir) % 4][0], y: v[(5 - dir) % 4][1] },
      bottomRight: { x: v[(6 - dir) % 4][0], y: v[(6 - dir) % 4][1] },
      bottomLeft:  { x: v[(7 - dir) % 4][0], y: v[(7 - dir) % 4][1] }
    };
  }

  /* ── Detect ALL visible markers → {id: corners, …} or null ─────────── */
  function detectAll(video) {
    if (!isReady) {
      if (!initStarted) init();
      return null;
    }

    callCount++;
    controller.detectMarker(video);
    var markerNum = controller.getMarkerNum();

    if (markerNum === 0) {
      if (callCount % 30 === 1) {
        console.log('[JSARDetector] #' + callCount + ': No markers detected');
      }
      return null;
    }

    var result = {};
    for (var i = 0; i < markerNum; i++) {
      var m = controller.cloneMarkerInfo(controller.getMarker(i));
      if (!m || m.idMatrix < 0) continue;
      var id = m.idMatrix;
      if (!smoothed[id]) smoothed[id] = { tl: null, tr: null, br: null, bl: null };
      var raw = extractCorners(m);
      smoothed[id].tl = smooth(smoothed[id].tl, raw.topLeft);
      smoothed[id].tr = smooth(smoothed[id].tr, raw.topRight);
      smoothed[id].br = smooth(smoothed[id].br, raw.bottomRight);
      smoothed[id].bl = smooth(smoothed[id].bl, raw.bottomLeft);
      result[id] = {
        topLeft:     { x: smoothed[id].tl.x, y: smoothed[id].tl.y },
        topRight:    { x: smoothed[id].tr.x, y: smoothed[id].tr.y },
        bottomRight: { x: smoothed[id].br.x, y: smoothed[id].br.y },
        bottomLeft:  { x: smoothed[id].bl.x, y: smoothed[id].bl.y }
      };
    }

    if (callCount % 30 === 1) {
      console.log('[JSARDetector] #' + callCount +
        ': Detected IDs=' + JSON.stringify(Object.keys(result)));
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  /* ── Single-marker detect (backward-compat — returns corners for ID 0) */
  function detect(video) {
    var all = detectAll(video);
    if (!all) return null;
    return all[MARKER_ID] || null;
  }

  /* ── Reset ──────────────────────────────────────────────────────────── */
  function reset() {
    smoothed = {};
    callCount = 0;
    console.log('[JSARDetector] reset');
  }

  return { init, detect, detectAll, reset };
})();
