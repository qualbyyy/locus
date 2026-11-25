import { beforeEach, describe, expect, it } from 'vitest';
import {
  createShapeLayer,
  createTextLayer,
  resetDocument,
  updateLayerEffects,
} from '../src/core/commands';
import { exportFileName } from '../src/core/documentFile';
import { useEditorStore } from '../src/core/store';
import { clampBBoxToArtboard } from '../src/export/rasterize';
import { sceneToSvg } from '../src/export/toSvg';

describe('raster export helpers and SVG effect filters', () => {
  beforeEach(() => {
    resetDocument({
      name: 'Постер Лето',
      width: 1080,
      height: 1080,
      dpi: 72,
      background: '#ffffff',
    });
  });

  it('formats png and jpg export filenames', () => {
    expect(exportFileName('Постер Лето', 'png')).toBe('Постер_Лето.png');
    expect(exportFileName('Постер Лето', 'jpg')).toBe('Постер_Лето.jpg');
  });

  it('clamps bbox to artboard bounds', () => {
    const scene = useEditorStore.getState().scene;
    expect(
      clampBBoxToArtboard({ x: -20, y: 10, width: 1200, height: 100 }, scene)
    ).toEqual({ left: 0, top: 10, width: 1080, height: 100 });
  });

  it('emits SVG filter definitions and extrude faces in sceneToSvg', async () => {
    const shape = createShapeLayer({
      preset: 'rect',
      x: 400,
      y: 400,
      width: 180,
      height: 140,
      fill: '#da7756',
    });
    updateLayerEffects([shape.id], {
      blur: 5,
      dropShadow: {
        color: '#000000',
        opacity: 0.4,
        offsetX: 4,
        offsetY: 8,
        blur: 10,
      },
      effect3d: {
        kind: 'extrude',
        rotateX: 15,
        rotateY: -20,
        rotateZ: 0,
        perspective: 40,
        depth: 25,
        shade: 0.7,
      },
    });

    const svg = await sceneToSvg(useEditorStore.getState().scene);
    expect(svg).toContain('<filter id="fx-');
    expect(svg).toContain('<feGaussianBlur stdDeviation="5"/>');
    expect(svg).toContain('<feDropShadow');
    expect(svg).toContain('filter="url(#fx-');
    // Extrude produces multiple <path> nodes inside the layer group
    const pathMatches = svg.match(/<path /g);
    expect(pathMatches && pathMatches.length).toBeGreaterThan(2);
  });

  it('exports motionBlur, innerShadow, colorAdjust and 150px blur filters to SVG', async () => {
    const shape = createShapeLayer({
      preset: 'rect',
      x: 300,
      y: 300,
      width: 120,
      height: 90,
      fill: '#da7756',
    });
    updateLayerEffects([shape.id], {
      blur: 150,
      motionBlur: { amount: 24, angle: 0 },
      innerShadow: {
        color: '#000000',
        opacity: 0.5,
        offsetX: 2,
        offsetY: 4,
        blur: 8,
      },
      colorAdjust: {
        brightness: 20,
        contrast: 10,
        saturate: 30,
        hue: 45,
      },
    });

    const svg = await sceneToSvg(useEditorStore.getState().scene);
    expect(svg).toContain('width="500%"');
    expect(svg).toContain('<feComponentTransfer');
    expect(svg).toContain('type="saturate"');
    expect(svg).toContain('type="hueRotate"');
    expect(svg).toContain('operator="out" in="SourceAlpha"');
    expect(svg).toContain('stdDeviation="150"');
  });

  it('exports text stroke with paint-order and offset textPath to SVG', async () => {
    const circle = createShapeLayer({
      preset: 'ellipse',
      x: 540,
      y: 540,
      width: 300,
      height: 300,
      fill: null,
      stroke: { color: '#1c1b1a', width: 2 },
    });
    createTextLayer({
      x: 0,
      y: 0,
      content: 'КРУГОВЫЕ БУКВЫ',
      fontSize: 32,
      align: 'center',
      fill: '#1c1b1a',
      stroke: { color: '#ffffff', width: 4, lineCap: 'round', lineJoin: 'round' },
      pathId: circle.id,
      pathOffset: 50,
      pathBaselineOffset: 14,
    });

    const svg = await sceneToSvg(useEditorStore.getState().scene);
    expect(svg).toContain('paint-order="stroke fill"');
    expect(svg).toContain('stroke="rgb(255,255,255)"');
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain('<textPath');
  });
});
