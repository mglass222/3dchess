import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  allSquares, squareToWorld, worldToSquare, isLightSquare, fileIndex, rankIndex,
} from './coords.js';
import {
  getTheme, makeGradientTexture, makeStarfield, DEFAULT_THEME, DEFAULT_FOG_DENSITY,
} from './themes.js';
import { CONTACT_SHADOW_Y, setPieceEnvironmentMap } from './pieces.js';
import { MarkerLayer } from './markers.js';

const LIGHT_SQ = 0xe8d6ae; // was 0xdac799 — the texture mean dropped ~0.88 -> ~0.74,
                            // so the colour comes up to hold the same on-screen value
// was 0x724528. Measured in the browser at the default orbit: with the neutral
// grain map, 0x4a3426 rendered dark squares at 13.2% luminance and 0x584032 at
// 15.8% — both short of the 18-24% that gives the darks visible grain. 0x6e5340
// lands at 20.7%, putting light:dark at 3.1:1 (it was ~8:1 with the burl map).
const DARK_SQ = 0x6e5340;

export const CAMERA_MAX_POLAR_ANGLE = Math.PI / 2 - 0.04;
export const ENVIRONMENT_BLUR = 0.04;
// Fallback IBL strength ONLY. three reads scene.environmentIntensity in exactly
// one place (WebGLRenderer: isMeshStandardMaterial && material.envMap === null
// && scene.environment !== null), so it applies to standard materials that did
// not get their own envMap from applyEnvironmentMap. Today there are none — the
// board (64 square clones), frame, stone and both piece materials are all
// stamped, and everything else in the scene is MeshBasic/Points, which ignore
// IBL entirely. So changing this value currently changes nothing on screen;
// per-material envMapIntensity is the live knob. Kept as a sane default for any
// standard material added later that misses the traverse.
const ENVIRONMENT_INTENSITY = 0.25;
export const BOARD_TEXTURES = {
  light: {
    url: 'textures/board/maple-grain.svg',
    // Light and dark must share a physical grain scale — 1.8 vs 1.65 was an
    // accident that rendered two woods at different physical sizes.
    repeat: [1.0, 1.0],
    anisotropy: 16,
  },
  dark: {
    url: 'textures/board/walnut-grain.svg',
    repeat: [1.0, 1.0],
    anisotropy: 16,
  },
  frame: {
    // The frame is BoxGeometry(8.8, ...) carrying the same 0-1 UV span as a
    // single square, so a repeat equal to the squares' (or a small multiple)
    // would render border grain far too coarse or align tile boundaries into
    // a visible band. 7.2 gives ~1.22 world units per tile — close to the
    // squares' physical scale without being an integer multiple of it.
    url: 'textures/board/walnut-grain.svg',
    repeat: [7.2, 7.2],
    anisotropy: 16,
  },
};

export function applyRendererQuality(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.00;
}

// Dependency-injectable so tests can stub the PMREM/GL machinery under node.
// Disposes the throwaway generator and room; the returned render target owns
// the texture and must survive (PMREMGenerator.dispose() only frees its own
// blur materials and ping-pong target).
export function createEnvironment({
  renderer,
  pmremFactory = (r) => new THREE.PMREMGenerator(r),
  roomFactory = () => new RoomEnvironment(),
} = {}) {
  const generator = pmremFactory(renderer);
  const room = roomFactory();
  try {
    const renderTarget = generator.fromScene(room, ENVIRONMENT_BLUR);
    return { texture: renderTarget.texture, renderTarget };
  } finally {
    // Throwaway scaffolding. The returned render target owns the texture and
    // must survive; PMREMGenerator.dispose() frees only its blur materials
    // and ping-pong target.
    room.dispose();
    generator.dispose();
  }
}

// Assigns `texture` as `envMap` on every isMeshStandardMaterial material found
// under `root` (MeshPhysicalMaterial extends MeshStandardMaterial, so board
// and stone materials are included). This is required for envMapIntensity to
// have any effect at all: three's refreshUniformsStandard only applies
// material.envMapIntensity when material.envMap is set, and setProgram only
// falls back to scene.environmentIntensity when material.envMap is null -
// with scene.environment as the sole IBL source (as it was before this
// function existed), every material's intensity was really just
// scene.environmentIntensity, and the six tuned envMapIntensity values were
// dead. Adding an envMap flips the shader's USE_ENVMAP define, so
// needsUpdate must be set to force a recompile. `seen` guards against
// redundantly touching a material more than once in one traversal (cheap
// insurance; harmless either way since the envMap === texture check below
// already no-ops a repeat assignment).
export function applyEnvironmentMap(root, texture) {
  const seen = new Set();
  root.traverse((child) => {
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material || !material.isMeshStandardMaterial) continue;
      if (seen.has(material) || material.envMap === texture) continue;
      seen.add(material);
      material.envMap = texture;
      material.needsUpdate = true;
    }
  });
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
  texture.name = key === 'light' ? 'maple-grain' : 'walnut-grain';
  return configureBoardTexture(texture, descriptor);
}

function boardSquareTextureTransform(square) {
  const file = fileIndex(square);
  const rank = rankIndex(square);
  return {
    offsetX: (file * 0.173 + rank * 0.071) % 1,
    offsetY: (rank * 0.137 + file * 0.047) % 1,
    // Deliberately `% 4`, not `% 2`. isLightSquare is (file+rank) % 2 === 1, so
    // light squares land on 90deg/270deg and dark squares on 0deg/180deg. The
    // wood grain is directional, so 0deg and 180deg are the *same* axis: every
    // dark square's grain runs one way, every light square's grain runs
    // perpendicular to it, and the 180deg flip among same-axis squares breaks
    // up the repeat so the tiling doesn't line up square-to-square. That's
    // how a veneered tournament board is actually built — don't "simplify"
    // this to `% 2`, it would make every square's grain run the same way.
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
  // envMapIntensity below is only live because applyEnvironmentMap gives each of
  // these materials its own envMap; three ignores the per-material value for a
  // material relying on scene.environment alone. Measured at the default orbit:
  // the originally-planned 0.55/0.50/0.45/0.30 pushed light squares to 73% and
  // darks to 29% (both over target) and the frame mean to 87. These values land
  // light 64.8% / dark 20.6% at a 3.14:1 ratio. The board deliberately sits well
  // below the pieces (0.9/1.0) — the pieces should be the reflective objects.
  return {
    light: new THREE.MeshPhysicalMaterial({
      color: LIGHT_SQ,
      map: lightMap,
      roughness: 0.44,
      metalness: 0.02,
      clearcoat: 0.26,
      clearcoatRoughness: 0.45,
      envMapIntensity: 0.28,
      userData: { boardTexture: BOARD_TEXTURES.light },
    }),
    dark: new THREE.MeshPhysicalMaterial({
      color: DARK_SQ,
      map: darkMap,
      roughness: 0.48,
      metalness: 0.03,
      clearcoat: 0.22,
      clearcoatRoughness: 0.5,
      envMapIntensity: 0.25,
      userData: { boardTexture: BOARD_TEXTURES.dark },
    }),
    frame: new THREE.MeshPhysicalMaterial({
      color: 0x2c2018,
      map: frameMap,
      roughness: 0.5,
      metalness: 0.04,
      clearcoat: 0.18,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.22,
      userData: { boardTexture: BOARD_TEXTURES.frame },
    }),
  };
}

export function createStoneMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x7d7868,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.15,
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

export const CAPTURE_DELAY = 110;      // ms — the attacker is ~40% into its 280ms arc
export const CAPTURE_DURATION = 230;   // ms
// These two are a PAIR: CAPTURE_SINK (0.55) > TARGET_KING_HEIGHT (1.4) *
// CAPTURE_END_SCALE (0.35) = 0.49, so even the tallest piece on the board is
// fully below y=0 by the time the animation ends, and the opaque board
// (BoxGeometry(1, 0.18, 1), top face at y=0 — see createChessBoard) clips it
// for free. No transparent material, no shader recompile, no dispose
// obligation. Don't raise one without the other: sinking further without
// shrinking to match would poke the piece out beneath the table slab at
// grazing camera angles.
const CAPTURE_SINK = 0.55;             // world units below the board top
const CAPTURE_END_SCALE = 0.35;

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

// Pure helper so setTheme can mutate the scene's single long-lived FogExp2
// instance rather than replacing it (see the constructor for why identity
// matters here).
export function applyThemeFog(fog, theme) {
  fog.color.set(theme.fog ?? theme.bottom);
  fog.density = theme.density ?? DEFAULT_FOG_DENSITY;
  return fog;
}

// Cancels the parent's arc-hop lift on the piece's contact-shadow decal so it
// stays welded to the board plane in world space, while x/z still track the
// piece through the parent transform. Call after every write to
// pieceObject.position.y during movePiece's animation, including the
// superseded branch - otherwise a move that gets superseded mid-arc leaves
// the decal permanently offset by whatever the lift was at that instant.
export function syncContactShadow(pieceObject) {
  const shadow = pieceObject.userData?.contactShadow;
  if (!shadow) return;
  // The decal is a child of pieceObject, so its world y is
  // pieceObject.position.y + pieceObject.scale.y * shadow.position.y. Solving
  // for shadow.position.y such that that world y equals CONTACT_SHADOW_Y gives
  // the division below. At scale 1 this reduces to the original expression;
  // the capture animation shrinks the group, and without dividing by scale the
  // decal would drift off the board plane by (1 - scale) * offset. `|| 1`
  // guards a degenerate zero scale.
  const scale = pieceObject.scale.y || 1;
  shadow.position.y = (CONTACT_SHADOW_Y - pieceObject.position.y) / scale;
}

export class Scene {
  constructor(container) {
    this.container = container;
    this.pieces = new Map();      // square -> Object3D
    // Pieces detached from `this.pieces` but still in the scene graph while
    // their capture animation plays. clearPieces() cannot see them any other
    // way — it iterates `pieces` — so a New Game mid-capture would orphan the
    // Object3D permanently.
    this._dying = new Set();
    // Board generation. Bumped by clearPieces(); an in-flight capture whose
    // stamp is stale bails out instead of re-destroying an already-destroyed
    // object. Scene-scoped rather than object-scoped (unlike movePiece's
    // userData._moveGen) precisely because a dying piece is no longer
    // reachable from this.pieces.
    this._boardGen = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    applyRendererQuality(this.renderer);
    container.appendChild(this.renderer.domElement);
    this.domElement = this.renderer.domElement;

    this.scene = new THREE.Scene();
    // One long-lived instance: WebGLRenderer keys shader recompiles on fog IDENTITY
    // (materialProperties.fog !== fog), so setTheme mutates this rather than
    // replacing it — otherwise every material in the scene recompiles on a theme switch.
    this._fog = new THREE.FogExp2(0x000000, DEFAULT_FOG_DENSITY);
    this.scene.fog = this._fog;
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

    // Must run after applyRendererQuality (above) because fromScene issues real
    // draw calls, and before the first render so scene.environment is set before
    // any envMap shader recompile. _addLights reads this._envFailed (set here)
    // to decide whether it needs to restore pre-IBL light levels.
    this._addEnvironment();
    this._addLights();
    this._buildBoard();
    // Board/stone materials are built by _buildBoard, so this traverse must
    // come after it - unlike piece materials (module-scope singletons wired
    // up inside _addEnvironment via setPieceEnvironmentMap), the board group
    // doesn't exist yet when _addEnvironment runs.
    if (this._envTexture) applyEnvironmentMap(this.scene, this._envTexture);
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

    this.markers = new MarkerLayer(this.scene);

    window.addEventListener('resize', () => this._resize());
    this._resize();
    this._animate();
  }

  _addEnvironment() {
    this._envRenderTarget = null;
    this._envTexture = null;
    this._envFailed = false;
    try {
      const { texture, renderTarget } = createEnvironment({ renderer: this.renderer });
      this.scene.environment = texture;
      this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
      this._envRenderTarget = renderTarget;
      this._envTexture = texture;
      // Piece materials are shared, long-lived singletons (pieces.js
      // MATERIALS) and pieces load asynchronously, so a one-time scene
      // traverse here would miss any piece created later - this call covers
      // every piece created before or after regardless.
      setPieceEnvironmentMap(texture);
    } catch (error) {
      console.warn('Environment map unavailable; falling back to lights only', error);
      this._envFailed = true;
      // Clear these too: _addLights restores the brighter pre-IBL rig when
      // _envFailed, so leaving a texture behind would let applyEnvironmentMap
      // also run and double-light the scene.
      this._envTexture = null;
      this._envRenderTarget = null;
    }
  }

  _addLights() {
    // The env map normally supplies ambient fill (see _addEnvironment), so
    // these punctual lights are reduced rather than stacked on top of it -
    // *unless* PMREM generation threw, in which case there is no IBL to make up
    // the difference and we restore the pre-IBL intensities/exposure instead of
    // rendering ~30-40% darker than before IBL landed.
    // Narrow by design: a lost context makes render() a no-op rather than throw
    // (so fromScene yields a black map, not an error), software GL just runs
    // slowly, and a machine with no WebGL2 at all already died constructing the
    // renderer. This covers PMREM failing outright - e.g. render-target OOM.
    const lit = !this._envFailed;

    this.hemiLight = new THREE.HemisphereLight(0xf4fff4, 0x33402c, lit ? 0.22 : 0.7);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1cf, lit ? 1.85 : 2.3);
    const key = this.keyLight;
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

    this.rimLight = new THREE.DirectionalLight(0xbad7ff, lit ? 0.4 : 0.65);
    this.rimLight.position.set(-8, 5, -7);
    this.scene.add(this.rimLight);

    if (!lit) this.renderer.toneMappingExposure = 1.08;
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
    this.markers.update(performance.now());
    this.renderer.render(this.scene, this.camera);
  }

  placePiece(square, object3d) {
    const { x, z } = squareToWorld(square);
    object3d.position.set(x, 0, z);
    object3d.userData.square = square;
    this.pieces.set(square, object3d);
    this.scene.add(object3d);
  }

  // Single teardown path for a piece Object3D: detach from the scene graph and
  // free its owned geometry clones. Frees no materials — the piece wood
  // materials (pieces.js MATERIALS) and the contact-shadow material are
  // shared app-wide singletons owned by pieces.js, not this object. Used by
  // removePieceAt, clearPieces, and the terminal branch of the capture
  // animation, so there is exactly one place that knows how to destroy a
  // piece.
  _destroyPiece(obj) {
    this.scene.remove(obj);
    disposePieceGeometries(obj);
  }

  removePieceAt(square) {
    const obj = this.pieces.get(square);
    if (!obj) return;
    this.pieces.delete(square);
    this._destroyPiece(obj);
  }

  clearPieces() {
    // Bump first, then destroy everything mid-capture, then clear the set,
    // and only then run the normal loop — so a queued rAF continuation for a
    // dying piece reads the new generation and bails out instead of running
    // _destroyPiece a second time against an object this call already freed.
    this._boardGen++;
    for (const obj of this._dying) this._destroyPiece(obj);
    this._dying.clear();
    for (const square of [...this.pieces.keys()]) this.removePieceAt(square);
  }

  // Detach the piece on `square` from the board synchronously (so a same-tick
  // movePiece onto `square` never clobbers it - see the map-write in
  // movePiece), then animate it sinking through the board plane. Returns a
  // promise that resolves once the piece is destroyed. A no-op square
  // resolves immediately without queuing a frame.
  capturePiece(square) {
    const obj = this.pieces.get(square);
    if (!obj) return Promise.resolve();
    this.pieces.delete(square);
    this._dying.add(obj);
    return this._animateCapture(obj);
  }

  // Sink-and-shrink, not a fade: see CAPTURE_SINK/CAPTURE_END_SCALE above for
  // why a fade was rejected. Mutates only this object's own transform (y and
  // scale) plus its contact-shadow child's local y via syncContactShadow -
  // zero material work, so there is nothing to dispose beyond the geometry
  // _destroyPiece already frees.
  _animateCapture(obj) {
    const myGen = this._boardGen;
    const startY = obj.position.y;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        if (this._boardGen !== myGen) {
          // clearPieces() already destroyed this object (see the mid-capture
          // branch there) - don't touch it again.
          resolve();
          return;
        }
        const elapsed = now - t0;
        if (elapsed < CAPTURE_DELAY) {
          // Hang while the attacker is still closing the distance - the
          // victim doesn't react until it's actually struck.
          requestAnimationFrame(step);
          return;
        }
        const t = Math.min(1, (elapsed - CAPTURE_DELAY) / CAPTURE_DURATION);
        const ease = t * t; // ease-in: slow start, then drops
        obj.position.y = startY - CAPTURE_SINK * ease;
        const scale = 1 - (1 - CAPTURE_END_SCALE) * ease;
        obj.scale.setScalar(scale);
        syncContactShadow(obj);
        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        this._dying.delete(obj);
        this._destroyPiece(obj);
        resolve();
      };
      requestAnimationFrame(step);
    });
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
    // clearPieces() bumps this before it destroys every piece in `this.pieces`
    // (which, by the time this rAF chain runs, includes `obj` under `to` -
    // see the map-write above), so a stale stamp means obj has already been
    // scene.remove()'d and its geometry disposed. Bail out the same way as a
    // superseded move rather than keep mutating a destroyed object.
    const myBoardGen = this._boardGen;
    const start = obj.position.clone();
    const end = squareToWorld(to);
    const lift = 0.6;
    const duration = 280; // ms
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        if (obj.userData._moveGen !== myGen || this._boardGen !== myBoardGen) {
          // Superseded mid-arc, or the board was cleared out from under us:
          // without the syncContactShadow call here for the supersede case,
          // the decal is left permanently offset by whatever the lift was at
          // the moment of supersession - a blob floating in mid-air.
          // Reachable via chained movePiece calls (castling) and a New Game
          // that resyncs the board mid-animation.
          syncContactShadow(obj);
          resolve();
          return;
        }
        const t = Math.min(1, (now - t0) / duration);
        const ease = t * t * (3 - 2 * t); // smoothstep
        obj.position.x = start.x + (end.x - start.x) * ease;
        obj.position.z = start.z + (end.z - start.z) * ease;
        obj.position.y = Math.sin(t * Math.PI) * lift; // arc hop
        syncContactShadow(obj);
        if (t < 1) requestAnimationFrame(step);
        else { obj.position.set(end.x, 0, end.z); syncContactShadow(obj); resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  // Named for what Input actually means: `square` is the piece the player
  // picked up, `targets` its legal destinations. Each target is either a bare
  // square string (normalized here to a quiet 'move' marker, so a stray
  // array-of-strings caller still works) or a { square, kind } pair where
  // kind is 'move' or 'capture'.
  setSelection(square, targets = []) {
    this.markers.set('selected', [{ square, kind: 'selected' }]);
    this.markers.set('targets', targets.map(
      (t) => (typeof t === 'string' ? { square: t, kind: 'move' } : t),
    ));
  }

  // Clears exactly the 'selected' and 'targets' slots — lastMove and check
  // live in separate slots and must survive this (Input.disable() calls this
  // via _clear() at the top of every onMove and every AI turn).
  clearSelection() {
    this.markers.clear('selected');
    this.markers.clear('targets');
  }

  setLastMove(from, to) {
    if (!from || !to) { this.markers.clear('lastMove'); return; }
    this.markers.set('lastMove', [
      { square: from, kind: 'lastMove' },
      { square: to, kind: 'lastMove' },
    ]);
  }

  setCheck(square) {
    if (!square) { this.markers.clear('check'); return; }
    this.markers.set('check', [{ square, kind: 'check' }]);
  }

  // Board-resync path (e.g. New Game): drop every marker in every slot.
  clearMarkers() {
    this.markers.clearAll();
  }

  // Apply a theme: a gradient sky, plus optional starfield.
  setTheme(key) {
    const theme = getTheme(key);
    this._clearBackdrop();

    this._bgTexture = makeGradientTexture(theme.top, theme.bottom);
    this.scene.background = this._bgTexture;
    applyThemeFog(this._fog, theme);
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
