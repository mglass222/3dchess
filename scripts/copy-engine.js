// Copies the Stockfish lite single-threaded engine into public/engine/ so it can be
// loaded as a classic Web Worker at /engine/stockfish-18-lite-single.js with its
// sibling .wasm resolved correctly in both `vite dev` and `vite build`.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const srcDir = join(root, 'node_modules', 'stockfish', 'bin');
const outDir = join(root, 'public', 'engine');
const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];

mkdirSync(outDir, { recursive: true });
for (const f of files) {
  const src = join(srcDir, f);
  if (!existsSync(src)) {
    console.warn(`[copy-engine] missing ${src} — is "stockfish" installed?`);
    continue;
  }
  copyFileSync(src, join(outDir, f));
  console.log(`[copy-engine] ${f} -> public/engine/`);
}
