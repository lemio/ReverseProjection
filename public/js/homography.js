window.Homography = (function() {

  // DLT algorithm: solve for 3x3 homography from 4 point correspondences
  function computeH(srcPts, dstPts) {
    const A = [];
    for (let i = 0; i < 4; i++) {
      const { x: sx, y: sy } = srcPts[i];
      const { x: dx, y: dy } = dstPts[i];
      A.push([-sx, -sy, -1,   0,   0,  0, dx * sx, dx * sy, dx]);
      A.push([  0,   0,  0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
    }
    const h = gaussianElimination(A);
    if (!h) return null;
    return [
      [h[0], h[1], h[2]],
      [h[3], h[4], h[5]],
      [h[6], h[7], 1]
    ];
  }

  function gaussianElimination(A) {
    const n = 8;
    // Fix h[8]=1 and solve the resulting 8x8 linear system
    const M = A.map(row => row.slice(0, 8));
    const b = A.map(row => -row[8]);

    for (let col = 0; col < n; col++) {
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
      }
      [M[col], M[maxRow]] = [M[maxRow], M[col]];
      [b[col], b[maxRow]] = [b[maxRow], b[col]];
      if (Math.abs(M[col][col]) < 1e-10) return null;
      for (let row = col + 1; row < n; row++) {
        const factor = M[row][col] / M[col][col];
        for (let k = col; k < n; k++) M[row][k] -= factor * M[col][k];
        b[row] -= factor * b[col];
      }
    }

    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = b[i];
      for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
      x[i] /= M[i][i];
    }
    return x;
  }

  function applyH(H, pt) {
    const w = H[2][0] * pt.x + H[2][1] * pt.y + H[2][2];
    return {
      x: (H[0][0] * pt.x + H[0][1] * pt.y + H[0][2]) / w,
      y: (H[1][0] * pt.x + H[1][1] * pt.y + H[1][2]) / w
    };
  }

  // Returns a CSS matrix3d string that warps the overlay element to the detected corners.
  // Reference: https://franklinta.com/2014/09/08/computing-css-matrix3d-transforms/
  function getCSSMatrix3d(corners, canvasWidth, canvasHeight) {
    const { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br } = corners;
    const src = [
      { x: 0,           y: 0            },
      { x: canvasWidth, y: 0            },
      { x: canvasWidth, y: canvasHeight },
      { x: 0,           y: canvasHeight }
    ];
    const dst = [tl, tr, br, bl];
    const H = computeH(src, dst);
    if (!H) return null;
    const m = H;
    // Convert 3x3 homography to column-major 4x4 CSS matrix
    const mat = [
      m[0][0], m[1][0], 0, m[2][0],
      m[0][1], m[1][1], 0, m[2][1],
      0,       0,       1, 0,
      m[0][2], m[1][2], 0, m[2][2]
    ];
    return `matrix3d(${mat.join(',')})`;
  }

  return { computeH, applyH, getCSSMatrix3d };
})();
