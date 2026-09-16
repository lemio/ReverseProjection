#!/usr/bin/env node
/*
 * Writes the phone tracking border as 8th Wall image targets.
 *
 * Usage:
 *   node tools/generate-border-target.js [--width 390] [--height 844] [--dpr 3] [--out targets]
 *
 * width/height are the phone's CSS viewport (window.innerWidth/innerHeight);
 * the phone shows these for a few seconds on load.
 *
 * Outputs (in --out):
 *   border-screen.png                      — whole screen as the phone draws it
 *   border-top.json / border-bottom.json   — 8th Wall target descriptors
 *   border-*_luminance.png                 — 480×640 detection images
 *
 * The JSON + luminance files use the same format as an 8th Wall Studio
 * project's image-targets/ folder, so --out can point straight at one.
 * The laptop app does not need these files: server.js generates targets on
 * the fly for each connected phone's screen size.
 */
const fs = require('fs');
const path = require('path');
const { renderTargets, renderScreenPng } = require('./imageTarget');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const cssW = Number(args.width || 390);
const cssH = Number(args.height || 844);
const dpr = Number(args.dpr || 3);
const outDir = path.resolve(args.out || 'targets');

function write(file, data) {
  fs.writeFileSync(path.join(outDir, file), data);
  console.log('wrote ' + path.relative(process.cwd(), path.join(outDir, file)));
}

fs.mkdirSync(outDir, { recursive: true });
write('border-screen.png', renderScreenPng(cssW, cssH, dpr));
renderTargets(cssW, cssH, { baseUrl: 'image-targets/' }).forEach((t) => {
  write(t.luminanceFile, t.luminancePng);
  write(t.name + '.json', JSON.stringify(t.json, null, 2));
});
