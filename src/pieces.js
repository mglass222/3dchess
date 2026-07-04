import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const PIECE_TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];

// Piece type -> model filename (Ernest Rudnicki "chess-3d" set, MIT).
const MODEL_FILE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

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

function createWoodTexture(baseHex, grainHex, seed) {
  const size = 192;
  const data = new Uint8Array(size * size * 4);
  const base = colorParts(baseHex);
  const grain = colorParts(grainHex);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const vertical = Math.sin(x * 0.18 + Math.sin(y * 0.05 + seed) * 2.1 + seed);
      const fine = Math.sin(x * 0.66 + y * 0.045 + seed * 2.4);
      const knot = Math.sin(Math.hypot(x - 108, y - 74) * 0.09 + seed * 1.5);
      const band = Math.max(0, Math.min(1, 0.5 + vertical * 0.12 + fine * 0.035 + knot * 0.045));
      const color = blendColor(base, grain, band);
      const i = (y * size + x) * 4;
      data[i] = color.r;
      data[i + 1] = color.g;
      data[i + 2] = color.b;
      data[i + 3] = 255;
    }
  }

  const texture = typeof document !== 'undefined' && document.createElement
    ? new THREE.CanvasTexture(createTextureCanvas(data, size))
    : new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.78, 1.75);
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
  });
  material.userData.woodGrain = { baseHex, grainHex, seed };
  return material;
}

// Shared, long-lived materials (one per color) applied to every piece clone.
const MATERIALS = {
  w: createWoodMaterial({
    baseHex: 0xd1a25d,
    grainHex: 0xe2bd7d,
    seed: 0.8,
    roughness: 0.26,
    metalness: 0.02,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    sheen: 0.16,
    sheenColor: 0xf8d18e,
    sheenRoughness: 0.52,
  }),
  b: createWoodMaterial({
    baseHex: 0x12100d,
    grainHex: 0x32261d,
    seed: 4.1,
    roughness: 0.23,
    metalness: 0.04,
    clearcoat: 0.62,
    clearcoatRoughness: 0.2,
    sheen: 0.1,
    sheenColor: 0x6a4a38,
    sheenRoughness: 0.58,
  }),
};

const FELT_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x0d7a45,
  roughness: 0.96,
});

const PIECE_ROTATION_Y = {
  n: Math.PI / 2,
};

function markPieceInstanceGeometry(geometry) {
  geometry.userData.pieceInstanceGeometry = true;
  return geometry;
}

export function getPieceMaterial(color) {
  return MATERIALS[color];
}

function applyWoodTextureCoordinates(mesh, color) {
  const positionAttribute = mesh.geometry?.attributes?.position;
  if (!positionAttribute) return;

  mesh.geometry = markPieceInstanceGeometry(mesh.geometry.clone());
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const positions = mesh.geometry.attributes.position;
  const uvs = [];
  const position = new THREE.Vector3();
  const height = Math.max(box.max.y - box.min.y, 0.001);

  for (let i = 0; i < positions.count; i++) {
    position.fromBufferAttribute(positions, i);
    const angle = Math.atan2(position.z, position.x);
    const u = ((angle + Math.PI) / (Math.PI * 2)) * 1.8 + position.y * 0.08;
    const v = ((position.y - box.min.y) / height) * 3.2 + (color === 'b' ? 0.17 : 0);
    uvs.push(u, v);
  }

  mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
}

// type -> normalized template Object3D (base at y=0, centered on x/z). Populated
// by loadPieces(); createPiece() clones these and marks per-piece geometry clones
// for disposal when the board removes them.
const templates = {};

const TARGET_KING_HEIGHT = 1.4; // world units (1 = one square); relative sizes preserved

// Load + normalize all six models once. Browser-only (GLTFLoader/fetch). Must be
// awaited before the first createPiece() call.
export async function loadPieces(baseUrl = import.meta.env.BASE_URL) {
  const loader = new GLTFLoader();
  const raw = {};
  await Promise.all(
    PIECE_TYPES.map(async (type) => {
      const gltf = await loader.loadAsync(`${baseUrl}models/${MODEL_FILE[type]}.glb`);
      raw[type] = gltf.scene;
    }),
  );
  // One uniform scale derived from the king keeps relative piece heights correct.
  const kingBox = new THREE.Box3().setFromObject(raw.k);
  const scale = TARGET_KING_HEIGHT / (kingBox.max.y - kingBox.min.y);
  for (const type of PIECE_TYPES) templates[type] = normalizeModel(raw[type], scale);
}

// Scale uniformly, then sit the object on y=0 and center it on x/z. Returns a Group.
export function normalizeModel(object3d, scale) {
  object3d.scale.setScalar(scale);
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

function setDetailShadows(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pieceDetail = true;
  if (mesh.geometry) markPieceInstanceGeometry(mesh.geometry);
  return mesh;
}

function createRing(radius, tube, y, material, name) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 12, 48),
    material,
  );
  ring.name = name;
  ring.position.y = y;
  ring.rotation.x = Math.PI / 2;
  return setDetailShadows(ring);
}

function addFeltPad(group, radius) {
  const felt = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.96, radius * 1.02, 0.035, 48),
    FELT_MATERIAL,
  );
  felt.name = 'felt-pad';
  felt.position.y = 0.012;
  setDetailShadows(felt);
  group.add(felt);
}

function addLatheRings(group, height, radius, material) {
  group.add(createRing(radius * 0.78, radius * 0.045, height * 0.1, material, 'base-bead'));
  group.add(createRing(radius * 0.58, radius * 0.032, height * 0.2, material, 'collar-bead'));
  group.add(createRing(radius * 0.44, radius * 0.025, height * 0.68, material, 'neck-bead'));
}

function addPawnDetails(group, height, radius, material) {
  group.add(createRing(radius * 0.38, radius * 0.022, height * 0.77, material, 'pawn-head-collar'));
}

function addRookDetails(group, height, radius, material) {
  const blockGeometry = new THREE.BoxGeometry(radius * 0.2, height * 0.11, radius * 0.18);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const block = new THREE.Mesh(blockGeometry, material);
    block.name = 'rook-crenellation';
    block.position.set(Math.cos(angle) * radius * 0.48, height * 0.92, Math.sin(angle) * radius * 0.48);
    block.rotation.y = -angle;
    group.add(setDetailShadows(block));
  }
}

function addKingDetails(group, height, radius, material) {
  const stem = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.13, height * 0.2, radius * 0.08), material);
  stem.name = 'king-cross-stem';
  stem.position.y = height * 1.02;
  group.add(setDetailShadows(stem));

  const arm = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.42, height * 0.07, radius * 0.08), material);
  arm.name = 'king-cross-arm';
  arm.position.y = height * 1.05;
  group.add(setDetailShadows(arm));
}

function addQueenDetails(group, height, radius, material) {
  const jewelGeometry = new THREE.SphereGeometry(radius * 0.075, 16, 10);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const jewel = new THREE.Mesh(jewelGeometry, material);
    jewel.name = 'queen-crown-jewel';
    jewel.position.set(Math.cos(angle) * radius * 0.38, height * 0.94, Math.sin(angle) * radius * 0.38);
    group.add(setDetailShadows(jewel));
  }
  const finial = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.1, 18, 12), material);
  finial.name = 'queen-finial';
  finial.position.y = height * 1.02;
  group.add(setDetailShadows(finial));
}

function addBishopDetails(group, height, radius, material) {
  group.add(createRing(radius * 0.42, radius * 0.02, height * 0.72, material, 'bishop-head-ring'));
}

function addKnightDetails(group, height, radius, material, color) {
  const maneGeometry = new THREE.BoxGeometry(radius * 0.08, height * 0.14, radius * 0.035);
  for (let i = 0; i < 5; i++) {
    const mane = new THREE.Mesh(maneGeometry, material);
    mane.name = 'knight-mane-carving';
    mane.position.set(-radius * 0.22, height * (0.64 + i * 0.055), -radius * 0.18);
    mane.rotation.z = -0.35;
    group.add(setDetailShadows(mane));
  }

}

const DETAIL_BUILDERS = {
  p: addPawnDetails,
  r: addRookDetails,
  k: addKingDetails,
  q: addQueenDetails,
  b: addBishopDetails,
  n: addKnightDetails,
};

function addClassicDetails(group, type, color) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const height = Math.max(size.y, 0.1);
  const radius = Math.max(size.x, size.z, 0.35) / 2;
  const material = MATERIALS[color];

  addFeltPad(group, radius);
  addLatheRings(group, height, radius, material);
  DETAIL_BUILDERS[type]?.(group, height, radius, material, color);
  group.traverse((child) => {
    if (child.isMesh && child.userData.pieceDetail && child.material === material) {
      applyWoodTextureCoordinates(child, color);
    }
  });
}

// Synchronous: clone the loaded template and tint it. Returns an Object3D standing
// on y=0, tagged with userData {type, color}. Requires loadPieces() to have run.
export function createPiece(type, color) {
  const tpl = templates[type];
  if (!tpl) throw new Error(`pieces not loaded: call loadPieces() before createPiece('${type}')`);
  const obj = tpl.clone(true);
  obj.rotation.y += PIECE_ROTATION_Y[type] ?? 0;
  obj.traverse((c) => {
    if (c.isMesh) {
      applyWoodTextureCoordinates(c, color);
      c.material = MATERIALS[color];
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  addClassicDetails(obj, type, color);
  obj.userData = { type, color };
  return obj;
}
