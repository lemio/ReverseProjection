window.ColorDetector = (function() {
  let smoothed = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  const ALPHA = 0.3;

  function findColorCentroid(data, width, height, colorTest) {
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        if (colorTest(r, g, b)) {
          sumX += x; sumY += y; count++;
        }
      }
    }
    if (count < 20) return null;
    return { x: sumX / count, y: sumY / count };
  }

  const colorTests = {
    red:    (r, g, b) => { const s = r + g + b; return s > 80 && r / s > 0.55 && r > 80 && g < 120 && b < 120; },
    green:  (r, g, b) => { const s = r + g + b; return s > 80 && g / s > 0.55 && g > 80 && r < 120 && b < 120; },
    blue:   (r, g, b) => { const s = r + g + b; return s > 80 && b / s > 0.55 && b > 80 && r < 120 && g < 120; },
    yellow: (r, g, b) => { const s = r + g + b; return r > 150 && g > 150 && b < 80 && (r + g) / s > 0.75; }
  };

  function smooth(prev, next) {
    if (!prev) return next;
    return { x: prev.x + ALPHA * (next.x - prev.x), y: prev.y + ALPHA * (next.y - prev.y) };
  }

  function detect(imageData) {
    const { data, width, height } = imageData;
    const tl = findColorCentroid(data, width, height, colorTests.red);
    const tr = findColorCentroid(data, width, height, colorTests.green);
    const bl = findColorCentroid(data, width, height, colorTests.blue);
    const br = findColorCentroid(data, width, height, colorTests.yellow);

    if (!tl || !tr || !bl || !br) {
      if (tl) smoothed.topLeft    = smooth(smoothed.topLeft, tl);
      if (tr) smoothed.topRight   = smooth(smoothed.topRight, tr);
      if (bl) smoothed.bottomLeft = smooth(smoothed.bottomLeft, bl);
      if (br) smoothed.bottomRight = smooth(smoothed.bottomRight, br);
      return null;
    }

    smoothed.topLeft    = smooth(smoothed.topLeft, tl);
    smoothed.topRight   = smooth(smoothed.topRight, tr);
    smoothed.bottomLeft = smooth(smoothed.bottomLeft, bl);
    smoothed.bottomRight = smooth(smoothed.bottomRight, br);

    return {
      topLeft:     { ...smoothed.topLeft },
      topRight:    { ...smoothed.topRight },
      bottomLeft:  { ...smoothed.bottomLeft },
      bottomRight: { ...smoothed.bottomRight }
    };
  }

  function reset() {
    smoothed = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  }

  return { detect, reset };
})();
