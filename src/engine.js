// Low-level wrapper around the Stockfish lite-single engine running as a classic
// Web Worker (vendored at /engine/stockfish-18-lite-single.js by scripts/copy-engine.js).
// The .wasm sits beside the .js so Emscripten's locateFile resolves it automatically.
const ENGINE_URL = '/engine/stockfish-18-lite-single.js';

export function createEngine(url = ENGINE_URL) {
  const worker = new Worker(url); // classic worker — do NOT pass { type: 'module' }
  const listeners = new Set();

  worker.onmessage = (e) => {
    const line = typeof e === 'string' ? e : e.data;
    for (const fn of listeners) fn(line);
  };

  const send = (cmd) => worker.postMessage(cmd);
  const onLine = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  // Resolve once the engine prints a line satisfying match(line).
  const waitFor = (match) =>
    new Promise((resolve) => {
      const off = onLine((line) => {
        if (match(line)) { off(); resolve(line); }
      });
    });

  const terminate = () => worker.terminate();

  return { worker, send, onLine, waitFor, terminate };
}
