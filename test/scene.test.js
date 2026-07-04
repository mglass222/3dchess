import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CAMERA_MAX_POLAR_ANGLE,
  createBoardMaterials,
  createChessBoard,
  createStoneMaterial,
  createStoneTable,
  applyRendererQuality,
} from '../src/scene.js';

describe('scene rendering helpers', () => {
  it('clamps camera rotation above board level', () => {
    expect(CAMERA_MAX_POLAR_ANGLE).toBeCloseTo(Math.PI / 2 - 0.04, 5);
  });

  it('creates premium board materials', () => {
    const { light, dark, frame } = createBoardMaterials();

    expect(light).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(dark).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(frame).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(light.color.getHex()).toBe(0xdac799);
    expect(dark.color.getHex()).toBe(0x724528);
    expect(frame.color.getHex()).toBe(0x2c2018);
    expect(light.clearcoat).toBeGreaterThan(0);
    expect(dark.clearcoat).toBeGreaterThan(0);
  });

  it('keeps frame geometry below the playable square surface', () => {
    const board = createChessBoard();
    const materials = createBoardMaterials();
    const frameMeshes = [];
    const squareMeshes = [];

    board.traverse((child) => {
      if (!child.isMesh) return;
      if (child.material.color.getHex() === materials.frame.color.getHex()) frameMeshes.push(child);
      else squareMeshes.push(child);
    });

    expect(squareMeshes.length).toBe(64);
    expect(frameMeshes.length).toBeGreaterThan(0);

    const squareTop = Math.max(
      ...squareMeshes.map((mesh) => new THREE.Box3().setFromObject(mesh).max.y),
    );
    const highestFrameTop = Math.max(
      ...frameMeshes.map((mesh) => new THREE.Box3().setFromObject(mesh).max.y),
    );

    expect(squareTop).toBeCloseTo(0, 5);
    expect(highestFrameTop).toBeLessThan(squareTop);
  });

  it('creates a stone material suitable for the table', () => {
    const material = createStoneMaterial();

    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.color.getHex()).toBe(0x7d7868);
    expect(material.roughness).toBeCloseTo(0.94, 5);
  });

  it('creates a shadow-casting stone table group below the board', () => {
    const table = createStoneTable();
    const meshes = [];
    table.traverse((child) => {
      if (child.isMesh) meshes.push(child);
    });

    expect(table.name).toBe('stone-table');
    expect(meshes.length).toBeGreaterThanOrEqual(3);
    expect(meshes.every((mesh) => mesh.castShadow)).toBe(true);
    expect(meshes.every((mesh) => mesh.receiveShadow)).toBe(true);

    const box = new THREE.Box3().setFromObject(table);
    expect(box.max.y).toBeLessThan(0);
    expect(box.min.y).toBeLessThan(-1);
    expect(box.max.x - box.min.x).toBeGreaterThan(9);
    expect(box.max.z - box.min.z).toBeGreaterThan(9);
  });

  it('applies high quality renderer settings to compatible renderers', () => {
    const renderer = {
      shadowMap: {},
      outputColorSpace: null,
      toneMapping: null,
      toneMappingExposure: 0,
    };

    applyRendererQuality(renderer);

    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBeCloseTo(1.08, 5);
  });
});
