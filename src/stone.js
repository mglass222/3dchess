import * as THREE from 'three';

// Procedural stone noise + texture maps for the table (slab/bevel/pedestal/base
// in scene.js's createStoneTable). This module only produces the noise field,
// the three texture maps, and the UV-retiling helpers — it is NOT wired into
// createStoneMaterial/createStoneTable yet (that's a later pass, A2). See
// src/pieces.js's createWoodTexture for the sibling precedent this follows:
// same node/browser texture branch, same "one shared drift/warp, not one per
// layer" lesson, same bake-hue-into-map-not-material.color reasoning.

export const STONE_BASE = 0x7d7868; // the calibrated hue, moved out of material.color
export const STONE_ROUGHNESS = 0.98; // multiplies roughnessMap (mean ~0.96) -> effective ~0.94, see below
export const STONE_UNITS_PER_TILE = 5.0;

const SIZE = 512; // texel resolution of the height field / derived maps

// --- Rule 1: value noise on an integer lattice, no sin() anywhere. ---------
//
// hash2 is a MurmurHash3-style integer finalizer (fmix32), not a trig hash: x
// and y each go through Math.imul with their own large odd constant and are
// combined with XOR, which is commutative and gives neither axis a preferred
// direction. This is the "lattice hash is symmetric" property Rule 1 asks for.
function hash2(ix, iy, seed) {
  const s = Math.imul((seed * 1000) | 0, 2654435761);
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ s;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // [0, 1)
}

// Rule 3: lattice coordinates taken mod `period` so the field is EXACTLY
// periodic (not cross-faded, not mirrored - see the module doc comment at the
// top of this file / the task's Rule 3 for why those two alternatives are
// exactly the directional artifacts being avoided here).
function periodicNoise(x, y, period, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx); // smoothstep, same formula on both axes
  const v = fy * fy * (3 - 2 * fy);
  const wrap = (n) => ((n % period) + period) % period;
  const x0 = wrap(ix);
  const x1 = wrap(ix + 1);
  const y0 = wrap(iy);
  const y1 = wrap(iy + 1);

  const h00 = hash2(x0, y0, seed);
  const h10 = hash2(x1, y0, seed);
  const h01 = hash2(x0, y1, seed);
  const h11 = hash2(x1, y1, seed);

  const nx0 = h00 + (h10 - h00) * u;
  const nx1 = h01 + (h11 - h01) * u;
  return nx0 + (nx1 - nx0) * v;
}

const OCTAVES = 5;
const BASE_PERIOD = 4; // lattice cells across the tile at octave 0; doubles per octave (4,8,16,32,64)
const WARP = 0.9; // warp magnitude, in octave-0 lattice cells

// Rule 2 note on amplitude schedule: a classic fBm (amplitude halving each
// octave: 1, 0.5, 0.25, ...) puts ~52% of the field's energy in octave 0 - the
// single largest, most memorable feature, which is exactly what would let an
// eye count repeats across the 10.4-unit slab (four STONE_UNITS_PER_TILE=5
// tiles). Starting lower (0.55) and decaying SLOWER (persistence 0.62 instead
// of 0.5) shifts more of the energy into the higher, finer octaves instead:
//   amplitudes: 0.55, 0.341, 0.2114, 0.131, 0.0812  (sum 1.3146)
//   octave-0 share: 0.55 / 1.3146 = 41.8%  (vs 51.6% for the classic schedule)
const AMPLITUDE_START = 0.55;
const PERSISTENCE = 0.62;

// Height field, value in [0, 1). u, v are normalized tile coordinates in
// [0, 1). ONE warp vector, sampled once from the lowest octave (BASE_PERIOD),
// is applied to every octave - never a per-octave warp, and never a sin()
// veining layer on top (see the module doc comment: that combination is
// exactly what produced the herringbone artifact in src/pieces.js's history).
export function stoneHeight(u, v, seed) {
  const wx = periodicNoise(u * BASE_PERIOD, v * BASE_PERIOD, BASE_PERIOD, seed + 11) - 0.5;
  const wy = periodicNoise(u * BASE_PERIOD, v * BASE_PERIOD, BASE_PERIOD, seed + 23) - 0.5;

  let sum = 0;
  let ampSum = 0;
  let amplitude = AMPLITUDE_START;
  for (let o = 0; o < OCTAVES; o++) {
    const scale = 2 ** o; // period doubles per octave, staying an integer divisor of SIZE
    const period = BASE_PERIOD * scale;
    // The warp field was sampled at BASE_PERIOD frequency (units of "one
    // BASE_PERIOD cell"). To apply the SAME physical-space displacement to a
    // higher-frequency octave, express it in THAT octave's own lattice units:
    // a BASE_PERIOD-cell fraction covers `scale` times as many of this
    // octave's (finer) cells, so the offset scales by `scale` too.
    const lx = u * period + wx * WARP * scale;
    const ly = v * period + wy * WARP * scale;
    const n = periodicNoise(lx, ly, period, seed + o * 37);
    sum += n * amplitude;
    ampSum += amplitude;
    amplitude *= PERSISTENCE;
  }

  const h = sum / ampSum;
  return Math.min(1, Math.max(0, h));
}

const STONE_SEED = 7.3; // fixed internal seed; module-level so createStoneMaps() is deterministic

function colorParts(hex) {
  return {
    r: (hex >> 16) & 255,
    g: (hex >> 8) & 255,
    b: hex & 255,
  };
}

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function blendColor(a, b, t) {
  return {
    r: clamp255(a.r + (b.r - a.r) * t),
    g: clamp255(a.g + (b.g - a.g) * t),
    b: clamp255(a.b + (b.b - a.b) * t),
  };
}

function createTextureCanvas(data, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(size, size);
  imageData.data.set(data);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

// Same node/browser branch as pieces.js's createWoodTexture. test/scene.test.js
// calls createStoneMaterial()/createStoneTable() directly under node (no DOM),
// so getting this branch wrong turns the whole green suite red.
function toTexture(data, size, colorSpace) {
  const texture = typeof document !== 'undefined' && document.createElement
    ? new THREE.CanvasTexture(createTextureCanvas(data, size))
    : new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

// Amount the albedo lightens/darkens either side of STONE_BASE. Symmetric by
// construction (same delta up and down), which is the point: material.color
// multiplies map, and an 8-bit map can only ever darken from white, so the
// only way to get a symmetric +/- variation is to bake the hue into the map
// itself and leave material.color at 0xffffff (see createWoodMaterial in
// pieces.js - identical reasoning).
const ALBEDO_DELTA = 24;

// roughnessMap multiplies material.roughness (STONE_ROUGHNESS). Kept to a
// tight range - the albedo's 0.8-1.0-ish swing would, if reused here, swing
// effective roughness across 0.75-0.94, far more variance than a stone
// surface actually has. mean(roughnessMap) ~= 0.96 (measured; see report),
// so STONE_ROUGHNESS 0.98 * 0.96 ~= 0.94, matching the flat material's
// original calibrated 0.94 (0x7d7868 @ roughness 0.94 in the old
// createStoneMaterial).
const ROUGH_MID = 0.96;
const ROUGH_SWING = 0.28;
const ROUGH_MIN = 0.86;
const ROUGH_MAX = 1.0;

// Central-difference normal strength. Small: the height field varies gently
// texel-to-texel (5-octave fBm at 512^2), so this is tuned to keep z
// comfortably > 0.5 (test 5) while still giving a visible, non-flat bump.
const NORMAL_STRENGTH = 6.0;

let cachedMaps = null;

// { map, normalMap, roughnessMap }, memoized at module scope - 512*512 texels
// times 5 octaves (plus the shared warp) is fine computed once, not fine
// recomputed by every test/material that asks for it (pieces.js's MATERIALS
// precedent).
export function createStoneMaps() {
  if (cachedMaps) return cachedMaps;

  const height = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      height[y * SIZE + x] = stoneHeight(u, v, STONE_SEED);
    }
  }

  const wrapIndex = (n) => ((n % SIZE) + SIZE) % SIZE;
  const at = (x, y) => height[wrapIndex(y) * SIZE + wrapIndex(x)];

  const base = colorParts(STONE_BASE);
  const light = {
    r: clamp255(base.r + ALBEDO_DELTA),
    g: clamp255(base.g + ALBEDO_DELTA),
    b: clamp255(base.b + ALBEDO_DELTA),
  };
  const dark = {
    r: clamp255(base.r - ALBEDO_DELTA),
    g: clamp255(base.g - ALBEDO_DELTA),
    b: clamp255(base.b - ALBEDO_DELTA),
  };

  const albedoData = new Uint8Array(SIZE * SIZE * 4);
  const normalData = new Uint8Array(SIZE * SIZE * 4);
  const roughData = new Uint8Array(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const h = height[y * SIZE + x];

      const color = blendColor(dark, light, h);
      albedoData[i] = color.r;
      albedoData[i + 1] = color.g;
      albedoData[i + 2] = color.b;
      albedoData[i + 3] = 255;

      // Central differences with WRAPPED indices: the field is periodic, so
      // its derivative must be sampled periodically too, or the seam Rule 3
      // designed out would reappear in the derivative even though the height
      // field itself matches at the border.
      const hl = at(x - 1, y);
      const hr = at(x + 1, y);
      const hd = at(x, y - 1);
      const hu = at(x, y + 1);
      const dx = (hr - hl) * NORMAL_STRENGTH;
      const dy = (hu - hd) * NORMAL_STRENGTH;
      const nz = 1;
      const len = Math.hypot(dx, dy, nz) || 1;
      const nx = -dx / len;
      const ny = -dy / len;
      const nzN = nz / len;
      normalData[i] = clamp255((nx * 0.5 + 0.5) * 255);
      normalData[i + 1] = clamp255((ny * 0.5 + 0.5) * 255);
      normalData[i + 2] = clamp255((nzN * 0.5 + 0.5) * 255);
      normalData[i + 3] = 255;

      const roughness = Math.min(ROUGH_MAX, Math.max(ROUGH_MIN, ROUGH_MID + (h - 0.5) * ROUGH_SWING));
      const rv = clamp255(roughness * 255);
      roughData[i] = rv;
      roughData[i + 1] = rv;
      roughData[i + 2] = rv;
      roughData[i + 3] = 255;
    }
  }

  const map = toTexture(albedoData, SIZE, THREE.SRGBColorSpace);
  const normalMap = toTexture(normalData, SIZE, THREE.NoColorSpace);
  const roughnessMap = toTexture(roughData, SIZE, THREE.NoColorSpace);

  cachedMaps = { map, normalMap, roughnessMap };
  return cachedMaps;
}

// --- UV retiling ------------------------------------------------------------
//
// BoxGeometry gives every face the same 0..1 UV span regardless of that
// face's actual world size (verified against the installed three source,
// node_modules/three/src/geometries/BoxGeometry.js: six buildPlane() calls in
// order px, nx, py, ny, pz, nz, each emitting 4 vertices - since our table
// meshes use default segment counts (1,1,1) that's 24 vertices total - with
// uvs.push(ix/gridX), uvs.push(1-iy/gridY), i.e. always 0..1 per face). One
// `repeat` that looks right on the 10.4x10.4 top face stretches the
// 10.4x0.42 side faces ~25:1. Rewritten here from each vertex's own
// world-space position projected onto that face's plane (identified from its
// normal, so this needs no assumption about vertex order beyond "faces are
// axis-aligned", which BoxGeometry always is), divided by unitsPerTile, so
// `repeat` can stay 1 and every face - and all four stone meshes sharing one
// material - keep uniform texel density.
export function retileBoxUV(geometry, unitsPerTile, offset = 0) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!position || !normal) return;

  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    let u;
    let v;
    if (nx >= ny && nx >= nz) {
      // face normal along x (px/nx) -> plane spans y, z
      u = y;
      v = z;
    } else if (ny >= nx && ny >= nz) {
      // face normal along y (py/ny) -> plane spans x, z
      u = x;
      v = z;
    } else {
      // face normal along z (pz/nz) -> plane spans x, y
      u = x;
      v = y;
    }

    uv[i * 2] = u / unitsPerTile + offset;
    uv[i * 2 + 1] = v / unitsPerTile + offset;
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}

// CylinderGeometry (verified against node_modules/three/src/geometries/
// CylinderGeometry.js) builds the torso first - (radialSegments+1) *
// (heightSegments+1) vertices, uv.x = x/radialSegments (an unwrapped angular
// fraction, column index over radialSegments - safe to reuse directly, no
// atan2 branch-cut to fix, unlike pieces.js's grainU) - then, if present, the
// top cap (radialSegments center vertices + (radialSegments+1) ring
// vertices), then the bottom cap in the same layout. It emits three groups
// (0 torso, 1 top cap, 2 bottom cap), matching the source's generateTorso/
// generateCap(true)/generateCap(false) call order.
//
// The torso wraps circumference (density varies with radius - a frustum, not
// a cylinder, on the bevel/pedestal/base pieces) while the caps are a radial
// disc (planar, like a box face). One `repeat` can't fit both, so:
//   - torso u = arc length (angleFraction * thetaLength * actual per-vertex
//     radius), NOT angle alone - a wide top ring and a narrow bottom ring
//     need different u-density for the same angular step to read as the same
//     texel size.
//   - torso v = fraction of the way down the slant (0 at the top ring, 1 at
//     the bottom) times the true slant length hypot(height, radiusTop -
//     radiusBottom) - the straight-line height is NOT the surface distance
//     between the two rings once the radii differ (e.g. the bevel mesh is
//     shallow and steeply tapered: height 0.28 vs slant ~0.375, a ~34% gap).
//   - caps u, v = local x, z directly, exactly like a box's flat top/bottom.
export function retileCylinderUV(geometry, unitsPerTile, offset = 0) {
  const params = geometry.parameters;
  if (!params) return;
  const {
    radiusTop, radiusBottom, height, radialSegments, heightSegments = 1, thetaLength = Math.PI * 2,
  } = params;

  const position = geometry.attributes.position;
  const existingUV = geometry.attributes.uv;
  if (!position || !existingUV) return;

  const torsoCount = (radialSegments + 1) * (heightSegments + 1);
  const hasTop = radiusTop > 0;
  const hasBottom = radiusBottom > 0;
  const capCount = 2 * radialSegments + 1;
  const topStart = torsoCount;
  const topEnd = topStart + (hasTop ? capCount : 0);

  const slantLength = Math.hypot(height, radiusTop - radiusBottom);

  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);

    let u;
    let v;
    if (i < torsoCount) {
      const radius = Math.hypot(x, z);
      const angleFraction = existingUV.getX(i); // 0..1, unwrapped (column / radialSegments)
      const rowFractionFromTop = (height / 2 - y) / height; // 0 at top ring, 1 at bottom ring
      u = angleFraction * thetaLength * radius;
      v = rowFractionFromTop * slantLength;
    } else if (i < topEnd) {
      u = x;
      v = z;
    } else {
      u = x;
      v = z;
    }

    uv[i * 2] = u / unitsPerTile + offset;
    uv[i * 2 + 1] = v / unitsPerTile + offset;
  }

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
}
