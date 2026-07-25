import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  STONE_BASE, STONE_ROUGHNESS, STONE_UNITS_PER_TILE,
  stoneHeight, createStoneMaps, retileBoxUV, retileCylinderUV,
} from '../src/stone.js';

// Any fixed seed works for the mechanical tests below; this just needs to be
// stable across the file so results are reproducible.
const SEED = 7.3;
const GRID = 128;

function sampleField(size = GRID, seed = SEED) {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      field[y * size + x] = stoneHeight(x / size, y / size, seed);
    }
  }
  return field;
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values) {
  const m = mean(values);
  return mean(values.map((v) => (v - m) ** 2));
}

function percentile(sortedValues, p) {
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(p * sortedValues.length)));
  return sortedValues[idx];
}

describe('stoneHeight', () => {
  it('is exactly seamless across the u=0/u=1 border', () => {
    for (let i = 0; i < 64; i++) {
      const v = i / 64;
      const a = stoneHeight(0, v, SEED);
      const b = stoneHeight(1, v, SEED);
      expect(Math.abs(a - b)).toBeLessThan(1e-9);
    }
  });

  it('is exactly seamless across the v=0/v=1 border', () => {
    for (let i = 0; i < 64; i++) {
      const u = i / 64;
      const a = stoneHeight(u, 0, SEED);
      const b = stoneHeight(u, 1, SEED);
      expect(Math.abs(a - b)).toBeLessThan(1e-9);
    }
  });

  it('stays within [0, 1]', () => {
    const field = sampleField();
    for (const h of field) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it('has sane contrast: not flat, not bimodal', () => {
    const field = Array.from(sampleField()).sort((a, b) => a - b);
    const p5 = percentile(field, 0.05);
    const p95 = percentile(field, 0.95);
    const spread = p95 - p5;
    // Flat/near-constant field would have spread ~0; a hard bimodal split
    // would push p5 near 0 and p95 near 1 (spread near 1) with almost nothing
    // in between. Require visible but moderate contrast.
    expect(spread).toBeGreaterThan(0.08);
    expect(spread).toBeLessThan(0.85);
    expect(p5).toBeGreaterThan(0.05);
    expect(p95).toBeLessThan(0.95);
  });

  it('is isotropic: horizontal and vertical gradients agree within 5%', () => {
    const size = GRID;
    const field = sampleField(size);
    let hGrad = 0;
    let vGrad = 0;
    let count = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const here = field[y * size + x];
        const right = field[y * size + ((x + 1) % size)];
        const down = field[((y + 1) % size) * size + x];
        hGrad += Math.abs(right - here);
        vGrad += Math.abs(down - here);
        count++;
      }
    }
    hGrad /= count;
    vGrad /= count;
    const ratio = hGrad / vGrad;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });

  it('has no directional banding: row/column mean variance stay low', () => {
    const size = GRID;
    const field = sampleField(size);
    const rowMeans = [];
    const colMeans = [];
    for (let y = 0; y < size; y++) {
      let rowSum = 0;
      for (let x = 0; x < size; x++) rowSum += field[y * size + x];
      rowMeans.push(rowSum / size);
    }
    for (let x = 0; x < size; x++) {
      let colSum = 0;
      for (let y = 0; y < size; y++) colSum += field[y * size + x];
      colMeans.push(colSum / size);
    }
    // A directional stripe pattern makes whole rows (or columns) share
    // nearly the same value, so its row-mean (or column-mean) variance
    // approaches the field's own per-texel variance. With only BASE_PERIOD=4
    // large cells across the tile, row/column means are naturally noisy
    // (this is macro-scale low-frequency content, not sampling error, so a
    // bigger GRID would not shrink it) — measured here around 18-33% of the
    // field's total variance — but a true directional artifact would blow
    // FAR past that (order of field variance itself) on one axis while the
    // other stayed flat. Guard both: an absolute ceiling well below 100% of
    // field variance, and a same-order-of-magnitude check between the two
    // axes (isotropy already covers gradients; this covers the same idea at
    // the row/column-mean level).
    const rowVar = variance(rowMeans);
    const colVar = variance(colMeans);
    const fieldVariance = variance(Array.from(field));
    expect(rowVar).toBeLessThan(fieldVariance * 0.5);
    expect(colVar).toBeLessThan(fieldVariance * 0.5);
    const axisRatio = rowVar / colVar;
    expect(axisRatio).toBeGreaterThan(0.25);
    expect(axisRatio).toBeLessThan(4);
  });
});

describe('createStoneMaps', () => {
  it('memoizes: repeated calls return the identical object', () => {
    const a = createStoneMaps();
    const b = createStoneMaps();
    expect(a).toBe(b);
  });

  it('uses the correct color spaces', () => {
    const { map, normalMap, roughnessMap } = createStoneMaps();
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(normalMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('produces a valid normal map: unit vectors, z > 0.5, mean near (0.5, 0.5, ~1)', () => {
    const { normalMap } = createStoneMaps();
    const data = normalMap.image.data;
    const size = normalMap.image.width;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const count = size * size;
    for (let i = 0; i < count; i++) {
      const r = data[i * 4] / 255;
      const g = data[i * 4 + 1] / 255;
      const b = data[i * 4 + 2] / 255;
      const nx = r * 2 - 1;
      const ny = g * 2 - 1;
      const nz = b * 2 - 1;
      const len = Math.hypot(nx, ny, nz);
      expect(Math.abs(len - 1)).toBeLessThan(1e-2);
      expect(nz).toBeGreaterThan(0.5);
      sx += r;
      sy += g;
      sz += b;
    }
    expect(sx / count).toBeCloseTo(0.5, 1);
    expect(sy / count).toBeCloseTo(0.5, 1);
    expect(sz / count).toBeGreaterThan(0.9);
  });

  it('keeps roughnessMap in a tight range around a ~0.96 mean', () => {
    const { roughnessMap } = createStoneMaps();
    const data = roughnessMap.image.data;
    const size = roughnessMap.image.width;
    const count = size * size;
    let sum = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < count; i++) {
      const rv = data[i * 4] / 255;
      sum += rv;
      min = Math.min(min, rv);
      max = Math.max(max, rv);
      // roughnessMap must not just be the albedo reused: albedo swings much
      // wider (see ALBEDO_DELTA in stone.js), so this bounds the actual
      // written range.
      expect(rv).toBeGreaterThanOrEqual(0.85);
      expect(rv).toBeLessThanOrEqual(1.0);
    }
    const meanRoughness = sum / count;
    expect(meanRoughness).toBeGreaterThan(0.9);
    expect(meanRoughness).toBeLessThan(1.0);
    // Effective roughness = STONE_ROUGHNESS * mean(roughnessMap) — should
    // land close to the old flat material's calibrated 0.94.
    const effective = STONE_ROUGHNESS * meanRoughness;
    expect(effective).toBeGreaterThan(0.88);
    expect(effective).toBeLessThan(0.98);
  });

  it('albedo map is centered on STONE_BASE and symmetric map/material.color split', () => {
    const { map } = createStoneMaps();
    const data = map.image.data;
    const size = map.image.width;
    const count = size * size;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let i = 0; i < count; i++) {
      sr += data[i * 4];
      sg += data[i * 4 + 1];
      sb += data[i * 4 + 2];
    }
    const baseR = (STONE_BASE >> 16) & 255;
    const baseG = (STONE_BASE >> 8) & 255;
    const baseB = STONE_BASE & 255;
    expect(sr / count).toBeCloseTo(baseR, -1); // within ~tens, not exact — noise mean isn't perfectly 0.5
    expect(sg / count).toBeCloseTo(baseG, -1);
    expect(sb / count).toBeCloseTo(baseB, -1);
  });
});

// --- UV retiling: texel-density uniformity across the real table geometries.
//
// Purely mechanical: for every triangle in every geometry, compute its
// world-space area (from vertex positions) and its UV-space area (from the
// retiled uv attribute), and derive a density = uvArea / worldArea. If
// texel density were uniform, every triangle's density would be identical
// (up to the polygon-approximation error of a curved surface, e.g. chord vs.
// arc length on the low-poly cylinders). Bucketing by geometry.groups (which
// three.js always populates — 6 box faces, or torso/top-cap/bottom-cap for a
// cylinder — regardless of whether a single material is used) gives one
// density per face without hardcoding any vertex-order assumptions beyond
// what BoxGeometry/CylinderGeometry's own source already guarantees.
function triangleDensities(geometry) {
  const { index } = geometry;
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const pc = new THREE.Vector3();
  const eb = new THREE.Vector3();
  const ec = new THREE.Vector3();
  const densities = [];
  for (const group of geometry.groups) {
    let worldArea = 0;
    let uvArea = 0;
    for (let k = group.start; k < group.start + group.count; k += 3) {
      const a = index.getX(k);
      const b = index.getX(k + 1);
      const c = index.getX(k + 2);
      pa.fromBufferAttribute(position, a);
      pb.fromBufferAttribute(position, b);
      pc.fromBufferAttribute(position, c);
      eb.subVectors(pb, pa);
      ec.subVectors(pc, pa);
      worldArea += eb.clone().cross(ec).length() / 2;

      const ua = uv.getX(a); const va = uv.getY(a);
      const ub = uv.getX(b); const vb = uv.getY(b);
      const uc = uv.getX(c); const vc = uv.getY(c);
      uvArea += Math.abs((ub - ua) * (vc - va) - (uc - ua) * (vb - va)) / 2;
    }
    if (worldArea > 1e-9) densities.push(uvArea / worldArea);
  }
  return densities;
}

describe('UV retiling', () => {
  it('gives every face of the stone table uniform texel density (within 15%)', () => {
    // Mirrors createStoneTable's geometry literals in src/scene.js exactly.
    const geometries = [
      new THREE.BoxGeometry(10.4, 0.42, 10.4),
      new THREE.CylinderGeometry(7.25, 7.5, 0.28, 8),
      new THREE.CylinderGeometry(2.8, 3.35, 1.95, 12),
      new THREE.CylinderGeometry(4.35, 4.8, 0.38, 12),
    ];

    const allDensities = [];
    for (const geometry of geometries) {
      if (geometry.type === 'BoxGeometry') retileBoxUV(geometry, STONE_UNITS_PER_TILE);
      else retileCylinderUV(geometry, STONE_UNITS_PER_TILE);
      allDensities.push(...triangleDensities(geometry));
    }

    expect(allDensities.length).toBeGreaterThan(0);
    const min = Math.min(...allDensities);
    const max = Math.max(...allDensities);
    expect((max - min) / min).toBeLessThan(0.15);
  });

  it('retileBoxUV keeps repeat at 1 unit-per-tile scale (spot check on the slab top)', () => {
    const geometry = new THREE.BoxGeometry(10.4, 0.42, 10.4);
    retileBoxUV(geometry, STONE_UNITS_PER_TILE);
    const uv = geometry.attributes.uv;
    // Top face (py) vertices are the third group of 4 in BoxGeometry's
    // px,nx,py,ny,pz,nz vertex order (verified against the installed three
    // source) — its world span is 10.4 x 10.4, so the uv span should be
    // 10.4 / STONE_UNITS_PER_TILE on each axis.
    const topStart = 8;
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (let i = topStart; i < topStart + 4; i++) {
      minU = Math.min(minU, uv.getX(i)); maxU = Math.max(maxU, uv.getX(i));
      minV = Math.min(minV, uv.getY(i)); maxV = Math.max(maxV, uv.getY(i));
    }
    expect(maxU - minU).toBeCloseTo(10.4 / STONE_UNITS_PER_TILE, 5);
    expect(maxV - minV).toBeCloseTo(10.4 / STONE_UNITS_PER_TILE, 5);
  });
});
