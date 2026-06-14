import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPiece, PIECE_TYPES } from '../src/pieces.js';

const colors = ['w', 'b'];

describe('pieces', () => {
  it('exposes the six piece types', () => {
    expect(PIECE_TYPES.sort()).toEqual(['b', 'k', 'n', 'p', 'q', 'r']);
  });

  it('builds an Object3D with positive height for every type and color', () => {
    for (const color of colors) {
      for (const type of PIECE_TYPES) {
        const obj = createPiece(type, color);
        expect(obj).toBeInstanceOf(THREE.Object3D);
        const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
        expect(size.y).toBeGreaterThan(0);
        expect(size.x).toBeLessThan(1);
        expect(size.z).toBeLessThan(1);
      }
    }
  });

  it('sits on the board (base at y ≈ 0)', () => {
    const box = new THREE.Box3().setFromObject(createPiece('q', 'w'));
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(box.min.y).toBeLessThan(0.05);
  });

  it('tags each piece with its type and color in userData', () => {
    const obj = createPiece('n', 'b');
    expect(obj.userData).toMatchObject({ type: 'n', color: 'b' });
  });

  it('uses visually different materials for white vs black', () => {
    const whiteColor = firstMeshColor(createPiece('p', 'w'));
    const blackColor = firstMeshColor(createPiece('p', 'b'));
    expect(whiteColor).not.toBe(blackColor);
  });

  it('makes taller royalty than pawns', () => {
    const ph = height(createPiece('p', 'w'));
    const kh = height(createPiece('k', 'w'));
    expect(kh).toBeGreaterThan(ph);
  });
});

function firstMeshColor(obj) {
  let hex = null;
  obj.traverse((c) => {
    if (hex === null && c.isMesh) hex = c.material.color.getHex();
  });
  return hex;
}
function height(obj) {
  return new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).y;
}
