import { beforeEach, describe, expect, it } from 'vitest';
import {
  createShapeLayer,
  resetDocument,
  updateLayerEffects,
  updateLayers,
} from '../src/core/commands';
import { useEditorStore } from '../src/core/store';
import { traceRgbaToVectorPaths } from '../src/engine/imageTrace';
import {
  isCanvas2dSupported,
  rasterizeComposite,
  rasterizeLayerLocalWithEffects,
  rasterizeSceneToBytes,
} from '../src/export/rasterize';

describe('real CanvasRenderingContext2D rendering via @napi-rs/canvas', () => {
  beforeEach(() => {
    resetDocument({
      name: 'CanvasReal',
      width: 200,
      height: 120,
      dpi: 72,
      background: '#ffffff',
    });
  });

  it('detects real 2D canvas support in test environment', () => {
    expect(isCanvas2dSupported()).toBe(true);
  });

  it('renders gradients and dashed strokes to actual pixels', async () => {
    const rect = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 60,
      width: 160,
      height: 80,
      fill: {
        kind: 'linear',
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    });
    updateLayers([rect.id], {
      stroke: {
        color: '#000000',
        width: 4,
        dashArray: [8, 8],
        dashOffset: 0,
      },
    });

    const canvas = await rasterizeComposite(useEditorStore.getState().scene, {
      scale: 1,
      transparent: false,
    });
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    const leftPx = ctx!.getImageData(30, 60, 1, 1).data;
    const rightPx = ctx!.getImageData(170, 60, 1, 1).data;

    expect(leftPx[0]).toBeGreaterThan(200);
    expect(leftPx[2]).toBeLessThan(60);
    expect(rightPx[2]).toBeGreaterThan(200);
    expect(rightPx[0]).toBeLessThan(60);
  });

  it('produces valid PNG and JPG binary outputs with scaled dimensions', async () => {
    createShapeLayer({
      preset: 'ellipse',
      x: 100,
      y: 60,
      width: 80,
      height: 80,
      fill: '#da7756',
    });
    const scene = useEditorStore.getState().scene;

    const png = await rasterizeSceneToBytes(scene, {
      format: 'png',
      scale: 2,
      quality: 1,
      transparent: true,
      backgroundColor: '#ffffff',
      scope: 'artboard',
    });
    expect(png.width).toBe(400);
    expect(png.height).toBe(240);
    expect(Array.from(png.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const jpg = await rasterizeSceneToBytes(scene, {
      format: 'jpg',
      scale: 1,
      quality: 0.9,
      transparent: false,
      backgroundColor: '#ffffff',
      scope: 'artboard',
    });
    expect(jpg.width).toBe(200);
    expect(jpg.height).toBe(120);
    expect(jpg.bytes[0]).toBe(0xff);
    expect(jpg.bytes[1]).toBe(0xd8);
  });

  it('rasterizes local layer effects and traces pixels drawn on Canvas 2D', () => {
    const star = createShapeLayer({
      preset: 'star',
      x: 100,
      y: 60,
      width: 60,
      height: 60,
      fill: '#1e293b',
    });
    updateLayerEffects([star.id], {
      blur: 4,
      dropShadow: {
        color: '#000000',
        opacity: 0.4,
        offsetX: 6,
        offsetY: 6,
        blur: 6,
      },
    });

    const updated = useEditorStore.getState().scene.layers[0];
    const localRaster = rasterizeLayerLocalWithEffects(updated);
    expect(localRaster).not.toBeNull();
    expect(localRaster!.canvas.width).toBeGreaterThan(60);

    const ctx = localRaster!.canvas.getContext('2d')!;
    const imgData = ctx.getImageData(
      0,
      0,
      localRaster!.canvas.width,
      localRaster!.canvas.height
    );
    const traced = traceRgbaToVectorPaths(
      imgData.data,
      imgData.width,
      imgData.height,
      60,
      60,
      { mode: 'bw', threshold: 120, simplify: 1.5 }
    );
    expect(traced.length).toBeGreaterThan(0);
    expect(traced[0].subpaths.length).toBeGreaterThan(0);
  });
});
