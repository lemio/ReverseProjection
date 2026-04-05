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
    // Fallback: plain coloured square so the page still looks right
    var fallbackColors = { 0: 'red', 42: '#00ff00', 85: 'blue', 127: 'yellow' };
    ctx.fillStyle = fallbackColors[id] || '#888';
    ctx.fillRect(0, 0, size, size);
    return;
  }

  var code = AR.DICTIONARIES.ARUCO.codeList[id];
  // Extract 25 bits MSB-first → flat array [row0col0 … row4col4]
  var bits = [];
  for (var b = 24; b >= 0; b--) bits.push((code >> b) & 1);

  // 7×7 grid: 1-cell black border + 5×5 inner data cells
  var cell = size / 7;

  // Black background (covers border cells)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  // Inner 5×5: 1 = white, 0 = black
  for (var r = 0; r < 5; r++) {
    for (var c = 0; c < 5; c++) {
      if (bits[r * 5 + c] === 1) {
        ctx.fillStyle = '#fff';
        ctx.fillRect((c + 1) * cell, (r + 1) * cell, cell, cell);
      }
    }
  }
};
