/* Builds extension/dist/unpacked and extension/dist/meetingplz-extension.zip.
 * Shared files (core.js, reminder.iife.js, art/*.svg) come from ../shared when present, otherwise from stubs/. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const shared = path.resolve(root, '..', 'shared');
const dist = path.join(root, 'dist');
const out = path.join(dist, 'unpacked');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, 'src'), out, { recursive: true });

const used = [];
function pick(name, sharedPath, stubPath) {
  const dst = path.join(out, name);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(sharedPath)) { fs.copyFileSync(sharedPath, dst); used.push(name + ': shared'); }
  else { fs.copyFileSync(stubPath, dst); used.push(name + ': STUB'); }
}
pick('core.js', path.join(shared, 'core.js'), path.join(root, 'stubs/core.js'));
pick('reminder.iife.js', path.join(shared, 'reminder/reminder.iife.js'), path.join(root, 'stubs/reminder.iife.js'));
// design v2: tokens + components + bundled woff2 fonts, and line art inlined into art.js (window.MPZ_ART)
const design = path.join(shared, 'design');
if (fs.existsSync(design)) {
  const dd = path.join(out, 'design');
  fs.mkdirSync(path.join(dd, 'fonts'), { recursive: true });
  ['tokens.css', 'components.css'].forEach((f) => { fs.copyFileSync(path.join(design, f), path.join(dd, f)); used.push('design/' + f + ': shared'); });
  fs.readdirSync(path.join(design, 'fonts')).filter((n) => /\.(woff2|txt)$/.test(n)).forEach((f) => fs.copyFileSync(path.join(design, 'fonts', f), path.join(dd, 'fonts', f)));
} else {
  throw new Error('shared/design missing: the popup needs design v2 tokens');
}
// art: stubs first, then shared svgs override
fs.mkdirSync(path.join(out, 'art'), { recursive: true });
fs.cpSync(path.join(root, 'stubs/art'), path.join(out, 'art'), { recursive: true });
const sharedArt = path.join(shared, 'art');
if (fs.existsSync(sharedArt)) {
  fs.readdirSync(sharedArt).filter((f) => f.endsWith('.svg') && f !== 'icon-1024.svg').forEach((f) => {
    fs.copyFileSync(path.join(sharedArt, f), path.join(out, 'art', f)); used.push('art/' + f + ': shared');
  });
}
const MPZ_ART = {};
fs.readdirSync(path.join(out, 'art')).filter((f) => f.endsWith('.svg')).forEach((f) => {
  MPZ_ART[f.replace(/\.svg$/, '')] = fs.readFileSync(path.join(out, 'art', f), 'utf8').trim()
    .replace(/fill="#FBF9F4"/g, 'style="fill:var(--surface)"').replace(/fill="#D4512A"/g, 'style="fill:var(--accent)"')
    .replace(/stroke="#171512"/g, 'stroke="currentColor"').replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
});
fs.writeFileSync(path.join(out, 'art.js'), 'window.MPZ_ART = ' + JSON.stringify(MPZ_ART) + ';\n');
// popup uses art.js (inlined svgs); art/plane.svg: if shared names it differently, keep the stub as fallback (copied above)
// icons: src/icons (resized from shared/art/icon-1024.png with sips)

const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
const zip = path.join(dist, 'meetingplz-extension.zip');
execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });
console.log('built', manifest.name, manifest.version, '->', out);
console.log(used.join('\n'));
