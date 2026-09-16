/*
 * BorderPattern — dashed, multi-coloured tracking frame drawn around the
 * edge of the phone screen. Intended as an 8th Wall image target, replacing
 * the jsartoolkit barcode marker.
 *
 * Design goals for natural-feature tracking:
 *   - Lots of high-contrast corners (short dashes on a black strip).
 *   - Thick enough to be found from a laptop webcam: in tests 9% of the short
 *     side was never recognised; 16% tracked a 117px-wide phone in 720p.
 *   - A plain white middle (INSIDE), so recognition relies only on the border.
 *   - Non-repeating: dash lengths/colours come from a seeded PRNG, with a
 *     different seed per side, so the frame is never rotationally symmetric.
 *   - Colours chosen with distinct luminance so they still differ once the
 *     tracker converts to greyscale.
 *   - Distinct corner blocks to anchor the four corners.
 *
 * Only uses ctx.fillStyle + ctx.fillRect, so the same code renders on a
 * browser canvas and in the Node PNG generator (tools/generate-border-target.js).
 *
 * Usage:
 *   BorderPattern.thickness(w, h)          → border thickness in the same units as w/h
 *   BorderPattern.draw(ctx, w, h, opts)    → paints the frame (centre left untouched)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BorderPattern = api;
})(typeof self !== 'undefined' ? self : this, function () {
  var STRIP  = '#000000';
  var COLORS = ['#ffffff', '#ffd600', '#00d0ff', '#ff2d55', '#2f5bff'];

  // Corner block colour indices, used row by row across the lanes×lanes grid
  // in the side's own (along, across) frame. All four corners differ.
  var CORNERS = [
    [0, 3, 4, 1],  // top-left
    [1, 4, 0, 2],  // top-right
    [2, 0, 3, 4],  // bottom-right
    [3, 1, 2, 0]   // bottom-left
  ];

  var DEFAULTS = {
    thicknessRatio: 0.16,  // border thickness as fraction of the short side (0.09 was never found in tests)
    lanes: 2,              // rows of dashes across the border
    unitRatio: 1.1,        // base dash length, relative to the lane height
    seed: 1
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function thickness(w, h, ratio) {
    return Math.round(Math.min(w, h) * (ratio || DEFAULTS.thicknessRatio));
  }

  function draw(ctx, w, h, opts) {
    opts = opts || {};
    var T    = opts.thickness || thickness(w, h, opts.thicknessRatio);
    var seed = opts.seed != null ? opts.seed : DEFAULTS.seed;

    var lanes = opts.lanes || DEFAULTS.lanes;
    var g    = Math.max(1, T * 0.2 / lanes);            // black gap between dashes / lanes
    var lane = (T - (lanes + 1) * g) / lanes;            // height of each lane
    var unit = lane * (opts.unitRatio || DEFAULTS.unitRatio); // base dash length unit

    // Sides walked clockwise. rect(along, across, len, thick) maps a rectangle
    // in side-local coords (along the edge, inward from the edge) to canvas.
    var sides = [
      { len: w, rect: function (a, c, l, t) { return [a, c, l, t]; } },                 // top
      { len: h, rect: function (a, c, l, t) { return [w - c - t, a, t, l]; } },         // right
      { len: w, rect: function (a, c, l, t) { return [w - a - l, h - c - t, l, t]; } }, // bottom
      { len: h, rect: function (a, c, l, t) { return [c, h - a - l, t, l]; } }          // left
    ];

    function fill(color, r) {
      ctx.fillStyle = color;
      ctx.fillRect(r[0], r[1], r[2], r[3]);
    }

    // Black strips first, so no side paints over another side's corner block
    sides.forEach(function (side) {
      fill(STRIP, side.rect(0, 0, side.len, T));
    });

    sides.forEach(function (side, s) {
      // Corner block at the start of this side (lanes×lanes squares)
      var cb = CORNERS[s];
      for (var r = 0; r < lanes; r++) {
        for (var c = 0; c < lanes; c++) {
          fill(COLORS[cb[(r * lanes + c) % 4]],
               side.rect(g + c * (lane + g), g + r * (lane + g), lane, lane));
        }
      }

      // Dashes in lanes between the corner blocks
      var start = T + g;
      var end   = side.len - T;
      for (var laneIdx = 0; laneIdx < lanes; laneIdx++) {
        var rand = mulberry32(seed * 1000 + s * 10 + laneIdx);
        var across = g + laneIdx * (lane + g);
        // Offset alternate lanes so dash boundaries don't line up across lanes
        var pos = start + (laneIdx % 2 ? unit * 0.5 : 0);
        var prev = -1;
        while (pos < end) {
          var steps = [1, 1, 2, 3][Math.floor(rand() * 4)];
          var len = Math.min(steps * unit - g, end - pos);
          // ~1 in 6 slots is left empty (a longer black gap) for extra variety
          if (rand() < 0.17) { pos += unit; continue; }
          var ci;
          do { ci = Math.floor(rand() * COLORS.length); } while (ci === prev);
          prev = ci;
          if (len > g) fill(COLORS[ci], side.rect(pos, across, len, lane));
          pos += len + g;
        }
      }
    });

    return T;
  }

  /*
   * 8th Wall planar image targets are always 3:4 portrait, so the screen is
   * covered by two full-width 3:4 regions: one anchored at the top edge and
   * one at the bottom edge (they overlap on typical phones). Each region is
   * tracked as its own image target; together they cover the whole border.
   * Returned rects are in the same units as w/h.
   */
  function targetRegions(w, h) {
    var rh = Math.min(h, w * 4 / 3);
    return [
      { part: 'top',    x: 0, y: 0,      w: w, h: rh },
      { part: 'bottom', x: 0, y: h - rh, w: w, h: rh }
    ];
  }

  return {
    draw: draw,
    thickness: thickness,
    targetRegions: targetRegions,
    COLORS: COLORS,
    INSIDE: '#ffffff',  // screen colour inside the border (no features → ignored by the tracker)
    DEFAULTS: DEFAULTS
  };
});
