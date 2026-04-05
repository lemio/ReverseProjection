/*
 * ArucoDetector — wraps js-aruco2 AR.Detector to find 4 corner markers.
 *
 * Marker-to-corner assignment (ARUCO 5×5 dictionary IDs):
 *   ID  0 → top-left
 *   ID 42 → top-right
 *   ID 85 → bottom-left
 *   ID 127 → bottom-right
 */
window.ArucoDetector = (function() {
  const CORNER_IDS = { 0: 'topLeft', 42: 'topRight', 85: 'bottomLeft', 127: 'bottomRight' };
  const ALPHA = 0.3;
  let smoothed = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  let detector = null;
  let callCount = 0;

  function init() {
    if (window.AR && !detector) {
      detector = new AR.Detector();
      console.log('[ArucoDetector] AR.Detector initialized');
    } else if (!window.AR) {
      console.warn('[ArucoDetector] window.AR not available — js-aruco2 not loaded?');
    }
  }

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
        var knownIds = markers.filter(function(m) { return CORNER_IDS[m.id]; }).map(function(m) { return m.id; });
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
    detector = null;
    callCount = 0;
    console.log('[ArucoDetector] reset');
  }

  return { detect, reset, init };
})();
