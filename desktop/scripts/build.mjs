// Copies desktop/src + shared UI into desktop/dist (the Tauri frontend). Stubs fill in for missing shared files.
import { cpSync, rmSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
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
const art = join(shared, 'art');
if (existsSync(art)) cpSync(art, join(dist, 'shared', 'art'), { recursive: true });
if (stubbed.length) {
  const msg = `STUBBED shared files: ${stubbed.join(', ')}`;
  if (require_shared) { console.error('ERROR ' + msg); process.exit(1); }
  console.warn('WARN ' + msg);
}
console.log('dist ready:', readdirSync(dist).join(', '));
