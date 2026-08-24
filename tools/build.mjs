/**
 * Copies just the extension files into dist/ — manifest, src, icons — leaving
 * tests, tooling and node_modules behind. Chrome can load the repo root
 * directly, but dist/ is the unambiguous thing to point "Load unpacked" at,
 * and the thing to zip for the Web Store.
 *
 *   npm run build
 */
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const INCLUDE = ['manifest.json', 'src', 'icons'];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const entry of INCLUDE) {
  const from = join(ROOT, entry);
  if (!existsSync(from)) throw new Error(`missing ${entry} — cannot build`);
  cpSync(from, join(DIST, entry), { recursive: true });
}

const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
console.log(`dist/ built — ${manifest.name} v${manifest.version}`);
console.log(`Load unpacked -> ${DIST}`);
