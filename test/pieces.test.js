import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPiece, normalizeModel, _setTemplate, PIECE_TYPES } from '../src/pieces.js';

function fakeTemplate(height = 1) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, height, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x808080 }),
  );
  mesh.position.y = height / 2; // base at y=0
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}
function firstMeshColor(obj) {
  let hex = null;
  obj.traverse((c) => { if (hex === null && c.isMesh) hex = c.material.color.getHex(); });
  return hex;
}
function height(obj) {
  return new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).y;
}

describe('pieces', () => {
  it('exposes the six piece types', () => {
    expect([...PIECE_TYPES].sort()).toEqual(['b', 'k', 'n', 'p', 'q', 'r']);
  });

  it('createPiece throws if the template is not loaded', () => {
    expect(() => createPiece('zzz', 'w')).toThrow();
  });

  it('clones the template and tags userData with type/color', () => {
    _setTemplate('p', fakeTemplate(0.5));
    const obj = createPiece('p', 'w');
    expect(obj).toBeInstanceOf(THREE.Object3D);
    expect(obj.userData).toMatchObject({ type: 'p', color: 'w' });
    expect(createPiece('p', 'w')).not.toBe(obj); // a fresh clone each call
  });

  it('tints white vs black with different materials', () => {
    _setTemplate('q', fakeTemplate(1));
    expect(firstMeshColor(createPiece('q', 'w'))).not.toBe(firstMeshColor(createPiece('q', 'b')));
  });

  it('normalizeModel grounds (y=0), centers x/z, and scales', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshStandardMaterial());
    mesh.position.set(2, 5, -1);
    const norm = normalizeModel(mesh, 2);
    const box = new THREE.Box3().setFromObject(norm);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(8, 5); // height 4 * scale 2
  });

  it('preserves relative heights (king taller than pawn)', () => {
    _setTemplate('p', fakeTemplate(0.5));
    _setTemplate('k', fakeTemplate(1.05));
    expect(height(createPiece('k', 'w'))).toBeGreaterThan(height(createPiece('p', 'w')));
  });
});
