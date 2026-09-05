import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// The reflected window and the shadow-casting key use the same direction.
export const WINDOW_POSITION = [6.5, 11, 5];
export const TABLE_TOP = -0.48;

function mesh(geometry, material, name, y = 0) {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.position.y = y;
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

// Grain coordinates in physical board units, with the long grain along X.
// Rails are built once and rotated, so each rail's grain follows its length.
export function furnitureUVs(geometry, scale = 1) {
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    uv[i * 2] = (Math.abs(normals.getX(i)) > 0.8 ? positions.getZ(i) : positions.getX(i)) / scale;
    uv[i * 2 + 1] = (Math.abs(normals.getY(i)) > 0.8 ? positions.getZ(i) : positions.getY(i)) / scale;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

export function createBoardFrame(frameMaterial) {
  const frame = new THREE.Group();
  frame.name = 'board-frame';
  const rail = new THREE.Shape();
  rail.moveTo(-4.515, 4.53);
  rail.lineTo(4.515, 4.53);
  rail.lineTo(4.045, 4.06);
  rail.lineTo(-4.045, 4.06);
  rail.closePath();
  const railGeometry = new THREE.ExtrudeGeometry(rail, {
    depth: 0.22, steps: 1, bevelEnabled: true,
    bevelSegments: 3, bevelSize: 0.01, bevelThickness: 0.014,
  });
  railGeometry.rotateX(-Math.PI / 2);
  furnitureUVs(railGeometry);
  for (let i = 0; i < 4; i++) {
    const railMesh = mesh(railGeometry, frameMaterial, `frame-rail-${i}`, -0.247);
    railMesh.rotation.y = i * Math.PI / 2;
    frame.add(railMesh);
  }

  const base = furnitureUVs(new RoundedBoxGeometry(9.1, 0.18, 9.1, 3, 0.045));
  frame.add(mesh(base, frameMaterial, 'board-plinth', -0.31));

  // Pale wood stringing separates the veneer from the walnut surround.
  const inlayMaterial = new THREE.MeshStandardMaterial({
    color: 0xc6ab79, roughness: 0.48, metalness: 0, envMapIntensity: 0.3,
  });
  for (let i = 0; i < 4; i++) {
    const inlay = mesh(new THREE.BoxGeometry(8.09, 0.018, 0.025), inlayMaterial, `frame-inlay-${i}`, -0.024);
    const angle = i * Math.PI / 2;
    inlay.rotation.y = angle;
    inlay.position.x = Math.sin(angle) * 4.035;
    inlay.position.z = Math.cos(angle) * 4.035;
    frame.add(inlay);
  }
  const footMaterial = new THREE.MeshStandardMaterial({ color: 0x242019, roughness: 0.95 });
  const footGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 16);
  for (const x of [-3.8, 3.8]) for (const z of [-3.8, 3.8]) {
    const foot = mesh(footGeometry, footMaterial, 'board-foot', TABLE_TOP + 0.04);
    foot.position.x = x;
    foot.position.z = z;
    frame.add(foot);
  }
  return frame;
}

export function createTable(material) {
  const table = new THREE.Group();
  table.name = 'study-table';
  const topGeometry = furnitureUVs(new RoundedBoxGeometry(24, 0.65, 20, 4, 0.16));
  table.add(mesh(topGeometry, material, 'tabletop', TABLE_TOP - 0.325));
  const apronGeometry = furnitureUVs(new RoundedBoxGeometry(22.4, 0.8, 18.4, 2, 0.06));
  table.add(mesh(apronGeometry, material, 'table-apron', TABLE_TOP - 1.03));
  const legGeometry = furnitureUVs(new RoundedBoxGeometry(0.8, 6.5, 0.8, 2, 0.06));
  for (const x of [-10.5, 10.5]) for (const z of [-8.5, 8.5]) {
    const leg = mesh(legGeometry, material, 'table-leg', TABLE_TOP - 3.9);
    leg.position.x = x;
    leg.position.z = z;
    table.add(leg);
  }
  return table;
}

// A compact, generated studio environment avoids a large HDR download. Broad
// window panes produce coherent highlights rather than six unrelated softboxes.
export function createStudyEnvironment() {
  const room = new THREE.Scene();
  const enclosure = new THREE.Mesh(new THREE.BoxGeometry(40, 30, 40), new THREE.MeshBasicMaterial({
    color: 0xb0afa9, side: THREE.BackSide,
  }));
  enclosure.position.y = 7;
  room.add(enclosure);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x5c4a36 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -7.9;
  room.add(ground);
  const windowGroup = new THREE.Group();
  windowGroup.position.set(...WINDOW_POSITION);
  windowGroup.lookAt(0, 0, 0);
  const paneGeometry = new THREE.PlaneGeometry(2.8, 3.8);
  const paneMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  paneMaterial.color.setRGB(18, 17.5, 16.5);
  for (const x of [-1.5, 1.5]) for (const y of [-2, 2]) {
    const pane = new THREE.Mesh(paneGeometry, paneMaterial);
    pane.position.set(x, y, 0);
    windowGroup.add(pane);
  }
  room.add(windowGroup);
  room.dispose = () => {
    const resources = new Set();
    room.traverse((object) => {
      if (!object.isMesh) return;
      resources.add(object.geometry);
      resources.add(object.material);
    });
    resources.forEach((resource) => resource.dispose());
  };
  return room;
}
