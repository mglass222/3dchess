import { defineConfig } from 'vite';

export default defineConfig({
  // Stockfish ships a Node entry + a large wasm; keep it out of dep pre-bundling.
  // We load the engine directly from public/engine/ as a classic Worker.
  optimizeDeps: { exclude: ['stockfish'] },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
