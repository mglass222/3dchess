import * as THREE from 'three';
import { squareToWorld } from './coords.js';

// Move-feedback marker vocabulary: selection, quiet-move/capture targets, the
// last move played, and a check pulse on the king. Four independent slots
// (see MARKER_SLOTS) so that a Scene.clearSelection() during Input._clear()
// (called at the top of every onMove and every AI turn — see main.js) never
// takes the lastMove/check markers down with it.
//
// Layering rationale. The board top is opaque at y=0; contact-shadow decals
// (pieces.js) sit at CONTACT_SHADOW_Y (0.006) with depthWrite:false. Opaque
// pieces render first and write depth, so a marker under a standing piece is
// occluded correctly for free — that's why depthTest stays ON for every
// marker material below. depthWrite:false on markers means marker-vs-decal
// draw order is decided by renderOrder deterministically, rather than by
// camera-distance ties between near-coplanar transparent quads, which flicker
// as the orbit moves. Distinct y values are belt-and-braces on top of that.
//
// Invariant: renderOrder ascends with y, and every y is strictly above
// CONTACT_SHADOW_Y and <= 0.020. test/markers.test.js checks this mechanically
// against pieces.js's CONTACT_SHADOW_Y so the two files can't drift apart.
export const MARKER_KINDS = {
  lastMove: {
    geometry: 'square', material: 'lastMove', y: 0.012, renderOrder: 1,
  },
  check: {
    geometry: 'disc', material: 'check', y: 0.014, renderOrder: 2,
  },
  selected: {
    geometry: 'ring', material: 'selected', y: 0.016, renderOrder: 3,
  },
  move: {
    geometry: 'dot', material: 'move', y: 0.020, renderOrder: 4,
  },
  capture: {
    geometry: 'ring', material: 'capture', y: 0.020, renderOrder: 4, scale: 1.15,
  },
};

// Slots a MarkerLayer tracks independently. 'targets' holds both 'move' and
// 'capture' kind entries (Scene.setSelection's second argument) — it is one
// slot, not two, because they're always replaced together as a set of legal
// destinations.
export const MARKER_SLOTS = ['lastMove', 'check', 'selected', 'targets'];

export const CHECK_PULSE_PERIOD = 1100; // ms, full cycle
export const CHECK_OPACITY = [0.16, 0.46];

function createGeometries() {
  return {
    // The pre-existing selection ring, kept verbatim for visual continuity.
    ring: new THREE.RingGeometry(0.30, 0.42, 32),
    dot: new THREE.CircleGeometry(0.155, 24),
    square: new THREE.PlaneGeometry(0.92, 0.92),
    disc: new THREE.CircleGeometry(0.46, 32),
  };
}

// All MeshBasicMaterial, transparent, double-sided, depthWrite:false (see the
// layering comment above for why), depthTest left at its default true.
function createMaterials() {
  return {
    move: new THREE.MeshBasicMaterial({
      color: 0x49e0a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    }),
    capture: new THREE.MeshBasicMaterial({
      color: 0xe0574a, transparent: true, opacity: 0.80, side: THREE.DoubleSide, depthWrite: false,
    }),
    selected: new THREE.MeshBasicMaterial({
      color: 0x49e0a0, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    }),
    lastMove: new THREE.MeshBasicMaterial({
      color: 0xf2d98c, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    }),
    check: new THREE.MeshBasicMaterial({
      color: 0xff4b3e, transparent: true, opacity: CHECK_OPACITY[0], side: THREE.DoubleSide, depthWrite: false,
    }),
  };
}

// Shared, long-lived singletons — one geometry per shape, one material per
// kind — reused by every marker mesh of that kind, the same pattern as
// pieces.js's CONTACT_SHADOW_GEOMETRY/MATERIAL. Never disposed by clear()/
// clearAll(), only by MarkerLayer.dispose().
export function createMarkerAssets() {
  return { geometries: createGeometries(), materials: createMaterials() };
}

export class MarkerLayer {
  constructor(parent, assets = createMarkerAssets()) {
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'markers';
    parent.add(this.group);
    this._slots = new Map(); // slot -> Mesh[]
    this._pulsing = false;
  }

  set(slot, entries) {
    this.clear(slot);
    const meshes = [];
    for (const { square, kind } of entries) {
      const spec = MARKER_KINDS[kind];
      const geometry = this.assets.geometries[spec.geometry];
      const material = this.assets.materials[spec.material];
      const mesh = new THREE.Mesh(geometry, material);
      const { x, z } = squareToWorld(square);
      mesh.position.set(x, spec.y, z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = spec.renderOrder;
      if (spec.scale) mesh.scale.setScalar(spec.scale);
      // Defensive opt-out from pickSquare's raycast, same as the contact-shadow
      // decal in pieces.js — markers are non-interactive overlays.
      mesh.raycast = () => {};
      mesh.userData.markerKind = kind;
      meshes.push(mesh);
    }
    // Add to the group only after the whole batch is built. If an entry names a
    // kind that isn't in MARKER_KINDS, the throw happens before anything is
    // parented — otherwise the meshes added so far would sit in the group while
    // `meshes` never reaches _slots, leaving them unreachable by clear/dispose.
    for (const mesh of meshes) this.group.add(mesh);
    this._slots.set(slot, meshes);
    if (slot === 'check') this._pulsing = entries.length > 0;
  }

  clear(slot) {
    const meshes = this._slots.get(slot);
    if (meshes) {
      // Do NOT dispose geometry/material — they are the shared assets
      // singletons, reused by every marker of that kind (mirrors the warning
      // that used to live on scene.js's _highlightGeom/_highlightMat).
      for (const mesh of meshes) this.group.remove(mesh);
    }
    this._slots.set(slot, []);
    if (slot === 'check') {
      this._pulsing = false;
      // Reset to the rest opacity so state is deterministic regardless of
      // where in the pulse cycle the check marker was cleared.
      this.assets.materials.check.opacity = CHECK_OPACITY[0];
    }
  }

  clearAll() {
    for (const slot of MARKER_SLOTS) this.clear(slot);
  }

  // Per-frame hook (Scene._animate calls this with performance.now() before
  // renderer.render). Pure function of nowMs — the only testable seam, since
  // _animate itself self-recurses through rAF and is unreachable under node.
  update(nowMs) {
    if (!this._pulsing) return;
    const phase = (Math.sin((nowMs / CHECK_PULSE_PERIOD) * Math.PI * 2) + 1) / 2; // 0..1
    // Mutating assets.materials.check in place is safe here because exactly
    // one marker kind ('check') ever uses this material and there is at most
    // one checked king on the board at a time — unlike pieces.js's
    // CONTACT_SHADOW_MATERIAL, which is shared by all 32 piece decals
    // simultaneously and must never be mutated per-instance.
    this.assets.materials.check.opacity = CHECK_OPACITY[0]
      + (CHECK_OPACITY[1] - CHECK_OPACITY[0]) * phase;
    const scale = 1 + 0.06 * phase;
    for (const mesh of this._slots.get('check') ?? []) mesh.scale.setScalar(scale);
  }

  // Nothing calls this today — Scene has no teardown path — this is here for
  // when one is added.
  dispose() {
    this.clearAll();
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const geometry of Object.values(this.assets.geometries)) geometry.dispose();
    for (const material of Object.values(this.assets.materials)) material.dispose();
  }
}
