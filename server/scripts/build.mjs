// Builds server/dist: public/ + partials + shared assets copied (no symlinks).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });

// shared assets -> dist/shared (required)
const need = ['core.js', 'reminder/reminder.iife.js', 'art', 'design'];
for (const p of need) {
  const src = join(repo, 'shared', p);
  if (!existsSync(src)) throw new Error(`missing shared/${p}`);
  mkdirSync(dirname(join(dist, 'shared', p)), { recursive: true });
  cpSync(src, join(dist, 'shared', p), { recursive: true });
}
// keep the server's vendored copy of core in sync (used by Functions and the cron worker)
cpSync(join(repo, 'shared', 'core.js'), join(root, 'src', 'vendor', 'core.cjs'));

// tiny templating for static pages
const part = (n) => readFileSync(join(root, 'partials', n), 'utf8');
// inline line art (single source: shared/art/*.svg) recoloured with the design tokens so it follows light/dark
const art = (n) => readFileSync(join(repo, 'shared', 'art', n), 'utf8').trim()
  .replace(/fill="#FBF9F4"/g, 'style="fill:var(--surface)"').replace(/fill="#D4512A"/g, 'style="fill:var(--accent)"')
  .replace(/stroke="#171512"/g, 'stroke="currentColor"').replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
const marks = {
  '<!--HEAD-->': part('head.html'), '<!--HEADER-->': part('header.html'), '<!--FOOTER-->': part('footer.html'), '<!--DOWNLOADS-->': part('downloads.html'),
  '<!--ART:clouds-->': art('clouds.svg'), '<!--ART:plane-->': art('plane.svg'), '<!--ART:calendar-check-->': art('calendar-check.svg')
};
for (const f of readdirSync(dist).filter((n) => n.endsWith('.html'))) {
  let h = readFileSync(join(dist, f), 'utf8');
  for (const [k, v] of Object.entries(marks)) h = h.split(k).join(v);
  writeFileSync(join(dist, f), h);
}
console.log('built', dist);
