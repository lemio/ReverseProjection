/*
 * drawArucoMarker(canvas, id, size)
 *
 * Draws an ArUco marker (ARUCO 5×5 dictionary) onto a canvas element.
 * Requires window.AR to be set (load aruco-detector.js first).
 *
 * Corner assignment (legacy / ArUco):
 *   ID  0 → top-left     (marker-tl)
 *   ID 42 → top-right    (marker-tr)
 *   ID 85 → bottom-left  (marker-bl)
 *   ID 127 → bottom-right (marker-br)
 */
window.drawArucoMarker = function(canvas, id, size) {
  size = size || canvas.offsetWidth || 110;
  canvas.width  = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');

  if (!window.AR || !AR.DICTIONARIES || !AR.DICTIONARIES.ARUCO) {
    // Fallback: coloured square with white margin so the page still looks right
    var fallbackColors = { 0: 'red', 42: '#00ff00', 85: 'blue', 127: 'yellow' };
    var margin0 = Math.round(size / 9);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = fallbackColors[id] || '#888';
    ctx.fillRect(margin0, margin0, size - 2 * margin0, size - 2 * margin0);
    return;
  }

  var code = AR.DICTIONARIES.ARUCO.codeList[id];
  // Extract 25 bits MSB-first → flat array [row0col0 … row4col4]
  var bits = [];
  for (var b = 24; b >= 0; b--) bits.push((code >> b) & 1);

  // Layout: 1 white quiet-zone + 7×7 ArUco grid (1 black border + 5 data + 1 black border) + 1 white quiet-zone
  // Total: 9 equal units across/down.  Each unit = size / 9.
  var unit = size / 9;
  var margin = unit;               // white quiet-zone on each side
  var cell   = unit;               // one module of the 7×7 grid

  // White background (quiet zone)
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  // Black background of the 7×7 ArUco grid (covers the black border cells)
  ctx.fillStyle = '#000';
  ctx.fillRect(margin, margin, cell * 7, cell * 7);

  // Inner 5×5 data cells: bit=1 → white, bit=0 → already black
  ctx.fillStyle = '#fff';
  for (var r = 0; r < 5; r++) {
    for (var c = 0; c < 5; c++) {
      if (bits[r * 5 + c] === 1) {
        ctx.fillRect(margin + (c + 1) * cell, margin + (r + 1) * cell, cell, cell);
      }
    }
  }
};

/*
 * drawJSARMarker(canvas, id, size)
 *
 * Draws a jsartoolkit5 3×3 barcode marker onto a canvas element.
 * No external library required — the pattern is computed directly.
 *
 * Physical structure: 5×5 grid (1-cell black border + 3×3 data area)
 * surrounded by a white quiet zone. Total rendered grid = 7×7 cells.
 *
 * Direction-0 encoding (same canonical orientation used for all markers
 * drawn here; jsartoolkit5 detects any rotation):
 *   Fixed BLACK cells : [0,0], [2,0]  (direction indicators)
 *   Fixed WHITE cell  : [2,2]         (direction indicator)
 *   Data bits (6 bits, IDs 0–63), MSB→LSB, reading order:
 *     bit5=[0,1]  bit4=[0,2]  bit3=[1,0]  bit2=[1,1]  bit1=[1,2]  bit0=[2,1]
 *
 * Corner assignment (jsartoolkit5 / 3×3 barcode):
 *   ID  0 → top-left,  ID  8 → top-right,
 *   ID 40 → bottom-left, ID 56 → bottom-right
 *   ID  0 → single-marker mode (same physical pattern as TL)
 */
window.drawJSARMarker = function (canvas, id, size) {
  size = size || canvas.offsetWidth || 110;
  canvas.width  = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');

  /* 7 columns/rows: quiet(1) + border(1) + data3 + border(1) + quiet(1) */
  var cell   = size / 7;
  var offset = cell;          /* start of the 5×5 grid (after quiet zone) */

  /* White background */
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  /* Black 5×5 outer border (covers all cells except the inner 3×3) */
  ctx.fillStyle = '#000';
  ctx.fillRect(offset, offset, cell * 5, cell * 5);

  /* Inner 3×3 data cells — start as all-white (default from the black fill above) */
  ctx.fillStyle = '#fff';
  ctx.fillRect(offset + cell, offset + cell, cell * 3, cell * 3);

  /*
   * Now paint the 3×3 data cells according to the bit pattern for `id`.
   * Cell positions in the inner 3×3 (row r, col c) map to canvas:
   *   x = offset + cell*(1+c),  y = offset + cell*(1+r)
   *
   * Direction-indicator cells (always same colour regardless of id):
   *   [r=0,c=0] = BLACK   [r=2,c=0] = BLACK   [r=2,c=2] = WHITE
   *
   * Data bits (id = 6-bit integer, IDs 0–63):
   *   bit5 → [r=0,c=1]   bit4 → [r=0,c=2]   bit3 → [r=1,c=0]
   *   bit2 → [r=1,c=1]   bit1 → [r=1,c=2]   bit0 → [r=2,c=1]
   */
  function paintCell(r, c, isBlack) {
    ctx.fillStyle = isBlack ? '#000' : '#fff';
    ctx.fillRect(offset + cell * (1 + c), offset + cell * (1 + r), cell, cell);
  }

  /* Direction indicators */
  paintCell(0, 0, true);   /* [0,0] = BLACK */
  paintCell(2, 0, true);   /* [2,0] = BLACK */
  paintCell(2, 2, false);  /* [2,2] = WHITE */

  /* Data bits */
  paintCell(0, 1, !!(id & 0x20));  /* bit 5 */
  paintCell(0, 2, !!(id & 0x10));  /* bit 4 */
  paintCell(1, 0, !!(id & 0x08));  /* bit 3 */
  paintCell(1, 1, !!(id & 0x04));  /* bit 2 */
  paintCell(1, 2, !!(id & 0x02));  /* bit 1 */
  paintCell(2, 1, !!(id & 0x01));  /* bit 0 */
};
