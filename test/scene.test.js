import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import * as THREE from 'three';
import {
  BOARD_TEXTURES,
  CAMERA_MAX_POLAR_ANGLE,
  Scene,
  createBoardMaterials,
  createChessBoard,
  createStoneMaterial,
  createStoneTable,
  applyRendererQuality,
} from '../src/scene.js';
import { THEMES } from '../src/themes.js';

describe('scene rendering helpers', () => {
  it('clamps camera rotation above board level', () => {
    expect(CAMERA_MAX_POLAR_ANGLE).toBeCloseTo(Math.PI / 2 - 0.04, 5);
  });

  it('creates premium board materials', () => {
    const { light, dark, frame } = createBoardMaterials();

    expect(light).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(dark).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(frame).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(light.color.getHex()).toBe(0xdac799);
    expect(dark.color.getHex()).toBe(0x724528);
    expect(frame.color.getHex()).toBe(0x2c2018);
    expect(light.clearcoat).toBeGreaterThan(0);
    expect(dark.clearcoat).toBeGreaterThan(0);
  });

  it('describes burl texture assets for the board woods', () => {
    expect(BOARD_TEXTURES.light.url).toBe('textures/board/maple-burl.svg');
    expect(BOARD_TEXTURES.dark.url).toBe('textures/board/walnut-burl.svg');
    expect(BOARD_TEXTURES.frame.url).toBe('textures/board/walnut-burl.svg');
    expect(BOARD_TEXTURES.light.repeat[0]).toBeGreaterThan(0);
    expect(BOARD_TEXTURES.dark.repeat[1]).toBeGreaterThan(0);
  });

  it('loads burl texture maps into compatible board materials', () => {
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
      '/game/textures/board/maple-burl.svg',
      '/game/textures/board/walnut-burl.svg',
      '/game/textures/board/walnut-burl.svg',
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

  it('varies burl texture placement across neighboring squares', () => {
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
    expect(renderer.toneMappingExposure).toBeCloseTo(1.08, 5);
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
});

// makeGradientTexture (called from Scene#setTheme) needs `document.createElement('canvas')`.
// The test suite runs in a plain Node environment (no DOM), so we stub just enough of
// the canvas API for THREE.CanvasTexture to be constructed without touching the GPU.
function stubCanvasDocument() {
  const fakeContext = {
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {},
  };
  const fakeCanvas = { getContext: () => fakeContext };
  vi.stubGlobal('document', { createElement: () => fakeCanvas });
}

function makeThemableScene() {
  const scene = Object.create(Scene.prototype);
  scene.scene = { add: vi.fn(), remove: vi.fn() };
  scene._bgTexture = null;
  scene._starfield = null;
  return scene;
}

describe('Scene theme backdrop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies a gradient background and records the resolved theme key', () => {
    stubCanvasDocument();
    const scene = makeThemableScene();

    scene.setTheme('walnut');

    expect(scene._bgTexture).toBeInstanceOf(THREE.CanvasTexture);
    expect(scene.scene.background).toBe(scene._bgTexture);
    expect(scene.currentTheme).toBe('walnut');
  });

  it('falls back to the first theme when given an unknown key', () => {
    stubCanvasDocument();
    const scene = makeThemableScene();

    scene.setTheme('not-a-real-theme');

    // getTheme() falls back to THEMES[0]; setTheme now stores the *resolved*
    // key rather than echoing back whatever invalid key was passed in.
    expect(scene.currentTheme).toBe(THEMES[0].key);
    expect(scene.currentTheme).not.toBe('not-a-real-theme');
  });

  it('adds a starfield only for themes that request one', () => {
    stubCanvasDocument();
    const scene = makeThemableScene();

    scene.setTheme('cosmos');

    expect(scene._starfield).not.toBeNull();
    expect(scene._starfield.isPoints).toBe(true);
    expect(scene.scene.add).toHaveBeenCalledWith(scene._starfield);
  });

  it('leaves the starfield unset for non-star themes', () => {
    stubCanvasDocument();
    const scene = makeThemableScene();

    scene.setTheme('midnight');

    expect(scene._starfield).toBeNull();
  });

  it('disposes the previous backdrop before applying a new theme', () => {
    stubCanvasDocument();
    const scene = makeThemableScene();
    scene.setTheme('cosmos');
    const oldTexture = scene._bgTexture;
    const oldStarfield = scene._starfield;
    const textureDispose = vi.spyOn(oldTexture, 'dispose');
    const geomDispose = vi.spyOn(oldStarfield.geometry, 'dispose');
    const matDispose = vi.spyOn(oldStarfield.material, 'dispose');

    scene.setTheme('midnight');

    expect(textureDispose).toHaveBeenCalled();
    expect(geomDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
    expect(scene.scene.remove).toHaveBeenCalledWith(oldStarfield);
    expect(scene._starfield).toBeNull();
  });

  it('no longer manages a "scenery" landmark group when clearing the backdrop', () => {
    stubCanvasDocument();
    const scene = makeThemableScene();
    // Simulate a stray legacy field: the retired scenery-clearing code path
    // must not exist anymore, so this object should be left untouched.
    const legacyScenery = { removed: false };
    scene._scenery = legacyScenery;

    scene.setTheme('midnight');

    expect(scene.scene.remove).not.toHaveBeenCalledWith(legacyScenery);
    expect(scene._scenery).toBe(legacyScenery);
  });
});
