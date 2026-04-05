window.ColorDetector = (function() {
  let smoothed = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  const ALPHA = 0.3;

  // Color-detection thresholds — tune these for your lighting conditions.
  const MIN_BRIGHTNESS  = 80;   // minimum channel sum to ignore near-black pixels
  const RATIO_THRESHOLD = 0.55; // dominant channel must exceed this fraction of the sum
  const CROSS_MAX       = 120;  // non-dominant channels must stay below this value
  const YELLOW_MIN      = 150;  // both R and G must exceed this for yellow
  const YELLOW_BLUE_MAX = 80;   // blue channel must stay below this for yellow
  const YELLOW_RG_RATIO = 0.75; // (R+G)/sum ratio threshold for yellow
  const MIN_PIXEL_COUNT = 20;   // minimum matching pixels to accept a centroid

  // Generic single-channel dominant colour test
  function makePrimaryTest(ch) {
    return function(r, g, b) {
      const s = r + g + b;
      const val = ch === 0 ? r : ch === 1 ? g : b;
      return s > MIN_BRIGHTNESS && val / s > RATIO_THRESHOLD && val > MIN_BRIGHTNESS &&
             (ch !== 0 ? r : g) < CROSS_MAX && (ch !== 2 ? b : g) < CROSS_MAX;
    };
  }

  const colorTests = {
    red:    makePrimaryTest(0),
    green:  makePrimaryTest(1),
    blue:   makePrimaryTest(2),
    yellow: function(r, g, b) {
      const s = r + g + b;
      return r > YELLOW_MIN && g > YELLOW_MIN && b < YELLOW_BLUE_MAX && (r + g) / s > YELLOW_RG_RATIO;
    }
  };

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
    if (count < MIN_PIXEL_COUNT) return null;
    return { x: sumX / count, y: sumY / count };
  }

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
