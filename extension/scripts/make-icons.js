/* Generates icons/icon{16,32,48,128}.png: ink rounded square with a paper line-art plane. Pure node, no deps. */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// plane outline segments in a 100x100 box (nose points right)
const P = [
  [[18,52],[24,44],[70,44],[84,52],[70,60],[24,60],[18,52]],   // fuselage
  [[26,44],[18,28],[28,28],[40,44]],                           // tail fin
  [[50,52],[42,76],[52,76],[70,56]],                           // wing
];
function dseg(px, py, a, b) {
  const dx = b[0]-a[0], dy = b[1]-a[1];
  let t = ((px-a[0])*dx + (py-a[1])*dy) / (dx*dx + dy*dy || 1);
  t = Math.max(0, Math.min(1, t));
  const x = a[0]+t*dx-px, y = a[1]+t*dy-py;
  return Math.sqrt(x*x + y*y);
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function render(size) {
  const SS = 4, N = size * SS;
  const radius = 0.22 * size, stroke = Math.max(1.2, size * 0.045);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const segs = [];
  P.forEach((poly) => { for (let i = 0; i < poly.length - 1; i++) segs.push([poly[i], poly[i+1]]); });
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let ink = 0, paper = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + .5) / SS, py = y + (sy + .5) / SS;
        // rounded square coverage
        const cx = Math.min(Math.max(px, radius), size - radius), cy = Math.min(Math.max(py, radius), size - radius);
        const inside = Math.hypot(px - cx, py - cy) <= radius;
        if (!inside) continue;
        ink++;
        const ux = px / size * 100, uy = py / size * 100;
        let d = 1e9;
        for (const s of segs) d = Math.min(d, dseg(ux, uy, s[0], s[1]));
        if (d * size / 100 <= stroke / 2) paper++;
      }
      const total = SS * SS;
      const cov = ink / total;
      const mix = ink ? paper / ink : 0;
      const v = Math.round(17 + (255 - 17) * mix);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = v; raw[o+1] = v; raw[o+2] = v; raw[o+3] = Math.round(cov * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = function makeIcons(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  [16, 32, 48, 128].forEach((s) => fs.writeFileSync(path.join(outDir, `icon${s}.png`), render(s)));
};
if (require.main === module) module.exports(process.argv[2] || 'icons');
