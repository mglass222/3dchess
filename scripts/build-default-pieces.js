// Offline asset authoring. The browser loads the resulting GLBs; no geometry
// generation, simplifier, or source scene download runs during play.
import fs from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';

const output = new URL('../public/models/Default/', import.meta.url);
const source = new URL('../public/models/Downloaded/realistic_chess_set_3d_model.glb', import.meta.url);
const credit = {
  title: 'Realistic Chess Set 3D Model', author: 'noob-3d',
  source: 'https://sketchfab.com/3d-models/realistic-chess-set-3d-model-a07b3ac3f57f4fa3822e3f2d6241a7b0',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  modifications: 'Knight head extracted, simplified, resized, given recessed eyes/nostrils and mounted on a new turned pedestal. Original textures removed.',
};

function lathe(points, segments = 80) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}
function sphere(radius, x, y, z, scale = [1, 1, 1]) {
  const geometry = new THREE.SphereGeometry(radius, radius < .05 ? 20 : 40, radius < .05 ? 12 : 24);
  geometry.scale(...scale);
  geometry.translate(x, y, z);
  return geometry;
}
function turnedBody(radius, collarY, neckRadius) {
  // Paired beads, a recessed fillet, curved shoulder, taper and rolled collar.
  return lathe([
    [0, 0], [radius * .85, 0], [radius * .94, .012], [radius, .032],
    [radius, .055], [radius * .98, .071], [radius * .90, .087],
    [radius * .85, .09], [radius * .85, .108], [radius * .94, .12],
    [radius * .96, .134], [radius * .94, .15], [radius * .88, .16],
    [radius * .78, .185], [radius * .66, .22], [radius * .53, .28],
    [neckRadius * 1.2, collarY * .61], [neckRadius, collarY * .77],
    [neckRadius * .97, collarY - .085], [neckRadius * 1.02, collarY - .055],
    [neckRadius * 1.35, collarY - .034], [neckRadius * 1.74, collarY - .024],
    [neckRadius * 1.86, collarY - .01], [neckRadius * 1.87, collarY + .005],
    [neckRadius * 1.7, collarY + .022], [neckRadius * 1.2, collarY + .03],
    [neckRadius * 1.1, collarY + .045], [0, collarY + .045],
  ]);
}
function join(parts) {
  const prepared = parts.map((geometry) => {
    geometry.deleteAttribute('uv');
    return geometry.index ? geometry.toNonIndexed() : geometry;
  });
  const merged = mergeVertices(mergeGeometries(prepared), 1e-5);
  // New models are authored in board units. Their grain coordinates are
  // generated once here; runtime preserves these instead of unwrapping clones.
  const p = merged.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * 1.7 + p.getZ(i) * .7;
    uv[i * 2 + 1] = p.getY(i) * .7;
  }
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

// Clip a convex head against a plane and close its cut face. Two opposing cuts
// form a real diagonal bishop slot, including visible interior faces.
function clippedHead(geometry, normal, constant) {
  const g = geometry.toNonIndexed();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const outP = [], outN = [], edge = [];
  const distance = (v) => normal.dot(v.p) + constant;
  const emit = (v) => { outP.push(...v.p); outN.push(...v.n); };
  for (let i = 0; i < p.count; i += 3) {
    const polygon = [0, 1, 2].map((j) => ({ p: new THREE.Vector3().fromBufferAttribute(p, i + j), n: new THREE.Vector3().fromBufferAttribute(n, i + j) }));
    const clipped = [];
    for (let j = 0; j < 3; j++) {
      const a = polygon[j], b = polygon[(j + 1) % 3];
      const da = distance(a), db = distance(b);
      if (da >= 0) clipped.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        const v = { p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize() };
        clipped.push(v); edge.push(v.p);
      }
    }
    for (let j = 1; j + 1 < clipped.length; j++) [clipped[0], clipped[j], clipped[j + 1]].forEach(emit);
  }
  const axisU = new THREE.Vector3(0, 0, 1);
  const axisV = new THREE.Vector3().crossVectors(normal, axisU);
  const unique = [...new Map(edge.map((v) => [v.toArray().map((c) => c.toFixed(6)).join(','), v])).values()];
  const center = unique.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(unique.length);
  unique.sort((a, b) => {
    const av = a.clone().sub(center), bv = b.clone().sub(center);
    return Math.atan2(av.dot(axisV), av.dot(axisU)) - Math.atan2(bv.dot(axisV), bv.dot(axisU));
  });
  const capNormal = normal.clone().negate();
  for (let i = 0; i < unique.length; i++) {
    [center, unique[(i + 1) % unique.length], unique[i]].forEach((v) => emit({ p: v, n: capNormal }));
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3));
  return result;
}

function pawn() {
  return join([turnedBody(.245, .49, .075), sphere(.132, 0, .666, 0)]);
}
function bishop() {
  const body = turnedBody(.29, .73, .078);
  const head = lathe([[0,.772],[.064,.78],[.109,.815],[.136,.86],[.14,.90],[.129,.94],[.105,.981],[.078,1.022],[.046,1.064],[.016,1.095],[0,1.108]]);
  const normal = new THREE.Vector3(1, -.65, 0).normalize();
  const constant = .65 * .965 / Math.hypot(1, .65);
  return join([body, clippedHead(head, normal, constant - .012), clippedHead(head, normal.clone().negate(), -constant - .012), sphere(.033, 0, 1.12, 0)]);
}
function rook() {
  const body = turnedBody(.30, .66, .114);
  const tower = lathe([[0,.68],[.161,.68],[.155,.72],[.157,.79],[.17,.827],[.211,.849],[.217,.868],[.211,.887],[.146,.887],[.14,.869],[.14,.824],[0,.824]]);
  const teeth = [];
  for (let i = 0; i < 6; i++) {
    const shape = new THREE.Shape();
    const angle = i * Math.PI / 3, width = Math.PI / 5;
    shape.absarc(0, 0, .212, angle, angle + width, false);
    shape.absarc(0, 0, .143, angle + width, angle, true);
    shape.closePath();
    const sector = new THREE.ExtrudeGeometry(shape, { depth: .088, bevelEnabled: true, bevelSize: .005, bevelThickness: .004, bevelSegments: 2, curveSegments: 8 });
    sector.rotateX(-Math.PI / 2); sector.translate(0, .883, 0);
    teeth.push(sector);
  }
  return join([body, tower, ...teeth]);
}
function queen() {
  const body = turnedBody(.328, .86, .116);
  // One continuous, hollow coronet. Its rim rises into eight points; there
  // are no separate balls or cones perched on top of the piece.
  const sections = [
    [.123, .899, 0], [.142, .928, 0], [.177, .95, 0],
    [.198, .968, 0], [.201, .983, 0], [.188, .997, 0],
    [.189, 1.023, 0], [.204, 1.071, .2], [.22, 1.123, 1],
    [.217, 1.13, 1], [.197, 1.13, 1], [.194, 1.119, 1],
    [.176, 1.077, .2], [.131, 1.063, 0], [0, 1.063, 0],
  ];
  const vertices = [], indices = [];
  const segments = 128;
  for (const [radius, height, rise] of sections) {
    for (let i = 0; i <= segments; i++) {
      const angle = i * Math.PI * 2 / segments;
      const phase = (i / segments * 8) % 1;
      const point = 1 - Math.abs(phase * 2 - 1);
      const r = radius + .009 * rise * point;
      vertices.push(Math.sin(angle) * r, height + .075 * rise * point, Math.cos(angle) * r);
    }
  }
  for (let row = 0; row < sections.length - 1; row++) {
    for (let i = 0; i < segments; i++) {
      const a = row * (segments + 1) + i, b = a + segments + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  crown.setIndex(indices);
  // Weld the longitude seam before calculating normals, including the inner cup.
  const smoothCrown = mergeVertices(crown, 1e-5);
  smoothCrown.computeVertexNormals();
  return join([body, smoothCrown]);
}

function king() {
  const body = turnedBody(.34, .80, .126);
  // A tall, outward-flaring head follows the Downloaded king's silhouette.
  // Lower the collar to give the head room without changing the set's scale.
  const shoulder = lathe([
    [0, .835], [.125, .835], [.125, .848], [.119, .86],
    [.115, .879], [.12, .92], [.143, .96], [.169, 1.0],
    [.187, 1.045], [.193, 1.069], [.19, 1.088], [.174, 1.103],
    [.146, 1.112], [.10, 1.119], [.062, 1.122], [0, 1.122],
  ]);
  // A substantial cross with gently flared terminals, a thicker edge, and
  // softened bevels. Its foot is seated inside the curved head of the king.
  const cross = new THREE.Shape();
  const outline = [
    [-.036, 0], [-.03, .112], [-.125, .105], [-.125, .171],
    [-.031, .161], [-.041, .262], [.041, .262], [.031, .161],
    [.125, .171], [.125, .105], [.03, .112], [.036, 0],
  ];
  outline.forEach(([x, y], i) => i ? cross.lineTo(x, y) : cross.moveTo(x, y));
  cross.closePath();
  const crossGeometry = new THREE.ExtrudeGeometry(cross, {
    depth: .066, bevelEnabled: true, bevelSegments: 3,
    bevelThickness: .012, bevelSize: .009, curveSegments: 1,
  });
  crossGeometry.translate(0, 1.101, -.033);
  return join([body, shoulder, crossGeometry]);
}

function readKnight() {
  const data = fs.readFileSync(source);
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength));
  const binStart = 28 + jsonLength;
  const parents = new Map();
  gltf.nodes.forEach((n,i) => n.children?.forEach((c) => parents.set(c,i)));
  function world(i) {
    const n = gltf.nodes[i];
    const m = n.matrix ? new THREE.Matrix4().fromArray(n.matrix) : new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation ?? [0,0,0])), new THREE.Quaternion(...(n.rotation ?? [0,0,0,1])), new THREE.Vector3(...(n.scale ?? [1,1,1])));
    return parents.has(i) ? world(parents.get(i)).multiply(m) : m;
  }
  function attribute(id) {
    const a = gltf.accessors[id], v = gltf.bufferViews[a.bufferView];
    const Ctor = {5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];
    const width = {SCALAR:1,VEC2:2,VEC3:3}[a.type];
    if ((v.byteStride && v.byteStride !== width * Ctor.BYTES_PER_ELEMENT) || a.sparse || !Ctor || !width) throw new Error('Unsupported source accessor');
    const bytes = data.subarray(binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + a.count * width * Ctor.BYTES_PER_ELEMENT);
    return new THREE.BufferAttribute(new Ctor(Uint8Array.from(bytes).buffer), width);
  }
  const root = gltf.nodes.findIndex((n) => n.name === 'White Horse Left');
  const index = gltf.nodes[root].children[0];
  const primitive = gltf.meshes[gltf.nodes[index].mesh].primitives[0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', attribute(primitive.attributes.POSITION));
  g.setAttribute('normal', attribute(primitive.attributes.NORMAL));
  g.setIndex(attribute(primitive.indices));
  g.applyMatrix4(world(index));
  g.computeBoundingBox();
  const box = g.boundingBox, size = box.getSize(new THREE.Vector3());
  g.translate(-(box.min.x + box.max.x)/2, -box.min.y, -(box.min.z + box.max.z)/2);
  g.scale(1.1/size.y,1.1/size.y,1.1/size.y);
  const pos = g.attributes.position;
  const kept = [];
  for (let i = 0; i < g.index.count; i += 3) {
    const ids = [g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];
    if (ids.some((v) => pos.getY(v) > .335)) kept.push(...ids);
  }
  g.setIndex(kept);
  return g;
}
async function knight() {
  let head = readKnight();
  head.rotateY(Math.PI);
  head.deleteAttribute('normal');
  head = mergeVertices(head, 1e-5);
  // Recessed sockets and nostrils are carved into the mesh, not decals or
  // floating accessories. The paired cuts follow the head's bilateral anatomy.
  const positions = head.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const eye = Math.exp(-(((y - .921) / .029) ** 2 + ((z - .04) / .034) ** 2));
    const nostril = Math.exp(-(((y - .785) / .016) ** 2 + ((z - .261) / .018) ** 2));
    positions.setX(i, x - Math.sign(x) * (.020 * eye + .014 * nostril));
  }
  await MeshoptSimplifier.ready;
  const [indices,error] = MeshoptSimplifier.simplify(new Uint32Array(head.index.array), positions.array, 3, 36000, .0005, ['LockBorder']);
  head.setIndex(new THREE.BufferAttribute(indices,1));
  head.computeVertexNormals();
  const compact = mergeVertices(head.toNonIndexed(), 1e-5);
  const pedestal = turnedBody(.30, .34, .125);
  const result = join([pedestal, compact]);
  console.log(`knight head: ${indices.length/3} triangles; simplification error ${error.toFixed(5)}`);
  return result;
}

function writeGLB(name, geometry) {
  geometry.computeBoundingBox();
  const doc = { asset: {version:'2.0',generator:'3D Chess default set authoring',extras:name==='knight'?credit:{}}, scene:0, scenes:[{nodes:[0]}], nodes:[{name:`staunton-${name}`,mesh:0,extras:{authoredWoodUVs:true}}], meshes:[{primitives:[]}], materials:[{name:'satin-wood',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.34}}], accessors:[], bufferViews:[], buffers:[] };
  const blocks=[]; let offset=0;
  function add(array,itemSize,type,min,max) {
    const raw=Buffer.from(array.buffer,array.byteOffset,array.byteLength);
    const padded=Buffer.alloc(Math.ceil(raw.length/4)*4);raw.copy(padded);
    const view=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:raw.length});offset+=padded.length;blocks.push(padded);
    const accessor={bufferView:view,componentType:type,count:array.length/itemSize,type:{1:'SCALAR',2:'VEC2',3:'VEC3'}[itemSize]};
    if(min) {accessor.min=min;accessor.max=max;}
    doc.accessors.push(accessor);return doc.accessors.length-1;
  }
  const attrs={};
  attrs.POSITION=add(geometry.attributes.position.array,3,5126,geometry.boundingBox.min.toArray(),geometry.boundingBox.max.toArray());
  attrs.NORMAL=add(geometry.attributes.normal.array,3,5126);
  attrs.TEXCOORD_0=add(geometry.attributes.uv.array,2,5126);
  const indices=new (geometry.attributes.position.count<65536?Uint16Array:Uint32Array)(geometry.index.array);
  const idx=add(indices,1,indices.BYTES_PER_ELEMENT===2?5123:5125);
  doc.meshes[0].primitives.push({attributes:attrs,indices:idx,material:0});doc.buffers.push({byteLength:offset});
  const json=Buffer.from(JSON.stringify(doc));const jsonPad=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(jsonPad);
  const bin=Buffer.concat(blocks);const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonPad.length+bin.length,8);header.writeUInt32LE(jsonPad.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
  const bytes=Buffer.concat([header,jsonPad,bh,bin]);fs.writeFileSync(new URL(`${name}.glb`,output),bytes);
  console.log(`${name}: ${geometry.index.count/3} triangles, ${(bytes.length/1024).toFixed(0)} KiB`);
}
for (const [name,builder] of Object.entries({pawn,rook,bishop,queen,king,knight})) writeGLB(name,await builder());
