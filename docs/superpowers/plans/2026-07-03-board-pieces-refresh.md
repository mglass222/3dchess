# Board and Pieces Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the garden-scene work by improving the chessboard, stone table, pieces, lighting, renderer quality, and camera clamp without changing the current theme/scenery selector.

**Architecture:** Keep gameplay and input unchanged. Add small exported rendering helpers so material choices, table geometry, and camera constraints are testable without constructing a browser `WebGLRenderer`. Apply those helpers inside the existing `Scene` and `pieces` modules.

**Tech Stack:** Vite, Three.js, Vitest, existing GLB assets in `public/models/`.

---

## Phase Boundary

This plan intentionally stops before garden/waterfall scenery. Do not remove the theme selector, do not replace `src/themes.js`, and do not add generated background assets in this phase.

## File Structure

- Modify `src/pieces.js`: define premium shared piece materials and export `getPieceMaterial(color)` for tests.
- Modify `test/pieces.test.js`: assert material color, finish, and clone material assignment.
- Modify `src/scene.js`: add exported render-quality constants/helpers, camera clamp constants, board material helpers, and stone table geometry. Use those helpers in `Scene`.
- Create `test/scene.test.js`: verify camera clamp constant, renderer-quality helper behavior, board material colors, and stone table shape.
- Run existing tests and build.

---

### Task 1: Upgrade Piece Materials Behind a Testable API

**Files:**
- Modify: `src/pieces.js`
- Modify: `test/pieces.test.js`

- [ ] **Step 1: Write failing piece-material tests**

Add `getPieceMaterial` to the import list and append these tests to `test/pieces.test.js`:

```js
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createPiece,
  normalizeModel,
  _setTemplate,
  PIECE_TYPES,
  getPieceMaterial,
} from '../src/pieces.js';

// keep the existing helper functions and existing tests unchanged

it('uses premium ivory and ebony piece materials', () => {
  const white = getPieceMaterial('w');
  const black = getPieceMaterial('b');

  expect(white).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  expect(black).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  expect(white.color.getHex()).toBe(0xf3ead2);
  expect(black.color.getHex()).toBe(0x17120f);
  expect(white.roughness).toBeCloseTo(0.32, 5);
  expect(black.roughness).toBeCloseTo(0.38, 5);
  expect(white.clearcoat).toBeCloseTo(0.42, 5);
  expect(black.clearcoat).toBeCloseTo(0.34, 5);
});

it('assigns the shared premium material to every mesh in a clone', () => {
  _setTemplate('r', fakeTemplate(1));
  const piece = createPiece('r', 'b');
  const black = getPieceMaterial('b');

  piece.traverse((child) => {
    if (child.isMesh) {
      expect(child.material).toBe(black);
      expect(child.castShadow).toBe(true);
      expect(child.receiveShadow).toBe(true);
    }
  });
});
```

If duplicate imports result from the edit, merge them into the single import block shown above.

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm test -- test/pieces.test.js
```

Expected: FAIL because `getPieceMaterial` is not exported from `src/pieces.js`.

- [ ] **Step 3: Implement premium shared piece materials**

In `src/pieces.js`, replace the existing `MATERIALS` block with this implementation:

```js
// Shared, long-lived materials (one per color) applied to every piece clone.
const MATERIALS = {
  w: new THREE.MeshPhysicalMaterial({
    color: 0xf3ead2,
    roughness: 0.32,
    metalness: 0.02,
    clearcoat: 0.42,
    clearcoatRoughness: 0.28,
    sheen: 0.18,
    sheenRoughness: 0.7,
  }),
  b: new THREE.MeshPhysicalMaterial({
    color: 0x17120f,
    roughness: 0.38,
    metalness: 0.04,
    clearcoat: 0.34,
    clearcoatRoughness: 0.32,
    sheen: 0.08,
    sheenRoughness: 0.65,
  }),
};

export function getPieceMaterial(color) {
  return MATERIALS[color];
}
```

Keep `createPiece()` assigning `c.material = MATERIALS[color]`.

- [ ] **Step 4: Run the targeted test and verify it passes**

Run:

```bash
npm test -- test/pieces.test.js
```

Expected: PASS for all `pieces` tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/pieces.js test/pieces.test.js
git commit -m "feat: upgrade chess piece materials"
```

---

### Task 2: Add Testable Scene Quality, Board, Table, and Camera Helpers

**Files:**
- Modify: `src/scene.js`
- Create: `test/scene.test.js`

- [ ] **Step 1: Write failing scene-helper tests**

Create `test/scene.test.js`:

```js
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CAMERA_MAX_POLAR_ANGLE,
  createBoardMaterials,
  createStoneMaterial,
  createStoneTable,
  applyRendererQuality,
} from '../src/scene.js';

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
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm test -- test/scene.test.js
```

Expected: FAIL because the named exports do not exist in `src/scene.js`.

- [ ] **Step 3: Add scene helper exports**

In `src/scene.js`, replace the `LIGHT_SQ` and `DARK_SQ` constants with these constants and helper functions near the top of the file:

```js
const LIGHT_SQ = 0xdac799;
const DARK_SQ = 0x724528;

export const CAMERA_MAX_POLAR_ANGLE = Math.PI / 2 - 0.04;

export function applyRendererQuality(renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
}

export function createBoardMaterials() {
  return {
    light: new THREE.MeshPhysicalMaterial({
      color: LIGHT_SQ,
      roughness: 0.44,
      metalness: 0.02,
      clearcoat: 0.26,
      clearcoatRoughness: 0.45,
    }),
    dark: new THREE.MeshPhysicalMaterial({
      color: DARK_SQ,
      roughness: 0.48,
      metalness: 0.03,
      clearcoat: 0.22,
      clearcoatRoughness: 0.5,
    }),
    frame: new THREE.MeshPhysicalMaterial({
      color: 0x2c2018,
      roughness: 0.5,
      metalness: 0.04,
      clearcoat: 0.18,
      clearcoatRoughness: 0.38,
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
```

- [ ] **Step 4: Run the targeted test and verify it passes**

Run:

```bash
npm test -- test/scene.test.js
```

Expected: PASS for all `scene rendering helpers` tests.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/scene.js test/scene.test.js
git commit -m "feat: add board scene quality helpers"
```

---

### Task 3: Apply Board, Table, Lighting, Renderer, and Camera Changes

**Files:**
- Modify: `src/scene.js`

- [ ] **Step 1: Update renderer setup**

In the `Scene` constructor in `src/scene.js`, replace the current manual shadow setup:

```js
this.renderer.shadowMap.enabled = true;
this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

with:

```js
applyRendererQuality(this.renderer);
```

- [ ] **Step 2: Clamp the camera above board level**

In the `Scene` constructor, replace:

```js
this.controls.maxPolarAngle = Math.PI - 0.05;
```

with:

```js
this.controls.maxPolarAngle = CAMERA_MAX_POLAR_ANGLE;
```

- [ ] **Step 3: Improve the lighting rig**

Replace the full `_addLights()` method with:

```js
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
```

- [ ] **Step 4: Put the board on the stone table and use premium board materials**

In `_buildBoard()`, replace the material setup and frame section with this version:

```js
_buildBoard() {
  const table = createStoneTable();
  this.scene.add(table);

  const board = new THREE.Group();
  board.name = 'chess-board';
  const tile = new THREE.BoxGeometry(1, 0.18, 1);
  const { light, dark, frame } = createBoardMaterials();

  for (const sq of allSquares()) {
    const { x, z } = squareToWorld(sq);
    const mesh = new THREE.Mesh(tile, isLightSquare(sq) ? light : dark);
    mesh.position.set(x, -0.09, z); // top face at y=0
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    board.add(mesh);
  }

  const frameMesh = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.34, 8.8), frame);
  frameMesh.position.y = -0.2;
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  board.add(frameMesh);

  const inset = new THREE.Mesh(new THREE.BoxGeometry(8.05, 0.08, 8.05), frame);
  inset.position.y = -0.03;
  inset.receiveShadow = true;
  board.add(inset);

  this.scene.add(board);
}
```

- [ ] **Step 5: Run the full unit suite**

Run:

```bash
npm test
```

Expected: PASS for all tests.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/scene.js
git commit -m "feat: refresh board table lighting and camera"
```

---

### Task 4: Build and Browser-Verify Phase 1

**Files:**
- Modify only if verification exposes defects in Task 1-3 changes.

- [ ] **Step 1: Build production assets**

Run:

```bash
npm run build
```

Expected: Vite completes and writes `dist/` without errors.

- [ ] **Step 2: Start the dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL such as `http://127.0.0.1:5173/`.

- [ ] **Step 3: Verify the app in a browser**

Open the Vite URL and check:

- Pieces render with ivory and dark ebony-style finishes.
- Board squares and frame have visible highlights instead of flat diffuse color.
- Board is visibly sitting on a stone table.
- Existing theme selector still works.
- Dragging can orbit around the board but cannot move below board/table level.
- Clicking a piece still selects it and legal move rings still appear.
- New Game and Difficulty controls still work.

- [ ] **Step 4: Fix any verification defects**

If the browser check exposes a concrete defect, patch the smallest relevant file and rerun:

```bash
npm test
npm run build
```

Expected: both commands pass after the fix.

- [ ] **Step 5: Commit verification fixes if any**

If Step 4 changed files, run:

```bash
git add src/scene.js src/pieces.js test/scene.test.js test/pieces.test.js
git commit -m "fix: polish board pieces phase one"
```

If Step 4 changed no files, do not create an empty commit.

---

## Final Verification

Run these commands after all tasks:

```bash
npm test
npm run build
```

Expected: both pass. Then perform the browser verification checklist in Task 4 and capture any remaining visual caveats in the final response.

## Self-Review

- Spec coverage: Phase 1 covers board surface/frame, stone table, piece materials, lighting, shadows, renderer quality, and camera clamp. Phase 2 scenery, generated assets, and theme removal are intentionally excluded.
- Placeholder scan: this plan contains no `TBD`, `TODO`, or unspecified implementation steps.
- Type consistency: exported helper names are `getPieceMaterial`, `CAMERA_MAX_POLAR_ANGLE`, `createBoardMaterials`, `createStoneMaterial`, `createStoneTable`, and `applyRendererQuality`; tests and implementation steps use the same names.
