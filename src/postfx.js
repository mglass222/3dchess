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
// - 0.000090537; b = v*(0.983729*v + 0.432951) + 0.238081; return a/b. Applied
// per-channel, componentwise, by both the scalar neutral-axis path just below
// (acesFilmicLuminance) and the full vector path further down
// (acesFilmicToneMapRGB) - GLSL's RRTAndODTFit(vec3) is itself just this same
// scalar curve applied to each channel, sandwiched between the
// ACESInputMat/ACESOutputMat rotations in the real shader (see those matrices'
// comment below).
function rrtAndOdtFit(x) {
  const a = x * (x + 0.0245786) - 0.000090537;
  const b = x * (0.983729 * x + 0.4329510) + 0.238081;
  return a / b;
}

// d/dx of rrtAndOdtFit, via the quotient rule. Only needed by the Newton solve
// in invertAcesFilmicToneMapRGB below - the scalar neutral-axis path has no use
// for a derivative, since acesFilmicLuminance is inverted by bisection instead.
function rrtAndOdtFitDerivative(x) {
  const a = x * (x + 0.0245786) - 0.000090537;
  const b = x * (0.983729 * x + 0.4329510) + 0.238081;
  const aPrime = 2 * x + 0.0245786;
  const bPrime = 2 * 0.983729 * x + 0.4329510;
  return (aPrime * b - a * bPrime) / (b * b);
}

// ACESInputMat/ACESOutputMat, transcribed from tonemapping_pars_fragment.glsl.js
// (node_modules/three/src/renderers/shaders/ShaderChunk/) as row-major 3x3
// arrays. GLSL's mat3(c0, c1, c2) constructor takes COLUMN vectors, and
// `mat * v` is a column-major product - so for a GLSL matrix built from column
// arguments c0/c1/c2, row i of the equivalent row-major matrix is
// [c0[i], c1[i], c2[i]]. Verified against the shader source directly, not just
// asserted here.
//
// Each ACES_INPUT row sums to 1.0 (row 0: 0.59719 + 0.35458 + 0.04823 = 1.0;
// same for rows 1 and 2) and each ACES_OUTPUT row sums to ~1.0. That identity
// is exactly why acesFilmicLuminance (the scalar port of RRTAndODTFit alone,
// with no matrices) reproduces the real shader exactly on the neutral axis
// (r === g === b) and ONLY there: for a neutral input (k, k, k), matrix *
// (k, k, k) = (k * rowSum, k * rowSum, k * rowSum) = (k, k, k) unchanged, so
// both matrices vanish and only the RRTAndODTFit curve remains. Off the
// neutral axis the matrices actively mix channels, the identity no longer
// holds, and a saturated color needs the full vector transform
// (acesFilmicToneMapRGB) instead - see its comment below for when to reach for
// which.
const ACES_INPUT_MAT = [
  [0.59719, 0.35458, 0.04823],
  [0.07600, 0.90834, 0.01566],
  [0.02840, 0.13383, 0.83777],
];
const ACES_OUTPUT_MAT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

function applyMat3(mat, v) {
  return [
    mat[0][0] * v[0] + mat[0][1] * v[1] + mat[0][2] * v[2],
    mat[1][0] * v[0] + mat[1][1] * v[1] + mat[1][2] * v[2],
    mat[2][0] * v[0] + mat[2][1] * v[1] + mat[2][2] * v[2],
  ];
}

// Plain 3x3 * 3x3 product (A * B), row-major. Only used to assemble the
// Jacobian in jacobianAt below.
function multMat3(a, b) {
  const result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[i][k] * b[k][j];
      result[i][j] = sum;
    }
  }
  return result;
}

function linearToSRGB(c) {
  return srgbEncode(Math.min(1, Math.max(0, c)));
}

// The sRGB OETF with no clamp - linearToSRGB's formula, factored out so
// invertAcesFilmicToneMapRGB's solved scene-linear values can be encoded back
// to a hex fraction WITHOUT silently clamping an out-of-[0,1] result, the same
// way bisectInverse's [0, 4] search range exposes rather than hides a channel
// that needs more than input=1 to hit its target. Only called with c >= 0
// (Newton's y is clamped non-negative each step), so the negative-input branch
// of the real OETF is never exercised and isn't implemented here.
function srgbEncode(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

// Inverse of linearToSRGB. Exported (unlike linearToSRGB) because
// preToneMapCompensate's round trip - and its tests - need to reason about the
// decode half explicitly.
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
//
// USE THIS (not acesFilmicToneMapRGB below) whenever all three channels are
// equal, or the caller only cares about luminance on the neutral axis - the
// BLOOM threshold reasoning and the board/piece luminance measurements both
// qualify. It's the same math as the vector path, just without reconstructing
// the ACES matrices that are identity there anyway (see their comment above).
// Reach for acesFilmicToneMapRGB instead the moment r, g and b actually differ
// and the channel-mixing the matrices perform matters - e.g. inverting a
// saturated theme color in preToneMapCompensate.
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

// Full vector port of THREE.ACESFilmicToneMapping (tonemapping_pars_fragment.
// glsl.js): scale by exposure/0.6, rotate into ACES AP1 via ACES_INPUT_MAT,
// apply the RRTAndODTFit curve to each channel, rotate back via
// ACES_OUTPUT_MAT, then saturate - exactly `color = ACESFilmicToneMapping(
// color)` in the real shader, for a general (possibly saturated) linear RGB
// triple where the matrices no longer cancel to identity. Returns tone-mapped
// LINEAR RGB, still needing the sRGB encode (linearToSRGB) applied by whatever
// calls this - see displayFromSceneLinearRGB just below, or
// acesFilmicLuminance's comment above for when the scalar path suffices
// instead.
export function acesFilmicToneMapRGB(rgbLinear, exposure = 1) {
  const k = exposure / 0.6;
  const scaled = rgbLinear.map((c) => c * k);
  const acesIn = applyMat3(ACES_INPUT_MAT, scaled);
  const fitted = acesIn.map(rrtAndOdtFit);
  const acesOut = applyMat3(ACES_OUTPUT_MAT, fitted);
  return acesOut.map((c) => Math.min(1, Math.max(0, c)));
}

// Vector counterpart to displayFromSceneLinear above: ACES-tonemaps all three
// channels together (so the matrices actually mix them, unlike three
// independent scalar calls) and sRGB-encodes each result. Exported so tests
// (and any future caller) can round-trip a compensated color through the same
// full chain the composer applies, without reimplementing it.
export function displayFromSceneLinearRGB(rgbLinear, exposure = 1) {
  return acesFilmicToneMapRGB(rgbLinear, exposure).map((c) => linearToSRGB(c));
}

// d(acesFilmicToneMapRGB)/d(rgbLinear) at a point, as a row-major 3x3 array -
// the Jacobian invertAcesFilmicToneMapRGB's Newton solve needs. Chain rule
// through the same three steps as the forward function: out = ACES_OUTPUT_MAT
// * fitted, fitted_m = rrtAndOdtFit(u_m), u = k * ACES_INPUT_MAT * rgbLinear.
// So d(out_i)/d(rgbLinear_j) = sum_m ACES_OUTPUT_MAT[i][m] *
// rrtAndOdtFitDerivative(u_m) * k * ACES_INPUT_MAT[m][j], i.e.
// J = ACES_OUTPUT_MAT * diag(rrtAndOdtFitDerivative(u)) * k * ACES_INPUT_MAT.
// Deliberately NOT clamped the way the forward function's return value is -
// saturate()'s clamp would zero the derivative outside [0, 1] and break
// Newton right where a not-yet-converged iterate needs it most.
function jacobianAt(rgbLinear, exposure) {
  const k = exposure / 0.6;
  const scaled = rgbLinear.map((c) => c * k);
  const u = applyMat3(ACES_INPUT_MAT, scaled);
  const fPrime = u.map(rrtAndOdtFitDerivative);
  const scaledInput = ACES_INPUT_MAT.map((row, m) => row.map((v) => v * fPrime[m] * k));
  return multMat3(ACES_OUTPUT_MAT, scaledInput);
}

// Solves the 3x3 linear system `matrix * result = vector` via Cramer's rule -
// small and exact enough for the one-off solve Newton's step needs each
// iteration, without pulling in a linear-algebra dependency for a single 3x3.
// Returns null (rather than Infinity/NaN) on a singular matrix so callers can
// bail out instead of propagating garbage - see invertAcesFilmicToneMapRGB.
function solve3x3(matrix, vector) {
  const det3 = (m) => (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
  const det = det3(matrix);
  if (Math.abs(det) < 1e-12) return null;
  return [0, 1, 2].map((col) => {
    const replaced = matrix.map((row) => row.slice());
    for (let i = 0; i < 3; i++) replaced[i][col] = vector[i];
    return det3(replaced) / det;
  });
}

// Monotonic increasing (rrtAndOdtFit's curve is), so bisection converges to
// the unique root. Upper bound is generous (not clamped to 1) so a value that
// needs to exceed authorable range is exposed as an out-of-[0,1] result rather
// than silently clamped - see invertAcesFilmicToneMapRGB, which uses this only
// to seed its Newton solve, and preToneMapCompensate's callers, which are
// expected to check the final result themselves.
function bisectInverse(target, forward, exposure) {
  let lo = 0;
  let hi = 4;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (forward(mid, exposure) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Inverts acesFilmicToneMapRGB as a vector - not per channel independently -
// so the ACES matrices' cross-channel mixing (see their comment above) is
// accounted for rather than approximated away. Seeds each channel from the
// scalar per-channel bisection against acesFilmicLuminance (already a good
// approximation, and exact on the neutral axis), then runs Newton's method on
// the full 3x3 system using the analytic Jacobian from jacobianAt: each step
// solves `J * delta = forward(sceneLinear) - targetLinear` and moves
// `sceneLinear -= delta`, clamped non-negative (scene-linear can't be
// negative). Converged in 1-2 Newton steps for all ten current theme
// endpoints - quadratic convergence near the root, unlike a naive per-channel
// multiplicative correction, which this codebase's git history shows
// oscillating without settling for very dark, unevenly-saturated colors (e.g.
// cosmos's near-black top). Callers MUST check `converged` themselves rather
// than assume it - see preToneMapCompensate below, and the tests, which assert
// it for every theme endpoint.
export function invertAcesFilmicToneMapRGB(targetLinear, exposure = 1, {
  maxIterations = 12, tolerance = 1e-5,
} = {}) {
  let sceneLinear = targetLinear.map((t) => bisectInverse(t, acesFilmicLuminance, exposure));
  let residual = Infinity;
  let iterations = 0;

  for (let i = 0; i <= maxIterations; i++) {
    const forward = acesFilmicToneMapRGB(sceneLinear, exposure);
    const error = forward.map((f, k) => f - targetLinear[k]);
    residual = Math.max(...error.map(Math.abs));
    iterations = i;
    if (residual < tolerance || i === maxIterations) break;

    const jacobian = jacobianAt(sceneLinear, exposure);
    const delta = solve3x3(jacobian, error);
    if (!delta) break;
    sceneLinear = sceneLinear.map((c, k) => Math.max(0, c - delta[k]));
  }

  return {
    sceneLinear, residual, iterations, converged: residual < tolerance,
  };
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
// background it previously bypassed - see displayFromSceneLinearRGB above),
// the color the composer actually displays still matches the ORIGINAL hex the
// direct render path shows unmodified. Inverts the real vector ACES transform
// (invertAcesFilmicToneMapRGB), not a per-channel scalar approximation: the
// ACESInputMat/ACESOutputMat matrices only cancel to identity on the neutral
// axis (see the ACES_INPUT_MAT/ACES_OUTPUT_MAT comment above), so a saturated
// color like dusk's bottom needs the cross-channel mixing accounted for or
// the compensation drifts.
//
// Returns the compensated color as both a hex string and the raw [0,1]
// fractions per channel - callers (Scene.setTheme via themes.js) should check
// the fractions stay within [0, 1] themselves rather than trust a silent clamp,
// since a channel needing more than input=1 to hit its target means that
// endpoint clips and should be reported, not hidden. Throws if the Newton
// solve fails to converge, since a compensated color this codebase can't
// verify is worse than a loud failure - see invertAcesFilmicToneMapRGB's
// comment; this has not happened for any of the current theme endpoints.
export function preToneMapCompensate(hex, exposure = 1) {
  const targetDisplay = hexToChannels(hex).map((c) => c / 255);
  const targetLinear = targetDisplay.map((c) => sRGBToLinear(c));
  const {
    sceneLinear, converged, residual, iterations,
  } = invertAcesFilmicToneMapRGB(targetLinear, exposure);

  if (!converged) {
    throw new Error(
      `preToneMapCompensate: Newton solve did not converge for ${hex} `
      + `(residual ${residual} after ${iterations} iterations)`,
    );
  }

  const channels = sceneLinear.map((c) => srgbEncode(c));
  return {
    hex: channelsToHex(channels.map((c) => c * 255)),
    channels,
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
