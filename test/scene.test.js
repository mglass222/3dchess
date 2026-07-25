import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BOARD_TEXTURES,
  CAMERA_MAX_POLAR_ANGLE,
  ENVIRONMENT_BLUR,
  Scene,
  applyEnvironmentMap,
  applyThemeFog,
  createBoardMaterials,
  createChessBoard,
  createEnvironment,
  createStoneMaterial,
  createStoneTable,
  applyRendererQuality,
  syncContactShadow,
} from '../src/scene.js';
import { DEFAULT_FOG_DENSITY, getTheme } from '../src/themes.js';
import { isLightSquare, squareToWorld } from '../src/coords.js';
import { CONTACT_SHADOW_Y } from '../src/pieces.js';

describe('scene rendering helpers', () => {
  it('clamps camera rotation above board level', () => {
    expect(CAMERA_MAX_POLAR_ANGLE).toBeCloseTo(Math.PI / 2 - 0.04, 5);
  });

  it('creates premium board materials', () => {
    const { light, dark, frame } = createBoardMaterials();

    expect(light).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(dark).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(frame).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(light.color.getHex()).toBe(0xe8d6ae);
    expect(dark.color.getHex()).toBe(0x6e5340);
    expect(frame.color.getHex()).toBe(0x2c2018);
    expect(light.clearcoat).toBeGreaterThan(0);
    expect(dark.clearcoat).toBeGreaterThan(0);
    expect(light.envMapIntensity).toBeCloseTo(0.28, 5);
    expect(dark.envMapIntensity).toBeCloseTo(0.25, 5);
    expect(frame.envMapIntensity).toBeCloseTo(0.22, 5);
  });

  it('describes grain texture assets for the board woods', () => {
    expect(BOARD_TEXTURES.light.url).toBe('textures/board/maple-grain.svg');
    expect(BOARD_TEXTURES.dark.url).toBe('textures/board/walnut-grain.svg');
    expect(BOARD_TEXTURES.frame.url).toBe('textures/board/walnut-grain.svg');
    expect(BOARD_TEXTURES.light.repeat[0]).toBeGreaterThan(0);
    expect(BOARD_TEXTURES.dark.repeat[1]).toBeGreaterThan(0);
    // Light and dark must share a physical grain scale — mismatched repeats
    // would render two woods at different physical sizes on the same board.
    expect(BOARD_TEXTURES.light.repeat).toEqual(BOARD_TEXTURES.dark.repeat);
  });

  it('loads grain texture maps into compatible board materials', () => {
    const loadedUrls = [];
    const onErrors = [];
    const loader = {
      load(url, onLoad, onProgress, onError) {
        loadedUrls.push(url);
        onErrors.push(onError);
        return new THREE.Texture();
      },
    };
    const { light, dark, frame } = createBoardMaterials({ textureLoader: loader, baseUrl: '/game/' });

    expect(loadedUrls).toEqual([
      '/game/textures/board/maple-grain.svg',
      '/game/textures/board/walnut-grain.svg',
      '/game/textures/board/walnut-grain.svg',
    ]);
    for (const material of [light, dark, frame]) {
      expect(material.map).toBeInstanceOf(THREE.Texture);
      expect(material.map.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(material.map.wrapS).toBe(THREE.RepeatWrapping);
      expect(material.map.wrapT).toBe(THREE.RepeatWrapping);
      expect(material.map.anisotropy).toBeGreaterThan(1);
    }
    expect(onErrors).toHaveLength(3);
    expect(onErrors.every((onError) => typeof onError === 'function')).toBe(true);
  });

  it('varies grain texture placement across neighboring squares', () => {
    const loader = { load: () => new THREE.Texture() };
    const board = createChessBoard({ textureLoader: loader, baseUrl: '/' });
    const squareMaps = [];

    board.traverse((child) => {
      if (child.isMesh && child.name.startsWith('square-')) squareMaps.push(child.material.map);
    });

    expect(squareMaps.length).toBe(64);
    expect(squareMaps.every((map) => map instanceof THREE.Texture)).toBe(true);

    const transforms = squareMaps.map((map) => [
      map.offset.x.toFixed(3),
      map.offset.y.toFixed(3),
      map.rotation.toFixed(3),
    ].join(':'));
    expect(new Set(transforms).size).toBeGreaterThan(16);
  });

  it('locks the grain axis: light and dark squares run perpendicular', () => {
    // boardSquareTextureTransform rotates by ((file+rank) % 4) * (PI/2). Since
    // isLightSquare is (file+rank) % 2 === 1, light squares always land on
    // 90deg/270deg and dark squares always land on 0deg/180deg. For
    // directional grain, 0deg and 180deg are the same axis, so this must
    // produce exactly two axes mod PI, PI/2 apart, split cleanly by color.
    const loader = { load: () => new THREE.Texture() };
    const board = createChessBoard({ textureLoader: loader, baseUrl: '/' });
    const lightAxes = new Set();
    const darkAxes = new Set();

    board.traverse((child) => {
      if (!child.isMesh || !child.name.startsWith('square-')) return;
      const square = child.name.slice('square-'.length);
      const axis = Number((child.material.map.rotation % Math.PI).toFixed(5));
      if (isLightSquare(square)) lightAxes.add(axis);
      else darkAxes.add(axis);
    });

    expect(lightAxes.size).toBe(1);
    expect(darkAxes.size).toBe(1);
    const [lightAxis] = lightAxes;
    const [darkAxis] = darkAxes;
    const diff = Math.abs(lightAxis - darkAxis);
    expect(Math.min(diff, Math.PI - diff)).toBeCloseTo(Math.PI / 2, 4);
  });

  it('keeps frame geometry below the playable square surface', () => {
    const board = createChessBoard();
    const materials = createBoardMaterials();
    const frameMeshes = [];
    const squareMeshes = [];

    board.traverse((child) => {
      if (!child.isMesh) return;
      if (child.material.color.getHex() === materials.frame.color.getHex()) frameMeshes.push(child);
      else squareMeshes.push(child);
    });

    expect(squareMeshes.length).toBe(64);
    expect(frameMeshes.length).toBeGreaterThan(0);

    const squareTop = Math.max(
      ...squareMeshes.map((mesh) => new THREE.Box3().setFromObject(mesh).max.y),
    );
    const highestFrameTop = Math.max(
      ...frameMeshes.map((mesh) => new THREE.Box3().setFromObject(mesh).max.y),
    );

    expect(squareTop).toBeCloseTo(0, 5);
    expect(highestFrameTop).toBeLessThan(squareTop);
  });

  it('creates a stone material suitable for the table', () => {
    const material = createStoneMaterial();

    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.color.getHex()).toBe(0x7d7868);
    expect(material.roughness).toBeCloseTo(0.94, 5);
  });

  it('creates a shadow-casting stone table group below the board', () => {
    const table = createStoneTable();
    const meshes = [];
    table.traverse((child) => {
      if (child.isMesh) meshes.push(child);
    });

    expect(table.name).toBe('stone-table');
    expect(meshes.length).toBeGreaterThanOrEqual(3);
    expect(meshes.every((mesh) => mesh.castShadow)).toBe(true);
    expect(meshes.every((mesh) => mesh.receiveShadow)).toBe(true);

    const box = new THREE.Box3().setFromObject(table);
    expect(box.max.y).toBeLessThan(0);
    expect(box.min.y).toBeLessThan(-1);
    expect(box.max.x - box.min.x).toBeGreaterThan(9);
    expect(box.max.z - box.min.z).toBeGreaterThan(9);
  });

  it('applies high quality renderer settings to compatible renderers', () => {
    const renderer = {
      shadowMap: {},
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 0,
    };

    applyRendererQuality(renderer);

    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(1.00, 5);
  });

  it('disposes owned piece geometries when removing a piece', () => {
    const ownedGeometry = new THREE.BoxGeometry();
    const sharedGeometry = new THREE.SphereGeometry();
    const sharedMaterial = new THREE.MeshBasicMaterial();
    const piece = new THREE.Group();
    let ownedDisposeCount = 0;
    let sharedGeometryDisposed = false;
    let sharedMaterialDisposed = false;

    ownedGeometry.userData.pieceInstanceGeometry = true;
    ownedGeometry.addEventListener('dispose', () => { ownedDisposeCount += 1; });
    sharedGeometry.addEventListener('dispose', () => { sharedGeometryDisposed = true; });
    sharedMaterial.addEventListener('dispose', () => { sharedMaterialDisposed = true; });

    piece.add(new THREE.Mesh(ownedGeometry, sharedMaterial));
    piece.add(new THREE.Mesh(ownedGeometry, sharedMaterial));
    piece.add(new THREE.Mesh(sharedGeometry, sharedMaterial));

    let removed = null;
    const scene = Object.create(Scene.prototype);
    scene.pieces = new Map([['e4', piece]]);
    scene.scene = { remove: (obj) => { removed = obj; } };

    scene.removePieceAt('e4');

    expect(removed).toBe(piece);
    expect(scene.pieces.has('e4')).toBe(false);
    expect(ownedDisposeCount).toBe(1);
    expect(sharedGeometryDisposed).toBe(false);
    expect(sharedMaterialDisposed).toBe(false);
  });

  it('creates a PMREM environment from a real RoomEnvironment scene', () => {
    let disposedGenerator = false;
    let fromSceneArgs = null;
    let receivedRoom = null;
    const fakeTexture = {};
    const fakeRenderTarget = { texture: fakeTexture };

    const { texture, renderTarget } = createEnvironment({
      renderer: {},
      pmremFactory: () => ({
        fromScene(scene, sigma) {
          fromSceneArgs = [scene, sigma];
          receivedRoom = scene;
          return fakeRenderTarget;
        },
        dispose: () => { disposedGenerator = true; },
      }),
      roomFactory: () => new RoomEnvironment(),
    });

    expect(texture).toBe(fakeTexture);
    expect(renderTarget).toBe(fakeRenderTarget);
    expect(fromSceneArgs[1]).toBe(ENVIRONMENT_BLUR);
    expect(receivedRoom.isScene).toBe(true);
    expect(disposedGenerator).toBe(true);
  });

  it('disposes the generator and room but not the returned render target', () => {
    const disposeCalls = [];
    const fakeRenderTarget = { texture: {}, dispose: () => disposeCalls.push('renderTarget') };
    const fakeRoom = { isScene: true, dispose: () => disposeCalls.push('room') };
    const fakeGenerator = {
      fromScene: () => fakeRenderTarget,
      dispose: () => disposeCalls.push('generator'),
    };

    const { renderTarget } = createEnvironment({
      renderer: {},
      pmremFactory: () => fakeGenerator,
      roomFactory: () => fakeRoom,
    });

    expect(renderTarget).toBe(fakeRenderTarget);
    expect(disposeCalls).toEqual(['room', 'generator']);
  });

  it('propagates a fromScene failure but still disposes generator and room', () => {
    const disposeCalls = [];
    const fakeRoom = { isScene: true, dispose: () => disposeCalls.push('room') };
    const fakeGenerator = {
      fromScene: () => { throw new Error('GL context lost'); },
      dispose: () => disposeCalls.push('generator'),
    };

    expect(() => createEnvironment({
      renderer: {},
      pmremFactory: () => fakeGenerator,
      roomFactory: () => fakeRoom,
    })).toThrow('GL context lost');
    expect(disposeCalls).toEqual(['room', 'generator']);
  });

  it('applyEnvironmentMap assigns a live envMap to every standard material found, and only once', () => {
    const texture = new THREE.Texture();
    const boardMaterial = new THREE.MeshPhysicalMaterial(); // extends MeshStandardMaterial
    const stoneMaterial = new THREE.MeshStandardMaterial();
    const basicMaterial = new THREE.MeshBasicMaterial(); // not isMeshStandardMaterial
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), boardMaterial));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), stoneMaterial));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), basicMaterial));
    // A SECOND mesh on an already-listed material, mirroring the real board
    // where one frame material is reused by both the frame and the inset mesh.
    // Without this the within-traverse dedup is never actually exercised.
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), boardMaterial));

    const sharedVersionBefore = boardMaterial.version;
    applyEnvironmentMap(root, texture);
    // Bumped exactly once despite being reached by two meshes.
    expect(boardMaterial.version).toBe(sharedVersionBefore + 1);

    expect(boardMaterial.envMap).toBe(texture);
    expect(stoneMaterial.envMap).toBe(texture);
    expect(basicMaterial.envMap).not.toBe(texture);

    // Reset the version counters, then call again: a material that already
    // carries this exact texture must be left untouched (no redundant
    // recompile), which is the "guard against setting it twice" contract for
    // materials shared across a traverse (e.g. the board's frame material,
    // reused by both the frame and the inset mesh).
    const versionBefore = boardMaterial.version;
    applyEnvironmentMap(root, texture);
    expect(boardMaterial.version).toBe(versionBefore);
  });

  it('_addEnvironment catches a broken renderer and flags the fallback instead of throwing', () => {
    // A bare object is missing everything PMREMGenerator needs (it fails
    // immediately in its constructor - see _compileMaterial), which is a
    // reasonable stand-in for the "context loss / software GL" case the
    // catch branch exists for.
    const scene = Object.create(Scene.prototype);
    scene.scene = new THREE.Scene();
    scene.renderer = {};

    expect(() => scene._addEnvironment()).not.toThrow();

    expect(scene._envFailed).toBe(true);
    expect(scene._envTexture).toBeNull();
    expect(scene.scene.environment).toBeNull();
  });

  it('_addLights uses the reduced IBL-era intensities when the environment map loaded', () => {
    const scene = Object.create(Scene.prototype);
    scene.scene = new THREE.Scene();
    scene.renderer = { toneMappingExposure: 1.00 };
    scene._envFailed = false;

    scene._addLights();

    expect(scene.hemiLight.intensity).toBeCloseTo(0.22, 5);
    expect(scene.keyLight.intensity).toBeCloseTo(1.85, 5);
    expect(scene.rimLight.intensity).toBeCloseTo(0.4, 5);
    // Untouched: applyRendererQuality already set this, and the lit path has
    // no reason to override it.
    expect(scene.renderer.toneMappingExposure).toBeCloseTo(1.00, 5);
  });

  it('_addLights restores pre-IBL intensities and exposure when the environment map failed', () => {
    // Without this, a context-loss/software-GL fallback rendered 30-40%
    // darker than before IBL landed: the punctual lights were cut on the
    // assumption the (now-missing) env map would make up the difference.
    const scene = Object.create(Scene.prototype);
    scene.scene = new THREE.Scene();
    scene.renderer = { toneMappingExposure: 1.00 };
    scene._envFailed = true;

    scene._addLights();

    expect(scene.hemiLight.intensity).toBeCloseTo(0.7, 5);
    expect(scene.keyLight.intensity).toBeCloseTo(2.3, 5);
    expect(scene.rimLight.intensity).toBeCloseTo(0.65, 5);
    expect(scene.renderer.toneMappingExposure).toBeCloseTo(1.08, 5);
  });

  it('mutates a single fog instance in place across theme switches', () => {
    // WebGLRenderer keys shader recompiles on fog IDENTITY, not value equality —
    // constructing a new FogExp2 per theme would recompile every material in the
    // scene on every <select> change. applyThemeFog must return the same object.
    const fog = new THREE.FogExp2(0x000000, DEFAULT_FOG_DENSITY);

    const afterMidnight = applyThemeFog(fog, getTheme('midnight'));
    const afterDusk = applyThemeFog(fog, getTheme('dusk'));

    expect(afterDusk).toBe(afterMidnight);
    expect(afterDusk).toBe(fog);
    expect(fog.color.getHexString()).toBe('6e4331');
    expect(fog.density).toBeCloseTo(0.015, 5);
  });

  it('keeps the same fog object on the scene across setTheme calls', () => {
    // The assertion above only proves applyThemeFog returns its argument. The
    // invariant that actually prevents ~70 shader recompiles on a <select>
    // change is that setTheme/_clearBackdrop never REPLACE scene.fog, so drive
    // the real method. makeGradientTexture needs a canvas; stub the minimum.
    const originalDocument = globalThis.document;
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createLinearGradient: () => ({ addColorStop() {} }),
          fillStyle: null,
          fillRect() {},
        }),
      }),
    };
    try {
      const scene = Object.create(Scene.prototype);
      scene.scene = new THREE.Scene();
      scene._bgTexture = null;
      scene._starfield = null;
      scene._fog = new THREE.FogExp2(0x000000, DEFAULT_FOG_DENSITY);
      scene.scene.fog = scene._fog;

      scene.setTheme('midnight');
      const afterFirst = scene.scene.fog;
      scene.setTheme('cosmos'); // adds a starfield, so _clearBackdrop does real work
      scene.setTheme('dusk');

      expect(afterFirst).toBe(scene._fog);
      expect(scene.scene.fog).toBe(scene._fog);
      expect(scene.scene.fog.color.getHexString()).toBe('6e4331');
      expect(scene.scene.fog.density).toBeCloseTo(0.015, 5);
    } finally {
      globalThis.document = originalDocument;
    }
  });

  it('keeps fog falloff a subtle depth cue across the real camera orbit', () => {
    // Camera default is (0, 9, 9) looking at the origin, so the orbit distance
    // is sqrt(9^2 + 9^2) ~= 12.73. The board extends +/-4.4 in X/Z, so the near
    // board edge is ~10.1 away and the far corner ~16.7 away. minDistance is 6
    // (fog should be negligible there); maxDistance is 28, where the table
    // should still read as haze rather than a wash.
    const falloff = (distance) => 1 - Math.exp(-((distance * DEFAULT_FOG_DENSITY) ** 2));

    expect(falloff(10.1)).toBeLessThan(0.05);
    expect(falloff(16.7)).toBeLessThan(0.15);
    expect(falloff(28)).toBeGreaterThan(0.20);
  });

  it('syncContactShadow cancels the parent arc-hop lift, keeping the decal grounded', () => {
    const parent = new THREE.Group();
    parent.position.set(1, 0.6, -2); // mid-hop
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    parent.add(shadow);
    parent.userData.contactShadow = shadow;

    syncContactShadow(parent);
    parent.updateMatrixWorld(true);

    const worldPos = new THREE.Vector3();
    shadow.getWorldPosition(worldPos);

    expect(worldPos.y).toBeCloseTo(CONTACT_SHADOW_Y, 5);
    expect(worldPos.x).toBeCloseTo(1, 5);
    expect(worldPos.z).toBeCloseTo(-2, 5);
  });

  it('is a no-op when the object carries no contact shadow', () => {
    const obj = new THREE.Group();
    obj.position.set(0, 0.5, 0);
    expect(() => syncContactShadow(obj)).not.toThrow();
  });

  it('keeps the decal grounded through movePiece, including a move superseded mid-arc', () => {
    const queue = [];
    const originalRAF = globalThis.requestAnimationFrame;
    const originalNow = performance.now;
    let now = 1000;
    globalThis.requestAnimationFrame = (cb) => { queue.push(cb); };
    performance.now = () => now;

    try {
      const scene = Object.create(Scene.prototype);
      scene.pieces = new Map();

      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
      const obj = new THREE.Group();
      obj.add(shadow);
      obj.userData.contactShadow = shadow;

      const from = squareToWorld('e2');
      obj.position.set(from.x, 0, from.z);
      scene.pieces.set('e2', obj);

      const settled = [];
      scene.movePiece('e2', 'e4').then(() => settled.push('e2-e4'));
      expect(queue.length).toBe(1);

      // Advance mid-arc (half the 280ms duration) - not yet complete.
      now += 140;
      const firstStep = queue.shift();
      firstStep(now);
      obj.updateMatrixWorld(true);

      expect(obj.position.y).toBeGreaterThan(0); // mid-hop lift
      const worldPosMidArc = new THREE.Vector3();
      shadow.getWorldPosition(worldPosMidArc);
      expect(worldPosMidArc.y).toBeCloseTo(CONTACT_SHADOW_Y, 5);
      expect(queue.length).toBe(1); // re-queued its own continuation

      const midArcContinuation = queue.shift();

      // A second move (e.g. castling's chained rook slide, or a New Game
      // resync) supersedes the in-flight one before it finishes its arc.
      scene.movePiece('e4', 'e5').then(() => settled.push('e4-e5'));
      expect(queue.length).toBe(1); // the new move's own rAF

      // Simulate the piece's y having moved on again (e.g. the start of the
      // new move's own arc) before the stale continuation gets a chance to
      // run. Without this, y is unchanged between the mid-arc sync above and
      // resuming midArcContinuation below, so the test can't tell a real
      // syncContactShadow call in the superseded branch apart from the decal
      // simply never having moved - it would pass even with that call
      // deleted, which is exactly what happened during review.
      obj.position.y = 0.25;

      // Resuming the superseded continuation must NOT keep animating the
      // piece - it should ground the decal at wherever obj now sits and
      // resolve immediately. Without syncContactShadow on this branch, the
      // decal stays put at the mid-arc offset instead of tracking the y set
      // just above, and worldPosSuperseded.y would be CONTACT_SHADOW_Y - 0.35
      // instead of CONTACT_SHADOW_Y.
      midArcContinuation(now + 1);

      const worldPosSuperseded = new THREE.Vector3();
      obj.updateMatrixWorld(true);
      shadow.getWorldPosition(worldPosSuperseded);
      expect(worldPosSuperseded.y).toBeCloseTo(CONTACT_SHADOW_Y, 5);

      // Drain the superseding move's own rAF too, instead of leaving its
      // promise permanently unsettled once requestAnimationFrame is restored.
      now += 280;
      const secondMoveStep = queue.shift();
      secondMoveStep(now);

      return Promise.resolve().then(() => {
        expect(settled).toContain('e2-e4');
        expect(settled).toContain('e4-e5');
      });
    } finally {
      globalThis.requestAnimationFrame = originalRAF;
      performance.now = originalNow;
    }
  });
});
