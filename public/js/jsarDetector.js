/*
 * JSARDetector — wraps jsartoolkit5's ARController to detect 3×3 barcode
 * markers, replacing the js-aruco2 detection pipeline.
 *
 * Two modes (same interface as the old ArucoDetector):
 *
 *   'four-corner' (default) — four 3×3 barcode markers at phone corners:
 *     ID  0 → top-left,  ID  8 → top-right,
 *     ID 40 → bottom-left, ID 56 → bottom-right
 *
 *   'single' — one 3×3 barcode marker (default ID: 0).
 *     The marker's own 4 corners are used as the phone quad.
 *
 * Detection canvas fixed at 640×480; callers must scale the returned
 * coordinates by (videoWidth/640, videoHeight/480).
 *
 * Requires: artoolkit.min.js loaded before this file.
 */
window.JSARDetector = (function () {
  'use strict';

  var DETECT_W = 640, DETECT_H = 480;

  /* Marker IDs assigned to each phone corner (3×3 barcode IDs) */
  var CORNER_IDS = { 0: 'topLeft', 8: 'topRight', 40: 'bottomLeft', 56: 'bottomRight' };

  var ALPHA = 0.3;
  var smoothed     = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  var smoothedSingle = { tl: null, tr: null, br: null, bl: null };

  var controller  = null;
  var initStarted = false;
  var isReady     = false;
  var mode        = 'four-corner';
  var singleMarkerId = 0;
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
      /* artoolkit.min.js may still be initialising — retry after a short delay */
      console.warn('[JSARDetector] artoolkit not ready yet, retrying in 500 ms…');
      initStarted = false;
      setTimeout(init, 500);
      return;
    }

    console.log('[JSARDetector] Loading camera parameters from /data/camera_para.dat…');
    var cam = new ARCameraParam('/data/camera_para.dat',
      function () {
        /* Camera params loaded — create the ARController synchronously */
        controller = new ARController(DETECT_W, DETECT_H, cam);

        /* Switch to 3×3 matrix-code (barcode) detection mode.
         * Fallback to known numeric values if symbolic constants aren't exported. */
        var AR_MATRIX_CODE_DETECTION =
          (artoolkit.AR_MATRIX_CODE_DETECTION !== undefined) ? artoolkit.AR_MATRIX_CODE_DETECTION : 2;
        var AR_MATRIX_CODE_3x3 =
          (artoolkit.AR_MATRIX_CODE_3x3 !== undefined) ? artoolkit.AR_MATRIX_CODE_3x3 : 3;

        controller.setPatternDetectionMode(AR_MATRIX_CODE_DETECTION);
        controller.setMatrixCodeType(AR_MATRIX_CODE_3x3);

        isReady = true;
        console.log('[JSARDetector] ARController ready (' + DETECT_W + '×' + DETECT_H +
          ', AR_MATRIX_CODE_3x3=' + AR_MATRIX_CODE_3x3 + ') | mode=' + mode);
      },
      function (err) {
        console.error('[JSARDetector] Failed to load camera_para.dat:', err);
      }
    );
  }

  /* ── Mode control ───────────────────────────────────────────────────── */
  function setMode(newMode, markerId) {
    mode = (newMode === 'single') ? 'single' : 'four-corner';
    if (markerId !== undefined) singleMarkerId = markerId;
    smoothed     = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
    smoothedSingle = { tl: null, tr: null, br: null, bl: null };
    console.log('[JSARDetector] Mode set to ' + mode +
      (mode === 'single' ? ' | singleMarkerId=' + singleMarkerId : ''));
  }

  function getMode() { return mode; }
  function getSingleMarkerId() { return singleMarkerId; }

  /* ── Main detection ─────────────────────────────────────────────────── */
  /* @param {HTMLVideoElement} video  Live webcam element */
  function detect(video) {
    if (!isReady) {
      /* Try to kick-start initialisation in case init() wasn't called yet */
      if (!initStarted) init();
      return null;
    }

    callCount++;

    /* Draw video → artoolkit's internal 640×480 canvas, then run detection */
    controller.detectMarker(video);
    var markerNum = controller.getMarkerNum();

    /* ── Single-marker mode ──────────────────────────────────────────── */
    if (mode === 'single') {
      var target = null;
      for (var i = 0; i < markerNum; i++) {
        var m = controller.cloneMarkerInfo(controller.getMarker(i));
        if (m && m.idMatrix === singleMarkerId) { target = m; break; }
      }

      if (callCount % 30 === 1) {
        if (!target) {
          var allIds = [];
          for (var j = 0; j < markerNum; j++) {
            var inf = controller.getMarker(j);
            if (inf) allIds.push(inf.idMatrix);
          }
          console.log('[JSARDetector/single] #' + callCount +
            ': Target ID ' + singleMarkerId + ' NOT found' +
            (allIds.length ? ' | Seen IDs=' + JSON.stringify(allIds) : ' | No markers'));
        } else {
          console.log('[JSARDetector/single] #' + callCount +
            ': ID ' + singleMarkerId + ' FOUND ✓' +
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

      smoothedSingle.tl = smooth(smoothedSingle.tl, tl);
      smoothedSingle.tr = smooth(smoothedSingle.tr, tr);
      smoothedSingle.br = smooth(smoothedSingle.br, br);
      smoothedSingle.bl = smooth(smoothedSingle.bl, bl);

      return {
        topLeft:     { x: smoothedSingle.tl.x, y: smoothedSingle.tl.y },
        topRight:    { x: smoothedSingle.tr.x, y: smoothedSingle.tr.y },
        bottomRight: { x: smoothedSingle.br.x, y: smoothedSingle.br.y },
        bottomLeft:  { x: smoothedSingle.bl.x, y: smoothedSingle.bl.y }
      };
    }

    /* ── Four-corner mode ───────────────────────────────────────────── */
    var found = {};
    for (var k = 0; k < markerNum; k++) {
      var marker = controller.cloneMarkerInfo(controller.getMarker(k));
      if (!marker) continue;
      var cornerName = CORNER_IDS[marker.idMatrix];
      if (cornerName) {
        found[cornerName] = { x: marker.pos[0], y: marker.pos[1] };
      }
    }

    var foundNames    = Object.keys(found);
    var allCorners    = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
    var missingCorners = allCorners.filter(function (c) { return !found[c]; });

    if (callCount % 30 === 1) {
      if (markerNum === 0) {
        console.log('[JSARDetector] #' + callCount + ': No markers detected');
      } else {
        var rawIds = [];
        for (var r = 0; r < markerNum; r++) {
          var ri = controller.getMarker(r);
          if (ri) rawIds.push(ri.idMatrix);
        }
        console.log('[JSARDetector] #' + callCount +
          ': IDs=' + JSON.stringify(rawIds) +
          ' | Corners=' + JSON.stringify(foundNames) +
          (missingCorners.length ? ' | Missing=' + JSON.stringify(missingCorners) : ' | ALL 4 ✓'));
      }
    }

    /* Smooth whichever corners were found this frame */
    foundNames.forEach(function (name) {
      smoothed[name] = smooth(smoothed[name], found[name]);
    });

    /* All 4 must be found in THIS frame to return a result */
    if (missingCorners.length > 0) return null;

    return {
      topLeft:     { x: smoothed.topLeft.x,     y: smoothed.topLeft.y },
      topRight:    { x: smoothed.topRight.x,    y: smoothed.topRight.y },
      bottomLeft:  { x: smoothed.bottomLeft.x,  y: smoothed.bottomLeft.y },
      bottomRight: { x: smoothed.bottomRight.x, y: smoothed.bottomRight.y }
    };
  }

  /* ── Reset ──────────────────────────────────────────────────────────── */
  function reset() {
    smoothed     = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
    smoothedSingle = { tl: null, tr: null, br: null, bl: null };
    callCount = 0;
    console.log('[JSARDetector] reset');
  }

  return { init, detect, reset, setMode, getMode, getSingleMarkerId };
})();
