// Recorded second impact from simone_ds — public/audio/README.md has CC0 credits.
export class PieceSounds {
  constructor({ contextFactory = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(),
    storage = () => globalThis.localStorage, isHidden = () => globalThis.document?.hidden,
    fetcher = (...args) => globalThis.fetch(...args),
    sampleUrl = `${import.meta.env?.BASE_URL ?? '/'}audio/piece-land.wav` } = {}) {
    this.contextFactory = contextFactory;
    this.storage = storage;
    this.isHidden = isHidden;
    this.context = null;
    this.fetcher = fetcher;
    this.sampleUrl = sampleUrl;
    this.samplePromise = null;
    this.decodePromise = null;
    this.buffer = null;
    this.voices = new Set();
    this.enabled = true;
    try { this.enabled = storage()?.getItem('chess-sound') !== 'off'; } catch { /* storage may be blocked */ }
  }

  // Fetch early, but leave AudioContext creation/resumption inside a gesture.
  preload() {
    if (!this.samplePromise) {
      this.samplePromise = Promise.resolve().then(() => this.fetcher(this.sampleUrl))
        .then((response) => {
          if (!response.ok) throw new Error('Sound unavailable');
          return response.arrayBuffer();
        }).catch(() => {
          this.samplePromise = null; // allow a later gesture to retry
          return null;
        });
    }
    return this.samplePromise;
  }

  // Called directly from a user gesture, before an animation or AI reply.
  // Never queue impacts while suspended: they would play late on the next click.
  async unlock() {
    if (!this.enabled) return;
    try {
      if (!this.context) this.context = this.contextFactory();
      // Invoke resume synchronously while the browser still has user activation.
      const resumed = this.context.state !== 'running' ? this.context.resume() : Promise.resolve();
      if (!this.buffer && !this.decodePromise) {
        this.decodePromise = this.preload().then((bytes) => bytes
          ? this.context.decodeAudioData(bytes.slice(0)) : null)
          .then((buffer) => { this.buffer = buffer; })
          .catch(() => { /* a later gesture may retry decoding */ })
          .finally(() => { this.decodePromise = null; });
      }
      await Promise.all([resumed, this.decodePromise]);
    } catch { /* Audio support or autoplay restrictions must not block chess. */ }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    try { this.storage()?.setItem('chess-sound', this.enabled ? 'on' : 'off'); } catch { /* optional preference */ }
    if (!this.enabled) this.stop();
    else void this.unlock();
  }

  stop() {
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch { /* already ended */ }
      voice.cleanup();
    }
  }

  playLanding({ piece = 'p', capture = false, file = 3.5 } = {}) {
    const context = this.context;
    if (!this.enabled || !context || context.state !== 'running' || !this.buffer || this.isHidden()) return;
    let voice;
    try {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const pan = context.createStereoPanner();
      voice = { source, cleanup: () => {
        source.disconnect(); gain.disconnect(); pan.disconnect();
        this.voices.delete(voice);
      } };
      source.buffer = this.buffer;
      source.playbackRate.value = 1; // preserve the selected recording exactly
      gain.gain.value = (piece === 'p' ? .8 : .9) * (capture ? 1.12 : 1);
      pan.pan.value = Math.max(-.22, Math.min(.22, (file - 3.5) * .06));
      source.connect(gain); gain.connect(pan); pan.connect(context.destination);
      source.onended = voice.cleanup;
      this.voices.add(voice);
      source.start();
    } catch {
      voice?.cleanup();
    }
  }
}
