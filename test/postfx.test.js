import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  BLOOM,
  MEASURED_SCENE_LINEAR,
  acesFilmicLuminance,
  displayFromSceneLinear,
  chooseSamples,
  postProcessingSupported,
  createPostProcessing,
} from '../src/postfx.js';

describe('postfx', () => {
  it('ports the ACES tonemap accurately enough to reproduce the Tier-1 browser measurements', () => {
    // These are the actual measured on-screen values from the Tier-1 pass
    // (see src/scene.js's LIGHT_SQ/DARK_SQ/envMapIntensity comments): light
    // squares render at 64.8% display luminance, dark squares at 20.6%. This
    // makes that claim executable instead of just a code comment.
    expect(displayFromSceneLinear(MEASURED_SCENE_LINEAR.lightSquare))
      .toBeCloseTo(0.648, 2);
    expect(displayFromSceneLinear(MEASURED_SCENE_LINEAR.darkSquare))
      .toBeCloseTo(0.206, 2);
  });

  it('acesFilmicLuminance stays within [0, 1] and is monotonic on the neutral axis', () => {
    expect(acesFilmicLuminance(0)).toBeCloseTo(0, 5);
    expect(acesFilmicLuminance(MEASURED_SCENE_LINEAR.darkSquare))
      .toBeLessThan(acesFilmicLuminance(MEASURED_SCENE_LINEAR.lightSquare));
    expect(acesFilmicLuminance(100)).toBeLessThanOrEqual(1);
  });

  it('proves the board (and its p95) cannot bloom: threshold clears 87% display and 2.5x the measured p95', () => {
    // UnrealBloomPass thresholds on the LINEAR, pre-tonemap buffer, so this is
    // the executable version of "only genuine speculars bloom; the board can't."
    expect(displayFromSceneLinear(BLOOM.threshold)).toBeGreaterThanOrEqual(0.87);
    expect(BLOOM.threshold).toBeGreaterThanOrEqual(2.5 * MEASURED_SCENE_LINEAR.p95);
  });

  it('chooseSamples steps down MSAA at its two boundaries', () => {
    expect(chooseSamples(6e6)).toBe(4);       // at (not over) the first boundary: still 4
    expect(chooseSamples(6e6 + 1)).toBe(2);   // just over -> drops to 2
    expect(chooseSamples(9e6)).toBe(2);       // at (not over) the second boundary: still 2
    expect(chooseSamples(9e6 + 1)).toBe(0);   // just over -> drops to 0
  });

  it('postProcessingSupported is false for a bare object and for a renderer missing both extensions', () => {
    expect(postProcessingSupported({})).toBe(false);
    expect(postProcessingSupported(undefined)).toBe(false);

    const noExtensions = { extensions: { has: () => false } };
    expect(postProcessingSupported(noExtensions)).toBe(false);

    const halfFloatOnly = { extensions: { has: (name) => name === 'EXT_color_buffer_half_float' } };
    expect(postProcessingSupported(halfFloatOnly)).toBe(true);

    const floatOnly = { extensions: { has: (name) => name === 'EXT_color_buffer_float' } };
    expect(postProcessingSupported(floatOnly)).toBe(true);
  });

  it('createPostProcessing returns null without throwing when unsupported', () => {
    const renderer = {
      extensions: { has: () => false },
      getSize: (target) => target.set(800, 600),
    };

    expect(() => createPostProcessing({
      renderer, scene: {}, camera: {},
    })).not.toThrow();
    expect(createPostProcessing({ renderer, scene: {}, camera: {} })).toBeNull();
  });

  it('builds RenderPass -> UnrealBloomPass -> OutputPass, at CSS size, with the tuned bloom constants', () => {
    const calls = { addPass: [] };
    const fakeComposer = {
      renderTarget2: { samples: 99 }, // non-zero, so we can prove createPostProcessing zeroes it
      addPass: (pass) => calls.addPass.push(pass),
    };
    let renderTargetArgs = null;
    let composerArgs = null;
    let bloomArgs = null;
    const fakeRenderPass = { name: 'renderPass' };
    const fakeBloomPass = { name: 'bloomPass' };
    const fakeOutputPass = { name: 'outputPass' };

    const factories = {
      renderTarget: (width, height, options) => {
        renderTargetArgs = [width, height, options];
        return { name: 'renderTarget' };
      },
      composer: (renderer, renderTarget) => {
        composerArgs = [renderer, renderTarget];
        return fakeComposer;
      },
      renderPass: () => fakeRenderPass,
      bloomPass: (resolution, strength, radius, threshold) => {
        bloomArgs = [resolution, strength, radius, threshold];
        return fakeBloomPass;
      },
      outputPass: () => fakeOutputPass,
    };

    // CSS size (not device pixels): a real renderer.getSize() would return this
    // even under a devicePixelRatio > 1, since WebGLRenderer stores its _width/
    // _height in CSS units and scales only the drawing buffer/canvas.
    const cssWidth = 1280;
    const cssHeight = 720;
    const renderer = {
      extensions: { has: (name) => name === 'EXT_color_buffer_half_float' },
      getSize: (target) => target.set(cssWidth, cssHeight),
    };

    const scene = { marker: 'scene' };
    const camera = { marker: 'camera' };
    const post = createPostProcessing({
      renderer, scene, camera, factories,
    });

    expect(post).not.toBeNull();
    expect(calls.addPass).toEqual([fakeRenderPass, fakeBloomPass, fakeOutputPass]);

    expect(composerArgs[0]).toBe(renderer);
    expect(composerArgs[1].name).toBe('renderTarget');

    // Built at CSS size, not device pixels.
    expect(renderTargetArgs[0]).toBe(cssWidth);
    expect(renderTargetArgs[1]).toBe(cssHeight);
    expect(renderTargetArgs[2].type).toBe(THREE.HalfFloatType);
    // 1280*720 = 921600, well under the 6e6 first boundary -> 4 samples.
    expect(renderTargetArgs[2].samples).toBe(4);

    // Only the scene pass needs MSAA; EffectComposer clones renderTarget1 into
    // renderTarget2 (copying `samples` along with it), so this must be zeroed
    // back out on the composer's second target after construction.
    expect(fakeComposer.renderTarget2.samples).toBe(0);

    expect(bloomArgs[0]).toBeInstanceOf(THREE.Vector2);
    expect(bloomArgs[0].x).toBe(cssWidth);
    expect(bloomArgs[0].y).toBe(cssHeight);
    expect(bloomArgs[1]).toBeCloseTo(BLOOM.strength, 5);
    expect(bloomArgs[2]).toBeCloseTo(BLOOM.radius, 5);
    expect(bloomArgs[3]).toBeCloseTo(BLOOM.threshold, 5);

    expect(post.renderPass).toBe(fakeRenderPass);
    expect(post.bloomPass).toBe(fakeBloomPass);
    expect(post.outputPass).toBe(fakeOutputPass);
    expect(post.composer).toBe(fakeComposer);
  });

  it('drops MSAA samples to 0 for a very large canvas', () => {
    const calls = { addPass: [] };
    const fakeComposer = { renderTarget2: { samples: 0 }, addPass: (p) => calls.addPass.push(p) };
    let renderTargetArgs = null;
    const factories = {
      renderTarget: (w, h, options) => { renderTargetArgs = [w, h, options]; return {}; },
      composer: () => fakeComposer,
      renderPass: () => ({}),
      bloomPass: () => ({}),
      outputPass: () => ({}),
    };
    // 4000 * 3000 = 1.2e7, over the 9e6 boundary -> 0 samples.
    const renderer = {
      extensions: { has: () => true },
      getSize: (target) => target.set(4000, 3000),
    };

    createPostProcessing({
      renderer, scene: {}, camera: {}, factories,
    });

    expect(renderTargetArgs[2].samples).toBe(0);
  });
});
