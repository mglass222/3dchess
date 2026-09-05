import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  MARKER_KINDS,
  MARKER_SLOTS,
  CHECK_PULSE_PERIOD,
  CHECK_OPACITY,
  createMarkerAssets,
  MarkerLayer,
} from '../src/markers.js';
import { squareToWorld } from '../src/coords.js';
import { CONTACT_SHADOW_Y } from '../src/pieces.js';

describe('markers', () => {
  it('keeps the layering invariant: y strictly above the contact shadow and renderOrder ascends with y', () => {
    const kinds = Object.entries(MARKER_KINDS);
    for (const [, spec] of kinds) {
      expect(spec.y).toBeGreaterThan(CONTACT_SHADOW_Y);
      expect(spec.y).toBeLessThanOrEqual(0.020);
    }
    const sorted = [...kinds].sort((a, b) => a[1].y - b[1].y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i][1].renderOrder).toBeGreaterThanOrEqual(sorted[i - 1][1].renderOrder);
    }
  });

  it('transfers renderOrder and scale from the spec onto the built mesh', () => {
    // The assertions above only check the MARKER_KINDS table against itself.
    // Everything the layering comment promises depends on renderOrder actually
    // reaching the mesh — with depthWrite:false and quads 2-8 thousandths apart,
    // losing that assignment reintroduces exactly the orbit-dependent flicker
    // renderOrder exists to prevent, and no other test would notice.
    const layer = new MarkerLayer(new THREE.Group());
    layer.set('targets', [
      { square: 'e3', kind: 'move' },
      { square: 'd4', kind: 'capture' },
    ]);
    const byKind = Object.fromEntries(
      layer.group.children.map((m) => [m.userData.markerKind, m]),
    );

    for (const [kind, mesh] of Object.entries(byKind)) {
      expect(mesh.renderOrder).toBe(MARKER_KINDS[kind].renderOrder);
    }
    // capture is the only kind carrying a scale; it reads as a reticle AROUND
    // the enemy piece rather than a ring under it.
    expect(byKind.capture.scale.x).toBeCloseTo(MARKER_KINDS.capture.scale, 5);
    expect(byKind.move.scale.x).toBeCloseTo(1, 5);
    // Markers must never intercept picks — Scene.pickSquare only raycasts
    // pieces and the pick plane today, but this is the same defensive opt-out
    // pieces.js gives the contact-shadow decal.
    expect(byKind.move.raycast()).toBeUndefined();
  });

  it('empties the group on clearAll', () => {
    const layer = new MarkerLayer(new THREE.Group());
    layer.set('lastMove', [{ square: 'e2', kind: 'lastMove' }]);
    layer.set('check', [{ square: 'e8', kind: 'check' }]);
    layer.set('targets', [{ square: 'e4', kind: 'move' }]);
    expect(layer.group.children.length).toBe(3);

    layer.clearAll();
    expect(layer.group.children.length).toBe(0);
  });

  it('gives every marker material the transparent/depthWrite/depthTest triple', () => {
    const { materials } = createMarkerAssets();
    for (const material of Object.values(materials)) {
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.depthTest).toBe(true);
    }
  });

  it('places a mixed set of targets at the right world position, y, rotation, and material', () => {
    const parent = new THREE.Group();
    const layer = new MarkerLayer(parent);

    layer.set('targets', [
      { square: 'e3', kind: 'move' },
      { square: 'd4', kind: 'capture' },
    ]);

    const meshes = layer.group.children;
    expect(meshes.length).toBe(2);

    const moveMesh = meshes.find((m) => m.userData.markerKind === 'move');
    const captureMesh = meshes.find((m) => m.userData.markerKind === 'capture');

    const e3 = squareToWorld('e3');
    expect(moveMesh.position.x).toBeCloseTo(e3.x, 5);
    expect(moveMesh.position.z).toBeCloseTo(e3.z, 5);
    expect(moveMesh.position.y).toBeCloseTo(MARKER_KINDS.move.y, 5);
    expect(moveMesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);

    const d4 = squareToWorld('d4');
    expect(captureMesh.position.x).toBeCloseTo(d4.x, 5);
    expect(captureMesh.position.z).toBeCloseTo(d4.z, 5);
    expect(captureMesh.position.y).toBeCloseTo(MARKER_KINDS.capture.y, 5);
    expect(captureMesh.material).toBe(layer.assets.materials.capture);
  });

  it('keeps slots independent: clearing targets leaves lastMove meshes in the group', () => {
    const parent = new THREE.Group();
    const layer = new MarkerLayer(parent);

    layer.set('lastMove', [{ square: 'e2', kind: 'lastMove' }, { square: 'e4', kind: 'lastMove' }]);
    layer.set('targets', [{ square: 'e3', kind: 'move' }]);
    layer.clear('targets');

    const kinds = layer.group.children.map((m) => m.userData.markerKind);
    expect(kinds).toEqual(['lastMove', 'lastMove']);
  });

  it('clear/clearAll never dispose the shared geometry/material singletons', () => {
    const parent = new THREE.Group();
    const layer = new MarkerLayer(parent);
    let disposeCount = 0;
    for (const geometry of Object.values(layer.assets.geometries)) {
      geometry.addEventListener('dispose', () => { disposeCount += 1; });
    }
    for (const material of Object.values(layer.assets.materials)) {
      material.addEventListener('dispose', () => { disposeCount += 1; });
    }

    layer.set('targets', [{ square: 'e3', kind: 'move' }, { square: 'd4', kind: 'capture' }]);
    layer.set('selected', [{ square: 'e2', kind: 'selected' }]);
    layer.set('check', [{ square: 'e1', kind: 'check' }]);
    layer.clear('targets');
    layer.clearAll();

    expect(disposeCount).toBe(0);
  });

  it('dispose() disposes every geometry and material exactly once', () => {
    const parent = new THREE.Group();
    const layer = new MarkerLayer(parent);
    const disposed = [];
    for (const [name, geometry] of Object.entries(layer.assets.geometries)) {
      geometry.addEventListener('dispose', () => disposed.push(`geo:${name}`));
    }
    for (const [name, material] of Object.entries(layer.assets.materials)) {
      material.addEventListener('dispose', () => disposed.push(`mat:${name}`));
    }

    layer.set('targets', [{ square: 'e3', kind: 'move' }]);
    layer.dispose();

    const expectedCount = Object.keys(layer.assets.geometries).length
      + Object.keys(layer.assets.materials).length;
    expect(disposed.length).toBe(expectedCount);
    expect(new Set(disposed).size).toBe(expectedCount);
    expect(parent.children).not.toContain(layer.group);
  });

  it('pulses check opacity within bounds and periodically, varying across a sweep', () => {
    const parent = new THREE.Group();
    const layer = new MarkerLayer(parent);
    layer.set('check', [{ square: 'e1', kind: 'check' }]);

    const opacities = [];
    for (let t = 0; t <= CHECK_PULSE_PERIOD; t += 50) {
      layer.update(t);
      opacities.push(layer.assets.materials.check.opacity);
    }

    for (const o of opacities) {
      expect(o).toBeGreaterThanOrEqual(CHECK_OPACITY[0]);
      expect(o).toBeLessThanOrEqual(CHECK_OPACITY[1]);
    }
    expect(new Set(opacities.map((o) => o.toFixed(4))).size).toBeGreaterThan(1);

    layer.update(137);
    const a = layer.assets.materials.check.opacity;
    layer.update(137 + CHECK_PULSE_PERIOD);
    const b = layer.assets.materials.check.opacity;
    expect(b).toBeCloseTo(a, 10);
  });

  it('stops pulsing once check is cleared, resetting to the rest opacity', () => {
    const parent = new THREE.Group();
    const layer = new MarkerLayer(parent);
    layer.set('check', [{ square: 'e1', kind: 'check' }]);
    layer.update(CHECK_PULSE_PERIOD / 4); // move opacity away from rest

    layer.clear('check');
    expect(layer.assets.materials.check.opacity).toBeCloseTo(CHECK_OPACITY[0], 10);

    layer.update(999);
    layer.update(1999);
    expect(layer.assets.materials.check.opacity).toBeCloseTo(CHECK_OPACITY[0], 10);
  });

  it('update() with no check marker present is a no-op', () => {
    const parent = new THREE.Group();
    const layer = new MarkerLayer(parent);
    const before = layer.assets.materials.check.opacity;

    layer.update(500);
    layer.update(1500);

    expect(layer.assets.materials.check.opacity).toBe(before);
  });

  it('exposes the four independent slot names', () => {
    expect(MARKER_SLOTS).toEqual(['lastMove', 'check', 'selected', 'targets']);
  });
});
