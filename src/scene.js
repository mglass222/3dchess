import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  allSquares, squareToWorld, worldToSquare, isLightSquare,
} from './coords.js';

const LIGHT_SQ = 0xddc9a3;
const DARK_SQ = 0x8a5a3b;

export class Scene {
  constructor(container) {
    this.container = container;
    this.pieces = new Map();      // square -> Object3D
    this.highlights = [];         // Mesh[]

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.domElement = this.renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d24);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 9, 9);

    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 28;
    // Orbit-only: full 360deg around (azimuth unconstrained), tilt from near
    // top-down to just under the board; clamp shy of the poles to avoid flip.
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = Math.PI - 0.05;

    this._addLights();
    this._buildBoard();

    // Invisible plane at the board top for raycasting empty squares.
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.pickPlane);

    this.raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    this._highlightGeom = new THREE.RingGeometry(0.30, 0.42, 32);
    this._highlightMat = new THREE.MeshBasicMaterial({
      color: 0x49e0a0, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });

    window.addEventListener('resize', () => this._resize());
    this._resize();
    this._animate();
  }

  _addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = -8; key.shadow.camera.right = 8;
    key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xaaccff, 0.35);
    fill.position.set(-6, 6, -4);
    this.scene.add(fill);
  }

  _buildBoard() {
    const board = new THREE.Group();
    const tile = new THREE.BoxGeometry(1, 0.25, 1);
    const lightMat = new THREE.MeshStandardMaterial({ color: LIGHT_SQ, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: DARK_SQ, roughness: 0.7 });
    for (const sq of allSquares()) {
      const { x, z } = squareToWorld(sq);
      const mesh = new THREE.Mesh(tile, isLightSquare(sq) ? lightMat : darkMat);
      mesh.position.set(x, -0.125, z); // top face at y=0
      mesh.receiveShadow = true;
      board.add(mesh);
    }
    // Frame skirt.
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 0.3, 8.6),
      new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.8 }),
    );
    frame.position.y = -0.16;
    frame.receiveShadow = true;
    board.add(frame);
    this.scene.add(board);
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
