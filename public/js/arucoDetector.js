/*
 * ArucoDetector — wraps js-aruco2 AR.Detector to find phone markers.
 *
 * Two modes:
 *   'four-corner' (default) — four ARUCO markers at phone corners:
 *     ID  0 → top-left,  ID 42 → top-right,
 *     ID 85 → bottom-left,  ID 127 → bottom-right
 *
 *   'single' — one ARUCO marker anywhere on the phone (default ID: 0).
 *     The marker's own 4 corners are used as the phone quad.
 *
 * IMPORTANT: The detector is explicitly initialised with {dictionaryName:'ARUCO'}
 * to match the 25-bit ARUCO markers rendered by drawMarker.js.
 * The js-aruco2 default is ARUCO_MIP_36h12 (36-bit), which is a completely
 * different dictionary and will never match the phone's ARUCO markers.
 */
window.ArucoDetector = (function() {
  const CORNER_IDS = { 0: 'topLeft', 42: 'topRight', 85: 'bottomLeft', 127: 'bottomRight' };
  const ALPHA = 0.3;
  let smoothed = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  // Per-corner smoothing for single-marker mode (uses the marker's own 4 corners)
  let smoothedSingle = { tl: null, tr: null, br: null, bl: null };
  let detector = null;
  let callCount = 0;
  let mode = 'four-corner';   // 'four-corner' | 'single'
  let singleMarkerId = 0;

  function init() {
    if (window.AR && !detector) {
      // Must specify ARUCO dictionary — js-aruco2 defaults to ARUCO_MIP_36h12
      // which is incompatible with the 25-bit ARUCO markers drawn by drawMarker.js.
      detector = new AR.Detector({ dictionaryName: 'ARUCO' });
      console.log('[ArucoDetector] AR.Detector initialized with ARUCO dictionary | mode=' + mode);
    } else if (!window.AR) {
      console.warn('[ArucoDetector] window.AR not available — js-aruco2 not loaded?');
    }
  }

  function setMode(newMode, markerId) {
    mode = newMode === 'single' ? 'single' : 'four-corner';
    if (markerId !== undefined) singleMarkerId = markerId;
    // Reset smoothed state so stale positions don't bleed across mode switches
    smoothed = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
    smoothedSingle = { tl: null, tr: null, br: null, bl: null };
    console.log('[ArucoDetector] Mode set to ' + mode +
      (mode === 'single' ? ' | singleMarkerId=' + singleMarkerId : ''));
  }

  function getMode() { return mode; }
  function getSingleMarkerId() { return singleMarkerId; }

  function centerOf(marker) {
    let sx = 0, sy = 0;
    marker.corners.forEach(function(c) { sx += c.x; sy += c.y; });
    return { x: sx / 4, y: sy / 4 };
  }

  function smooth(prev, next) {
    if (!prev) return { x: next.x, y: next.y };
    return { x: prev.x + ALPHA * (next.x - prev.x), y: prev.y + ALPHA * (next.y - prev.y) };
  }

  function detect(imageData) {
    if (!detector) init();
    if (!detector) return null;

    callCount++;
    var markers = detector.detect(imageData);

    // ── Single-marker mode ────────────────────────────────────────────────────
    if (mode === 'single') {
      var target = null;
      for (var i = 0; i < markers.length; i++) {
        if (markers[i].id === singleMarkerId) { target = markers[i]; break; }
      }

      if (callCount % 30 === 1) {
        if (!target) {
          var allIds = markers.map(function(m) { return m.id; });
          console.log('[ArucoDetector/single] #' + callCount +
            ': Target ID ' + singleMarkerId + ' NOT found' +
            (allIds.length ? ' | Seen IDs=' + JSON.stringify(allIds) : ' | No markers at all'));
        } else {
          var s = target.corners;
          var w = Math.round(Math.hypot(s[1].x-s[0].x, s[1].y-s[0].y));
          console.log('[ArucoDetector/single] #' + callCount +
            ': ID ' + singleMarkerId + ' FOUND ✓' +
            ' | apparentWidth=' + w + 'px' +
            ' | center=(' + Math.round(centerOf(target).x) + ',' + Math.round(centerOf(target).y) + ')');
        }
      }

      if (!target) return null;

      // Smooth the marker's own 4 corners (clockwise: TL, TR, BR, BL)
      var c = target.corners;
      smoothedSingle.tl = smooth(smoothedSingle.tl, c[0]);
      smoothedSingle.tr = smooth(smoothedSingle.tr, c[1]);
      smoothedSingle.br = smooth(smoothedSingle.br, c[2]);
      smoothedSingle.bl = smooth(smoothedSingle.bl, c[3]);

      return {
        topLeft:     { x: smoothedSingle.tl.x, y: smoothedSingle.tl.y },
        topRight:    { x: smoothedSingle.tr.x, y: smoothedSingle.tr.y },
        bottomRight: { x: smoothedSingle.br.x, y: smoothedSingle.br.y },
        bottomLeft:  { x: smoothedSingle.bl.x, y: smoothedSingle.bl.y }
      };
    }

    // ── Four-corner mode ──────────────────────────────────────────────────────
    var found = {};

    markers.forEach(function(m) {
      var corner = CORNER_IDS[m.id];
      if (corner) found[corner] = centerOf(m);
    });

    var foundCornerNames = Object.keys(found);
    var allCorners = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
    var missingCorners = allCorners.filter(function(c) { return !found[c]; });

    // Throttled logging every 30 calls (~1.5 s at 20 fps)
    if (callCount % 30 === 1) {
      if (markers.length === 0) {
        console.log('[ArucoDetector] #' + callCount + ': No markers detected in frame');
      } else {
        var allIds = markers.map(function(m) { return m.id; });
        var unknownIds = markers.filter(function(m) { return !CORNER_IDS[m.id]; }).map(function(m) { return m.id; });
        console.log('[ArucoDetector] #' + callCount +
          ': Detected IDs=' + JSON.stringify(allIds) +
          ' | Mapped corners=' + JSON.stringify(foundCornerNames) +
          (unknownIds.length ? ' | Unmapped IDs=' + JSON.stringify(unknownIds) : '') +
          (missingCorners.length ? ' | Missing corners=' + JSON.stringify(missingCorners) : ' | ALL 4 CORNERS FOUND ✓'));
      }
    }

    // Log partial detection more frequently (every 10 calls) when some but not all corners found
    if (missingCorners.length > 0 && missingCorners.length < 4 && callCount % 10 === 1) {
      console.log('[ArucoDetector] Partial: found ' + foundCornerNames.length + '/4 corners, missing: ' +
        JSON.stringify(missingCorners));
    }

    // Always smooth whatever was found this frame
    Object.keys(found).forEach(function(name) {
      smoothed[name] = smooth(smoothed[name], found[name]);
    });

    // All 4 corners must be found this frame for a valid detection
    if (!found.topLeft || !found.topRight || !found.bottomLeft || !found.bottomRight) {
      return null;
    }

    return {
      topLeft:     { x: smoothed.topLeft.x,     y: smoothed.topLeft.y },
      topRight:    { x: smoothed.topRight.x,    y: smoothed.topRight.y },
      bottomLeft:  { x: smoothed.bottomLeft.x,  y: smoothed.bottomLeft.y },
      bottomRight: { x: smoothed.bottomRight.x, y: smoothed.bottomRight.y }
    };
  }

  function reset() {
    smoothed = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
    smoothedSingle = { tl: null, tr: null, br: null, bl: null };
    detector = null;
    callCount = 0;
    console.log('[ArucoDetector] reset');
  }

  return { detect, reset, init, setMode, getMode, getSingleMarkerId };
})();
