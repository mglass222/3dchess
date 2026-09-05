import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PieceSounds } from '../src/sound.js';

function harness(saved = null) {
  const sources = [];
  const storage = { getItem: () => saved, setItem: vi.fn() };
  const context = {
    state: 'suspended', sampleRate: 48000, destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    decodeAudioData: vi.fn(async () => ({ duration: .282 })),
    createBufferSource: () => {
      const source = { playbackRate: {}, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      sources.push(source);
      return source;
    },
    createGain: () => ({ gain: {}, connect: vi.fn(), disconnect: vi.fn() }),
    createStereoPanner: () => ({ pan: {}, connect: vi.fn(), disconnect: vi.fn() }),
  };
  let hidden = false;
  const factory = vi.fn(() => context);
  const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  const sounds = new PieceSounds({ contextFactory: factory, storage: () => storage, isHidden: () => hidden, fetcher });
  return { sounds, context, sources, storage, factory, fetcher, hide: () => { hidden = true; } };
}

describe('piece sounds', () => {
  it('ships a short, non-clipping mono WAV with quiet endpoints', () => {
    const wav = readFileSync(new URL('../public/audio/piece-land.wav', import.meta.url));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    let data, rate;
    for (let offset = 12; offset + 8 <= wav.length;) {
      const size = wav.readUInt32LE(offset + 4);
      const chunk = wav.subarray(offset + 8, offset + 8 + size);
      const name = wav.toString('ascii', offset, offset + 4);
      if (name === 'fmt ') {
        expect(chunk.readUInt16LE(0)).toBe(1); // PCM
        expect(chunk.readUInt16LE(2)).toBe(1); // mono
        rate = chunk.readUInt32LE(4);
        expect(chunk.readUInt16LE(14)).toBe(16);
      }
      if (name === 'data') data = chunk;
      offset += 8 + size + size % 2;
    }
    expect(rate).toBe(48000);
    expect(data.length / 2 / rate).toBeCloseTo(.282, 3);
    const pcm = Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2) / 32768);
    expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(.5);
    expect(Math.max(...pcm.map(Math.abs))).toBeLessThan(.9);
    expect(Math.abs(pcm[0])).toBeLessThan(.001);
    expect(Math.abs(pcm.at(-1))).toBeLessThan(.001);
  });

  it('preloads once, shares the decoded recording, and preserves its pitch for moves and captures', async () => {
    const { sounds, context, sources, fetcher } = harness();
    await sounds.preload();
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    await Promise.all([sounds.unlock(), sounds.unlock()]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    sounds.playLanding({ piece: 'p' });
    sounds.playLanding({ piece: 'k', capture: true });
    expect(sources[0].buffer).toBe(sources[1].buffer);
    expect(sources.map((source) => source.playbackRate.value)).toEqual([1, 1]);
  });

  it('silently skips an unavailable sample and retries on a later gesture', async () => {
    const { sounds, sources, fetcher } = harness();
    fetcher.mockResolvedValueOnce({ ok: false });
    await sounds.unlock();
    sounds.playLanding();
    expect(sources).toHaveLength(0);
    await sounds.unlock();
    expect(sources).toHaveLength(0); // no delayed sound from the failed load
    sounds.playLanding();
    expect(sources).toHaveLength(1);
  });

  it('unlocks on a gesture and does not queue sounds from before unlock or while suspended', async () => {
    const { sounds, context, sources, factory } = harness();
    sounds.playLanding();
    expect(factory).not.toHaveBeenCalled();
    await sounds.unlock();
    expect(sources).toHaveLength(0);
    sounds.playLanding({ piece: 'k' });
    expect(sources[0].start).toHaveBeenCalledOnce();
    context.state = 'suspended';
    sounds.playLanding();
    await sounds.unlock();
    expect(sources).toHaveLength(1);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('remembers mute, stops active sounds immediately, and releases completed voices', async () => {
    const { sounds, sources, storage } = harness();
    await sounds.unlock();
    sounds.playLanding();
    sources[0].onended();
    expect(sounds.voices.size).toBe(0);
    sounds.playLanding({ capture: true });
    sounds.setEnabled(false);
    expect(sources[1].stop).toHaveBeenCalledOnce();
    expect(sounds.voices.size).toBe(0);
    expect(storage.setItem).toHaveBeenCalledWith('chess-sound', 'off');
    sounds.playLanding();
    expect(sources).toHaveLength(2);
    const muted = harness('off');
    await muted.sounds.unlock();
    expect(muted.factory).not.toHaveBeenCalled();
  });

  it('stays silent in a hidden tab and tolerates unavailable browser audio/storage', async () => {
    const { sounds, sources, hide } = harness();
    await sounds.unlock();
    hide();
    sounds.playLanding();
    expect(sources).toHaveLength(0);
    const unavailable = new PieceSounds({
      contextFactory: () => { throw new Error('No audio'); },
      storage: () => { throw new Error('Blocked'); },
    });
    await expect(unavailable.unlock()).resolves.toBeUndefined();
    expect(() => unavailable.playLanding()).not.toThrow();
    expect(() => unavailable.setEnabled(false)).not.toThrow();
  });
});
