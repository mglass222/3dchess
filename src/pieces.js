import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const PIECE_TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];

// Piece type -> model filename (Ernest Rudnicki "chess-3d" set, MIT).
const MODEL_FILE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const PIECE_SETS = {
  default: {
    key: 'default',
    label: 'Default',
    mode: 'separate-files',
    directory: 'models/Default',
    files: MODEL_FILE,
    rotations: { n: Math.PI / 2 },
  },
  downloaded: {
    key: 'downloaded',
    label: 'Downloaded',
    mode: 'combined-scene',
    file: 'models/Downloaded/realistic_chess_set_3d_model.glb',
    nodes: {
      p: 'White Pawn',
      n: 'White Horse Left',
      b: 'White Bishop Left',
      r: 'White Rook Left',
      q: 'White Queen',
      k: 'White King',
    },
    rotations: { n: -Math.PI / 2 },
  },
};

const DEFAULT_PIECE_SET = 'default';

function blendColor(base, grain, t) {
  return {
    r: Math.round(base.r + (grain.r - base.r) * t),
    g: Math.round(base.g + (grain.g - base.g) * t),
    b: Math.round(base.b + (grain.b - base.b) * t),
  };
}

function colorParts(hex) {
  return {
    r: (hex >> 16) & 255,
    g: (hex >> 8) & 255,
    b: hex & 255,
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

const TAU = Math.PI * 2;

function createWoodTexture(baseHex, grainHex, seed) {
  const size = 192;
  const data = new Uint8Array(size * size * 4);
  const base = colorParts(baseHex);
  const grain = colorParts(grainHex);

  // Frequencies expressed as whole cycles per texture so the map actually tiles
  // (a non-integer period never divides `size`, leaving a seam once contrast lands).
  const kFigureX = (TAU * 6) / size;
  const kFigureY = (TAU * 2) / size;
  const kFineX = (TAU * 20) / size;
  const kFineY = (TAU * 1) / size;
  const kPoreX = (TAU * 61) / size; // prime-ish cycle count avoids beating with the figure
  const kPoreY = (TAU * 3) / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const vertical = Math.sin(x * kFigureX + Math.sin(y * kFigureY + seed) * 2.1 + seed);
      const fine = Math.sin(x * kFineX + y * kFineY + seed * 2.4);
      const band = Math.max(0, Math.min(1, 0.5 + vertical * 0.36 + fine * 0.13));
      const color = blendColor(base, grain, band);

      // Multiplicative pore term so pores read as depth rather than a second colour;
      // the **6 keeps the lines thin instead of a sine wash.
      const pore = Math.max(0, Math.sin(x * kPoreX + Math.sin(y * kPoreY + seed) * 1.4));
      const shade = 1 - pore ** 6 * 0.24;

      const i = (y * size + x) * 4;
      data[i] = Math.round(color.r * shade);
      data[i + 1] = Math.round(color.g * shade);
      data[i + 2] = Math.round(color.b * shade);
      data[i + 3] = 255;
    }
  }

  const texture = typeof document !== 'undefined' && document.createElement
    ? new THREE.CanvasTexture(createTextureCanvas(data, size))
    : new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1); // scale now lives in the world-space UVs (applyWoodTextureCoordinates)
  texture.needsUpdate = true;
  return texture;
}

function createWoodMaterial({
  baseHex,
  grainHex,
  seed,
  roughness,
  metalness,
  clearcoat,
  clearcoatRoughness,
  sheen,
  sheenColor,
  sheenRoughness,
  envMapIntensity,
}) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: createWoodTexture(baseHex, grainHex, seed),
    roughness,
    metalness,
    clearcoat,
    clearcoatRoughness,
    sheen,
    sheenColor,
    sheenRoughness,
    envMapIntensity,
  });
  material.userData.woodGrain = { baseHex, grainHex, seed };
  return material;
}

// Shared, long-lived materials (one per color) applied to every piece clone.
const MATERIALS = {
  w: createWoodMaterial({
    baseHex: 0xe6d3b6,
    grainHex: 0xf2e3ca,
    seed: 0.8,
    roughness: 0.26,
    metalness: 0.02,
    clearcoat: 0.55,
    clearcoatRoughness: 0.30,
    sheen: 0.16,
    sheenColor: 0xffefd6,
    sheenRoughness: 0.52,
    envMapIntensity: 0.9,
  }),
  b: createWoodMaterial({
    baseHex: 0x2c65a8,
    // was 0x74a7df, whose luminance ratio against the base was 1.71 versus the
    // white pair's 1.073. That 2.4x mismatch was invisible while the UVs were
    // mis-scaled; once the projection was fixed and the grain actually resolved,
    // it read as marbled porcelain rather than stained wood. 0x3374c1 puts blue
    // at 1.15 — slightly above white, which a darker stain can carry.
    grainHex: 0x3374c1,
    seed: 4.1,
    roughness: 0.23,
    metalness: 0.04,
    clearcoat: 0.62,
    clearcoatRoughness: 0.28,
    sheen: 0.1,
    sheenColor: 0xb3d2f6,
    sheenRoughness: 0.58,
    envMapIntensity: 1.0,
  }),
};

// Decorrelate the blue grain from the white grain (was a geometry-side v-offset;
// moved to the texture so geometry stays identical between colours).
MATERIALS.b.map.offset.set(0.31, 0.17);

// --- Contact shadow: a decal parented into each piece group, grounding it on
// the board instead of letting it read as pasted on top. Parenting (rather than
// a separate ground layer) means placePiece/removePieceAt/clearPieces need zero
// bookkeeping changes: scene.remove(obj) takes the decal with it, and the
// geometry below is deliberately never flagged pieceInstanceGeometry, so
// disposePieceGeometries (scene.js) skips it like it does the MATERIALS above.
export const CONTACT_SHADOW_Y = 0.006; // above the board top (y=0), below the highlight rings (y=0.02)
// Fraction of total piece height sampled as "the base" when sizing the decal.
// Using the whole bounding box (the old approach) picks up the piece's widest
// point *anywhere* - a queen's crown, a knight's head - not where it actually
// touches the board, which is why every piece used to hit CONTACT_SHADOW_MAX
// regardless of its real footprint.
const CONTACT_SHADOW_BASE_BAND = 0.15;
const CONTACT_SHADOW_SPREAD = 1.4;     // decal diameter / piece BASE footprint diameter (bottom 15% of height)
const CONTACT_SHADOW_MAX = 0.94;       // never bleed onto a neighbouring square (squares are 1.0 wide)

// Shared and long-lived, like MATERIALS. Deliberately NOT flagged
// pieceInstanceGeometry — scene.js disposePieceGeometries must never free it.
const CONTACT_SHADOW_GEOMETRY = new THREE.PlaneGeometry(1, 1);

// Procedural radial falloff, sharp at the base with a long soft tail so the
// decal reads as occlusion rather than a sticker.
function createContactShadowAlphaTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const r = Math.min(1, Math.hypot(dx, dy));
      const falloff = Math.round(255 * (1 - r) ** 2.2);

      // TRAP: alphaMap samples the GREEN channel
      // (diffuseColor.a *= texture2D(alphaMap, vUv).g), not the alpha channel.
      // Write the falloff into all four channels so it works either way.
      const i = (y * size + x) * 4;
      data[i] = falloff;
      data[i + 1] = falloff;
      data[i + 2] = falloff;
      data[i + 3] = falloff;
    }
  }

  const texture = typeof document !== 'undefined' && document.createElement
    ? new THREE.CanvasTexture(createTextureCanvas(data, size))
    : new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  // Data map, not colour - no sRGB decode.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// MeshBasicMaterial is not isMeshStandardMaterial, so it is deliberately immune
// to the environment map: the blob keeps a fixed density regardless of IBL.
// depthWrite: false stops the decal punching a hole in the depth buffer.
const CONTACT_SHADOW_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x000000,
  alphaMap: createContactShadowAlphaTexture(),
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
});

// Widest x/z extent among vertices in the bottom CONTACT_SHADOW_BASE_BAND of
// the piece's height (box already computed by the caller) - i.e. the actual
// footprint touching the board, as opposed to the whole bounding box which
// can be dominated by a wider feature higher up.
function measureBaseDiameter(group, box) {
  const bandTop = box.min.y + (box.max.y - box.min.y) * CONTACT_SHADOW_BASE_BAND;
  let maxX = 0;
  let maxZ = 0;
  const position = new THREE.Vector3();

  // No isContactShadow check needed: addContactShadow measures before it adds
  // the decal, so a piece never carries one at this point.
  group.traverse((child) => {
    if (!child.isMesh) return;
    const positions = child.geometry?.attributes?.position;
    if (!positions) return;
    for (let i = 0; i < positions.count; i++) {
      position.fromBufferAttribute(positions, i);
      position.applyMatrix4(child.matrixWorld);
      if (position.y > bandTop) continue;
      maxX = Math.max(maxX, Math.abs(position.x));
      maxZ = Math.max(maxZ, Math.abs(position.z));
    }
  });

  // Degenerate fallback (no vertex fell inside the band): whole bounding box
  // beats a zero-diameter decal.
  return Math.max(maxX, maxZ) * 2 || Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
}

// Adds a ground-plane decal sized from `group`'s base footprint. Must be
// called after any traversal that sets castShadow = true on the piece's meshes:
// a transparent plane with castShadow = true renders into the shadow map as a
// solid disc, producing a hard black ring under every piece. The decal is
// radially symmetric, so per-piece rotation (e.g. the knight's rotation.y)
// needs no compensation.
function addContactShadow(group) {
  // Box3.setFromObject updates the whole hierarchy's matrixWorld, which
  // measureBaseDiameter below relies on to read vertices in group-local space.
  const box = new THREE.Box3().setFromObject(group);
  const baseDiameter = measureBaseDiameter(group, box);
  const diameter = Math.min(baseDiameter * CONTACT_SHADOW_SPREAD, CONTACT_SHADOW_MAX);

  const shadow = new THREE.Mesh(CONTACT_SHADOW_GEOMETRY, CONTACT_SHADOW_MATERIAL);
  shadow.name = 'contact-shadow';
  shadow.scale.set(diameter, diameter, 1);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = CONTACT_SHADOW_Y;
  shadow.castShadow = false;
  shadow.receiveShadow = false;
  // Boolean marker on the DECAL itself, distinct from the *Mesh* reference
  // stored at obj.userData.contactShadow on the piece group (see createPiece)
  // - two different things used to share the same key.
  shadow.userData.isContactShadow = true;
  // The pick plane already covers this footprint, and pickSquare traverses
  // piece children looking for userData.square - don't let the decal hit-test.
  shadow.raycast = () => {};

  group.add(shadow);
  return shadow;
}

// Sets the flag scene.js's disposePieceGeometries reads to decide which geometries
// it owns (per-piece clones) vs. shared templates it must never dispose.
function markPieceInstanceGeometry(geometry) {
  geometry.userData.pieceInstanceGeometry = true;
  return geometry;
}

export function getPieceMaterial(color) {
  return MATERIALS[color];
}

// Gives every piece material its own live envMap (see scene.js's
// applyEnvironmentMap for why envMapIntensity alone does nothing without
// one). MATERIALS.w/b are shared, long-lived singletons, and pieces load
// asynchronously, so a one-time scene traversal at startup would miss any
// piece created afterward - setting it here, once, on the shared materials
// covers every piece created before or after this call.
export function setPieceEnvironmentMap(texture) {
  for (const material of Object.values(MATERIALS)) {
    material.envMap = texture;
    material.needsUpdate = true;
  }
}

// Exported so tests can compute expected UV spans/seam pushes from these
// directly instead of duplicating the numbers.
export const GRAIN_ARC_SCALE = 1.25;
export const GRAIN_HEIGHT_SCALE = 0.5;
// Above this many post-unwrap vertices, skip the per-triangle seam fix: seam
// visibility scales with triangle size while the 3x vertex cost of toNonIndexed()
// scales inversely, and the Downloaded piece set is one 48MB GLB where a seam
// triangle is sub-pixel.
const SEAM_FIX_MAX_VERTICES = 60000;

// Arc length, not angle: du per unit of surface distance is constant, so texel
// density is uniform from the widest base to the narrowest neck. Degenerates to
// 0 on the axis of revolution, which is correct at a finial.
function grainU(x, z) {
  return (Math.atan2(z, x) * Math.hypot(x, z)) / GRAIN_ARC_SCALE;
}

// u is arc length (angle * radius), so the seam jump at atan2's +-PI branch cut is
// 2*PI*r for the radius of *that* vertex, not a constant. Per triangle, if the u-span
// is wider than half a revolution of arc, the triangle straddles the seam; push its
// low-u corners forward by their own 2*PI*r so the triangle stops wrapping around.
export function unwrapSeamTriangles(uvs, radii) {
  for (let tri = 0; tri < radii.length; tri += 3) {
    const us = [uvs[tri * 2], uvs[(tri + 1) * 2], uvs[(tri + 2) * 2]];
    const rs = [radii[tri], radii[tri + 1], radii[tri + 2]];
    const maxU = Math.max(us[0], us[1], us[2]);
    const minU = Math.min(us[0], us[1], us[2]);
    const halfTurn = (Math.PI * Math.max(rs[0], rs[1], rs[2])) / GRAIN_ARC_SCALE;
    if (maxU - minU <= halfTurn) continue; // ordinary triangle, doesn't cross the seam

    const mid = (maxU + minU) / 2;
    for (let k = 0; k < 3; k++) {
      if (us[k] < mid) {
        uvs[(tri + k) * 2] += (TAU * rs[k]) / GRAIN_ARC_SCALE;
      }
    }
  }
}

// `localToRoot` maps mesh-local vertices into piece-root space: the space
// normalizeModel grounds at y=0 and scales so 1 unit = 1 board square. Raw
// mesh-local coordinates are pre-scale, pre-rotation and differ per mesh
// (and, for the Downloaded set's combined scene, per baked ancestor
// transform) - using them directly used to produce UVs off by the piece's
// full model->world scale factor (~15x for the Default set) and inconsistent
// between piece sets.
function applyWoodTextureCoordinates(mesh, localToRoot) {
  const positionAttribute = mesh.geometry?.attributes?.position;
  if (!positionAttribute) return;

  const source = mesh.geometry;
  // Vertex count after a hypothetical toNonIndexed() split - each index becomes its
  // own vertex, so triangle-count * 3 either way.
  const splitVertexCount = source.index ? source.index.count : positionAttribute.count;
  const splitSeams = splitVertexCount <= SEAM_FIX_MAX_VERTICES;

  // FOOTGUN: BufferGeometry.toNonIndexed() returns `this` when already non-indexed.
  // Calling it unconditionally would bake these UVs into a shared template geometry
  // and flag it pieceInstanceGeometry, so disposePieceGeometries (scene.js) would
  // free it out from under every other piece on the first capture. Always branch on
  // source.index !== null and clone() otherwise.
  const geometry = splitSeams && source.index !== null
    ? source.toNonIndexed()
    : source.clone();
  markPieceInstanceGeometry(geometry);
  mesh.geometry = geometry;

  const positions = geometry.attributes.position;
  const uvs = new Float32Array(positions.count * 2);
  const radii = new Float32Array(positions.count);
  const position = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    position.fromBufferAttribute(positions, i);
    position.applyMatrix4(localToRoot);
    radii[i] = Math.hypot(position.x, position.z);
    uvs[i * 2] = grainU(position.x, position.z);
    // Height in piece-root space (see localToRoot above): normalizeModel
    // already grounds every template at y=0 and scales it to board-square
    // units, and once a piece is placed on the board this is also its world
    // height - so using it directly keeps grain scale consistent between a
    // pawn and a king, and between piece sets.
    uvs[i * 2 + 1] = position.y / GRAIN_HEIGHT_SCALE;
  }

  if (splitSeams) unwrapSeamTriangles(uvs, radii);

  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
}

// type -> normalized template Object3D (base at y=0, centered on x/z). Populated
// by loadPieces(); createPiece() clones these and marks per-piece geometry clones
// for disposal when the board removes them.
const templates = {};
let activePieceSet = PIECE_SETS[DEFAULT_PIECE_SET];
let loadPiecesId = 0;

const TARGET_KING_HEIGHT = 1.4; // world units (1 = one square); relative sizes preserved

function assetUrl(baseUrl, path) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${path}`;
}

function getPieceSet(key = DEFAULT_PIECE_SET) {
  const set = PIECE_SETS[key];
  if (!set) throw new Error(`unknown piece set: ${key}`);
  return set;
}

function nodeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findNodeByName(root, name) {
  let match = null;
  const target = nodeKey(name);
  root.traverse((child) => {
    if (match || nodeKey(child.name) !== target) return;
    match = child;
  });
  return match;
}

async function loadSeparateFiles(loader, set, baseUrl) {
  const raw = {};
  await Promise.all(
    PIECE_TYPES.map(async (type) => {
      const gltf = await loader.loadAsync(assetUrl(baseUrl, `${set.directory}/${set.files[type]}.glb`));
      raw[type] = gltf.scene;
    }),
  );
  return raw;
}

async function loadCombinedScene(loader, set, baseUrl) {
  const gltf = await loader.loadAsync(assetUrl(baseUrl, set.file));
  gltf.scene.updateMatrixWorld(true);
  const raw = {};
  for (const type of PIECE_TYPES) {
    const node = findNodeByName(gltf.scene, set.nodes[type]);
    if (!node) throw new Error(`piece set "${set.key}" is missing node "${set.nodes[type]}"`);
    raw[type] = cloneWithWorldTransform(node);
  }
  return raw;
}

function cloneWithWorldTransform(node) {
  node.updateWorldMatrix(true, false);
  const clone = node.clone(true);
  clone.matrix.copy(node.matrixWorld);
  clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
  clone.matrixAutoUpdate = true;
  clone.updateMatrixWorld(true);
  return clone;
}

// Load + normalize all six models once. Browser-only (GLTFLoader/fetch). Must be
// awaited before the first createPiece() call.
export async function loadPieces({
  baseUrl = import.meta.env.BASE_URL,
  set = DEFAULT_PIECE_SET,
  loader = new GLTFLoader(),
} = {}) {
  const nextPieceSet = getPieceSet(set);
  const requestId = ++loadPiecesId;
  const raw = nextPieceSet.mode === 'combined-scene'
    ? await loadCombinedScene(loader, nextPieceSet, baseUrl)
    : await loadSeparateFiles(loader, nextPieceSet, baseUrl);
  if (requestId !== loadPiecesId) throw new Error('piece load superseded');

  // One uniform scale derived from the king keeps relative piece heights correct.
  const kingBox = new THREE.Box3().setFromObject(raw.k);
  const scale = TARGET_KING_HEIGHT / (kingBox.max.y - kingBox.min.y);
  const nextTemplates = {};
  for (const type of PIECE_TYPES) nextTemplates[type] = normalizeModel(raw[type], scale);
  if (requestId !== loadPiecesId) throw new Error('piece load superseded');
  for (const type of PIECE_TYPES) templates[type] = nextTemplates[type];
  activePieceSet = nextPieceSet;
}

// Scale uniformly, then sit the object on y=0 and center it on x/z. Returns a Group.
export function normalizeModel(object3d, scale) {
  object3d.scale.multiplyScalar(scale);
  object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3d);
  object3d.position.x -= (box.min.x + box.max.x) / 2;
  object3d.position.z -= (box.min.z + box.max.z) / 2;
  object3d.position.y -= box.min.y;
  const group = new THREE.Group();
  group.add(object3d);
  return group;
}

// FOR TESTS ONLY: inject a template, bypassing GLB loading.
export function _setTemplate(type, object3d) {
  templates[type] = object3d;
}

// Synchronous: clone the loaded template and tint it. Returns an Object3D standing
// on y=0, tagged with userData {type, color}. Requires loadPieces() to have run.
export function createPiece(type, color) {
  const tpl = templates[type];
  if (!tpl) throw new Error(`pieces not loaded: call loadPieces() before createPiece('${type}')`);
  const obj = tpl.clone(true);
  obj.rotation.y += activePieceSet.rotations[type] ?? 0;
  // obj is unparented, so this computes matrixWorld as if obj were the scene
  // root - exactly the piece-root space applyWoodTextureCoordinates needs.
  // Required before reading any mesh's matrixWorld below.
  obj.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse((c) => {
    if (c.isMesh) {
      const localToRoot = new THREE.Matrix4().multiplyMatrices(rootInverse, c.matrixWorld);
      applyWoodTextureCoordinates(c, localToRoot);
      c.material = MATERIALS[color];
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  // Added after the traverse above (ordering is load-bearing - see
  // addContactShadow) and outside it, so the decal gets neither the piece
  // material/UVs nor a castShadow flag.
  const contactShadow = addContactShadow(obj);
  obj.userData = { type, color, contactShadow };
  return obj;
}
