import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the project under /3dchess/; local dev stays at root.
  base: command === 'build' ? '/3dchess/' : '/',
  // Stockfish ships a Node entry + a large wasm; keep it out of dep pre-bundling.
  optimizeDeps: { exclude: ['stockfish'] },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
}));
