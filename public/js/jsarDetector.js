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
  var smoothed = { tl: null, tr: null, br: null, bl: null };

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

  /* ── Main detection ─────────────────────────────────────────────────── */
  function detect(video) {
    if (!isReady) {
      if (!initStarted) init();
      return null;
    }

    callCount++;

    controller.detectMarker(video);
    var markerNum = controller.getMarkerNum();

    var target = null;
    for (var i = 0; i < markerNum; i++) {
      var m = controller.cloneMarkerInfo(controller.getMarker(i));
      if (m && m.idMatrix === MARKER_ID) { target = m; break; }
    }

    if (callCount % 30 === 1) {
      if (!target) {
        var allIds = [];
        for (var j = 0; j < markerNum; j++) {
          var inf = controller.getMarker(j);
          if (inf) allIds.push(inf.idMatrix);
        }
        console.log('[JSARDetector] #' + callCount + ': Marker ' + MARKER_ID + ' not found' +
          (allIds.length ? ' | Seen IDs=' + JSON.stringify(allIds) : ' | No markers'));
      } else {
        console.log('[JSARDetector] #' + callCount + ': Marker ' + MARKER_ID + ' found' +
          ' | pos=(' + Math.round(target.pos[0]) + ',' + Math.round(target.pos[1]) + ')');
      }
    }

    if (!target) return null;

    /* vertex[(4-dir)%4] is the top-left corner; proceed clockwise */
    var dir = target.dir;
    var v   = target.vertex;
    var tl  = { x: v[(4 - dir) % 4][0], y: v[(4 - dir) % 4][1] };
    var tr  = { x: v[(5 - dir) % 4][0], y: v[(5 - dir) % 4][1] };
    var br  = { x: v[(6 - dir) % 4][0], y: v[(6 - dir) % 4][1] };
    var bl  = { x: v[(7 - dir) % 4][0], y: v[(7 - dir) % 4][1] };

    smoothed.tl = smooth(smoothed.tl, tl);
    smoothed.tr = smooth(smoothed.tr, tr);
    smoothed.br = smooth(smoothed.br, br);
    smoothed.bl = smooth(smoothed.bl, bl);

    return {
      topLeft:     { x: smoothed.tl.x, y: smoothed.tl.y },
      topRight:    { x: smoothed.tr.x, y: smoothed.tr.y },
      bottomRight: { x: smoothed.br.x, y: smoothed.br.y },
      bottomLeft:  { x: smoothed.bl.x, y: smoothed.bl.y }
    };
  }

  /* ── Reset ──────────────────────────────────────────────────────────── */
  function reset() {
    smoothed = { tl: null, tr: null, br: null, bl: null };
    callCount = 0;
    console.log('[JSARDetector] reset');
  }

  return { init, detect, reset };
})();
