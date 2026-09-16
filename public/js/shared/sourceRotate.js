/*
 * SourceRotate — 90° rotation of a shared screen source, used by both the
 * laptop (ScreenExample) and the phone (ScreenPhone).
 *
 * The source video is videoW × videoH. When it is displayed rotated by
 * `rot` degrees clockwise (0, 90, 180, 270), everything is laid out in
 * "rotated space": the same picture with width/height swapped for 90/270.
 *
 * Marks drawn on top are stored in unrotated source coordinates, so they stay
 * on the same spot of the shared screen when the rotation changes.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SourceRotate = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function norm(rot) {
    return ((Math.round((rot || 0) / 90) * 90) % 360 + 360) % 360;
  }

  // Size of the source once rotated
  function dims(rot, w, h) {
    return norm(rot) % 180 ? { w: h, h: w } : { w: w, h: h };
  }

  // Source point → rotated-space point
  function toRotated(rot, x, y, w, h) {
    switch (norm(rot)) {
      case 90:  return { x: h - y, y: x };
      case 180: return { x: w - x, y: h - y };
      case 270: return { x: y, y: w - x };
      default:  return { x: x, y: y };
    }
  }

  // Rotated-space point → source point
  function fromRotated(rot, x, y, w, h) {
    switch (norm(rot)) {
      case 90:  return { x: y, y: h - x };
      case 180: return { x: w - x, y: h - y };
      case 270: return { x: w - y, y: x };
      default:  return { x: x, y: y };
    }
  }

  return { norm: norm, dims: dims, toRotated: toRotated, fromRotated: fromRotated };
});
