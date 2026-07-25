import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// UnrealBloomPass thresholds on the LINEAR, PRE-TONE-MAP buffer, so a threshold
// expressed in display terms is meaningless. Inverting three's ACES fit (its
// input/output matrices are identity on the neutral axis, each row summing to 1):
//   dark squares  20.6% display -> 0.053 scene-linear
//   light squares 64.8% display -> 0.303
//   p95 172/255                 -> 0.336
// 0.90 sits 2.7x above the p95, so only genuine speculars bloom; the board can't.
export const BLOOM = { strength: 0.22, radius: 0.35, threshold: 0.90 };
export const MEASURED_SCENE_LINEAR = { lightSquare: 0.303, darkSquare: 0.053, p95: 0.336 };

// RRTAndODTFit (three's tonemapping_pars_fragment.glsl.js): a = v*(v+0.0245786)
// - 0.000090537; b = v*(0.983729*v + 0.432951) + 0.238081; return a/b. The
// ACESInputMat/ACESOutputMat 3x3 matrices that sandwich this in the real shader
// only rotate between sRGB and ACES AP1 primaries - each is identity on the
// neutral axis (r === g === b): every row of ACESInputMat sums to 1 (e.g. row 0
// is 0.59719 + 0.35458 + 0.04823 = 1.0), and likewise for ACESOutputMat. This
// app never pushes board/marker colors far enough off the neutral axis for that
// to matter, so a scalar port of RRTAndODTFit reproduces the shader's luminance
// response exactly, without reconstructing the matrices.
function rrtAndOdtFit(x) {
  const a = x * (x + 0.0245786) - 0.000090537;
  const b = x * (0.983729 * x + 0.4329510) + 0.238081;
  return a / b;
}

function linearToSRGB(c) {
  const clamped = Math.min(1, Math.max(0, c));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

// Scene-linear -> post-tonemap linear, matching THREE.ACESFilmicToneMapping
// exactly (same `toneMappingExposure / 0.6` prescale three's shader applies).
// Still linear - callers wanting a display-comparable number need the sRGB
// encode in displayFromSceneLinear below.
export function acesFilmicLuminance(sceneLinear, exposure = 1) {
  const x = sceneLinear * (exposure / 0.6);
  return Math.min(1, Math.max(0, rrtAndOdtFit(x)));
}

// Full port of the renderer's output chain for a neutral (r=g=b) color:
// ACES tonemap, then the sRGB transfer function outputColorSpace applies.
// Lets BLOOM.threshold and the measured board luminances be compared directly
// against the 0-255 numbers a browser eyedropper reports.
export function displayFromSceneLinear(sceneLinear, exposure = 1) {
  return linearToSRGB(acesFilmicLuminance(sceneLinear, exposure));
}

// MSAA sample count for the composer's scene-pass render target. Halved (or
// dropped) at higher resolutions because the sample count multiplies GPU
// memory and resolve cost together with pixel count - a 4K canvas at 4x MSAA
// would be the single largest allocation in the app for a barely-visible edge
// quality gain over 2x.
export function chooseSamples(pixelCount) {
  if (pixelCount > 9e6) return 0;
  if (pixelCount > 6e6) return 2;
  return 4;
}

// RGBA16F (the HalfFloatType render target UnrealBloomPass needs to threshold
// on linear, un-tone-mapped HDR values) is only colour-renderable in WebGL2
// with EXT_color_buffer_half_float (or the broader EXT_color_buffer_float).
// Missing either gives an incomplete framebuffer - a black screen, not a
// thrown error - so this must be an explicit capability check, not a
// try/catch around render-target creation.
export function postProcessingSupported(renderer) {
  const extensions = renderer && renderer.extensions;
  if (!extensions || typeof extensions.has !== 'function') return false;
  return extensions.has('EXT_color_buffer_half_float') || extensions.has('EXT_color_buffer_float');
}

export const POST_FACTORIES = {
  renderTarget: (width, height, options) => new THREE.WebGLRenderTarget(width, height, options),
  composer: (renderer, renderTarget) => new EffectComposer(renderer, renderTarget),
  renderPass: (scene, camera) => new RenderPass(scene, camera),
  bloomPass: (resolution, strength, radius, threshold) => (
    new UnrealBloomPass(resolution, strength, radius, threshold)
  ),
  outputPass: () => new OutputPass(),
};

// Dependency-injectable so tests can stub the composer/pass machinery under
// node, following the same pattern as createEnvironment above it in scene.js.
// Returns null when unsupported (see postProcessingSupported) so Scene falls
// back to renderer.render - the same philosophy as _envFailed.
//
// Pass order is exactly RenderPass -> UnrealBloomPass -> OutputPass. No
// vignette pass here: a vignette is a lens/print effect and belongs in display
// space (see the #vignette element in index.html), not baked into the HDR
// scene buffer this composer operates on.
export function createPostProcessing({
  renderer, scene, camera, bloom = BLOOM, factories = POST_FACTORIES,
} = {}) {
  if (!postProcessingSupported(renderer)) return null;

  // CSS pixels, not device pixels: EffectComposer.setSize (called from
  // Scene#_resize) multiplies whatever it's given by the pixel ratio it
  // captured at construction, and UnrealBloomPass's resolution is likewise
  // re-derived from that same setSize call - passing device pixels here would
  // double-apply the pixel ratio and size the bloom mip chain by dpr^2.
  const size = renderer.getSize(new THREE.Vector2());
  const samples = chooseSamples(size.width * size.height);

  const renderTarget = factories.renderTarget(size.width, size.height, {
    type: THREE.HalfFloatType,
    samples,
  });

  const composer = factories.composer(renderer, renderTarget);
  // EffectComposer clones renderTarget1 into renderTarget2, and
  // RenderTarget.copy copies `samples` along with it. Only the scene pass
  // (RenderPass, drawing into renderTarget1/writeBuffer) draws geometry that
  // benefits from multisampling; GL allocation is lazy, so zeroing
  // renderTarget2's sample count right after construction is free and halves
  // the MSAA allocation this composer holds.
  composer.renderTarget2.samples = 0;

  const renderPass = factories.renderPass(scene, camera);
  const resolution = new THREE.Vector2(size.width, size.height);
  const bloomPass = factories.bloomPass(resolution, bloom.strength, bloom.radius, bloom.threshold);
  // OutputPass reads renderer.toneMapping / outputColorSpace / toneMappingExposure
  // every frame, which is exactly what's needed here: RenderPass draws into a
  // composer target, and three forces NoToneMapping + LinearSRGBColorSpace for
  // every material program whenever renderer.getRenderTarget() !== null, so the
  // composer chain is linear, un-tone-mapped HDR until OutputPass terminates it.
  const outputPass = factories.outputPass();

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  return {
    composer, renderPass, bloomPass, outputPass,
  };
}
