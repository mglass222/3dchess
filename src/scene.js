import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  allSquares, squareToWorld, worldToSquare, isLightSquare, fileIndex, rankIndex,
} from './coords.js';
import { getTheme, makeGradientTexture, makeStarfield, DEFAULT_THEME } from './themes.js';

const LIGHT_SQ = 0xdac799;
const DARK_SQ = 0x724528;

export const CAMERA_MAX_POLAR_ANGLE = Math.PI / 2 - 0.04;
export const BOARD_TEXTURES = {
  light: {
    url: 'textures/board/maple-burl.svg',
    repeat: [1.8, 1.8],
    anisotropy: 8,
  },
  dark: {
    url: 'textures/board/walnut-burl.svg',
    repeat: [1.65, 1.65],
    anisotropy: 8,
  },
  frame: {
    url: 'textures/board/walnut-burl.svg',
    repeat: [2.5, 2.5],
    anisotropy: 8,
  },
};

export function applyRendererQuality(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
}

function textureUrl(baseUrl, path) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${path}`;
}

function configureBoardTexture(texture, descriptor, transform = {}) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(descriptor.repeat[0], descriptor.repeat[1]);
  texture.offset.set(transform.offsetX ?? 0, transform.offsetY ?? 0);
  texture.center.set(0.5, 0.5);
  texture.rotation = transform.rotation ?? 0;
  texture.anisotropy = descriptor.anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function loadBoardTexture(textureLoader, key, baseUrl) {
  const descriptor = BOARD_TEXTURES[key];
  const url = textureUrl(baseUrl, descriptor.url);
  const texture = textureLoader.load(url, undefined, undefined, (error) => {
    console.warn(`Failed to load board texture "${key}" from ${url}`, error);
  });
  texture.name = key === 'light' ? 'maple-burl' : 'walnut-burl';
  return configureBoardTexture(texture, descriptor);
}

function boardSquareTextureTransform(square) {
  const file = fileIndex(square);
  const rank = rankIndex(square);
  return {
    offsetX: (file * 0.173 + rank * 0.071) % 1,
    offsetY: (rank * 0.137 + file * 0.047) % 1,
    rotation: ((file + rank) % 4) * (Math.PI / 2),
  };
}

function createBoardSquareMaterial(baseMaterial, textureKey, square) {
  if (!baseMaterial.map) return baseMaterial;
  const material = baseMaterial.clone();
  material.map = baseMaterial.map.clone();
  configureBoardTexture(
    material.map,
    BOARD_TEXTURES[textureKey],
    boardSquareTextureTransform(square),
  );
  return material;
}

export function createBoardMaterials({
  textureLoader = null,
  baseUrl = import.meta.env.BASE_URL,
} = {}) {
  const lightMap = textureLoader ? loadBoardTexture(textureLoader, 'light', baseUrl) : null;
  const darkMap = textureLoader ? loadBoardTexture(textureLoader, 'dark', baseUrl) : null;
  const frameMap = textureLoader ? loadBoardTexture(textureLoader, 'frame', baseUrl) : null;
  return {
    light: new THREE.MeshPhysicalMaterial({
      color: LIGHT_SQ,
      map: lightMap,
      roughness: 0.44,
      metalness: 0.02,
      clearcoat: 0.26,
      clearcoatRoughness: 0.45,
      userData: { boardTexture: BOARD_TEXTURES.light },
    }),
    dark: new THREE.MeshPhysicalMaterial({
      color: DARK_SQ,
      map: darkMap,
      roughness: 0.48,
      metalness: 0.03,
      clearcoat: 0.22,
      clearcoatRoughness: 0.5,
      userData: { boardTexture: BOARD_TEXTURES.dark },
    }),
    frame: new THREE.MeshPhysicalMaterial({
      color: 0x2c2018,
      map: frameMap,
      roughness: 0.5,
      metalness: 0.04,
      clearcoat: 0.18,
      clearcoatRoughness: 0.38,
      userData: { boardTexture: BOARD_TEXTURES.frame },
    }),
  };
}

export function createStoneMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x7d7868,
    roughness: 0.94,
    metalness: 0,
  });
}

export function createStoneTable() {
  const table = new THREE.Group();
  table.name = 'stone-table';
  const stone = createStoneMaterial();

  const slab = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.42, 10.4), stone);
  slab.position.y = -0.55;
  slab.castShadow = true;
  slab.receiveShadow = true;
  table.add(slab);

  const bevel = new THREE.Mesh(new THREE.CylinderGeometry(7.25, 7.5, 0.28, 8), stone);
  bevel.position.y = -0.83;
  bevel.rotation.y = Math.PI / 8;
  bevel.castShadow = true;
  bevel.receiveShadow = true;
  table.add(bevel);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.35, 1.95, 12), stone);
  pedestal.position.y = -1.93;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  table.add(pedestal);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.35, 4.8, 0.38, 12), stone);
  base.position.y = -3.1;
  base.castShadow = true;
  base.receiveShadow = true;
  table.add(base);

  return table;
}

function disposePieceGeometries(object3d) {
  const disposed = new Set();
  object3d.traverse((child) => {
    const geometry = child.isMesh ? child.geometry : null;
    if (!geometry?.userData?.pieceInstanceGeometry || disposed.has(geometry)) return;
    geometry.dispose();
    disposed.add(geometry);
  });
}

export function createChessBoard({
  textureLoader = null,
  baseUrl = import.meta.env.BASE_URL,
} = {}) {
  const board = new THREE.Group();
  board.name = 'chess-board';
  const tile = new THREE.BoxGeometry(1, 0.18, 1);
  const { light, dark, frame } = createBoardMaterials({ textureLoader, baseUrl });

  for (const sq of allSquares()) {
    const { x, z } = squareToWorld(sq);
    const textureKey = isLightSquare(sq) ? 'light' : 'dark';
    const baseMaterial = textureKey === 'light' ? light : dark;
    const mesh = new THREE.Mesh(
      tile,
      createBoardSquareMaterial(baseMaterial, textureKey, sq),
    );
    mesh.name = `square-${sq}`;
    mesh.position.set(x, -0.09, z); // top face at y=0
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    board.add(mesh);
  }

  const frameMesh = new THREE.Mesh(
    new THREE.BoxGeometry(8.8, 0.34, 8.8),
    frame,
  );
  frameMesh.position.y = -0.2;
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  board.add(frameMesh);

  const inset = new THREE.Mesh(
    new THREE.BoxGeometry(8.05, 0.08, 8.05),
    frame,
  );
  inset.position.y = -0.08;
  inset.receiveShadow = true;
  board.add(inset);

  return board;
}

export class Scene {
  constructor(container) {
    this.container = container;
    this.pieces = new Map();      // square -> Object3D
    this.highlights = [];         // Mesh[]

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    applyRendererQuality(this.renderer);
    container.appendChild(this.renderer.domElement);
    this.domElement = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this._bgTexture = null;
    this._starfield = null;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 9, 9);

    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 28;
    // Orbit-only: full 360deg around (azimuth unconstrained), tilt from near
    // top-down to just above board level; clamp shy of the poles to avoid flip.
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = CAMERA_MAX_POLAR_ANGLE;

    this._addLights();
    this._buildBoard();
    this.setTheme(DEFAULT_THEME);

    // Invisible plane at the board top for raycasting empty squares.
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.pickPlane);

    this.raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    this._highlightGeom = new THREE.RingGeometry(0.30, 0.42, 32);
    this._highlightMat = new THREE.MeshBasicMaterial({
      color: 0x49e0a0, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });

    window.addEventListener('resize', () => this._resize());
    this._resize();
    this._animate();
  }

  _addLights() {
    this.scene.add(new THREE.HemisphereLight(0xf4fff4, 0x33402c, 0.7));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    const key = new THREE.DirectionalLight(0xfff1cf, 2.3);
    key.position.set(6.5, 11, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 42;
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.bias = -0.00015;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xbad7ff, 0.65);
    rim.position.set(-8, 5, -7);
    this.scene.add(rim);
  }

  _buildBoard() {
    const table = createStoneTable();
    this.scene.add(table);

    this.scene.add(createChessBoard({ textureLoader: new THREE.TextureLoader() }));
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  placePiece(square, object3d) {
    const { x, z } = squareToWorld(square);
    object3d.position.set(x, 0, z);
    object3d.userData.square = square;
    this.pieces.set(square, object3d);
    this.scene.add(object3d);
  }

  removePieceAt(square) {
    const obj = this.pieces.get(square);
    if (!obj) return;
    this.pieces.delete(square);
    this.scene.remove(obj);
    disposePieceGeometries(obj);
    // Piece materials are shared app-wide and owned by pieces.js, so they live on.
  }

  clearPieces() {
    for (const square of [...this.pieces.keys()]) this.removePieceAt(square);
  }

  // Animate the piece currently on `from` to `to`. Returns a promise that
  // resolves when the slide completes. Updates the internal square map.
  // A generation stamp makes a newer move on the same piece supersede an
  // in-flight one (the older animation resolves early instead of fighting it).
  movePiece(from, to) {
    const obj = this.pieces.get(from);
    if (!obj) return Promise.resolve();
    this.pieces.delete(from);
    this.pieces.set(to, obj);
    obj.userData.square = to;

    const myGen = (obj.userData._moveGen = (obj.userData._moveGen ?? 0) + 1);
    const start = obj.position.clone();
    const end = squareToWorld(to);
    const lift = 0.6;
    const duration = 280; // ms
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        if (obj.userData._moveGen !== myGen) { resolve(); return; } // superseded
        const t = Math.min(1, (now - t0) / duration);
        const ease = t * t * (3 - 2 * t); // smoothstep
        obj.position.x = start.x + (end.x - start.x) * ease;
        obj.position.z = start.z + (end.z - start.z) * ease;
        obj.position.y = Math.sin(t * Math.PI) * lift; // arc hop
        if (t < 1) requestAnimationFrame(step);
        else { obj.position.set(end.x, 0, end.z); resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  setHighlights(squares) {
    this.clearHighlights();
    for (const sq of squares) {
      const ring = new THREE.Mesh(this._highlightGeom, this._highlightMat);
      const { x, z } = squareToWorld(sq);
      ring.position.set(x, 0.02, z);
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(ring);
      this.highlights.push(ring);
    }
  }

  clearHighlights() {
    // Do NOT dispose ring.geometry/material — they are the shared
    // _highlightGeom/_highlightMat singletons owned by the Scene.
    for (const ring of this.highlights) this.scene.remove(ring);
    this.highlights = [];
  }

  // Apply a theme: a gradient sky, plus optional starfield.
  setTheme(key) {
    const theme = getTheme(key);
    this._clearBackdrop();

    this._bgTexture = makeGradientTexture(theme.top, theme.bottom);
    this.scene.background = this._bgTexture;
    if (theme.stars) {
      this._starfield = makeStarfield();
      this.scene.add(this._starfield);
    }
    this.currentTheme = theme.key;
  }

  _clearBackdrop() {
    if (this._bgTexture) { this._bgTexture.dispose(); this._bgTexture = null; }
    if (this._starfield) {
      this.scene.remove(this._starfield);
      this._starfield.geometry.dispose();
      this._starfield.material.dispose();
      this._starfield = null;
    }
  }

  // Raycast a pointer event to a square. Prefers a hit on a piece (so tall pieces
  // can be clicked), else falls back to the board plane.
  pickSquare(event) {
    const rect = this.domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this._pointer, this.camera);

    const pieceObjs = [...this.pieces.values()];
    const pieceHit = this.raycaster.intersectObjects(pieceObjs, true)[0];
    if (pieceHit) {
      let o = pieceHit.object;
      while (o && !o.userData.square) o = o.parent;
      if (o?.userData.square) return o.userData.square;
    }
    const planeHit = this.raycaster.intersectObject(this.pickPlane)[0];
    if (planeHit) return worldToSquare(planeHit.point.x, planeHit.point.z);
    return null;
  }
}
