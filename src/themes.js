import * as THREE from 'three';

// Self-contained thematic backgrounds. Two kinds:
//  - "mood" themes: a vertical gradient set as scene.background (+ optional starfield)
//  - "place" themes: a gradient sky + a ground plane + low-poly 3D landmarks placed
//    behind the board (they parallax as you orbit). All procedural — no asset files.
export const THEMES = [
  // --- moods ---
  { key: 'midnight', label: 'Midnight',     top: '#0c0f17', bottom: '#232a3d' },
  { key: 'walnut',   label: 'Walnut Study', top: '#180f08', bottom: '#5e4029' },
  { key: 'cosmos',   label: 'Cosmos',       top: '#01010a', bottom: '#191540', stars: true },
  { key: 'dusk',     label: 'Dusk',         top: '#1f1140', bottom: '#c9663d' },
  { key: 'emerald',  label: 'Emerald',      top: '#05130e', bottom: '#2f6048' },
  // --- places (gradient sky + 3D landmark scenery) ---
  { key: 'egypt',   label: 'Ancient Egypt', scenery: 'egypt',   top: '#603a86', bottom: '#f4b25a', ground: '#b98f54', stone: '#d9b97e' },
  { key: 'paris',   label: 'Paris',         scenery: 'paris',   top: '#243a6b', bottom: '#e8b9b0', ground: '#3a4055', stone: '#8d8f9c' },
  { key: 'london',  label: 'London',        scenery: 'london',  top: '#3a4757', bottom: '#aeb7c4', ground: '#3c4654', stone: '#6f7682' },
  { key: 'rome',    label: 'Rome',          scenery: 'rome',    top: '#5a3a6b', bottom: '#f0c074', ground: '#7a6442', stone: '#cbae7e' },
  { key: 'newyork', label: 'New York',      scenery: 'newyork', top: '#1d2a52', bottom: '#f0a064', ground: '#2a3146', stone: '#5a6072' },
];

export const DEFAULT_THEME = 'midnight';

export function getTheme(key) {
  return THEMES.find((t) => t.key === key) ?? THEMES[0];
}

// Vertical-gradient texture for scene.background (browser-only: uses a canvas).
export function makeGradientTexture(topColor, bottomColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, bottomColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A spherical shell of stars (for space-y themes). Pure THREE (works without a DOM).
export function makeStarfield(count = 1400, radius = 46) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.85 + Math.random() * 0.15);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.9,
  });
  const points = new THREE.Points(geom, mat);
  points.name = 'starfield';
  return points;
}

// ---------------------------------------------------------------------------
// 3D landmark scenery (place themes)
// ---------------------------------------------------------------------------

const GY = -0.33; // ground level (just below the board frame)

// Build a Group: a ground disc + the theme's landmarks, placed around/behind the board.
export function makeScenery(theme) {
  const g = new THREE.Group();
  g.name = 'scenery';

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(46, 64),
    new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GY;
  ground.receiveShadow = true;
  g.add(ground);

  const stone = new THREE.MeshStandardMaterial({ color: theme.stone, roughness: 0.95, metalness: 0 });
  (SCENERY[theme.scenery] || (() => {}))(g, stone, theme);
  return g;
}

// --- geometry helpers (base sits on the ground) ---
function box(g, mat, w, h, d, x, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, GY + h / 2, z);
  m.rotation.y = ry;
  g.add(m);
  return m;
}
function pyramid(g, mat, base, h, x, z) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(base, h, 4), mat);
  m.position.set(x, GY + h / 2, z);
  m.rotation.y = Math.PI / 4; // face a flat side forward
  g.add(m);
  return m;
}
function cyl(g, mat, rt, rb, h, x, z, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, GY + h / 2, z);
  g.add(m);
  return m;
}

const SCENERY = {
  egypt(g, stone, t) {
    pyramid(g, stone, 9, 13, 1, -19);
    pyramid(g, stone, 6.5, 9.5, -12, -16);
    pyramid(g, stone, 7.5, 11, 13, -22);
    // a low sphinx-ish block
    box(g, stone, 5, 2.4, 9, -22, -12);
    box(g, stone, 2.2, 2.2, 2.2, -18.2, -12);
    // setting sun (unlit glowing disc, low on the horizon, far away)
    const sun = new THREE.Mesh(new THREE.CircleGeometry(5, 40), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    sun.position.set(3, 5.5, -34);
    g.add(sun);
  },

  paris(g, stone, t) {
    eiffel(g, stone, 0, -18, 1.3);
    // Haussmann blocks around
    for (let i = -3; i <= 3; i++) {
      if (Math.abs(i) < 1) continue;
      box(g, stone, 3.2, 3 + Math.abs(i) * 0.4, 3.2, i * 5.5, -24 + (i % 2) * 2);
    }
  },

  london(g, stone, t) {
    bigBen(g, stone, -4, -18);
    londonEye(g, stone, 8, -20, 4.2);
    // a few riverside blocks
    box(g, stone, 3, 6, 3, -14, -22);
    box(g, stone, 2.6, 8, 2.6, -10, -24);
    box(g, stone, 3.4, 5, 3.4, 14, -23);
  },

  rome(g, stone, t) {
    colosseum(g, stone, 0, -23);
    // a ruined colonnade off to the left
    for (let i = 0; i < 6; i++) cyl(g, stone, 0.42, 0.5, 5, -19 + i * 1.6, -13);
    const ent = box(g, stone, 10.5, 1.1, 1.8, -15, -13);
    ent.position.y = GY + 5 + 0.55; // entablature resting on the columns
  },

  newyork(g, stone, t) {
    // skyline of towers across the back
    let x = -22;
    let seed = 1;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    while (x < 22) {
      const w = 2.4 + rnd() * 2.6;
      const h = 6 + rnd() * 13;
      box(g, stone, w, h, w, x, -22 - rnd() * 3);
      x += w + 0.6;
    }
    // a tapered hero tower (Empire State-ish)
    box(g, stone, 3.4, 12, 3.4, 2, -18);
    box(g, stone, 2.2, 4, 2.2, 2, -18);
    cyl(g, stone, 0.15, 0.4, 3, 2, -18, 8);
    // Statue of Liberty (verdigris green, raised torch)
    statueOfLiberty(g, -11, -18);
  },
};

function colosseum(g, mat, ox, oz) {
  const N = 22;
  const sx = 6.4, sz = 4.7;
  // low elliptical base drum
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(sx, sx, 0.9, 44, 1, true),
    new THREE.MeshStandardMaterial({ color: mat.color, roughness: 0.95, side: THREE.DoubleSide }),
  );
  base.scale.set(1, 1, sz / sx);
  base.position.set(ox, GY + 0.45, oz);
  g.add(base);
  // two tiers of arcade piers — the gaps between them read as arches
  const tier = (rsx, rsz, ph, py) => {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.72, ph, 0.6), mat);
      m.position.set(ox + Math.sin(a) * rsx, GY + py + ph / 2, oz + Math.cos(a) * rsz);
      m.rotation.y = a;
      g.add(m);
    }
  };
  tier(sx, sz, 3.0, 0.9);
  tier(sx * 0.98, sz * 0.98, 2.3, 3.9);
}

function statueOfLiberty(g, x, z) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a8f7a, roughness: 1 });
  const patina = new THREE.MeshStandardMaterial({ color: 0x84a894, roughness: 0.9 });
  const ped = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), stone);
  ped.position.set(x, GY + 1.2, z); g.add(ped);
  const ped2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.5), stone);
  ped2.position.set(x, GY + 2.9, z); g.add(ped2);
  const rb = GY + 3.4; // robe base
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.85, 2.4, 12), patina);
  robe.position.set(x, rb + 1.2, z); g.add(robe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), patina);
  head.position.set(x, rb + 2.7, z); g.add(head);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.5, 8), patina);
  arm.position.set(x + 0.55, rb + 2.3, z); arm.rotation.z = -0.55; g.add(arm);
  const torch = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0x6a4a00 }),
  );
  torch.position.set(x + 1.05, rb + 3.1, z); g.add(torch);
}

// A thin box strut between two 3D points (used for the Eiffel legs).
function strut(g, mat, x1, y1, z1, x2, y2, z2, thick) {
  const start = new THREE.Vector3(x1, y1, z1);
  const dir = new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1);
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, dir.length(), thick), mat);
  m.position.copy(start).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.add(m);
  return m;
}

function eiffel(g, mat, ox, oz, s) {
  const baseH = 3.4 * s; // height to the first platform (the "waist")
  const b = 1.5 * s;     // half base-width (legs splay this far)
  const wb = 0.45 * s;   // half waist-width (legs nearly meet here)
  const waistY = GY + baseH;
  // four thin splayed legs (open arch beneath) — full height from ground to waist
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    strut(g, mat, ox + sx * b, GY, oz + sz * b, ox + sx * wb, waistY, oz + sz * wb, 0.2 * s);
  }
  // arch brace + first platform
  box(g, mat, b * 1.7, 0.16 * s, b * 1.7, ox, oz).position.y = GY + baseH * 0.46;
  box(g, mat, b * 1.3, 0.28 * s, b * 1.3, ox, oz).position.y = waistY;
  // tapered mid section (clearly narrows upward), second platform
  const midH = 2.6 * s;
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * s, b * 0.78, midH, 4), mat);
  mid.position.set(ox, waistY + midH / 2, oz); mid.rotation.y = Math.PI / 4; g.add(mid);
  box(g, mat, 0.8 * s, 0.2 * s, 0.8 * s, ox, oz).position.y = waistY + midH;
  // tapered top section + antenna
  const topH = 2.4 * s;
  const tp = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.55 * s, topH, 4), mat);
  tp.position.set(ox, waistY + midH + topH / 2, oz); tp.rotation.y = Math.PI / 4; g.add(tp);
  cyl(g, mat, 0.04 * s, 0.07 * s, 1.0 * s, ox, oz).position.y = waistY + midH + topH + 0.5 * s;
}

function bigBen(g, mat, x, z) {
  box(g, mat, 2.2, 11, 2.2, x, z);                  // shaft
  box(g, mat, 2.7, 0.8, 2.7, x, z).position.y = GY + 9.2;   // belfry ring
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.4, 4), mat);
  roof.position.set(x, GY + 11.4, z);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  // clock face (light disc) on the +z face
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), new THREE.MeshStandardMaterial({ color: 0xefe7c6, roughness: 0.6 }));
  clock.position.set(x, GY + 8, z + 1.12);
  g.add(clock);
}

function londonEye(g, mat, x, z, r) {
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(r, 0.16, 10, 48), mat);
  wheel.position.set(x, GY + r + 0.6, z);
  g.add(wheel); // torus lies in the XY plane by default → stands vertically facing +z
  // hub + a couple of spokes suggestion
  cyl(g, mat, 0.25, 0.25, 0.4, x, z).position.set(x, GY + r + 0.6, z);
  // A-frame supports
  const sup1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, r + 1.2, 6), mat);
  sup1.position.set(x - 0.9, GY + (r + 0.6) / 2, z);
  sup1.rotation.z = 0.28;
  g.add(sup1);
  const sup2 = sup1.clone();
  sup2.position.set(x + 0.9, GY + (r + 0.6) / 2, z);
  sup2.rotation.z = -0.28;
  g.add(sup2);
}
