import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createPiece,
  normalizeModel,
  _setTemplate,
  PIECE_TYPES,
  getPieceMaterial,
} from '../src/pieces.js';

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
function height(obj) {
  return new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).y;
}
function detailNames(obj) {
  const names = [];
  obj.traverse((c) => {
    if (c.userData.pieceDetail) names.push(c.name);
  });
  return names;
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

  it('rotates knights sideways without rotating other pieces', () => {
    _setTemplate('n', fakeTemplate(0.9));
    _setTemplate('p', fakeTemplate(0.5));

    expect(createPiece('n', 'w').rotation.y).toBeCloseTo(Math.PI / 2, 5);
    expect(createPiece('p', 'w').rotation.y).toBeCloseTo(0, 5);
  });

  it('tints white vs black with different materials', () => {
    expect(getPieceMaterial('w').userData.woodGrain.baseHex)
      .not.toBe(getPieceMaterial('b').userData.woodGrain.baseHex);
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

  it('uses glossy wood-grain ivory and ebony piece materials', () => {
    const white = getPieceMaterial('w');
    const black = getPieceMaterial('b');

    expect(white).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(black).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(white.color.getHex()).toBe(0xffffff);
    expect(black.color.getHex()).toBe(0xffffff);
    expect(white.vertexColors).toBe(false);
    expect(black.vertexColors).toBe(false);
    expect(white.map).toBeInstanceOf(THREE.DataTexture);
    expect(black.map).toBeInstanceOf(THREE.DataTexture);
    expect(white.userData.woodGrain).toMatchObject({ baseHex: 0xd1a25d, grainHex: 0xe2bd7d });
    expect(black.userData.woodGrain).toMatchObject({ baseHex: 0x12100d, grainHex: 0x32261d });
    expect(white.roughness).toBeCloseTo(0.26, 5);
    expect(black.roughness).toBeCloseTo(0.23, 5);
    expect(white.clearcoat).toBeCloseTo(0.55, 5);
    expect(black.clearcoat).toBeCloseTo(0.62, 5);
    expect(white.sheenColor.getHex()).toBe(0xf8d18e);
    expect(black.sheenColor.getHex()).toBe(0x6a4a38);
  });

  it('adds classic detail meshes to each piece family', () => {
    for (const type of PIECE_TYPES) _setTemplate(type, fakeTemplate(1));

    expect(detailNames(createPiece('p', 'w'))).toContain('pawn-head-collar');
    expect(detailNames(createPiece('r', 'w'))).toContain('rook-crenellation');
    expect(detailNames(createPiece('k', 'w'))).toContain('king-cross-arm');
    expect(detailNames(createPiece('q', 'w'))).toContain('queen-crown-jewel');
    expect(detailNames(createPiece('b', 'w'))).toContain('bishop-head-ring');
    expect(detailNames(createPiece('n', 'w'))).toContain('knight-mane-carving');
    expect(detailNames(createPiece('p', 'w'))).toContain('felt-pad');
  });

  it('wraps wood texture coordinates onto original and detail mesh geometry', () => {
    _setTemplate('n', fakeTemplate(1));
    const knight = createPiece('n', 'w');
    const meshUvCounts = [];

    knight.traverse((child) => {
      if (child.isMesh && child.material === getPieceMaterial('w')) {
        meshUvCounts.push(child.geometry.getAttribute('uv')?.count ?? 0);
      }
    });

    expect(meshUvCounts.length).toBeGreaterThan(1);
    expect(meshUvCounts.every((count) => count > 0)).toBe(true);
  });

  it('assigns the shared premium material to every original model mesh in a clone', () => {
    _setTemplate('r', fakeTemplate(1));
    const piece = createPiece('r', 'b');
    const ebony = getPieceMaterial('b');

    piece.traverse((child) => {
      if (child.isMesh && !child.userData.pieceDetail) {
        expect(child.material).toBe(ebony);
        expect(child.castShadow).toBe(true);
        expect(child.receiveShadow).toBe(true);
      }
    });
  });
});
