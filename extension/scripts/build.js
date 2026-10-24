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
// art: stubs first, then shared svgs override
fs.mkdirSync(path.join(out, 'art'), { recursive: true });
fs.cpSync(path.join(root, 'stubs/art'), path.join(out, 'art'), { recursive: true });
const sharedArt = path.join(shared, 'art');
if (fs.existsSync(sharedArt)) {
  fs.readdirSync(sharedArt).filter((f) => f.endsWith('.svg') && f !== 'icon-1024.svg').forEach((f) => {
    fs.copyFileSync(path.join(sharedArt, f), path.join(out, 'art', f)); used.push('art/' + f + ': shared');
  });
}
// popup uses art/plane.svg: if shared names it differently, keep the stub as fallback (copied above)
// icons: src/icons (resized from shared/art/icon-1024.png with sips)

const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
const zip = path.join(dist, 'meetingplz-extension.zip');
execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });
console.log('built', manifest.name, manifest.version, '->', out);
console.log(used.join('\n'));
