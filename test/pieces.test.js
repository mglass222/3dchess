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
  setPieceEnvironmentMap,
  unwrapSeamTriangles,
  GRAIN_ARC_SCALE,
  GRAIN_HEIGHT_SCALE,
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
function firstMesh(obj) {
  let mesh = null;
  obj.traverse((c) => {
    if (!mesh && c.isMesh) mesh = c;
  });
  return mesh;
}
function uvSpanY(geometry) {
  const uv = geometry.getAttribute('uv');
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const v = uv.getY(i);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
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
    expect(white.userData.woodGrain).toMatchObject({ baseHex: 0xe8c48b, grainHex: 0xf3d5a3 });
    expect(blue.userData.woodGrain).toMatchObject({ baseHex: 0x2c65a8, grainHex: 0x3374c1 });
    expect(white.roughness).toBeCloseTo(0.26, 5);
    expect(blue.roughness).toBeCloseTo(0.23, 5);
    expect(white.clearcoat).toBeCloseTo(0.55, 5);
    expect(blue.clearcoat).toBeCloseTo(0.62, 5);
    expect(white.sheenColor.getHex()).toBe(0xffefd6);
    expect(blue.sheenColor.getHex()).toBe(0xb3d2f6);
    expect(white.envMapIntensity).toBeCloseTo(0.9, 5);
    expect(blue.envMapIntensity).toBeCloseTo(1.0, 5);
  });

  it('does not attach procedural detail meshes', () => {
    for (const type of PIECE_TYPES) _setTemplate(type, fakeTemplate(1));

    for (const type of PIECE_TYPES) {
      const piece = createPiece(type, 'w');
      expect(detailNames(piece)).toEqual([]);
      expect(namedMesh(piece, 'felt-pad')).toBeNull();
    }
  });

  it('wraps wood texture coordinates onto model mesh geometry', () => {
    _setTemplate('n', fakeTemplate(1));
    const knight = createPiece('n', 'w');
    const meshUvCounts = [];

    knight.traverse((child) => {
      if (child.isMesh && child.material === getPieceMaterial('w')) {
        meshUvCounts.push(child.geometry.getAttribute('uv')?.count ?? 0);
      }
    });

    expect(meshUvCounts.length).toBe(1);
    expect(meshUvCounts[0]).toBeGreaterThan(0);
  });

  it('scales grain consistently across piece types by world height', () => {
    _setTemplate('p', fakeTemplate(0.6));
    _setTemplate('k', fakeTemplate(1.4));

    const pawnSpan = uvSpanY(firstMesh(createPiece('p', 'w')).geometry);
    const kingSpan = uvSpanY(firstMesh(createPiece('k', 'w')).geometry);

    // Absolute span, not just the ratio: a bug that scales every piece by the
    // same wrong factor (e.g. reading pre-normalizeModel mesh-local
    // coordinates instead of piece-root-space ones) preserves this ratio
    // while still being off by ~15x in practice, so the ratio alone doesn't
    // catch it.
    expect(pawnSpan).toBeCloseTo(0.6 / GRAIN_HEIGHT_SCALE, 5);
    expect(kingSpan).toBeCloseTo(1.4 / GRAIN_HEIGHT_SCALE, 5);
    expect(kingSpan / pawnSpan).toBeCloseTo(1.4 / 0.6, 1);
  });

  it('scales grain by world height for a real (non-identity) piece-root transform', async () => {
    // fakeTemplate-via-_setTemplate above bypasses loadPieces/normalizeModel
    // entirely, so its piece-root transform is identity and wouldn't catch a
    // bug in the mesh-local -> piece-root matrix math itself. Route through
    // the real default-set (separate-files) load path, which applies
    // normalizeModel's actual uniform scale, to exercise that math.
    const scenes = { p: fakeTemplate(0.5), k: fakeTemplate(2) };
    const loader = { async loadAsync(url) {
      const type = Object.keys(PIECE_SETS.default.files)
        .find((t) => url.endsWith(`${PIECE_SETS.default.files[t]}.glb`));
      return { scene: (scenes[type] ?? fakeTemplate(1)).clone(true) };
    } };

    await loadPieces({ set: 'default', baseUrl: '/', loader });

    const pawn = createPiece('p', 'w');
    const king = createPiece('k', 'w');
    const pawnHeight = height(pawn);
    const kingHeight = height(king);

    expect(kingHeight).toBeCloseTo(1.4, 5); // TARGET_KING_HEIGHT
    expect(uvSpanY(firstMesh(pawn).geometry)).toBeCloseTo(pawnHeight / GRAIN_HEIGHT_SCALE, 4);
    expect(uvSpanY(firstMesh(king).geometry)).toBeCloseTo(kingHeight / GRAIN_HEIGHT_SCALE, 4);
  });

  it('does not bake UVs into a shared template geometry', () => {
    const template = fakeTemplate(1);
    _setTemplate('r', template);
    const templateGeometry = firstMesh(template).geometry;

    const piece = createPiece('r', 'w');

    expect(firstMesh(piece).geometry).not.toBe(templateGeometry);
    expect(templateGeometry.userData.pieceInstanceGeometry).toBeUndefined();
  });

  it('assigns the shared premium material to every original model mesh in a clone', () => {
    _setTemplate('r', fakeTemplate(1));
    const piece = createPiece('r', 'b');
    const blue = getPieceMaterial('b');

    piece.traverse((child) => {
      if (child.isMesh && !child.userData.isContactShadow) {
        expect(child.material).toBe(blue);
        expect(child.castShadow).toBe(true);
        expect(child.receiveShadow).toBe(true);
      }
    });
  });

  it('gives every piece a contact-shadow decal sharing one geometry and material', () => {
    _setTemplate('p', fakeTemplate(0.5));
    _setTemplate('r', fakeTemplate(1));

    const pawn = createPiece('p', 'w');
    const rook = createPiece('r', 'b');
    const pawnShadow = namedMesh(pawn, 'contact-shadow');
    const rookShadow = namedMesh(rook, 'contact-shadow');

    expect(pawnShadow).not.toBeNull();
    expect(rookShadow).not.toBeNull();
    expect(pawnShadow.geometry).toBe(rookShadow.geometry);
    expect(pawnShadow.material).toBe(rookShadow.material);
    // Guards scene.js's disposePieceGeometries contract: this geometry is a
    // shared, long-lived singleton and must never be flagged for per-piece
    // disposal, or the first captured piece would free it out from under
    // every other piece still on the board.
    expect(pawnShadow.geometry.userData.pieceInstanceGeometry).toBeUndefined();
  });

  it('grounds the contact shadow, unlit and inside its own square', () => {
    _setTemplate('q', fakeTemplate(1.2));
    const queen = createPiece('q', 'w');
    const shadow = namedMesh(queen, 'contact-shadow');

    expect(shadow.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    expect(shadow.position.y).toBeGreaterThan(0);
    expect(shadow.position.y).toBeLessThan(0.02);
    expect(shadow.castShadow).toBe(false);
    expect(shadow.material.depthWrite).toBe(false);

    queen.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(shadow);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeLessThanOrEqual(0.95);
  });

  it('describes isolated default and downloaded model sets', () => {
    expect(PIECE_SETS.default).toMatchObject({
      mode: 'separate-files',
      directory: 'models/Default',
    });
    expect(PIECE_SETS.downloaded).toMatchObject({
      mode: 'combined-scene',
      file: 'models/Downloaded/realistic_chess_set_3d_model.glb',
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
    // Cross-set check for FIX 2: the Downloaded set's ancestor scale (y*3,
    // baked into the node's own transform by cloneWithWorldTransform before
    // normalizeModel ever runs) must still be reflected in the UV height,
    // exactly like the Default set's uniform scale is. A bug that reads raw
    // mesh-local vertices (pre-bake, pre-normalizeModel) would produce a v
    // span based on height 1 (the fakeTemplate's untransformed geometry),
    // not the actual grounded height of 2.1.
    expect(uvSpanY(firstMesh(pawn).geometry)).toBeCloseTo(height(pawn) / GRAIN_HEIGHT_SCALE, 4);
  });

  it('unwrapSeamTriangles pushes only the seam-crossing corner, by that corner\'s own 2*PI*r', () => {
    // One triangle whose u-span straddles the atan2 branch cut (u driven by
    // radius per grainU, so different vertices can carry different radii).
    // Vertex 0 sits on the low side of the seam and should be the only one
    // pushed forward, by its own 2*PI*r/GRAIN_ARC_SCALE - not vertex 1's or
    // vertex 2's radius.
    const radii = [2, 1, 1];
    const uvs = new Float32Array([-3, 0, 3, 0, 0, 0]); // v (odd indices) is irrelevant here
    const originalU0 = uvs[0];

    unwrapSeamTriangles(uvs, radii);

    const expectedPush = (2 * Math.PI * radii[0]) / GRAIN_ARC_SCALE;
    expect(uvs[0]).toBeCloseTo(originalU0 + expectedPush, 5);
    expect(uvs[2]).toBeCloseTo(3, 5); // untouched: already on the high side
    expect(uvs[4]).toBeCloseTo(0, 5); // untouched: not below the triangle's u midpoint

    // A triangle that doesn't cross the seam is left alone entirely.
    const smallSpanRadii = [1, 1, 1];
    const smallSpanUvs = new Float32Array([-0.1, 0, 0.1, 0, 0, 0]);
    const untouched = smallSpanUvs.slice();
    unwrapSeamTriangles(smallSpanUvs, smallSpanRadii);
    expect(smallSpanUvs).toEqual(untouched);
  });

  it('setPieceEnvironmentMap assigns a live envMap to both shared piece materials', () => {
    const texture = new THREE.Texture();
    const white = getPieceMaterial('w');
    const blue = getPieceMaterial('b');
    const versionBefore = { w: white.version, b: blue.version };

    setPieceEnvironmentMap(texture);

    expect(white.envMap).toBe(texture);
    expect(blue.envMap).toBe(texture);
    // `needsUpdate` is a write-only setter (no getter) that bumps `.version`
    // when set true - version increasing is the observable proof the shader
    // will actually recompile with USE_ENVMAP defined.
    expect(white.version).toBeGreaterThan(versionBefore.w);
    expect(blue.version).toBeGreaterThan(versionBefore.b);
  });
});
