import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BOARD_TEXTURES,
  CAMERA_MAX_POLAR_ANGLE,
  CAPTURE_DELAY,
  CAPTURE_DELAY_FRACTION,
  CAPTURE_DURATION,
  CAPTURE_SINK,
  CAPTURE_END_SCALE,
  CAPTURE_SINK_MARGIN,
  ENVIRONMENT_BLUR,
  LIGHT_RIG,
  MOVE_DEFAULT,
  MOVE_PROFILES,
  MOVE_SETTLE_MS,
  MOVE_DURATION_CLAMP,
  Scene,
  applyEnvironmentMap,
  applyThemeEnvIntensity,
  applyThemeFog,
  applyThemeLighting,
  captureDelayFor,
  createBoardMaterials,
  createChessBoard,
  createEnvironment,
  applyRendererQuality,
  moveDuration,
  moveProfile,
  syncContactShadow,
} from '../src/scene.js';
import { DEFAULT_FOG_DENSITY, getTheme } from '../src/themes.js';
import { isLightSquare, squareToWorld } from '../src/coords.js';
import { CONTACT_SHADOW_Y, PIECE_TYPES } from '../src/pieces.js';
import { MarkerLayer } from '../src/markers.js';

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
    const plainMaterial = new THREE.MeshStandardMaterial();
    const basicMaterial = new THREE.MeshBasicMaterial(); // not isMeshStandardMaterial
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), boardMaterial));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), plainMaterial));
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
    expect(plainMaterial.envMap).toBe(texture);
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
    // (fog should be negligible there); maxDistance is 28, where the board
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

  it('syncContactShadow keeps the decal grounded when the parent group is scaled (capture shrink)', () => {
    const parent = new THREE.Group();
    parent.position.set(1, 0.6, -2); // mid-hop
    parent.scale.setScalar(0.5);
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

  it('setSelection normalizes bare target strings to move markers and marks the square selected', () => {
    const scene = Object.create(Scene.prototype);
    scene.markers = new MarkerLayer(new THREE.Group());

    scene.setSelection('e2', ['e3', 'e4']);

    const selected = scene.markers._slots.get('selected');
    expect(selected).toHaveLength(1);
    expect(selected[0].userData.markerKind).toBe('selected');
    const e2 = squareToWorld('e2');
    expect(selected[0].position.x).toBeCloseTo(e2.x, 5);
    expect(selected[0].position.z).toBeCloseTo(e2.z, 5);

    const targets = scene.markers._slots.get('targets');
    expect(targets.map((m) => m.userData.markerKind)).toEqual(['move', 'move']);
  });

  it('setLastMove markers survive a clearSelection (same slot-independence invariant, at the public Scene API)', () => {
    const scene = Object.create(Scene.prototype);
    scene.markers = new MarkerLayer(new THREE.Group());

    scene.setLastMove('e2', 'e4');
    scene.setSelection('d2', ['d3', 'd4']);
    scene.clearSelection();

    const lastMove = scene.markers._slots.get('lastMove');
    expect(lastMove).toHaveLength(2);
    expect(lastMove.every((m) => m.parent === scene.markers.group)).toBe(true);
    expect(scene.markers._slots.get('selected')).toHaveLength(0);
    expect(scene.markers._slots.get('targets')).toHaveLength(0);
  });

  it('_resize forwards CSS pixel dimensions to the composer and still updates camera aspect', () => {
    // EffectComposer.setSize multiplies whatever it receives by the pixel
    // ratio captured at construction - passing device pixels here would
    // double-apply that ratio, so this must see the same CSS w/h that
    // renderer.setSize gets, not container.clientWidth * devicePixelRatio.
    const scene = Object.create(Scene.prototype);
    scene.container = { clientWidth: 800, clientHeight: 600 };
    const rendererSizes = [];
    scene.renderer = { setSize: (w, h) => rendererSizes.push([w, h]) };
    let composerSize = null;
    scene.post = { composer: { setSize: (w, h) => { composerSize = [w, h]; } } };
    scene.camera = { aspect: 0, updateProjectionMatrix: () => {} };

    scene._resize();

    expect(rendererSizes).toEqual([[800, 600]]);
    expect(composerSize).toEqual([800, 600]);
    expect(scene.camera.aspect).toBeCloseTo(800 / 600, 5);
  });

  it('_resize is a no-op on the composer when post is null (the fallback path)', () => {
    const scene = Object.create(Scene.prototype);
    scene.container = { clientWidth: 400, clientHeight: 300 };
    scene.renderer = { setSize: () => {} };
    scene.post = null;
    scene.camera = { aspect: 0, updateProjectionMatrix: () => {} };

    expect(() => scene._resize()).not.toThrow();
    expect(scene.camera.aspect).toBeCloseTo(400 / 300, 5);
  });

  it('_render renders through the composer when post is set, leaving renderer.render untouched', () => {
    const scene = Object.create(Scene.prototype);
    const rendererCalls = [];
    scene.renderer = { render: (...args) => rendererCalls.push(args) };
    scene.scene = { marker: 'scene' };
    scene.camera = { marker: 'camera' };
    let composerRenderCount = 0;
    scene.post = { composer: { render: () => { composerRenderCount += 1; } } };

    scene._render();

    expect(composerRenderCount).toBe(1);
    expect(rendererCalls).toHaveLength(0);
  });

  it('_render falls back to renderer.render(scene, camera) when post is null', () => {
    const scene = Object.create(Scene.prototype);
    const rendererCalls = [];
    scene.renderer = { render: (...args) => rendererCalls.push(args) };
    scene.scene = { marker: 'scene' };
    scene.camera = { marker: 'camera' };
    scene.post = null;

    scene._render();

    expect(rendererCalls).toEqual([[scene.scene, scene.camera]]);
  });
});

describe('thematic lighting', () => {
  // Real light instances (not fakes) so .color.set(...) exercises THREE's
  // actual Color parsing, matching what applyThemeLighting does in production.
  function makeRig(base = LIGHT_RIG.lit) {
    return {
      hemiLight: new THREE.HemisphereLight(0xf4fff4, 0x33402c, base.hemi),
      keyLight: new THREE.DirectionalLight(0xfff1cf, base.key),
      rimLight: new THREE.DirectionalLight(0xbad7ff, base.rim),
      base,
      renderer: { toneMappingExposure: base.exposure },
    };
  }

  function snapshot(rig) {
    return {
      hemi: rig.hemiLight.intensity,
      hemiSky: rig.hemiLight.color.getHexString(),
      hemiGround: rig.hemiLight.groundColor.getHexString(),
      key: rig.keyLight.intensity,
      keyColor: rig.keyLight.color.getHexString(),
      rim: rig.rimLight.intensity,
      rimColor: rig.rimLight.color.getHexString(),
      exposure: rig.renderer.toneMappingExposure,
    };
  }

  it('applyThemeLighting is idempotent: applying dusk twice yields identical values', () => {
    const rig = makeRig();
    applyThemeLighting(rig, getTheme('dusk'));
    const first = snapshot(rig);
    applyThemeLighting(rig, getTheme('dusk'));
    const second = snapshot(rig);
    expect(second).toEqual(first);
  });

  it('dusk then midnight lands exactly on LIGHT_RIG.lit\'s numbers and the original four colours — no compounding', () => {
    const rig = makeRig();
    applyThemeLighting(rig, getTheme('dusk'));
    applyThemeLighting(rig, getTheme('midnight'));

    expect(rig.hemiLight.intensity).toBeCloseTo(LIGHT_RIG.lit.hemi, 5);
    expect(rig.keyLight.intensity).toBeCloseTo(LIGHT_RIG.lit.key, 5);
    expect(rig.rimLight.intensity).toBeCloseTo(LIGHT_RIG.lit.rim, 5);
    expect(rig.renderer.toneMappingExposure).toBeCloseTo(LIGHT_RIG.lit.exposure, 5);

    expect(rig.hemiLight.color.getHexString()).toBe('f4fff4');
    expect(rig.hemiLight.groundColor.getHexString()).toBe('33402c');
    expect(rig.keyLight.color.getHexString()).toBe('fff1cf');
    expect(rig.rimLight.color.getHexString()).toBe('bad7ff');
  });

  it('composes with LIGHT_RIG.fallback: the same theme multipliers scale the fallback numbers, not override them', () => {
    const rig = makeRig(LIGHT_RIG.fallback);
    applyThemeLighting(rig, getTheme('dusk'));
    const { light } = getTheme('dusk');

    expect(rig.hemiLight.intensity).toBeCloseTo(LIGHT_RIG.fallback.hemi * light.hemiIntensity, 5);
    expect(rig.keyLight.intensity).toBeCloseTo(LIGHT_RIG.fallback.key * light.keyIntensity, 5);
    expect(rig.rimLight.intensity).toBeCloseTo(LIGHT_RIG.fallback.rim * light.rimIntensity, 5);
    expect(rig.renderer.toneMappingExposure)
      .toBeCloseTo(LIGHT_RIG.fallback.exposure * light.exposure, 5);
  });

  it('midnight is the identity theme: exactly 0.22/1.85/0.4, exposure 1.00, and the four base colours', () => {
    const rig = makeRig();
    applyThemeLighting(rig, getTheme('midnight'));

    expect(rig.hemiLight.intensity).toBeCloseTo(0.22, 5);
    expect(rig.keyLight.intensity).toBeCloseTo(1.85, 5);
    expect(rig.rimLight.intensity).toBeCloseTo(0.4, 5);
    expect(rig.renderer.toneMappingExposure).toBeCloseTo(1.00, 5);

    expect(rig.hemiLight.color.getHexString()).toBe('f4fff4');
    expect(rig.hemiLight.groundColor.getHexString()).toBe('33402c');
    expect(rig.keyLight.color.getHexString()).toBe('fff1cf');
    expect(rig.rimLight.color.getHexString()).toBe('bad7ff');
  });

  it('applyThemeEnvIntensity round-trips 1.2 -> 0.9 -> 1.0 back to exactly the board defaults, with material.version unchanged throughout', () => {
    const { light, dark, frame } = createBoardMaterials();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), light));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), dark));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), frame));
    const versions = { light: light.version, dark: dark.version, frame: frame.version };

    applyThemeEnvIntensity(root, 1.2);
    expect(light.envMapIntensity).toBeCloseTo(0.28 * 1.2, 5);
    expect(dark.envMapIntensity).toBeCloseTo(0.25 * 1.2, 5);
    expect(frame.envMapIntensity).toBeCloseTo(0.22 * 1.2, 5);

    applyThemeEnvIntensity(root, 0.9);
    expect(light.envMapIntensity).toBeCloseTo(0.28 * 0.9, 5);
    expect(dark.envMapIntensity).toBeCloseTo(0.25 * 0.9, 5);
    expect(frame.envMapIntensity).toBeCloseTo(0.22 * 0.9, 5);

    applyThemeEnvIntensity(root, 1.0);
    expect(light.envMapIntensity).toBeCloseTo(0.28, 5);
    expect(dark.envMapIntensity).toBeCloseTo(0.25, 5);
    expect(frame.envMapIntensity).toBeCloseTo(0.22, 5);

    // Plain uniform refresh — no needsUpdate, no shader recompile — proved by
    // an unchanged material.version across every call above.
    expect(light.version).toBe(versions.light);
    expect(dark.version).toBe(versions.dark);
    expect(frame.version).toBe(versions.frame);
  });

  it('setTheme does not throw on a lights-less Object.create(Scene.prototype) stub (existing tests build Scenes this way)', () => {
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
      // No keyLight/hemiLight/rimLight/renderer/_lightBase at all — the guard
      // in setTheme must skip applyThemeLighting entirely rather than throw.

      expect(() => scene.setTheme('dusk')).not.toThrow();
    } finally {
      globalThis.document = originalDocument;
    }
  });
});

describe('capture animation', () => {
  // Stubs requestAnimationFrame (into `queue`, so tests control exactly when
  // each frame runs) and performance.now (into a manually-advanced clock),
  // matching the harness the movePiece tests above already use.
  function withFakeClock(run) {
    const queue = [];
    const originalRAF = globalThis.requestAnimationFrame;
    const originalNow = performance.now;
    let now = 1000;
    globalThis.requestAnimationFrame = (cb) => { queue.push(cb); };
    performance.now = () => now;
    try {
      return run({ queue, advance: (ms) => { now += ms; } });
    } finally {
      globalThis.requestAnimationFrame = originalRAF;
      performance.now = originalNow;
    }
  }

  // Runs every currently-queued (and re-queued) rAF callback to completion,
  // advancing the fake clock 50ms per step. 60 steps * 50ms = 3000ms, well
  // past both CAPTURE_DELAY + CAPTURE_DURATION (340ms) and movePiece's 280ms.
  function drainAll(queue, advance) {
    for (let i = 0; i < 60 && queue.length; i++) {
      advance(50);
      queue.shift()(performance.now());
    }
  }

  // Builds a minimal stand-in for a pieces.js createPiece() group: one mesh
  // with owned (pieceInstanceGeometry-flagged) geometry, plus a contact-shadow
  // child wired up the same way createPiece/addContactShadow wire it, so
  // syncContactShadow has something to act on.
  function makePiece(square, { onGeometryDispose, material, height } = {}) {
    const geometry = new THREE.BoxGeometry();
    geometry.userData.pieceInstanceGeometry = true;
    if (onGeometryDispose) geometry.addEventListener('dispose', onGeometryDispose);
    const mesh = new THREE.Mesh(geometry, material ?? new THREE.MeshStandardMaterial());
    const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const obj = new THREE.Group();
    obj.add(mesh);
    obj.add(shadowMesh);
    obj.userData = { square, contactShadow: shadowMesh };
    // Only set when the caller passes one, so a test can exercise the
    // fallback path (userData.height missing) exactly like a piece built by
    // some path other than pieces.js#createPiece.
    if (height !== undefined) obj.userData.height = height;
    const { x, z } = squareToWorld(square);
    obj.position.set(x, 0, z);
    return { obj, mesh, shadowMesh, geometry };
  }

  function makeSceneStub() {
    const removed = [];
    const added = [];
    const scene = Object.create(Scene.prototype);
    scene.pieces = new Map();
    scene._dying = new Set();
    scene._boardGen = 0;
    scene.scene = {
      remove: (obj) => removed.push(obj),
      add: (obj) => added.push(obj),
    };
    return { scene, removed, added };
  }

  it('detaches the victim synchronously so a same-tick movePiece cannot clobber it (the clobber test)', () => withFakeClock(({ queue, advance }) => {
    const { scene } = makeSceneStub();
    let victimDisposeCount = 0;
    const { obj: victim } = makePiece('d5', { onGeometryDispose: () => { victimDisposeCount += 1; } });
    const { obj: attacker } = makePiece('e4');
    scene.pieces.set('d5', victim);
    scene.pieces.set('e4', attacker);

    scene.capturePiece('d5');
    scene.movePiece('e4', 'd5');

    // Immediate, same-tick assertions: the map write inside movePiece must
    // land on an already-emptied slot, not clobber the victim's entry.
    expect(scene.pieces.get('d5')).toBe(attacker);
    expect(scene._dying.has(victim)).toBe(true);
    expect(scene.pieces.size).toBe(1);

    drainAll(queue, advance);

    expect(scene.pieces.get('d5')).toBe(attacker);
    expect(victimDisposeCount).toBe(1);
  }));

  it('does not move or shrink the victim before CAPTURE_DELAY elapses (the literal bug being fixed)', () => withFakeClock(({ queue, advance }) => {
    const { scene, removed } = makeSceneStub();
    const { obj: victim } = makePiece('d5');
    scene.pieces.set('d5', victim);

    scene.capturePiece('d5');
    expect(queue.length).toBe(1);

    advance(50); // < CAPTURE_DELAY (110ms) — the attacker hasn't arrived yet
    expect(50).toBeLessThan(CAPTURE_DELAY);
    queue.shift()(performance.now());

    expect(victim.position.y).toBe(0);
    expect(victim.scale.y).toBe(1);
    expect(removed).not.toContain(victim);
    expect(queue.length).toBe(1); // re-queued its own continuation, still hanging
  }));

  it('en passant: the victim (on a different square than the attacker lands on) is destroyed independently', () => withFakeClock(({ queue, advance }) => {
    const { scene, removed } = makeSceneStub();
    let victimDisposeCount = 0;
    const { obj: victim } = makePiece('d5', { onGeometryDispose: () => { victimDisposeCount += 1; } });
    const { obj: attacker } = makePiece('e5');
    scene.pieces.set('d5', victim);
    scene.pieces.set('e5', attacker);

    expect(removed).not.toContain(victim); // present at t=0

    scene.capturePiece('d5');
    scene.movePiece('e5', 'd6');

    // `pieces` never holds a conflicting 'd5' entry: capturePiece already
    // emptied it, and the attacker's destination is 'd6', not 'd5'.
    expect(scene.pieces.has('d5')).toBe(false);
    expect(scene.pieces.get('d6')).toBe(attacker);

    drainAll(queue, advance);

    expect(victimDisposeCount).toBe(1);
    expect(scene.pieces.get('d6')).toBe(attacker);
  }));

  it('keeps the contact-shadow decal welded to the board plane while the victim group is shrinking', () => withFakeClock(({ queue, advance }) => {
    const { scene } = makeSceneStub();
    const { obj: victim, shadowMesh } = makePiece('d5');
    scene.pieces.set('d5', victim);

    scene.capturePiece('d5');

    const expectGrounded = () => {
      victim.updateMatrixWorld(true);
      const worldPos = new THREE.Vector3();
      shadowMesh.getWorldPosition(worldPos);
      expect(worldPos.y).toBeCloseTo(CONTACT_SHADOW_Y, 5);
    };

    advance(CAPTURE_DELAY + 20); // just past the hang, early in the sink
    queue.shift()(performance.now());
    expectGrounded();

    advance(CAPTURE_DURATION / 2); // mid-sink, mid-shrink
    queue.shift()(performance.now());
    expectGrounded();

    advance(CAPTURE_DURATION); // well past completion
    queue.shift()(performance.now());
    expectGrounded();
  }));

  it('clearPieces mid-capture destroys the victim once; the still-queued rAF continuation is a no-op', () => withFakeClock(({ queue, advance }) => {
    const { scene, removed } = makeSceneStub();
    let disposeCount = 0;
    const { obj: victim } = makePiece('d5', { onGeometryDispose: () => { disposeCount += 1; } });
    scene.pieces.set('d5', victim);

    const capturePromise = scene.capturePiece('d5');
    expect(queue.length).toBe(1);

    scene.clearPieces();

    expect(removed).toContain(victim);
    expect(disposeCount).toBe(1);
    expect(scene._dying.size).toBe(0);

    // Invoke the continuation clearPieces left behind in the queue: it must
    // see the bumped _boardGen and bail out instead of re-destroying victim.
    advance(50);
    queue.shift()(performance.now());
    expect(disposeCount).toBe(1);

    return capturePromise.then(() => {
      expect(disposeCount).toBe(1);
    });
  }));

  it('capture + promotion on the same square (capturePiece(to) then removePieceAt(to)) are handled independently', () => withFakeClock(({ queue, advance }) => {
    const { scene } = makeSceneStub();
    let victimDisposeCount = 0;
    let pawnDisposeCount = 0;
    const { obj: victim } = makePiece('e8', { onGeometryDispose: () => { victimDisposeCount += 1; } });
    const { obj: pawn } = makePiece('e7', { onGeometryDispose: () => { pawnDisposeCount += 1; } });
    scene.pieces.set('e8', victim);
    scene.pieces.set('e7', pawn);

    // Capture on the 8th rank: the pawn takes the piece standing on e8...
    scene.capturePiece('e8');
    scene.movePiece('e7', 'e8');

    expect(scene.pieces.get('e8')).toBe(pawn);
    expect(scene._dying.has(victim)).toBe(true);

    drainAll(queue, advance);

    expect(victimDisposeCount).toBe(1);
    expect(scene._dying.size).toBe(0);

    // ...then promotes: the pawn that just landed on e8 is itself replaced.
    scene.removePieceAt('e8');
    expect(pawnDisposeCount).toBe(1);

    const { obj: queen } = makePiece('e8');
    scene.placePiece('e8', queen);

    expect(scene.pieces.get('e8')).toBe(queen);
    expect(scene._dying.has(queen)).toBe(false);
  }));

  it('mutates no material during the sink (proves no fade/clone crept in)', () => withFakeClock(({ queue, advance }) => {
    const { scene } = makeSceneStub();
    const sharedMaterial = new THREE.MeshStandardMaterial({ transparent: false, opacity: 1 });
    let materialDisposed = false;
    sharedMaterial.addEventListener('dispose', () => { materialDisposed = true; });

    const { obj: victim, mesh: victimMesh } = makePiece('d5', { material: sharedMaterial });
    const { obj: attacker, mesh: attackerMesh } = makePiece('e4', { material: sharedMaterial });
    scene.pieces.set('d5', victim);
    scene.pieces.set('e4', attacker);

    scene.capturePiece('d5');
    scene.movePiece('e4', 'd5');

    drainAll(queue, advance);

    expect(victimMesh.material).toBe(attackerMesh.material);
    expect(victimMesh.material.transparent).toBe(false);
    expect(victimMesh.material.opacity).toBe(1);
    expect(materialDisposed).toBe(false);
  }));

  it('derives the sink from the piece\'s own recorded height, clearing a piece taller than the king', () => withFakeClock(({ queue, advance }) => {
    // 2.5 world units is deliberately far taller than TARGET_KING_HEIGHT
    // (1.4) — the exact "queen taller than king" scenario the fixed
    // CAPTURE_SINK constant assumed could never happen. Prove the OLD fixed
    // constant would have failed this piece first, so the assertion below
    // isn't vacuously true for any sink value.
    const height = 2.5;
    const scaledHeight = height * CAPTURE_END_SCALE;
    expect(CAPTURE_SINK).toBeLessThan(scaledHeight); // old constant: piece would poke above y=0

    const { scene } = makeSceneStub();
    const { obj: victim } = makePiece('d5', { height });
    scene.pieces.set('d5', victim);

    scene.capturePiece('d5');
    drainAll(queue, advance);

    // Final frame: ease = 1, so scale.y is exactly CAPTURE_END_SCALE and
    // position.y is startY - (derived sink).
    expect(victim.scale.y).toBeCloseTo(CAPTURE_END_SCALE, 5);
    const derivedSink = Math.max(CAPTURE_SINK, scaledHeight + CAPTURE_SINK_MARGIN);
    expect(victim.position.y).toBeCloseTo(-derivedSink, 5);

    // The piece's own scaled top must land strictly below the board (y=0),
    // not just "lower than before".
    const top = victim.position.y + scaledHeight;
    expect(top).toBeLessThan(0);
  }));

  it('falls back to the fixed CAPTURE_SINK when the piece carries no recorded height', () => withFakeClock(({ queue, advance }) => {
    const { scene } = makeSceneStub();
    // No `height` option: mirrors a piece built by some path other than
    // pieces.js#createPiece, which never set userData.height.
    const { obj: victim } = makePiece('d5');
    expect(victim.userData.height).toBeUndefined();
    scene.pieces.set('d5', victim);

    scene.capturePiece('d5');
    drainAll(queue, advance);

    expect(victim.scale.y).toBeCloseTo(CAPTURE_END_SCALE, 5);
    expect(victim.position.y).toBeCloseTo(-CAPTURE_SINK, 5);
  }));

  it('capturePiece on an empty square resolves immediately without queuing a frame', () => withFakeClock(({ queue }) => {
    const { scene } = makeSceneStub();
    const promise = scene.capturePiece('d5');
    expect(queue.length).toBe(0);
    return promise;
  }));
});

describe('move profiles and settle', () => {
  // Same stubbed-rAF + stubbed-performance.now harness as the describes above.
  function withFakeClock(run) {
    const queue = [];
    const originalRAF = globalThis.requestAnimationFrame;
    const originalNow = performance.now;
    let now = 1000;
    globalThis.requestAnimationFrame = (cb) => { queue.push(cb); };
    performance.now = () => now;
    try {
      return run({ queue, advance: (ms) => { now += ms; } });
    } finally {
      globalThis.requestAnimationFrame = originalRAF;
      performance.now = originalNow;
    }
  }

  function drainAll(queue, advance, steps = 80) {
    for (let i = 0; i < steps && queue.length; i++) {
      advance(10);
      queue.shift()(performance.now());
    }
  }

  // Minimal stand-in for a pieces.js createPiece() group, typed this time -
  // real pieces always carry userData.type; only test stubs and the
  // capture-animation describe above deliberately omit it.
  function makeTypedPiece(square, type) {
    const geometry = new THREE.BoxGeometry();
    geometry.userData.pieceInstanceGeometry = true;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const obj = new THREE.Group();
    obj.add(mesh);
    obj.add(shadowMesh);
    obj.userData = { square, type, contactShadow: shadowMesh };
    const { x, z } = squareToWorld(square);
    obj.position.set(x, 0, z);
    return obj;
  }

  function makeSceneStub() {
    const scene = Object.create(Scene.prototype);
    scene.pieces = new Map();
    scene._dying = new Set();
    scene._boardGen = 0;
    scene.scene = { remove: () => {}, add: () => {} };
    return scene;
  }

  it('MOVE_PROFILES has an entry for every PIECE_TYPES letter; knight lift is the max; king duration is the max; every settle is in [0, 0.08]', () => {
    for (const type of PIECE_TYPES) expect(MOVE_PROFILES[type]).toBeDefined();

    const lifts = PIECE_TYPES.map((type) => MOVE_PROFILES[type].lift);
    expect(MOVE_PROFILES.n.lift).toBe(Math.max(...lifts));

    const durations = PIECE_TYPES.map((type) => MOVE_PROFILES[type].duration);
    expect(MOVE_PROFILES.k.duration).toBe(Math.max(...durations));

    for (const type of PIECE_TYPES) {
      expect(MOVE_PROFILES[type].settle).toBeGreaterThanOrEqual(0);
      expect(MOVE_PROFILES[type].settle).toBeLessThanOrEqual(0.08);
    }
  });

  it('moveDuration is monotone non-decreasing in distance and clamped at both ends', () => {
    const [min, max] = MOVE_DURATION_CLAMP;
    for (const type of [...PIECE_TYPES, undefined]) {
      let previous = -Infinity;
      for (const distance of [0, 0.5, 1, 2, 4, 7, 9.9, 50, 1000]) {
        const duration = moveDuration(type, distance);
        expect(duration).toBeGreaterThanOrEqual(previous);
        expect(duration).toBeGreaterThanOrEqual(min);
        expect(duration).toBeLessThanOrEqual(max);
        previous = duration;
      }
    }
    // The clamp must actually be reachable, not just a no-op ceiling — but only
    // for real profiles. MOVE_DEFAULT deliberately has no distance term at all
    // (it reproduces the flat pre-profile 280ms), so it never reaches the
    // ceiling; that flatness is asserted separately below.
    for (const type of PIECE_TYPES) {
      expect(moveDuration(type, 1000)).toBe(max);
    }
    expect(moveDuration(undefined, 1000)).toBe(MOVE_DEFAULT.duration);
    expect(moveDuration(undefined, 0)).toBe(MOVE_DEFAULT.duration);
  });

  it('moveProfile(undefined) === MOVE_DEFAULT, and MOVE_DEFAULT is the compatibility lock {280, 0.60, 0}', () => {
    expect(moveProfile(undefined)).toBe(MOVE_DEFAULT);
    expect(MOVE_DEFAULT).toEqual({ duration: 280, lift: 0.60, settle: 0 });
  });

  it('a typed knight move arcs higher than a typed rook at the same arc fraction, position.y never negative, scale.y stays within [0.94, 1]', () => {
    // Each piece gets its own isolated fake-clock scope (withFakeClock stubs
    // requestAnimationFrame/performance.now globally for the duration of the
    // callback), sampling position.y/scale.y every frame at 10 evenly spaced
    // fractions of ITS OWN duration - which is exactly "the same arc
    // fraction" for pieces whose real durations differ.
    function sampleArc(type, from, to) {
      return withFakeClock(({ queue, advance }) => {
        const scene = makeSceneStub();
        const obj = makeTypedPiece(from, type);
        scene.pieces.set(from, obj);
        scene.movePiece(from, to);
        const duration = moveDuration(type, 1);
        const step = duration / 10;
        const ys = [];
        for (let i = 0; i <= 10 && queue.length; i++) {
          advance(i === 0 ? 0 : step);
          queue.shift()(performance.now());
          expect(obj.position.y).toBeGreaterThanOrEqual(0);
          expect(obj.scale.y).toBeGreaterThanOrEqual(0.94);
          expect(obj.scale.y).toBeLessThanOrEqual(1);
          ys.push(obj.position.y);
        }
        return ys;
      });
    }

    const knightYs = sampleArc('n', 'g1', 'f3');
    const rookYs = sampleArc('r', 'a1', 'a4');
    const midIndex = Math.min(5, knightYs.length - 1, rookYs.length - 1);
    expect(knightYs[midIndex]).toBeGreaterThan(rookYs[midIndex]);
  });

  it('terminal frame: position is exactly squareToWorld(to) with y === 0, scale is exactly (1,1,1)', () => withFakeClock(({ queue, advance }) => {
    const scene = makeSceneStub();
    const knight = makeTypedPiece('b1', 'n');
    scene.pieces.set('b1', knight);

    scene.movePiece('b1', 'c3');
    drainAll(queue, advance);

    const end = squareToWorld('c3');
    expect(knight.position.x).toBe(end.x);
    expect(knight.position.y).toBe(0);
    expect(knight.position.z).toBe(end.z);
    expect(knight.scale.x).toBe(1);
    expect(knight.scale.y).toBe(1);
    expect(knight.scale.z).toBe(1);
  }));

  it('supersede DURING the settle (not just mid-arc): scale is restored to exactly 1, the decal stays grounded, and the promise resolves', () => withFakeClock(({ queue, advance }) => {
    const scene = makeSceneStub();
    const knight = makeTypedPiece('b1', 'n');
    scene.pieces.set('b1', knight);
    const shadowMesh = knight.userData.contactShadow;

    let settled = false;
    scene.movePiece('b1', 'c3').then(() => { settled = true; });

    const { settle } = MOVE_PROFILES.n;
    const duration = moveDuration('n', Math.hypot(1, 2)); // b1 -> c3
    expect(settle).toBeGreaterThan(0);

    // Drain past the arc, one settle half-step into the squash.
    advance(duration + MOVE_SETTLE_MS / 2);
    queue.shift()(performance.now());
    expect(knight.scale.y).toBeLessThan(1); // mid-squash, proves settle is live
    const staleSettleContinuation = queue.shift(); // its own re-queued settle frame

    // A second move (e.g. castling's chained rook slide, or a New Game
    // resync) supersedes the in-flight settle before it finishes.
    scene.movePiece('c3', 'c4');
    expect(queue.length).toBe(1); // the new move's own rAF

    // Resuming the stale settle continuation must ground out immediately:
    // reset scale to exactly 1 (not leave the piece squashed forever) and
    // sync the decal, then resolve the FIRST move's promise.
    staleSettleContinuation(performance.now() + 1);

    expect(knight.scale.y).toBe(1);
    knight.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    shadowMesh.getWorldPosition(worldPos);
    expect(worldPos.y).toBeCloseTo(CONTACT_SHADOW_Y, 5);

    // Drain the superseding move's own rAF too, so its promise settles.
    drainAll(queue, advance);

    return Promise.resolve().then(() => expect(settled).toBe(true));
  }));

  it('clearPieces() during a settle bails out and mutates nothing further', () => withFakeClock(({ queue, advance }) => {
    const scene = makeSceneStub();
    const knight = makeTypedPiece('b1', 'n');
    scene.pieces.set('b1', knight);

    let settled = false;
    scene.movePiece('b1', 'c3').then(() => { settled = true; });

    const duration = moveDuration('n', Math.hypot(1, 2)); // b1 -> c3
    advance(duration + MOVE_SETTLE_MS / 2);
    queue.shift()(performance.now());
    const squashedScale = knight.scale.y;
    expect(squashedScale).toBeLessThan(1);
    expect(queue.length).toBe(1); // its own re-queued settle continuation

    scene._boardGen++; // what clearPieces() does before tearing pieces down

    const continuation = queue.shift();
    continuation(performance.now() + 1);

    expect(knight.scale.y).toBe(1);
    expect(queue.length).toBe(0); // no further frame queued - nothing left to mutate

    return Promise.resolve().then(() => expect(settled).toBe(true));
  }));

  it('captureDelayFor(MOVE_DEFAULT.duration) === CAPTURE_DELAY (the old "~40% into 280ms" prose, now an assertion)', () => {
    expect(CAPTURE_DELAY_FRACTION).toBeCloseTo(CAPTURE_DELAY / MOVE_DEFAULT.duration, 10);
    expect(captureDelayFor(MOVE_DEFAULT.duration)).toBe(CAPTURE_DELAY);
  });

  it('lockout budget: moveDuration(type, dist) + MOVE_SETTLE_MS never exceeds 520ms, for every type at every legal distance', () => {
    const legalDistances = [1, Math.SQRT2, 2, 3, 4, 5, 6, 7, 7 * Math.SQRT2, Math.hypot(1, 2)];
    for (const type of [...PIECE_TYPES, undefined]) {
      for (const distance of legalDistances) {
        expect(moveDuration(type, distance) + MOVE_SETTLE_MS).toBeLessThanOrEqual(520);
      }
    }
  });
});
