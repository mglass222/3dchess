import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  easeOutCubic,
  easeInOutCubic,
  shortestAngle,
  sphericalOf,
  applyOrbit,
  sampleFlight,
  CameraFlight,
} from '../src/camera.js';
import { Scene, CAMERA_MAX_POLAR_ANGLE } from '../src/scene.js';

// Same fake-clock harness as test/scene.test.js's `withFakeClock`: stubs
// performance.now into a manually-advanced clock (CameraFlight.start/update
// read it, but always through an explicit nowMs param for update, so this
// mostly matters for start()'s internal performance.now() call).
function withFakeClock(run) {
  const originalNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    return run({ advance: (ms) => { now += ms; }, now: () => now });
  } finally {
    performance.now = originalNow;
  }
}

// Unwraps a raw (possibly >PI or <=-PI) theta into the canonical (-PI, PI]
// range, matching THREE.Spherical/Math.atan2's own convention. sampleFlight
// deliberately does NOT wrap its output (applyOrbit's sin/cos are periodic,
// so there's no correctness reason to), so tests that care about "did this
// go the short way through +/-PI" must unwrap before comparing.
function unwrap(theta) {
  let t = theta % (2 * Math.PI);
  if (t > Math.PI) t -= 2 * Math.PI;
  else if (t <= -Math.PI) t += 2 * Math.PI;
  return t;
}

describe('easing', () => {
  it('easeOutCubic/easeInOutCubic start at 0 and end at exactly 1', () => {
    for (const ease of [easeOutCubic, easeInOutCubic]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
  });

  it('easeOutCubic is fast-then-slow: past the midpoint sooner than linear', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('easeInOutCubic is symmetric around t=0.5', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75), 10);
  });
});

describe('shortestAngle', () => {
  it('goes the short way through +/-PI rather than back through zero', () => {
    const delta = shortestAngle(3.0, -3.0);
    expect(delta).toBeCloseTo(0.283185307179586, 10);
  });

  it('is a no-op for equal angles and simple for small deltas', () => {
    expect(shortestAngle(1.2, 1.2)).toBe(0);
    expect(shortestAngle(0, 1)).toBeCloseTo(1, 10);
    expect(shortestAngle(1, 0)).toBeCloseTo(-1, 10);
  });
});

describe('sphericalOf / applyOrbit', () => {
  it('round-trips through applyOrbit within 1e-12', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(3.1, 4.7, -2.2);
    const target = new THREE.Vector3(0, 0, 0);

    const spherical = sphericalOf(camera, target);
    const restored = new THREE.PerspectiveCamera();
    applyOrbit(restored, target, spherical);

    expect(restored.position.x).toBeCloseTo(camera.position.x, 12);
    expect(restored.position.y).toBeCloseTo(camera.position.y, 12);
    expect(restored.position.z).toBeCloseTo(camera.position.z, 12);
  });

  it('gives radius ~= 12.728, phi === PI/4, theta === 0 for the default (0, 9, 9) camera pose', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 9, 9);
    const target = new THREE.Vector3(0, 0, 0);

    const { radius, phi, theta } = sphericalOf(camera, target);

    expect(radius).toBeCloseTo(12.728, 3);
    expect(phi).toBe(Math.PI / 4);
    expect(theta).toBe(0);
  });
});

describe('sampleFlight', () => {
  const from = { radius: 20, phi: 0.34, theta: -0.45 };
  const to = { radius: 12.728, phi: Math.PI / 4, theta: 0 };

  it('t=0 equals `from`; t=1 is EXACTLY `to` (strict equality per field)', () => {
    expect(sampleFlight(from, to, 0)).toEqual(from);
    const landed = sampleFlight(from, to, 1);
    expect(landed.radius).toBe(to.radius);
    expect(landed.phi).toBe(to.phi);
    expect(landed.theta).toBe(to.theta);
  });

  it('a t past 1 still lands exactly on `to` (defensive clamp)', () => {
    const landed = sampleFlight(from, to, 1.4);
    expect(landed).toEqual(to);
  });

  it('interpolates strictly between endpoints at a mid t', () => {
    const mid = sampleFlight(from, to, 0.5);
    expect(mid.radius).toBeLessThan(from.radius);
    expect(mid.radius).toBeGreaterThan(to.radius);
    expect(mid.phi).toBeGreaterThan(from.phi);
    expect(mid.phi).toBeLessThan(to.phi);
  });

  it('shortest-path azimuth: theta=3.0 -> theta=-3.0 sweeps ~0.283 rad through +/-PI, never back through zero', () => {
    const swept = shortestAngle(3.0, -3.0);
    expect(swept).toBeCloseTo(0.283185307179586, 10);

    const azFrom = { radius: 10, phi: 1, theta: 3.0 };
    const azTo = { radius: 10, phi: 1, theta: -3.0 };
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const { theta } = sampleFlight(azFrom, azTo, t);
      const u = unwrap(theta);
      // Every sample - from the very first (3.0) through the very last
      // (-3.0, wrapping through +/-PI) - stays outside (-2.8, 2.8); it never
      // dips back down near zero, which is what "the short way" means here.
      expect(u > 2.8 || u < -2.8).toBe(true);
    }
  });

  it('every sampled pose over 64 samples stays inside the real clamps (radius in [6,28], phi in [0.05, CAMERA_MAX_POLAR_ANGLE]) — a clamp firing mid-flight would be a visible stall', () => {
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const { radius, phi } = sampleFlight(from, to, t);
      expect(radius).toBeGreaterThanOrEqual(6);
      expect(radius).toBeLessThanOrEqual(28);
      expect(phi).toBeGreaterThanOrEqual(0.05);
      expect(phi).toBeLessThanOrEqual(CAMERA_MAX_POLAR_ANGLE);
    }
  });

  it('radius and phi are monotonic across samples (no overshooting spring)', () => {
    let prevRadius = Infinity;
    let prevPhi = -Infinity;
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const { radius, phi } = sampleFlight(from, to, t);
      expect(radius).toBeLessThanOrEqual(prevRadius + 1e-9);
      expect(phi).toBeGreaterThanOrEqual(prevPhi - 1e-9);
      prevRadius = radius;
      prevPhi = phi;
    }
  });
});

describe('CameraFlight', () => {
  function makeCamera() {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 9, 9);
    return camera;
  }

  function makeControls() {
    const listeners = new Map();
    return {
      target: new THREE.Vector3(0, 0, 0),
      addEventListener(type, handler) { listeners.set(type, handler); },
      _fire(type) { listeners.get(type)?.(); },
    };
  }

  it('fake-clock lifecycle: start() then update(t0+duration) lands exactly on target and returns true; a further update returns false and mutates nothing', () => withFakeClock(({ advance, now }) => {
    const camera = makeCamera();
    const controls = makeControls();
    const flight = new CameraFlight({ camera, controls });

    const to = { radius: 12.728, phi: Math.PI / 4, theta: Math.PI };
    const from = { radius: 20, phi: 0.34, theta: Math.PI - 0.45 };
    const startedFlight = flight.start(to, { duration: 1200, from });
    expect(startedFlight).toBe(false);
    expect(flight.active).toBe(true);

    advance(1200);
    const completed = flight.update(now());
    expect(completed).toBe(true);
    expect(flight.active).toBe(false);

    const landedPose = sphericalOf(camera, controls.target);
    expect(landedPose.radius).toBeCloseTo(to.radius, 9);
    expect(landedPose.phi).toBeCloseTo(to.phi, 9);
    expect(landedPose.theta).toBeCloseTo(to.theta, 9);

    const positionAfterLanding = camera.position.clone();
    advance(500);
    const secondResult = flight.update(now());
    expect(secondResult).toBe(false);
    expect(camera.position.equals(positionAfterLanding)).toBe(true);
  }));

  it('abort: a controls "start" event cancels the flight; camera stays put across later update calls', () => withFakeClock(({ advance, now }) => {
    const camera = makeCamera();
    const controls = makeControls();
    const flight = new CameraFlight({ camera, controls });

    flight.start(
      { radius: 12.728, phi: Math.PI / 4, theta: 0 },
      { duration: 1200, from: { radius: 20, phi: 0.34, theta: -0.45 } },
    );

    advance(400); // partway through
    flight.update(now());
    expect(flight.active).toBe(true);
    const poseAtAbort = camera.position.clone();

    controls._fire('start'); // simulates OrbitControls' pointerdown/wheel/touchstart

    expect(flight.active).toBe(false);

    advance(400);
    flight.update(now());
    expect(flight.active).toBe(false);
    expect(camera.position.equals(poseAtAbort)).toBe(true);
  }));

  it('reduced motion: start() snaps to the target pose immediately and reports inactive', () => withFakeClock(() => {
    const camera = makeCamera();
    const controls = makeControls();
    const flight = new CameraFlight({ camera, controls, reducedMotion: true });

    const to = { radius: 12.728, phi: Math.PI / 4, theta: Math.PI };
    const applied = flight.start(to, { duration: 1200, from: { radius: 20, phi: 0.34, theta: 2.6916 } });

    expect(applied).toBe(true);
    expect(flight.active).toBe(false);

    const pose = sphericalOf(camera, controls.target);
    expect(pose.radius).toBeCloseTo(to.radius, 9);
    expect(pose.phi).toBeCloseTo(to.phi, 9);
    expect(pose.theta).toBeCloseTo(to.theta, 9);
  }));

  it('a fresh CameraFlight defaults `from` to the camera\'s current live pose when none is supplied', () => withFakeClock(({ advance, now }) => {
    const camera = makeCamera(); // (0, 9, 9) -> radius 12.728, phi PI/4, theta 0
    const controls = makeControls();
    const flight = new CameraFlight({ camera, controls });

    flight.start({ radius: 20, phi: 0.5, theta: 1 }, { duration: 1000 });
    advance(0);
    flight.update(now());

    // At t=0 the sampled pose equals `from`, which should be the camera's
    // starting spherical - so the camera shouldn't have jumped anywhere yet.
    expect(camera.position.x).toBeCloseTo(0, 9);
    expect(camera.position.y).toBeCloseTo(9, 9);
    expect(camera.position.z).toBeCloseTo(9, 9);
  }));
});

describe('Scene.prototype.flyToNewGame', () => {
  it('delegates to cameraFlight.start with a legal to/from pose pair and the documented duration/ease', () => {
    const scene = Object.create(Scene.prototype);
    const calls = [];
    scene.cameraFlight = { start: (to, opts) => calls.push({ to, opts }) };

    scene.flyToNewGame('w');

    expect(calls).toHaveLength(1);
    const { to, opts } = calls[0];
    expect(to).toEqual({ radius: Math.hypot(9, 9), phi: Math.PI / 4, theta: 0 });
    expect(opts.duration).toBe(1200);
    expect(typeof opts.ease).toBe('function');
    expect(opts.from).toEqual({ radius: 20, phi: 0.34, theta: -0.45 });
  });

  it('picks theta = PI for Black rather than White\'s 0', () => {
    const scene = Object.create(Scene.prototype);
    const calls = [];
    scene.cameraFlight = { start: (to, opts) => calls.push({ to, opts }) };

    scene.flyToNewGame('b');

    const { to, opts } = calls[0];
    expect(to.theta).toBe(Math.PI);
    expect(opts.from.theta).toBeCloseTo(Math.PI - 0.45, 10);
  });
});
