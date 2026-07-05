import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createPiece,
  loadPieces,
  normalizeModel,
  _setTemplate,
  PIECE_SETS,
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
function namedMesh(obj, name) {
  let mesh = null;
  obj.traverse((c) => {
    if (!mesh && c.isMesh && c.name === name) mesh = c;
  });
  return mesh;
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

  it('normalizeModel preserves imported object scale while fitting target height', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    mesh.scale.setScalar(100);
    mesh.position.y = 100;

    const norm = normalizeModel(mesh, 0.01);
    const box = new THREE.Box3().setFromObject(norm);

    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(2, 5);
  });

  it('preserves relative heights (king taller than pawn)', () => {
    _setTemplate('p', fakeTemplate(0.5));
    _setTemplate('k', fakeTemplate(1.05));
    expect(height(createPiece('k', 'w'))).toBeGreaterThan(height(createPiece('p', 'w')));
  });

  it('uses glossy wood-grain ivory and blue piece materials', () => {
    const white = getPieceMaterial('w');
    const blue = getPieceMaterial('b');

    expect(white).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(blue).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(white.color.getHex()).toBe(0xffffff);
    expect(blue.color.getHex()).toBe(0xffffff);
    expect(white.vertexColors).toBe(false);
    expect(blue.vertexColors).toBe(false);
    expect(white.map).toBeInstanceOf(THREE.DataTexture);
    expect(blue.map).toBeInstanceOf(THREE.DataTexture);
    expect(white.userData.woodGrain).toMatchObject({ baseHex: 0xd1a25d, grainHex: 0xe2bd7d });
    expect(blue.userData.woodGrain).toMatchObject({ baseHex: 0x2c65a8, grainHex: 0x74a7df });
    expect(white.roughness).toBeCloseTo(0.26, 5);
    expect(blue.roughness).toBeCloseTo(0.23, 5);
    expect(white.clearcoat).toBeCloseTo(0.55, 5);
    expect(blue.clearcoat).toBeCloseTo(0.62, 5);
    expect(white.sheenColor.getHex()).toBe(0xf8d18e);
    expect(blue.sheenColor.getHex()).toBe(0xb3d2f6);
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

  it('uses black felt pads under the pieces', () => {
    _setTemplate('p', fakeTemplate(1));
    const felt = namedMesh(createPiece('p', 'w'), 'felt-pad');

    expect(felt).toBeInstanceOf(THREE.Mesh);
    expect(felt.material.color.getHex()).toBe(0x050505);
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
    const blue = getPieceMaterial('b');

    piece.traverse((child) => {
      if (child.isMesh && !child.userData.pieceDetail) {
        expect(child.material).toBe(blue);
        expect(child.castShadow).toBe(true);
        expect(child.receiveShadow).toBe(true);
      }
    });
  });

  it('describes isolated default and downloaded model sets', () => {
    expect(PIECE_SETS.default).toMatchObject({
      mode: 'separate-files',
      directory: 'models/Default',
      addClassicDetails: true,
    });
    expect(PIECE_SETS.downloaded).toMatchObject({
      mode: 'combined-scene',
      file: 'models/Downloaded/realistic_chess_set_3d_model.glb',
      addClassicDetails: false,
    });
    expect(Object.keys(PIECE_SETS.downloaded.nodes).sort()).toEqual([...PIECE_TYPES].sort());
  });

  it('loads a combined downloaded scene by sanitized node names', async () => {
    const scene = new THREE.Group();
    const requestedUrls = [];
    for (const type of PIECE_TYPES) {
      const node = fakeTemplate(type === 'k' ? 2 : 1);
      node.name = PIECE_SETS.downloaded.nodes[type].replace(/\s/g, '_');
      node.scale.setScalar(100);
      scene.add(node);
    }
    const loader = {
      async loadAsync(url) {
        requestedUrls.push(url);
        return { scene };
      },
    };

    await loadPieces({ set: 'downloaded', baseUrl: '/game', loader });
    const knight = createPiece('n', 'w');

    expect(requestedUrls).toEqual(['/game/models/Downloaded/realistic_chess_set_3d_model.glb']);
    expect(knight.rotation.y).toBeCloseTo(-Math.PI / 2, 5);
    expect(detailNames(knight)).not.toContain('felt-pad');
    expect(height(knight)).toBeGreaterThan(0.5);
  });

  it('bakes ancestor transforms when loading nested combined-scene nodes', async () => {
    const scene = new THREE.Group();
    for (const type of PIECE_TYPES) {
      const parent = new THREE.Group();
      parent.scale.set(1, type === 'p' ? 3 : 1, 1);
      const node = fakeTemplate(type === 'k' ? 2 : 1);
      node.name = PIECE_SETS.downloaded.nodes[type].replace(/\s/g, '_');
      parent.add(node);
      scene.add(parent);
    }
    const loader = {
      async loadAsync() {
        return { scene };
      },
    };

    await loadPieces({ set: 'downloaded', baseUrl: '/', loader });
    const pawn = createPiece('p', 'w');

    expect(height(pawn)).toBeCloseTo(2.1, 5);
  });
});
