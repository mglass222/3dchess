import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const PIECE_TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];

// Piece type -> model filename (Ernest Rudnicki "chess-3d" set, MIT).
const MODEL_FILE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// Shared, long-lived materials (one per color) applied to every piece clone.
const MATERIALS = {
  w: new THREE.MeshStandardMaterial({ color: 0xede4cf, roughness: 0.5, metalness: 0.05 }),
  b: new THREE.MeshStandardMaterial({ color: 0x3b2c24, roughness: 0.55, metalness: 0.05 }),
};

// type -> normalized template Object3D (base at y=0, centered on x/z). Populated
// by loadPieces(); createPiece() clones these. Geometry/materials are shared across
// clones and live for the app's lifetime (scene.js must NOT dispose them).
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

// Synchronous: clone the loaded template and tint it. Returns an Object3D standing
// on y=0, tagged with userData {type, color}. Requires loadPieces() to have run.
export function createPiece(type, color) {
  const tpl = templates[type];
  if (!tpl) throw new Error(`pieces not loaded: call loadPieces() before createPiece('${type}')`);
  const obj = tpl.clone(true);
  obj.traverse((c) => {
    if (c.isMesh) {
      c.material = MATERIALS[color];
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  obj.userData = { type, color };
  return obj;
}
