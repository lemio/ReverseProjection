/*
 * drawArucoMarker(canvas, id, size)
 *
 * Draws an ArUco marker (ARUCO 5×5 dictionary) onto a canvas element.
 * Requires window.AR to be set (load aruco-detector.js first).
 *
 * Corner assignment:
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
