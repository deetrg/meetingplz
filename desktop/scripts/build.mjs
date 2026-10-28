// Copies desktop/src + shared UI into desktop/dist (the Tauri frontend). Stubs fill in for missing shared files.
// Design v2: shared/design (tokens.css, components.css, bundled woff2 fonts) is copied next to the pages, and the
// line art is inlined into dist/art.js (window.MPZ_ART) recoloured with the design tokens so it follows light/dark.
import { cpSync, rmSync, mkdirSync, existsSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const shared = join(root, '..', 'shared');
const require_shared = process.env.REQUIRE_SHARED === '1';

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'shared'), { recursive: true });
cpSync(join(root, 'src'), dist, { recursive: true });

const parts = [
  ['core.js', join(shared, 'core.js'), join(root, 'scripts/stubs/core.js')],
  ['reminder.iife.js', join(shared, 'reminder', 'reminder.iife.js'), join(root, 'scripts/stubs/reminder.iife.js')],
];
const stubbed = [];
for (const [name, real, stub] of parts) {
  if (existsSync(real)) copyFileSync(real, join(dist, 'shared', name));
  else { copyFileSync(stub, join(dist, 'shared', name)); stubbed.push(name); }
}

// design v2: css + woff2 fonts (fonts.js is only for shadow roots and is already inside reminder.iife.js)
const design = join(shared, 'design');
const dd = join(dist, 'shared', 'design');
mkdirSync(join(dd, 'fonts'), { recursive: true });
if (existsSync(design)) {
  for (const f of ['tokens.css', 'components.css']) copyFileSync(join(design, f), join(dd, f));
  for (const f of readdirSync(join(design, 'fonts')).filter((n) => /\.(woff2|txt)$/.test(n))) copyFileSync(join(design, 'fonts', f), join(dd, 'fonts', f));
} else {
  stubbed.push('design/');
}

// art: svgs only (png icons are not needed by the UI and would bloat the binary), plus inlined copies in art.js
const art = join(shared, 'art');
const MPZ_ART = {};
if (existsSync(art)) {
  mkdirSync(join(dist, 'shared', 'art'), { recursive: true });
  for (const f of readdirSync(art).filter((n) => n.endsWith('.svg'))) {
    copyFileSync(join(art, f), join(dist, 'shared', 'art', f));
    MPZ_ART[f.replace(/\.svg$/, '')] = readFileSync(join(art, f), 'utf8').trim()
      .replace(/fill="#FBF9F4"/g, 'style="fill:var(--surface)"').replace(/fill="#D4512A"/g, 'style="fill:var(--accent)"')
      .replace(/stroke="#171512"/g, 'stroke="currentColor"').replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
  }
}
writeFileSync(join(dist, 'art.js'), 'window.MPZ_ART = ' + JSON.stringify(MPZ_ART) + ';\n');

if (stubbed.length) {
  const msg = `STUBBED shared files: ${stubbed.join(', ')}`;
  if (require_shared) { console.error('ERROR ' + msg); process.exit(1); }
  console.warn('WARN ' + msg);
}
console.log('dist ready:', readdirSync(dist).join(', '));
