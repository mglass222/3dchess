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

  it('does not accumulate rotation across repeated knight clones', () => {
    _setTemplate('n', fakeTemplate(0.9));
    const first = createPiece('n', 'w');
    const second = createPiece('n', 'w');
    expect(first.rotation.y).toBeCloseTo(Math.PI / 2, 5);
    expect(second.rotation.y).toBeCloseTo(Math.PI / 2, 5);
  });

  it('configures the wood texture map for seamless tiling', () => {
    const map = getPieceMaterial('w').map;
    expect(map.wrapS).toBe(THREE.RepeatWrapping);
    expect(map.wrapT).toBe(THREE.RepeatWrapping);
    expect(map.repeat.x).toBeCloseTo(0.78, 5);
    expect(map.repeat.y).toBeCloseTo(1.75, 5);
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(map.needsUpdate).toBe(true);
  });

  it('renders wood grain pixel data blended between the base and grain colors', () => {
    const map = getPieceMaterial('w').map;
    const { baseHex, grainHex } = getPieceMaterial('w').userData.woodGrain;
    const base = { r: (baseHex >> 16) & 255, g: (baseHex >> 8) & 255, b: baseHex & 255 };
    const grain = { r: (grainHex >> 16) & 255, g: (grainHex >> 8) & 255, b: grainHex & 255 };
    const { data, width, height } = map.image;

    expect(width).toBe(192);
    expect(height).toBe(192);
    expect(data.length).toBe(192 * 192 * 4);

    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBeGreaterThanOrEqual(Math.min(base.r, grain.r));
      expect(data[i]).toBeLessThanOrEqual(Math.max(base.r, grain.r));
      expect(data[i + 1]).toBeGreaterThanOrEqual(Math.min(base.g, grain.g));
      expect(data[i + 1]).toBeLessThanOrEqual(Math.max(base.g, grain.g));
      expect(data[i + 2]).toBeGreaterThanOrEqual(Math.min(base.b, grain.b));
      expect(data[i + 2]).toBeLessThanOrEqual(Math.max(base.b, grain.b));
      expect(data[i + 3]).toBe(255);
    }
  });

  it('adds the three shared lathe bead rings to every piece type', () => {
    for (const type of PIECE_TYPES) _setTemplate(type, fakeTemplate(1));

    for (const type of PIECE_TYPES) {
      const names = detailNames(createPiece(type, 'w'));
      expect(names).toContain('base-bead');
      expect(names).toContain('collar-bead');
      expect(names).toContain('neck-bead');
    }
  });

  it('builds the expected count of repeated ornamental detail meshes per piece type', () => {
    for (const type of PIECE_TYPES) _setTemplate(type, fakeTemplate(1));

    const countByName = (obj, name) => detailNames(obj).filter((n) => n === name).length;
    expect(countByName(createPiece('r', 'w'), 'rook-crenellation')).toBe(6);
    expect(countByName(createPiece('q', 'w'), 'queen-crown-jewel')).toBe(6);
    expect(countByName(createPiece('q', 'w'), 'queen-finial')).toBe(1);
    expect(countByName(createPiece('n', 'w'), 'knight-mane-carving')).toBe(5);
    expect(countByName(createPiece('k', 'w'), 'king-cross-stem')).toBe(1);
    expect(countByName(createPiece('k', 'w'), 'king-cross-arm')).toBe(1);
  });

  it('uses a distinct green felt material for the base pad, separate from the wood material', () => {
    _setTemplate('p', fakeTemplate(1));
    const piece = createPiece('p', 'w');
    const wood = getPieceMaterial('w');
    let felt = null;
    piece.traverse((child) => {
      if (child.name === 'felt-pad') felt = child;
    });

    expect(felt).not.toBeNull();
    expect(felt.material).not.toBe(wood);
    expect(felt.material.color.getHex()).toBe(0x0d7a45);
    expect(felt.material.roughness).toBeCloseTo(0.96, 5);
  });

  it('applies the shared wood material (not the felt material) to non-felt detail meshes', () => {
    _setTemplate('b', fakeTemplate(1));
    const piece = createPiece('b', 'b');
    const ebony = getPieceMaterial('b');

    piece.traverse((child) => {
      if (child.isMesh && child.userData.pieceDetail && child.name !== 'felt-pad') {
        expect(child.material).toBe(ebony);
      }
    });
  });

  it('computes cylindrical wood UV coordinates from vertex position, offset for black pieces', () => {
    const buildTemplateWithKnownVertices = () => {
      const geometry = new THREE.BufferGeometry();
      // x=1,y=0,z=0 | x=0,y=1,z=1 | x=-1,y=2,z=0
      const positions = new Float32Array([1, 0, 0, 0, 1, 1, -1, 2, 0]);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
      const group = new THREE.Group();
      group.add(mesh);
      return group;
    };
    const readUv = (piece) => {
      let uv = null;
      piece.traverse((child) => {
        if (child.isMesh && !child.userData.pieceDetail) uv = child.geometry.getAttribute('uv');
      });
      return uv;
    };

    _setTemplate('p', buildTemplateWithKnownVertices());
    const whiteUv = readUv(createPiece('p', 'w'));
    _setTemplate('p', buildTemplateWithKnownVertices());
    const blackUv = readUv(createPiece('p', 'b'));

    // Bounding box y spans [0, 2] -> height 2; v = (y / 2) * 3.2 (+0.17 for black).
    expect(whiteUv.getX(0)).toBeCloseTo(0.9, 5);
    expect(whiteUv.getY(0)).toBeCloseTo(0, 5);
    expect(whiteUv.getX(1)).toBeCloseTo(1.43, 5);
    expect(whiteUv.getY(1)).toBeCloseTo(1.6, 5);
    expect(whiteUv.getX(2)).toBeCloseTo(1.96, 5);
    expect(whiteUv.getY(2)).toBeCloseTo(3.2, 5);

    expect(blackUv.getX(0)).toBeCloseTo(whiteUv.getX(0), 5);
    expect(blackUv.getY(0)).toBeCloseTo(0.17, 5);
    expect(blackUv.getY(1)).toBeCloseTo(1.6 + 0.17, 5);
    expect(blackUv.getY(2)).toBeCloseTo(3.2 + 0.17, 5);
  });

  it('produces finite UV coordinates for degenerate (zero-height) geometry', () => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([1, 0, 0, 0, 0, 1, -1, 0, 0]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const group = new THREE.Group();
    group.add(mesh);
    _setTemplate('p', group);

    const piece = createPiece('p', 'w');
    let uv = null;
    piece.traverse((child) => {
      if (child.isMesh && !child.userData.pieceDetail) uv = child.geometry.getAttribute('uv');
    });

    for (let i = 0; i < uv.count; i++) {
      expect(Number.isFinite(uv.getX(i))).toBe(true);
      expect(Number.isFinite(uv.getY(i))).toBe(true);
    }
  });
});
