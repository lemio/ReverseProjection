/*
 * Renders the phone tracking border (public/phone/js/borderPattern.js) into
 * 8th Wall image-target files — without needing 8th Wall Studio.
 *
 * An 8th Wall planar target is a JSON descriptor plus a 480×640 greyscale
 * "luminance" image (the same format Studio writes into image-targets/).
 * Because targets must be 3:4, the screen is split into a top and a bottom
 * region (BorderPattern.targetRegions); each becomes its own target.
 */
const zlib = require('zlib');
const BorderPattern = require('../public/phone/js/borderPattern.js');

const LUM_W = 480, LUM_H = 640;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Minimal canvas-like rasteriser with anti-aliased (area coverage) rect edges.
// Coordinates passed to fillRect are in CSS px and multiplied by `scale`.
function makeRaster(w, h, scale, background) {
  const data = new Float32Array(w * h * 3);
  const bg = hexToRgb(background);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 3);
  let rgb = [0, 0, 0];
  const ctx = {
    set fillStyle(hex) { rgb = hexToRgb(hex); },
    fillRect(x, y, rw, rh) {
      const X0 = x * scale, X1 = (x + rw) * scale, Y0 = y * scale, Y1 = (y + rh) * scale;
      for (let py = Math.max(0, Math.floor(Y0)); py < Math.min(h, Math.ceil(Y1)); py++) {
        const cy = Math.min(py + 1, Y1) - Math.max(py, Y0);
        for (let px = Math.max(0, Math.floor(X0)); px < Math.min(w, Math.ceil(X1)); px++) {
          const a = cy * (Math.min(px + 1, X1) - Math.max(px, X0));
          if (a <= 0) continue;
          const o = (py * w + px) * 3;
          for (let c = 0; c < 3; c++) data[o + c] = data[o + c] * (1 - a) + rgb[c] * a;
        }
      }
    }
  };
  return { w, h, data, ctx };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Encode rows [y0, y0+outH) of a raster as an 8-bit PNG (RGB, or grey if `grey`).
function encodePng(raster, { y0 = 0, outH = raster.h, grey = false } = {}) {
  const ch = grey ? 1 : 3;
  const stride = raster.w * ch + 1;
  const raw = Buffer.alloc(stride * outH);
  for (let y = 0; y < outH; y++) {
    const row = y * stride;
    for (let x = 0; x < raster.w; x++) {
      const i = ((y0 + y) * raster.w + x) * 3;
      const r = raster.data[i], g = raster.data[i + 1], b = raster.data[i + 2];
      if (grey) {
        raw[row + 1 + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      } else {
        raw[row + 1 + x * 3] = Math.round(r);
        raw[row + 2 + x * 3] = Math.round(g);
        raw[row + 3 + x * 3] = Math.round(b);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(raster.w, 0); ihdr.writeUInt32BE(outH, 4);
  ihdr[8] = 8; ihdr[9] = grey ? 0 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Full-screen colour render, as the phone draws it (cssW×cssH at `dpr`).
 */
function renderScreenPng(cssW, cssH, dpr = 1) {
  const r = makeRaster(Math.round(cssW * dpr), Math.round(cssH * dpr), dpr, BorderPattern.INSIDE);
  BorderPattern.draw(r.ctx, cssW, cssH);
  return encodePng(r);
}

/**
 * Image targets for a phone with a cssW×cssH screen.
 * @param {string} baseUrl  URL prefix the luminance images will be served from
 * @param {string} prefix   target name prefix (targets are `${prefix}top`, `${prefix}bottom`)
 * @param {object} drawOpts BorderPattern.draw options (defaults match the phone)
 * @returns [{part, name, region, json, luminancePng, luminanceFile}]
 */
function renderTargets(cssW, cssH, { baseUrl = '', prefix = 'border-', drawOpts } = {}) {
  // Render the whole screen at a scale where its width is 480 px, then crop
  // each 3:4 region to exactly 480×640.
  const scale = LUM_W / cssW;
  const fullH = Math.round(cssH * scale);
  const r = makeRaster(LUM_W, fullH, scale, BorderPattern.INSIDE);
  BorderPattern.draw(r.ctx, cssW, cssH, drawOpts);

  return BorderPattern.targetRegions(cssW, cssH).map((region) => {
    const y0 = region.part === 'top' ? 0 : Math.max(0, fullH - LUM_H);
    const outH = Math.min(LUM_H, fullH);
    const name = prefix + region.part;
    const luminanceFile = name + '_luminance.png';
    return {
      part: region.part,
      name,
      region,
      luminanceFile,
      luminancePng: encodePng(r, { y0, outH, grey: true }),
      json: {
        imagePath: baseUrl + luminanceFile,
        name,
        type: 'PLANAR',
        properties: {
          top: y0, left: 0, width: LUM_W, height: outH,
          isRotated: false,
          originalWidth: LUM_W, originalHeight: fullH
        },
        // Where this target sits on the phone screen (CSS px) — used by the
        // laptop to turn a target pose into phone-screen corners.
        metadata: { screenW: cssW, screenH: cssH, region },
        loadAutomatically: true
      }
    };
  });
}

module.exports = { renderTargets, renderScreenPng, makeRaster, encodePng, LUM_W, LUM_H };
