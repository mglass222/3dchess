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
// Was [0.16, 0.46]. Re-measured lower for two compounding reasons:
// 1. Composer-vs-direct blending-space shift (see createMaterials' comment) -
//    at the old 0.16 rest value, a dark square (d8) over-delivered contrast
//    by +0.084 against the direct-path reference; 0.05 matches within +/-0.01
//    on both a light and a dark square.
// 2. This material's color is now boosted above 1.0 (see createMaterials
//    below) so check can bloom - a color-only change, but the RRTAndODTFit
//    tonemap responds to color magnitude, not just alpha, so the SAME
//    opacity now reads brighter than it used to independent of blending
//    space. The peak (was 0.46) is deliberately NOT contrast-matched to the
//    direct path the way the rest value is: 0.28 was chosen by eye, on both
//    paths, as the value where the composer path's bloom halo reads as an
//    intentional glow rather than a blown-out disc, while the direct
//    (fallback) path still shows a clearly visible, correctly-tinted ring
//    (see FIX 4's comment on the check/capture materials for why the
//    composer path is EXPECTED to look more dramatic here, not matched).
export const CHECK_OPACITY = [0.05, 0.28];

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
//
// Opacities below are NOT the pre-composer numbers: EffectComposer moved
// alpha blending from display space (direct renderer.render) into linear
// space (the composer's HDR scene pass, blended pre-tonemap), which changes
// how much a translucent marker's color reads against the board underneath
// it - and unlike the black contact-shadow decal in pieces.js, these are
// saturated colors on both light AND dark squares, so the shift isn't a
// single uniform factor. Each was re-measured with the method in
// docs/visual-review.md's follow-up pass: select/target/lastMove/check
// markers raised via window.__chess.input.onSquarePicked (and
// Scene.setLastMove/setCheck for the other two), sampled at the marker
// centre against the same square with the marker cleared, A/B'd across
// scene.post on both a light and a dark square, comparing composer contrast
// to the direct-path reference:
//   move      0.55 -> 0.34  (composer over-delivered contrast on dark squares
//                             by up to 37% at the old value; light squares
//                             needed far less correction - 0.34 is the
//                             minimax compromise, light squares land ~0.018
//                             under target, dark squares ~0.011 over)
//   capture   0.80 -> unchanged (was within +/-0.006 on a light square before
//                             the above-1.0 bloom color below; with it, the
//                             composer path runs about 0.025 hotter than
//                             direct, which is the bloom glow working as
//                             intended, not a miscalibration - see the bloom
//                             comment on the capture material below)
//   selected  0.85 -> unchanged (within +/-0.008 on both a light and a dark
//                             square - high-opacity markers sit close to
//                             the alpha=1 limit where blending-space
//                             doesn't matter)
//   lastMove  0.16 -> 0.07   (light squares were already close; dark squares
//                             over-delivered by ~0.09-0.12 contrast at 0.16,
//                             matched to within +/-0.02 at 0.07)
//   check     see CHECK_OPACITY below (measured against the bloomed color -
//                             see the comment there)
function createMaterials() {
  return {
    move: new THREE.MeshBasicMaterial({
      color: 0x49e0a0, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false,
    }),
    // Above-1.0 linear RGB (Color.setRGB, not the `color:` hex option, which
    // clamps to [0,1] sRGB): with the composer's HalfFloat linear buffer this
    // exceeds BLOOM.threshold (1.30 scene-linear - see postfx.js), so capture
    // is one of exactly two things in the scene that bloom (see check below),
    // a deliberate diegetic glow on a capture opportunity. Milder than
    // check's boost - it fires far more often (any capturable square) and
    // shouldn't out-glow the check pulse. Degrades to a flat saturated red on
    // the no-composer fallback (values >1 simply clip) - acceptable per the
    // fallback philosophy elsewhere in this file (see the layering comment).
    capture: (() => {
      const material = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.80, side: THREE.DoubleSide, depthWrite: false,
      });
      // 2.1, not the 1.35 first tried: the threshold had to be raised to 1.30
      // to stop the white pieces blooming, which left 1.35 only marginally
      // over the line and the glow barely visible. Judge this against the
      // threshold, not in isolation.
      material.color.setRGB(2.1, 0.30, 0.26);
      return material;
    })(),
    selected: new THREE.MeshBasicMaterial({
      color: 0x49e0a0, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    }),
    lastMove: new THREE.MeshBasicMaterial({
      color: 0xf2d98c, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false,
    }),
    // Above-1.0 linear RGB - see capture's comment for the mechanism. Check
    // is the rarer, more dramatic event, so it gets the stronger glow.
    check: (() => {
      const material = new THREE.MeshBasicMaterial({
        transparent: true, opacity: CHECK_OPACITY[0], side: THREE.DoubleSide, depthWrite: false,
      });
      material.color.setRGB(2.4, 0.45, 0.34);
      return material;
    })(),
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
