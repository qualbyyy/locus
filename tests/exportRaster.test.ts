import { beforeEach, describe, expect, it } from 'vitest';
import {
  createShapeLayer,
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
});
