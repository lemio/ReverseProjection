/*
 * PhonePose — computes phone position and orientation from a detected marker.
 *
 * The marker sits at the top centre of the phone screen.  Given its four
 * camera-pixel corners and the phone's known CSS dimensions, this module
 * derives:
 *   - Marker centre and apparent side length in camera pixels
 *   - Rotation angle (radians) — the angle of the marker's top edge
 *   - Physical scale (camera px / phone CSS px)
 *   - Drawing-area centre in camera pixels and as a normalised 0–1 position
 *   - Whiteboard (WB) coordinates and viewport size in a 10 000 × 10 000 space
 *   - Projected camera-pixel corners of the phone's full drawing area
 *     (for accurate overlay rendering)
 *
 * The "down" direction on the phone in camera space is (−sin θ, cos θ)
 * where θ = atan2(topRight.y − topLeft.y, topRight.x − topLeft.x).
 *
 * coordinate conventions
 *   Phone-space:  +x → right along marker top edge
 *                 +y → down (toward drawing area)
 *   Camera-space: +x → right, +y → down (screen coords)
 *   WB-space:     0–10000 on each axis; maps from normalised 0–1
 */
window.PhonePose = (function () {
  'use strict';

  var WB_W = 10000, WB_H = 10000;

  /**
   * Compute all pose fields for one detected marker.
   *
   * @param {number} id              - Marker ID
   * @param {object} corners         - {topLeft, topRight, bottomRight, bottomLeft}
   *                                   each {x, y} in camera pixels
   * @param {object} vp              - Phone viewport data:
   *                                   {markerDisplayPx, drawAreaW, drawAreaH}
   * @param {number} camW            - Camera frame width  (pixels)
   * @param {number} camH            - Camera frame height (pixels)
   * @param {boolean} invertControls - Flip the normalised position (for front camera)
   * @returns {object} markerInfo — see field list below
   *
   * Returned fields:
   *   id, corners
   *   markerCamX, markerCamY   — marker centre in camera pixels
   *   drawCamX,  drawCamY     — drawing-area centre in camera pixels
   *   rotation                — angle of top edge (radians)
   *   markerSidePx            — apparent side length (camera px)
   *   scale                   — camera px per phone CSS px
   *   nx, ny                  — normalised drawing-area centre (0–1)
   *   wbX, wbY                — WB position of drawing-area centre
   *   wbVpW, wbVpH            — WB viewport dimensions
   *   drawAreaW, drawAreaH    — phone drawing area in CSS px
   *   markerDisplayPx         — marker canvas size in CSS px
   *   camW, camH              — camera frame size (pass-through)
   */
  function computeMarkerInfo(id, corners, vp, camW, camH, invertControls) {
    var mdisp = vp.markerDisplayPx || 280;
    var daW   = vp.drawAreaW       || 375;
    var daH   = vp.drawAreaH       || 500;

    // Marker centre (average of 4 corners)
    var cx = (corners.topLeft.x + corners.topRight.x +
              corners.bottomLeft.x + corners.bottomRight.x) / 4;
    var cy = (corners.topLeft.y + corners.topRight.y +
              corners.bottomLeft.y + corners.bottomRight.y) / 4;

    // Rotation = angle of the top edge; apparent side length from top edge vector
    var dx = corners.topRight.x - corners.topLeft.x;
    var dy = corners.topRight.y - corners.topLeft.y;
    var markerSidePx = Math.sqrt(dx * dx + dy * dy);
    var rotation     = Math.atan2(dy, dx);

    // Physical scale: camera pixels per phone CSS pixel
    var scale = markerSidePx / mdisp;

    // Offset from marker centre to drawing-area centre along the phone's
    // "down" axis: mdisp/2 + 8px gap + daH/2
    var offsetPhonePx = mdisp / 2 + 8 + daH / 2;
    // "Down" in camera space = (−sin θ, cos θ)
    var drawCamX = cx + (-Math.sin(rotation)) * offsetPhonePx * scale;
    var drawCamY = cy + ( Math.cos(rotation)) * offsetPhonePx * scale;

    // Normalised position (0–1) of the drawing-area centre
    var nx = invertControls ? 1 - drawCamX / camW : drawCamX / camW;
    var ny = invertControls ? 1 - drawCamY / camH : drawCamY / camH;

    return {
      id:              id,
      corners:         corners,
      markerCamX:      cx,
      markerCamY:      cy,
      drawCamX:        drawCamX,
      drawCamY:        drawCamY,
      rotation:        rotation,
      markerSidePx:    markerSidePx,
      scale:           scale,
      nx:              nx,
      ny:              ny,
      wbX:             nx * WB_W,
      wbY:             ny * WB_H,
      wbVpW:           (daW * scale / camW) * WB_W,
      wbVpH:           (daH * scale / camH) * WB_H,
      drawAreaW:       daW,
      drawAreaH:       daH,
      markerDisplayPx: mdisp,
      camW:            camW,
      camH:            camH
    };
  }

  /**
   * Compute the 4 projected camera-pixel corners of the phone's drawing area.
   * Returned as [{x, y}, …] in TL → TR → BR → BL order.
   *
   * Useful for drawing an accurate overlay rectangle over the visible phone area.
   */
  function drawAreaCameraCorners(info) {
    var cx    = info.markerCamX;
    var cy    = info.markerCamY;
    var θ     = info.rotation;
    var s     = info.scale;
    var mdisp = info.markerDisplayPx;
    var daW   = info.drawAreaW;
    var daH   = info.drawAreaH;

    // Distance from marker centre to the top edge of the drawing area
    var topOffset = mdisp / 2 + 8;

    // Local corners: (rightward, downward) offsets in phone CSS px
    var local = [
      { r: -daW / 2, d: topOffset       },   // TL
      { r:  daW / 2, d: topOffset       },   // TR
      { r:  daW / 2, d: topOffset + daH },   // BR
      { r: -daW / 2, d: topOffset + daH }    // BL
    ];

    // Phone axes in camera space:
    //   right = (cos θ, sin θ)
    //   down  = (−sin θ, cos θ)
    return local.map(function (p) {
      return {
        x: cx + (p.r * Math.cos(θ) + p.d * (-Math.sin(θ))) * s,
        y: cy + (p.r * Math.sin(θ) + p.d *   Math.cos(θ))  * s
      };
    });
  }

  return { computeMarkerInfo, drawAreaCameraCorners };
})();
