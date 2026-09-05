import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoardFrame, createTable, createStudyEnvironment, WINDOW_POSITION } from './furnishing.js';
import {
  allSquares, squareToWorld, worldToSquare, isLightSquare, fileIndex, rankIndex,
} from './coords.js';
import {
  getTheme, makeGradientTexture, makeStarfield, DEFAULT_THEME, DEFAULT_FOG_DENSITY,
  THEME_LIGHT_DEFAULT,
} from './themes.js';
import { CONTACT_SHADOW_Y, setPieceEnvironmentMap, setPieceEnvIntensity } from './pieces.js';
import { MarkerLayer } from './markers.js';
import { createPostProcessing } from './postfx.js';
import { CameraFlight, easeOutCubic, newGamePose, CAMERA_NEW_GAME_DURATION } from './camera.js';

// Scanned veneer supplies its own color; these tints control the finish.
const LIGHT_SQ = 0xe5edff;
const DARK_SQ = 0xf4dfc5;

export const CAMERA_MAX_POLAR_ANGLE = Math.PI / 2 - 0.04;
export const ENVIRONMENT_BLUR = 0.04;
// Fallback for standard materials without an explicit environment map.
const ENVIRONMENT_INTENSITY = 0.25;

// The base punctual-light rig _addLights chooses between, keyed on whether
// the env map loaded (see the `lit` comment there). Published so
// applyThemeLighting always scales FROM these fixed numbers rather than
// from whatever the lights currently hold — that's what makes repeated
// theme switches idempotent instead of compounding.
export const LIGHT_RIG = {
  lit: { hemi: 0.22, key: 1.85, rim: 0.4, exposure: 1.00 },
  fallback: { hemi: 0.70, key: 2.30, rim: 0.65, exposure: 1.08 },
};

export const BOARD_TEXTURES = {
  light: {
    url: 'textures/board/cherry-color.jpg',
    normal: 'textures/board/cherry-normal.jpg',
    roughness: 'textures/board/cherry-roughness.jpg',
    repeat: [0.24, 0.24], anisotropy: 16,
  },
  dark: {
    url: 'textures/board/walnut-color.jpg',
    normal: 'textures/board/walnut-normal.jpg',
    roughness: 'textures/board/walnut-roughness.jpg',
    repeat: [0.24, 0.24], anisotropy: 16,
  },
  frame: {
    url: 'textures/board/walnut-color.jpg',
    normal: 'textures/board/walnut-normal.jpg',
    roughness: 'textures/board/walnut-roughness.jpg',
    repeat: [0.24, 0.24], anisotropy: 16,
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
  roomFactory = () => createStudyEnvironment(),
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
// under `root` (MeshPhysicalMaterial extends MeshStandardMaterial, so the
// board and frame materials are included). This is required for envMapIntensity to
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

function configureBoardTexture(texture, descriptor, transform = {}, colorSpace = THREE.SRGBColorSpace) {
  texture.colorSpace = colorSpace;
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

function loadBoardTexture(textureLoader, key, baseUrl, channel = 'url') {
  const descriptor = BOARD_TEXTURES[key];
  const url = textureUrl(baseUrl, descriptor[channel]);
  const texture = textureLoader.load(url, undefined, undefined, (error) => {
    console.warn(`Failed to load board texture "${key}/${channel}" from ${url}`, error);
  });
  texture.name = `${key}-${channel}`;
  return configureBoardTexture(texture, descriptor, {},
    channel === 'url' ? THREE.SRGBColorSpace : THREE.NoColorSpace);
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
  // Color and data maps must sample the same patch of veneer.
  for (const channel of ['map', 'normalMap', 'roughnessMap']) {
    if (!baseMaterial[channel]) continue;
    material[channel] = baseMaterial[channel].clone();
    configureBoardTexture(material[channel], BOARD_TEXTURES[textureKey],
      boardSquareTextureTransform(square), baseMaterial[channel].colorSpace);
  }
  return material;
}

function createWoodSurface(key, color, roughness, envMapIntensity, textureLoader, baseUrl) {
  return new THREE.MeshPhysicalMaterial({
    color,
    map: textureLoader ? loadBoardTexture(textureLoader, key, baseUrl) : null,
    normalMap: textureLoader ? loadBoardTexture(textureLoader, key, baseUrl, 'normal') : null,
    roughnessMap: textureLoader ? loadBoardTexture(textureLoader, key, baseUrl, 'roughness') : null,
    normalScale: new THREE.Vector2(0.12, 0.12),
    roughness, metalness: 0,
    clearcoat: 0.3, clearcoatRoughness: 0.32,
    envMapIntensity,
    userData: { boardTexture: BOARD_TEXTURES[key] },
  });
}

export function createBoardMaterials({
  textureLoader = null,
  baseUrl = import.meta.env.BASE_URL,
} = {}) {
  return {
    light: createWoodSurface('light', LIGHT_SQ, 0.64, 0.28, textureLoader, baseUrl),
    dark: createWoodSurface('dark', DARK_SQ, 0.68, 0.25, textureLoader, baseUrl),
    frame: createWoodSurface('frame', 0xc9a582, 0.7, 0.22, textureLoader, baseUrl),
  };
}

export const CAPTURE_DELAY = 110;      // ms — the attacker is ~40% into its 280ms arc
export const CAPTURE_DURATION = 230;   // ms
// CAPTURE_SINK is a FLOOR, not a bound derived from "the king is the tallest
// piece" — that assumption doesn't hold in general (loadPieces derives ONE
// uniform scale from the king's height and applies it to every type, so it
// only holds if the king's raw model happens to be the tallest in the set;
// nothing enforces that). Instead, _animateCapture below computes a per-piece
// sink from the captured piece's OWN recorded height (obj.userData.height,
// set once in pieces.js#createPiece from the same Box3 addContactShadow
// already computes to size the contact-shadow decal — reused rather than
// measured again, since the Downloaded set is a single 48MB GLB with ~300k
// vertices per piece and a second per-capture Box3 traversal would be a
// visible hitch): Math.max(CAPTURE_SINK, height * CAPTURE_END_SCALE +
// CAPTURE_SINK_MARGIN). CAPTURE_SINK remains the floor for any piece no
// taller than the king, and the fallback for a piece created by some other
// path that never got a recorded height. The opaque board (BoxGeometry(1,
// 0.18, 1), top face at y=0 — see createChessBoard) clips the piece for free
// once it's below y=0. No transparent material, no shader recompile, no
// dispose obligation.
// Exported so tests can compute expected clearances directly instead of
// duplicating these numbers.
export const CAPTURE_SINK = 0.55;      // world units below the board top; also the floor
export const CAPTURE_END_SCALE = 0.35;
// Extra clearance added on top of the scaled height so the piece's topmost
// vertex lands strictly below y=0, not grazing it. Margin, not a bound: don't
// raise CAPTURE_END_SCALE or lower this without re-checking that the sink
// still clears the board and doesn't poke the piece out beneath the table
// slab at grazing camera angles (see CAPTURE_SINK above).
export const CAPTURE_SINK_MARGIN = 0.06;

// --- Move profiles: every piece used to share one flat 280ms/lift-0.6 arc.
// Default = today's numbers EXACTLY, with settle 0. Every real piece carries
// userData.type, so this branch is only reached by test stubs and by pieces
// built through some other path — which is why it must stay byte-identical to
// the pre-profile behaviour.
export const MOVE_DEFAULT = { duration: 280, lift: 0.60, settle: 0 };
export const MOVE_PROFILES = {
  n: { duration: 380, lift: 1.15, settle: 0.055 }, // knights jump: high arc, slow
  p: { duration: 260, lift: 0.22, settle: 0.020 },
  b: { duration: 240, lift: 0.10, settle: 0.014 }, // sliders glide low and fast
  r: { duration: 240, lift: 0.10, settle: 0.016 },
  q: { duration: 260, lift: 0.12, settle: 0.018 },
  k: { duration: 420, lift: 0.16, settle: 0.030 }, // deliberate
};
export const MOVE_SETTLE_MS = 90;
export const MOVE_DURATION_CLAMP = [200, 430];
const MS_PER_EXTRA_UNIT = 16;

export function moveProfile(type) { return MOVE_PROFILES[type] ?? MOVE_DEFAULT; }

// A rook crossing seven squares in the same 240ms as one reads as a teleport;
// a fixed speed makes short moves crawl. Mostly-fixed duration with a mild
// distance term, hard-clamped so the input lockout stays bounded (see the
// lockout-budget test: moveDuration's max output plus MOVE_SETTLE_MS lands
// exactly at the 520ms ceiling that clamp was chosen for).
export function moveDuration(type, worldDistance = 1) {
  const profile = moveProfile(type);
  // MOVE_DEFAULT gets no distance term at all. It exists to reproduce the
  // pre-profile behaviour byte-for-byte, and that was a flat 280ms for every
  // distance — a stub with no userData.type moving two squares must still take
  // exactly 280ms, or the fake-clock tests that hand-advance frames desync.
  // This lives here rather than at each call site on purpose: it is a property
  // of the default profile, not a convention every caller has to remember.
  const distance = profile === MOVE_DEFAULT ? 1 : worldDistance;
  const extra = MS_PER_EXTRA_UNIT * Math.max(0, distance - 1);
  const [min, max] = MOVE_DURATION_CLAMP;
  return Math.min(max, Math.max(min, profile.duration + extra));
}

// CAPTURE_DELAY used to be commented as "the attacker is ~40% into its 280ms
// arc" - true back when every piece shared one duration. With per-type
// durations that prose goes stale silently, so express the coupling in code
// instead: derive the fraction once from the fixed point (MOVE_DEFAULT's own
// 280ms), then scale it by whatever duration the actual attacker's move ends
// up taking.
export const CAPTURE_DELAY_FRACTION = CAPTURE_DELAY / MOVE_DEFAULT.duration; // 0.392857...
export function captureDelayFor(attackerDuration) { return attackerDuration * CAPTURE_DELAY_FRACTION; }

function disposePieceGeometries(object3d) {
  const disposed = new Set();
  object3d.traverse((child) => {
    const geometry = child.isMesh ? child.geometry : null;
    if (!geometry || disposed.has(geometry)) return;
    disposed.add(geometry);
    if (geometry.userData.pieceReferences !== undefined) {
      // Authored models share immutable buffers. Release GPU storage only when
      // the last instance leaves; Three can re-upload them on a later New Game.
      geometry.userData.pieceReferences = Math.max(0, geometry.userData.pieceReferences - 1);
      if (geometry.userData.pieceReferences === 0) geometry.dispose();
    } else if (geometry.userData.pieceInstanceGeometry) {
      geometry.dispose();
    }
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

  board.add(createBoardFrame(frame));

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

// Applies a theme's light block to the three live lights plus the renderer's
// exposure. Colours are set absolutely; intensities are always BASE *
// multiplier (never current * multiplier) — that's what makes this
// idempotent (calling it twice with the same theme is a no-op past the first
// call) and what makes repeated theme switches never compound. `base` is
// LIGHT_RIG.lit or LIGHT_RIG.fallback (see _addLights/this._lightBase), so
// the same multipliers compose with whichever rig _envFailed picked rather
// than overriding it.
export function applyThemeLighting({
  hemiLight, keyLight, rimLight, base, renderer,
}, theme) {
  const light = { ...THEME_LIGHT_DEFAULT, ...(theme.light ?? {}) };

  hemiLight.color.set(light.hemiSky);
  hemiLight.groundColor.set(light.hemiGround);
  hemiLight.intensity = base.hemi * light.hemiIntensity;

  keyLight.color.set(light.key);
  keyLight.intensity = base.key * light.keyIntensity;

  rimLight.color.set(light.rim);
  rimLight.intensity = base.rim * light.rimIntensity;

  renderer.toneMappingExposure = base.exposure * light.exposure;
}

// Rescales envMapIntensity on every material applyEnvironmentMap already
// stamped (board, frame — anything under `root` with an envMap), by
// `factor` relative to each material's OWN original intensity, captured into
// userData.baseEnvMapIntensity on first call so repeated theme switches never
// compound. Plain uniform refresh in three (refreshUniformsStandard) — no
// needsUpdate, no recompile — so this is safe to call on every theme switch.
export function applyThemeEnvIntensity(root, factor) {
  root.traverse((child) => {
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material || !material.isMeshStandardMaterial) continue;
      material.userData.baseEnvMapIntensity ??= material.envMapIntensity;
      material.envMapIntensity = material.userData.baseEnvMapIntensity * factor;
    }
  });
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

    // antialias is dead weight once createPostProcessing succeeds below - MSAA
    // resolves into renderTarget1 before UnrealBloomPass/OutputPass run, and the
    // final blit through OutputPass is what actually reaches the screen - but it
    // stays on because it's the ONLY antialiasing on the fallback path (post ===
    // null), where render() draws straight to the default framebuffer.
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

    // Tier 3 C1: camera flight (New Game orbit-in). Constructed after
    // `controls` because it wires an abort listener onto it (see camera.js's
    // module doc for the whole "flight writes position, controls clamps it"
    // design). reducedMotion is read here, at construction time in the
    // browser - not at module import time - so camera.js itself stays
    // import-clean under node (see its own comment on this).
    this.cameraFlight = new CameraFlight({
      camera: this.camera,
      controls: this.controls,
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    });

    // Must run after applyRendererQuality (above) because fromScene issues real
    // draw calls, and before the first render so scene.environment is set before
    // any envMap shader recompile. _addLights reads this._envFailed (set here)
    // to decide whether it needs to restore pre-IBL light levels.
    this._addEnvironment();
    this._addLights();
    this._buildBoard();
    // Board materials are built by _buildBoard, so this traverse must
    // come after it - unlike piece materials (module-scope singletons wired
    // up inside _addEnvironment via setPieceEnvironmentMap), the board group
    // doesn't exist yet when _addEnvironment runs.
    if (this._envTexture) applyEnvironmentMap(this.scene, this._envTexture);

    // Must run before setTheme below: setTheme's compensate flag reads
    // !!this.post, and this is the ONLY assignment of this.post - if it ran
    // after setTheme, the initial gradient would always render uncompensated
    // even once the composer exists (createPostProcessing needs only
    // renderer/scene/camera, all already constructed, so moving it earlier
    // is otherwise a no-op: it doesn't depend on pickPlane/markers below, and
    // RenderPass holds a live reference to `this.scene`, so pieces/markers
    // added later still render through it). Returns null (falling back to
    // renderer.render in _render below) when the GPU/context lacks what
    // UnrealBloomPass's HDR target needs - the same fallback philosophy as
    // _addEnvironment/_envFailed above.
    this.post = createPostProcessing({ renderer: this.renderer, scene: this.scene, camera: this.camera });
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
    const base = LIGHT_RIG[lit ? 'lit' : 'fallback'];
    this._lightBase = base;

    this.hemiLight = new THREE.HemisphereLight(0xf4fff4, 0x33402c, base.hemi);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1cf, base.key);
    const key = this.keyLight;
    key.position.set(...WINDOW_POSITION);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 42;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.00015;
    key.shadow.normalBias = 0.015;
    this.scene.add(key);

    this.rimLight = new THREE.DirectionalLight(0xbad7ff, base.rim);
    this.rimLight.position.set(-8, 5, -7);
    this.scene.add(this.rimLight);

    if (!lit) this.renderer.toneMappingExposure = base.exposure;
  }

  _buildBoard() {
    const textureLoader = new THREE.TextureLoader();
    this.scene.add(createChessBoard({ textureLoader }));
    const tableMaterial = createWoodSurface('frame', 0xb4a18b, 0.95, 0.35, textureLoader, import.meta.env.BASE_URL);
    // The table is a quieter, open-pore finish than the varnished board.
    tableMaterial.clearcoat = 0.06;
    tableMaterial.normalScale.set(0.22, 0.22);
    for (const channel of ['map', 'normalMap', 'roughnessMap']) {
      tableMaterial[channel].repeat.set(0.13, 0.13);
    }
    this.scene.add(createTable(tableMaterial));
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    // CSS pixels, like renderer.setSize above: EffectComposer.setSize multiplies
    // whatever it's given by the pixel ratio it captured at construction.
    this.post?.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    // Flight writes camera.position; controls.update() re-derives its
    // spherical from that position and applies the min/maxDistance and
    // min/maxPolarAngle clamps - see camera.js's module doc for why this
    // ordering (flight -> controls -> markers -> render) is load-bearing.
    this.cameraFlight.update(performance.now());
    this.controls.update();
    this.markers.update(performance.now());
    this._render();
  }

  // Seam extracted purely so the render choice is testable under node -
  // _animate self-recurses through requestAnimationFrame and is otherwise
  // unreachable in a vitest run.
  _render() {
    if (this.post) this.post.composer.render();
    else this.renderer.render(this.scene, this.camera);
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
  //
  // `attackerFrom`/`attackerTo` let the caller (main.js) stay ignorant of
  // piece types entirely: the delay before the victim reacts is derived from
  // the ATTACKER's own move profile (a knight capturing takes longer to
  // arrive than a bishop gliding in), not a flat constant. Reading the
  // attacker via `this.pieces.get(attackerFrom)` is only valid because
  // main.js calls capturePiece() before movePiece() on the same tick (see the
  // ordering comment in main.js#onMove) - the attacker is still parked at
  // attackerFrom when this runs. `attackerTo` defaults to `square` (the
  // common case: the attacker lands where the victim stood) but en passant
  // passes a distinct square, since the victim there isn't on the square the
  // attacker moves to. With no attacker on record (or none supplied), fall
  // back to the flat CAPTURE_DELAY.
  capturePiece(square, { attackerFrom = null, attackerTo = square } = {}) {
    const obj = this.pieces.get(square);
    if (!obj) return Promise.resolve();
    this.pieces.delete(square);
    this._dying.add(obj);

    const attacker = attackerFrom ? this.pieces.get(attackerFrom) : null;
    let delay = CAPTURE_DELAY;
    if (attacker) {
      const attackerType = attacker.userData?.type;
      const attackerStart = squareToWorld(attackerFrom);
      const attackerEnd = squareToWorld(attackerTo);
      const attackerDistance = Math.hypot(
        attackerEnd.x - attackerStart.x,
        attackerEnd.z - attackerStart.z,
      );
      // moveDuration itself drops the distance term for MOVE_DEFAULT, so an
      // attacker with no recorded type yields captureDelayFor(280) ===
      // CAPTURE_DELAY exactly - the fallback the capture-animation tests rely on.
      const attackerDuration = moveDuration(attackerType, attackerDistance);
      delay = captureDelayFor(attackerDuration);
    }
    return this._animateCapture(obj, delay);
  }

  // Sink-and-shrink, not a fade: see CAPTURE_SINK/CAPTURE_END_SCALE above for
  // why a fade was rejected. Mutates only this object's own transform (y and
  // scale) plus its contact-shadow child's local y via syncContactShadow -
  // zero material work, so there is nothing to dispose beyond the geometry
  // _destroyPiece already frees. `delay` is how long the victim hangs before
  // reacting - see capturePiece above for how it's derived.
  _animateCapture(obj, delay) {
    const myGen = this._boardGen;
    const startY = obj.position.y;
    const t0 = performance.now();
    // See CAPTURE_SINK's comment above: derive this piece's own clearance
    // rather than trust the shared constant to already cover it. Falls back
    // to CAPTURE_SINK when userData.height is missing (e.g. a piece built by
    // some other path than pieces.js#createPiece), so it still animates
    // sanely rather than throwing or sinking by NaN.
    const height = obj.userData?.height;
    const sink = Number.isFinite(height)
      ? Math.max(CAPTURE_SINK, height * CAPTURE_END_SCALE + CAPTURE_SINK_MARGIN)
      : CAPTURE_SINK;
    return new Promise((resolve) => {
      const step = (now) => {
        if (this._boardGen !== myGen) {
          // clearPieces() already destroyed this object (see the mid-capture
          // branch there) - don't touch it again.
          resolve();
          return;
        }
        const elapsed = now - t0;
        if (elapsed < delay) {
          // Hang while the attacker is still closing the distance - the
          // victim doesn't react until it's actually struck.
          requestAnimationFrame(step);
          return;
        }
        const t = Math.min(1, (elapsed - delay) / CAPTURE_DURATION);
        const ease = t * t; // ease-in: slow start, then drops
        obj.position.y = startY - sink * ease;
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
  //
  // Per-type feel comes from moveProfile(obj.userData.type) (see the MOVE_*
  // block above): knights arc high and slow (they jump), sliders (b/r/q)
  // glide low and fast, the king moves with deliberate weight, and every
  // profile but the default settles with a brief landing squash. A piece
  // built through some path other than pieces.js#createPiece (or a test
  // stub) carries no userData.type, so moveProfile falls back to
  // MOVE_DEFAULT - today's original numbers, byte-identical, with settle 0.
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
    const type = obj.userData.type;
    const profile = moveProfile(type);
    const { lift, settle } = profile;
    const worldDistance = Math.hypot(end.x - start.x, end.z - start.z);
    // Only a real MOVE_PROFILES entry earns the distance-based speed-up/slow-down;
    // moveDuration drops the distance term for MOVE_DEFAULT itself.
    const duration = moveDuration(type, worldDistance); // ms
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        if (obj.userData._moveGen !== myGen || this._boardGen !== myBoardGen) {
          // Superseded mid-arc or mid-settle, or the board was cleared out
          // from under us. Reset scale FIRST, then syncContactShadow (order
          // matters - it divides by scale.y): a settle squash superseded
          // partway through would otherwise leave the piece permanently
          // deformed, since nothing else ever undoes it. Without the
          // syncContactShadow call here, the decal is also left permanently
          // offset by whatever the lift was at the moment of supersession -
          // a blob floating in mid-air. Reachable via chained movePiece
          // calls (castling) and a New Game that resyncs the board
          // mid-animation.
          obj.scale.set(1, 1, 1);
          syncContactShadow(obj);
          resolve();
          return;
        }
        const elapsed = now - t0;
        if (elapsed < duration) {
          const t = elapsed / duration;
          const ease = t * t * (3 - 2 * t); // smoothstep
          obj.position.x = start.x + (end.x - start.x) * ease;
          obj.position.z = start.z + (end.z - start.z) * ease;
          obj.position.y = Math.sin(t * Math.PI) * lift; // arc hop
          syncContactShadow(obj);
          requestAnimationFrame(step);
          return;
        }
        // Arc complete: position is pinned exactly and stays there - only
        // `scale` moves from here on. A squash (never a negative y) is the
        // only safe way to sell a landing: a y overshoot would dip the
        // piece's flat base into the opaque board (and, if superseded
        // mid-dip, leave it buried there), and an XZ overshoot would leave
        // it off-centre if superseded. A scale squash costs neither, because
        // syncContactShadow already divides by scale.y (see above) - the
        // decal stays welded for free, the same path the capture shrink
        // already exercises.
        obj.position.set(end.x, 0, end.z);
        const settleElapsed = elapsed - duration;
        if (settle > 0 && settleElapsed < MOVE_SETTLE_MS) {
          const s = settleElapsed / MOVE_SETTLE_MS;
          const squash = Math.sin(s * Math.PI) * settle; // 0 at both ends
          obj.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
          syncContactShadow(obj);
          requestAnimationFrame(step);
          return;
        }
        // Finish at exactly 1, not sin(PI) (~1.2e-16) - see above.
        obj.scale.set(1, 1, 1);
        syncContactShadow(obj);
        resolve();
      };
      requestAnimationFrame(step);
    });
  }

  // Public so main.js can compute the castling stagger (see onMove) without
  // duplicating movePiece's own profile/distance logic. Must be called
  // before movePiece(from, to) empties `from`'s slot in `this.pieces` -
  // afterward there is nothing left here to read the type from, and this
  // falls back to squareToWorld(from) for the distance (a stationary piece,
  // not one already mid-animation).
  moveDurationFor(from, to) {
    const obj = this.pieces.get(from);
    const type = obj?.userData?.type;
    const start = obj ? obj.position : squareToWorld(from);
    const end = squareToWorld(to);
    const worldDistance = Math.hypot(end.x - start.x, end.z - start.z);
    return moveDuration(type, worldDistance);
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

  // Tier 3 C1: New Game orbit-in. `side` is 'w' or 'b' (whichever side is
  // about to play) - see camera.js#newGamePose for the actual pose numbers
  // and camera.js's module doc for why input is never gated during this
  // (nothing here calls input.disable() or touches controls.enabled). Every
  // call - including a second New Game landing mid-flight - snaps to the same
  // wide start pose and re-flies in from there; that snap-then-swing is the
  // intended "new game" cue, not a bug to smooth over. What a re-entrant call
  // does NOT do is fight the previous flight: CameraFlight#start fully
  // replaces the prior _from/_to/_t0 rather than blending with them, so a
  // superseding New Game is a clean restart, never two flights racing to
  // write camera.position on the same frame.
  flyToNewGame(side) {
    const { from, to } = newGamePose(side);
    this.cameraFlight.start(to, { duration: CAMERA_NEW_GAME_DURATION, ease: easeOutCubic, from });
  }

  // Apply a theme: a gradient sky, plus optional starfield.
  setTheme(key) {
    const theme = getTheme(key);
    this._clearBackdrop();

    // Only compensate when the composer is actually in the pipeline - see
    // makeGradientTexture's comment for why doing this unconditionally would
    // double-correct the fallback (post === null) path.
    this._bgTexture = makeGradientTexture(theme.top, theme.bottom, { compensate: !!this.post });
    this.scene.background = this._bgTexture;
    applyThemeFog(this._fog, theme);
    if (theme.stars) {
      this._starfield = makeStarfield();
      this.scene.add(this._starfield);
    }

    // Guarded: some tests build a Scene via Object.create(Scene.prototype)
    // with no lights/renderer at all (e.g. the fog and marker tests above),
    // and would throw here without the check. Real instances always have
    // keyLight by the time setTheme first runs (constructor calls _addLights
    // before setTheme).
    if (this.keyLight) {
      applyThemeLighting({
        hemiLight: this.hemiLight,
        keyLight: this.keyLight,
        rimLight: this.rimLight,
        base: this._lightBase,
        renderer: this.renderer,
      }, theme);
    }
    const env = theme.light?.env ?? 1;
    applyThemeEnvIntensity(this.scene, env);
    setPieceEnvIntensity(env);

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
