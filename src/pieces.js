import * as THREE from 'three';

export const PIECE_TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];

const MATERIALS = {
  w: new THREE.MeshStandardMaterial({ color: 0xeae0c8, roughness: 0.45, metalness: 0.05 }),
  b: new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.5, metalness: 0.05 }),
};

// Build a solid of revolution from [radius, height] profile points (bottom -> top).
function lathe(profile, material) {
  const points = profile.map(([r, h]) => new THREE.Vector2(r, h));
  const geom = new THREE.LatheGeometry(points, 48);
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Lathe profiles (radius, height) tuned to read as Staunton silhouettes.
const PROFILES = {
  p: [
    [0.0, 0.0], [0.26, 0.0], [0.26, 0.04], [0.17, 0.07], [0.13, 0.20],
    [0.16, 0.27], [0.10, 0.30], [0.10, 0.34], [0.16, 0.40], [0.0, 0.40],
  ],
  r: [
    [0.0, 0.0], [0.30, 0.0], [0.30, 0.05], [0.20, 0.10], [0.18, 0.42],
    [0.25, 0.46], [0.27, 0.58], [0.18, 0.58], [0.18, 0.50], [0.0, 0.50],
  ],
  b: [
    [0.0, 0.0], [0.28, 0.0], [0.28, 0.05], [0.18, 0.09], [0.13, 0.40],
    [0.19, 0.46], [0.12, 0.52], [0.12, 0.68], [0.07, 0.78], [0.0, 0.82],
  ],
  q: [
    [0.0, 0.0], [0.32, 0.0], [0.32, 0.05], [0.20, 0.10], [0.15, 0.55],
    [0.22, 0.62], [0.16, 0.72], [0.18, 0.86], [0.10, 0.92], [0.0, 0.98],
  ],
  k: [
    [0.0, 0.0], [0.32, 0.0], [0.32, 0.05], [0.21, 0.10], [0.16, 0.60],
    [0.23, 0.68], [0.17, 0.80], [0.17, 0.96], [0.10, 1.00], [0.0, 1.02],
  ],
};

function buildRook(material) {
  const group = new THREE.Group();
  group.add(lathe(PROFILES.r, material));
  // Crenellations: four small blocks around the rim (each owns its geometry
  // so per-mesh disposal in scene.js is safe).
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.09), material);
    const a = (i / 4) * Math.PI * 2;
    m.position.set(Math.cos(a) * 0.18, 0.60, Math.sin(a) * 0.18);
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

function buildKnight(material) {
  const group = new THREE.Group();
  group.add(lathe(PROFILES.p.map(([r, h]) => [r * 1.05, h * 0.7]), material)); // short base
  // Sculpted horse-head silhouette, extruded and stood up facing +x.
  const shape = new THREE.Shape();
  const outline = [
    [-0.06, 0.0], [0.10, 0.0], [0.10, 0.06], [0.02, 0.10], [0.06, 0.20],
    [0.18, 0.24], [0.20, 0.34], [0.10, 0.40], [0.00, 0.40], [-0.06, 0.34],
    [-0.10, 0.22], [-0.14, 0.16], [-0.12, 0.06],
  ];
  shape.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 });
  geom.center();
  const head = new THREE.Mesh(geom, material);
  head.castShadow = true;
  head.position.y = 0.50;
  group.add(head);
  return group;
}

function buildFinialedRoyalty(profileKey, material, makeCrown) {
  const group = new THREE.Group();
  group.add(lathe(PROFILES[profileKey], material));
  makeCrown(group, material);
  return group;
}

// type -> Object3D builder
const BUILDERS = {
  p: (mat) => { const g = new THREE.Group(); g.add(lathe(PROFILES.p, mat)); return g; },
  b: (mat) => { const g = new THREE.Group(); g.add(lathe(PROFILES.b, mat)); return g; },
  r: buildRook,
  n: buildKnight,
  q: (mat) => buildFinialedRoyalty('q', mat, (g, m) => {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), m);
    ball.position.y = 1.02; ball.castShadow = true; g.add(ball);
  }),
  k: (mat) => buildFinialedRoyalty('k', mat, (g, m) => {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), m);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.05), m);
    v.position.y = 1.12; h.position.y = 1.13; // 0.01 offset avoids z-fighting between the two bars
    v.castShadow = true; h.castShadow = true;
    g.add(v); g.add(h);
  }),
};

export function createPiece(type, color) {
  const material = MATERIALS[color];
  const obj = BUILDERS[type](material);
  obj.userData = { type, color };
  return obj;
}
