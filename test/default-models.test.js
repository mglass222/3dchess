import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadPieces, createPiece, PIECE_TYPES, PIECE_SETS, TARGET_KING_HEIGHT } from '../src/pieces.js';
import { Scene } from '../src/scene.js';

// Parse the actual deliverable assets, not fixtures standing in for the models.
const loader = {
  async loadAsync(url) {
    const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  },
};
function woodMesh(piece) {
  let mesh;
  piece.traverse((child) => { if (child.isMesh && child.userData.authoredWoodUVs) mesh = child; });
  return mesh;
}

describe('authored Default assets', () => {
  it('loads a complete, grounded, proportionate set with usable normals and UVs', async () => {
    await loadPieces({ set: 'default', baseUrl: '/', loader });
    const heights = {};
    for (const type of PIECE_TYPES) {
      const piece = createPiece(type, 'w');
      const mesh = woodMesh(piece);
      expect(mesh).toBeDefined();
      const geometry = mesh.geometry;
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      heights[type] = size.y;
      expect(box.min.y).toBeCloseTo(0, 5);
      expect(Math.max(size.x, size.z)).toBeLessThan(.8); // clearance inside one square
      expect(size.y).toBeGreaterThan(.7);
      expect(size.y).toBeLessThanOrEqual(TARGET_KING_HEIGHT * (PIECE_SETS.default.heightMultipliers[type] ?? 1) + .001);
      expect(geometry.index.count / 3).toBeLessThan(20000);
      for (const name of ['position', 'normal', 'uv']) {
        const attribute = geometry.getAttribute(name);
        expect(attribute.count).toBe(geometry.attributes.position.count);
        expect([...attribute.array].every(Number.isFinite)).toBe(true);
      }
    }
    expect(heights.k).toBeCloseTo(1.504347826, 5);
    expect(heights.q).toBeGreaterThan(heights.b);
    expect(heights.b).toBeGreaterThan(heights.p);
  });

  it('preserves authored UVs and keeps shared geometry alive when another piece is removed', async () => {
    await loadPieces({ set: 'default', baseUrl: '/', loader });
    const first = createPiece('n', 'w');
    const second = createPiece('n', 'b');
    const geometry = woodMesh(first).geometry;
    const uvBefore = Array.from(geometry.attributes.uv.array);
    expect(woodMesh(second).geometry).toBe(geometry);
    expect(geometry.userData.pieceInstanceGeometry).toBeUndefined();
    let disposed = false;
    geometry.addEventListener('dispose', () => { disposed = true; });
    const scene = Object.create(Scene.prototype);
    scene.scene = new THREE.Scene();
    scene.pieces = new Map([['b1', first], ['b8', second]]);
    scene.scene.add(first, second);
    scene.removePieceAt('b1');
    expect(disposed).toBe(false);
    expect(second.parent).toBe(scene.scene);
    expect(Array.from(woodMesh(second).geometry.attributes.uv.array)).toEqual(uvBefore);
    scene.removePieceAt('b8');
    expect(disposed).toBe(true);
    expect(geometry.userData.pieceReferences).toBe(0);
    // dispose releases GPU buffers without invalidating reusable template data.
    const replacement = createPiece('n', 'w');
    expect(woodMesh(replacement).geometry).toBe(geometry);
    expect(geometry.userData.pieceReferences).toBe(1);
    expect(Array.from(geometry.attributes.uv.array)).toEqual(uvBefore);
  });
});
