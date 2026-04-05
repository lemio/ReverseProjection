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

  function init() {
    if (window.AR && !detector) {
      detector = new AR.Detector();
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

    var markers = detector.detect(imageData);
    var found = {};

    markers.forEach(function(m) {
      var corner = CORNER_IDS[m.id];
      if (corner) found[corner] = centerOf(m);
    });

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
  }

  return { detect, reset, init };
})();
