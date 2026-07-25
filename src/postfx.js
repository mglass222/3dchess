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
// 0.90 clears the BOARD comfortably (2.7x its p95) but NOT the pieces, and that
// distinction is the whole tuning story: the p95 is a whole-frame statistic
// dominated by the board, while the glossy white pieces sit far above it. At
// 0.90 large areas of every white piece crossed the threshold and the pieces
// rendered with hazy halos instead of a lacquered edge - verified by A/B
// against the no-composer path. 1.30 puts the threshold above the pieces' lit
// surfaces, so nothing in the scene blooms on its own.
//
// That is deliberate: bloom here is diegetic, not atmospheric. The only things
// meant to glow are the check and capture markers, which are authored with
// above-1.0 linear colour in markers.js specifically to cross this line. If you
// raise strength or lower threshold to "see more bloom", you will get the piece
// halos back - author the marker colours higher instead.
export const BLOOM = { strength: 0.18, radius: 0.35, threshold: 1.30 };
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

// Inverse of linearToSRGB. Exported (unlike linearToSRGB) because
// preToneMapCompensate's round trip - and its tests - need to reason about the
// decode half explicitly; see composerDisplayFromHexFraction below.
export function sRGBToLinear(c) {
  const clamped = Math.min(1, Math.max(0, c));
  return clamped <= 0.04045
    ? clamped / 12.92
    : ((clamped + 0.055) / 1.055) ** 2.4;
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

// A CanvasTexture tagged SRGBColorSpace (src/themes.js's gradient) is uploaded
// with an sRGB internal format, so the GPU sampler hardware-decodes it to
// scene-linear on every fetch - the same decode sRGBToLinear performs above.
// WebGLBackground sets that plane's material.toneMapped = false whenever the
// background texture's transfer function is SRGB (see three's
// WebGLBackground.js), so on the direct renderer.render() path the decode and
// colorspace_fragment's re-encode cancel out exactly: whatever hex is authored
// is what lands on screen. The composer's RenderPass forces NoToneMapping /
// LinearSRGBColorSpace while a render target is bound (see createPostProcessing
// above), so that per-material toneMapped flag never gets consulted - the
// decoded linear texel is written to the HDR target as-is, and OutputPass later
// tonemaps and re-encodes the whole buffer, background pixels included. Net
// effect: composerDisplayed(hex) = displayFromSceneLinear(sRGBToLinear(hex)),
// one extra decode/tonemap pass the direct path never applies.
function composerDisplayFromHexFraction(hexFraction, exposure = 1) {
  return displayFromSceneLinear(sRGBToLinear(hexFraction), exposure);
}

// Monotonic increasing (sRGB decode, ACES tonemap, and sRGB encode all are),
// so bisection converges to the unique root. Upper bound is generous (not
// clamped to 1) so a channel that needs to exceed authorable range is exposed
// as an out-of-[0,1] result rather than silently clamped - see
// preToneMapCompensate's callers, which are expected to check that themselves.
function bisectInverse(target, forward, exposure) {
  let lo = 0;
  let hi = 4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (forward(mid, exposure) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function hexToChannels(hex) {
  const value = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channelsToHex(channels) {
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

// Pre-compensates a display-space hex color so that, once it is authored into
// a gradient canvas and rendered through the composer (which tonemaps the
// background it previously bypassed - see composerDisplayFromHexFraction),
// the color the composer actually displays still matches the ORIGINAL hex the
// direct render path shows unmodified. Per channel, independently: the
// RRTAndODTFit has no closed-form inverse, and the ACESInputMat/ACESOutputMat
// matrices this scalar port omits are near-identity on the neutral axis (see
// rrtAndOdtFit's comment) - close enough off-axis, for the mild, mostly-neutral
// theme colors here, that per-channel bisection matches what a full 3x3-matrix
// inversion would give.
//
// Returns the compensated color as both a hex string and the raw [0,1]
// fractions per channel - callers (Scene.setTheme via themes.js) should check
// the fractions stay within [0, 1] themselves rather than trust a silent clamp,
// since a channel needing more than input=1 to hit its target means that
// endpoint clips and should be reported, not hidden.
export function preToneMapCompensate(hex, exposure = 1) {
  const channels = hexToChannels(hex).map((c) => c / 255);
  const compensated = channels.map(
    (target) => bisectInverse(target, composerDisplayFromHexFraction, exposure),
  );
  return {
    hex: channelsToHex(compensated.map((c) => c * 255)),
    channels: compensated,
  };
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
