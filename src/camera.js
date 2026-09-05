import * as THREE from 'three';

// Tier 3 C1 - camera flight (New Game orbit-in). A pure seam (easing,
// spherical conversion, sampling) plus a thin stateful shell, following the
// MarkerLayer.update(nowMs) / syncContactShadow precedent in scene.js: pure
// functions of time so this is fully testable under node, where Scene#_animate
// (rAF-driven) is unreachable.
//
// THE KEY INSIGHT (verified against node_modules/three/examples/jsm/controls/
// OrbitControls.js): OrbitControls#update() recomputes `_v = position -
// target` and `this._spherical.setFromVector3(_v)` at the TOP of every call
// (see update(), lines ~294-302). It holds no authoritative pose a flight
// could fight, and it is the sole authority on the minDistance/maxDistance/
// minPolarAngle/maxPolarAngle clamps (applied later in the same call, via
// _clampDistance and a direct Math.max/min on phi). Therefore: the flight
// writes camera.position; controls.update() re-derives its spherical from
// that position and clamps/damps it. Scene#_animate must call
// cameraFlight.update() BEFORE controls.update() every frame.
//
// Consequences:
// - This module must NEVER duplicate the distance/polar clamps -
//   controls.update() already applies them. Both New Game poses below are
//   chosen to already sit inside them, so there is nothing to clamp.
// - A residual _sphericalDelta from a drag decays per update() and adds on
//   top of the flight's pose. That's a few thousandths of a radian and reads
//   as the flight easing OUT of the user's last gesture - desired behaviour,
//   not a bug to zero out (it's private on OrbitControls anyway, and decaying
//   it is the entire point of damping).
// - Never set controls.enabled = false during a flight - that would make
//   abort impossible.
//
// Abort seam: OrbitControls dispatches a 'start' event from its pointerdown
// (onMouseDown), touchstart (onTouchStart) and wheel (onMouseWheel) handlers
// (verified: three `this.dispatchEvent(_startEvent)` call sites in those
// three functions, and no others). CameraFlight listens for it and cancels -
// cancel() just stops writing; the camera stays wherever the last sampled
// frame put it, and controls picks up seamlessly because it re-derives from
// camera.position regardless of whether a flight was ever running.
//
// Input is deliberately NEVER gated during a flight (no `input.disable()` /
// `controls.enabled = false` anywhere in this module or in scene.js's
// wiring): the flight owns no game state and mutates only camera.position;
// pickSquare (scene.js) reads camera matrices at pointerup, so it is correct
// mid-flight; a pointerdown aborts the flight anyway (see above); main.js
// already has a drag-vs-click discriminator (>5px is treated as a rotate,
// see the pointerup listener in main.js); and blocking clicks for ~1.2s after
// every New Game would be a latency regression nobody would attribute to a
// camera animation.

export function easeOutCubic(t) { return 1 - (1 - t) ** 3; }

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

const TWO_PI = Math.PI * 2;

// Shortest signed angular delta from `from` to `to` (radians), always in
// (-PI, PI]. A flip from theta=3.0 to theta=-3.0 is 0.28 rad through +/-PI,
// not 6.0 rad back through zero - this is what keeps an azimuth flight
// (theta_side changing between White/Black, see scene.js#flyToNewGame) from
// sweeping all the way around the board the long way.
export function shortestAngle(from, to) {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  else if (delta <= -Math.PI) delta += TWO_PI;
  return delta;
}

// Reads camera.position relative to `target` through the EXACT same
// convention OrbitControls.update() uses: THREE.Spherical, phi measured from
// +Y, theta measured from +Z toward +X. This is only equivalent to
// OrbitControls' own internal spherical (which additionally rotates offset by
// a quaternion aligning object.up with +Y before/after) when camera.up is the
// default (0, 1, 0) - true everywhere in this app; OrbitControls itself skips
// that rotation step's effect in that case too (the quaternion is identity).
export function sphericalOf(camera, target) {
  const offset = camera.position.clone().sub(target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  return { radius: spherical.radius, phi: spherical.phi, theta: spherical.theta };
}

// Inverse of sphericalOf: writes camera.position from a { radius, phi, theta }
// pose plus `target`. Does not touch controls.target or call controls.update()
// - the caller (CameraFlight#update) writes position only, per the key insight
// above.
export function applyOrbit(camera, target, spherical) {
  const offset = new THREE.Vector3().setFromSphericalCoords(
    spherical.radius, spherical.phi, spherical.theta,
  );
  camera.position.copy(target).add(offset);
  return camera.position;
}

// Pure sample of a flight from `from` to `to` at normalized time t. Radius
// and phi are plain lerps; theta takes the shortest signed path (see
// shortestAngle) so an azimuth flip sweeps the short way around rather than
// back through zero. Lands EXACTLY on `to` at t >= 1 - returned as `{ ...to }`
// rather than interpolated with ease(1), the same reasoning as movePiece
// finishing at exactly 1 rather than sin(PI) (~1.2e-16): a flight that never
// bit-exactly matches the resting pose would leave OrbitControls perpetually
// re-deriving a spherical a few ULPs off from the "true" default framing.
export function sampleFlight(from, to, t, ease = easeOutCubic) {
  if (t <= 0) return { ...from };
  if (t >= 1) return { ...to };
  const e = ease(t);
  const deltaTheta = shortestAngle(from.theta, to.theta);
  return {
    radius: from.radius + (to.radius - from.radius) * e,
    phi: from.phi + (to.phi - from.phi) * e,
    theta: from.theta + deltaTheta * e,
  };
}

// New Game orbit-in poses. HOME is the exact distance/tilt of the default
// (0, 9, 9) camera looking at the origin - Math.hypot(9, 9), not the rounded
// 12.728 literal from the design notes - so the flight lands bit-for-bit on
// wherever the camera already sits before any game has been played, rather
// than a few ULPs short of it. START is a wide, low-angle snap-out: radius 20
// (< maxDistance 28) and phi 0.34 (> minPolarAngle 0.05) are both already
// inside OrbitControls' clamps, per the "never duplicate the clamps" rule
// above. THETA_OFFSET (-0.45 rad) is the snap-out azimuth relative to
// whichever side is about to play, so the swing back in reads as a
// directional turn rather than a straight dolly.
export const CAMERA_HOME = { radius: Math.hypot(9, 9), phi: Math.PI / 4 };
export const CAMERA_NEW_GAME_START = { radius: 20, phi: 0.34 };
export const CAMERA_NEW_GAME_THETA_OFFSET = -0.45;
export const CAMERA_NEW_GAME_DURATION = 1200;

// side is 'w' or 'b' (Game's turn()/colour convention) - theta_side is 0 for
// White, PI for Black. The side-switch flip itself (rotating the board so the
// human's side faces the camera) is Tier 3 C2, a later pass; this only picks
// the target azimuth for whichever side is about to play right now.
export function newGamePose(side) {
  const theta = side === 'b' ? Math.PI : 0;
  return {
    to: { radius: CAMERA_HOME.radius, phi: CAMERA_HOME.phi, theta },
    from: {
      radius: CAMERA_NEW_GAME_START.radius,
      phi: CAMERA_NEW_GAME_START.phi,
      theta: theta + CAMERA_NEW_GAME_THETA_OFFSET,
    },
  };
}

// Thin stateful shell around the pure functions above. Constructed once per
// Scene (see scene.js constructor); `start()` is called per New Game.
export class CameraFlight {
  constructor({ camera, controls, reducedMotion = false }) {
    this.camera = camera;
    this.controls = controls;
    this.reducedMotion = reducedMotion;
    this._active = false;
    this._from = null;
    this._to = null;
    this._ease = easeOutCubic;
    this._t0 = 0;
    this._duration = 0;

    // The sole abort seam - see the module doc comment above for why this is
    // the right (and only) event to listen for.
    this.controls.addEventListener('start', () => this.cancel());
  }

  // `to`/`from` are { radius, phi, theta } poses (see sphericalOf/applyOrbit).
  // `from` defaults to the camera's CURRENT pose (read via sphericalOf) so a
  // flight can also be started as a plain "fly to X from here"; New Game
  // passes an explicit `from` to snap out first (see scene.js#flyToNewGame).
  // Returns true if the target pose was applied immediately (reduced motion),
  // false if a flight was started.
  start(to, { duration = 1200, ease = easeOutCubic, from = null } = {}) {
    this._to = to;
    this._ease = ease;
    this._duration = duration;
    this._from = from ?? sphericalOf(this.camera, this.controls.target);

    if (this.reducedMotion) {
      applyOrbit(this.camera, this.controls.target, to);
      this._active = false;
      return true;
    }

    this._t0 = performance.now();
    this._active = true;
    return false;
  }

  // Advances the flight to `nowMs` and writes camera.position (via
  // applyOrbit) - never controls state. Returns true on the exact frame the
  // flight completes, false otherwise (including every call once inactive,
  // which is a no-op). Called first in Scene#_animate, before
  // controls.update() - see the module doc comment for why the ordering
  // matters.
  update(nowMs) {
    if (!this._active) return false;
    const t = Math.min(1, (nowMs - this._t0) / this._duration);
    const pose = sampleFlight(this._from, this._to, t, this._ease);
    applyOrbit(this.camera, this.controls.target, pose);
    if (t >= 1) {
      this._active = false;
      return true;
    }
    return false;
  }

  // Stops writing. Does NOT restore or snap anything - the camera stays
  // exactly where the last sampled frame put it, and controls.update() picks
  // up seamlessly on the very next frame since it re-derives its spherical
  // from camera.position regardless.
  cancel() {
    this._active = false;
  }

  get active() { return this._active; }
}
