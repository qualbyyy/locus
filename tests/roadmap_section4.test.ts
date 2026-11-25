import { beforeEach, describe, expect, it } from 'vitest';
import {
  contrastRatio,
  extractPaletteFromRgba,
  recolorSceneWithPalette,
} from '../src/ai/palette';
import { runPreflightCheck } from '../src/ai/preflight';
import { executeTool } from '../src/ai/registry';
import {
  createShapeLayer,
  createTextLayer,
  resetDocument,
  undoCommand,
} from '../src/core/commands';
import { useEditorStore } from '../src/core/store';
import type { PathLayer, TextLayer } from '../src/core/types';

function makePaletteRgba(
  blocks: Array<{ hex: [number, number, number]; pixels: number }>
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const total = blocks.reduce((acc, b) => acc + b.pixels, 0);
  const rgba = new Uint8ClampedArray(total * 4);
  let idx = 0;
  for (const b of blocks) {
    for (let i = 0; i < b.pixels; i += 1) {
      rgba[idx * 4] = b.hex[0];
      rgba[idx * 4 + 1] = b.hex[1];
      rgba[idx * 4 + 2] = b.hex[2];
      rgba[idx * 4 + 3] = 255;
      idx += 1;
    }
  }
  return { rgba, width: total, height: 1 };
}

describe('Section 4 Roadmap AI Assistant', () => {
  beforeEach(() => {
    resetDocument({
      name: 'Poster',
      width: 800,
      height: 600,
      dpi: 72,
      background: '#ffffff',
    });
  });

  it('1. Extracts dominant palette colors from RGBA reference image', () => {
    const { rgba, width, height } = makePaletteRgba([
      { hex: [218, 119, 86], pixels: 120 }, // #da7756
      { hex: [30, 41, 59], pixels: 80 }, // #1e293b
      { hex: [248, 250, 252], pixels: 60 }, // #f8fafc
    ]);
    const extracted = extractPaletteFromRgba(rgba, width, height, 3);
    const hexes = extracted.map((c) => c.hex);
    expect(hexes).toContain('#da7756');
    expect(hexes).toContain('#1e293b');
    expect(hexes).toContain('#f8fafc');
    expect(extracted[0].hex).toBe('#da7756');
  });

  it('2. Smart palette recolor updates layers + background with WCAG text contrast protection and atomic undo', () => {
    const card = createShapeLayer({
      preset: 'rect',
      x: 400,
      y: 300,
      width: 300,
      height: 200,
      fill: '#cccccc',
      stroke: { color: '#333333', width: 2 },
    });
    const heading = createTextLayer({
      content: 'Заголовок',
      x: 400,
      y: 260,
      fontSize: 32,
      fill: '#222222',
    });

    const result = recolorSceneWithPalette(['#1e293b', '#f8fafc', '#f59e0b'], {
      includeBackground: true,
      preserveContrast: true,
    });
    expect(result.updatedLayers).toBe(2);
    expect(result.updatedBackground).toBe(true);

    const stateAfter = useEditorStore.getState();
    const updatedCard = stateAfter.scene.layers[0] as PathLayer;
    const updatedText = stateAfter.scene.layers[1] as TextLayer;
    expect(typeof updatedCard.fill).toBe('string');
    const underFill = String(updatedCard.fill);
    const textFill = String(updatedText.fill);
    expect(contrastRatio(textFill, underFill)).toBeGreaterThanOrEqual(4.5);

    undoCommand();
    const stateReverted = useEditorStore.getState();
    expect(stateReverted.scene.background).toBe('#ffffff');
    expect((stateReverted.scene.layers.find((l) => l.id === card.id) as PathLayer).fill).toBe('#cccccc');
    expect((stateReverted.scene.layers.find((l) => l.id === heading.id) as TextLayer).fill).toBe('#222222');
  });

  it('3. Preflight check flags low contrast, small 300 DPI type, out-of-artboard layers, and passes clean layouts', () => {
    resetDocument({
      name: 'Print Flyer',
      width: 800,
      height: 600,
      dpi: 300,
      background: '#ffffff',
    });

    // Out of bounds layer
    const outside = createShapeLayer({
      preset: 'rect',
      x: -300,
      y: -300,
      width: 100,
      height: 100,
      fill: '#da7756',
      stroke: null,
    });
    // Low contrast + tiny print font (~4.8 pt at 300 DPI = 20 px)
    const tinyLowContrast = createTextLayer({
      content: 'Мелкий светлый текст',
      x: 200,
      y: 200,
      fontSize: 20,
      fill: '#f1f5f9',
    });

    const badReport = runPreflightCheck(useEditorStore.getState().scene);
    expect(badReport.issues.some((i) => i.category === 'bounds' && i.layerId === outside.id && i.severity === 'error')).toBe(true);
    expect(badReport.issues.some((i) => i.category === 'typography' && i.layerId === tinyLowContrast.id)).toBe(true);
    expect(badReport.issues.some((i) => i.category === 'contrast' && i.layerId === tinyLowContrast.id)).toBe(true);

    // Clean layout -> 0 issues
    resetDocument({
      name: 'Clean Print',
      width: 800,
      height: 600,
      dpi: 300,
      background: '#ffffff',
    });
    createShapeLayer({
      preset: 'rect',
      x: 400,
      y: 300,
      width: 400,
      height: 300,
      fill: '#f8fafc',
      stroke: null,
    });
    createTextLayer({
      content: 'Заголовок',
      x: 400,
      y: 280,
      fontSize: 48, // ~11.5 pt at 300 dpi
      align: 'center',
      fill: '#0f172a',
    });

    const cleanReport = runPreflightCheck(useEditorStore.getState().scene);
    expect(cleanReport.issues).toHaveLength(0);
  });

  it('4. AI tool registry exposes recolor_palette and preflight_check', () => {
    createShapeLayer({
      preset: 'rect',
      x: 400,
      y: 300,
      width: 200,
      height: 200,
      fill: '#334155',
    });
    createTextLayer({
      content: 'HI',
      x: 400,
      y: 280,
      fontSize: 36,
      fill: '#475569',
    });

    const preflightBefore = executeTool('preflight_check', {});
    expect(preflightBefore.ok).toBe(true);
    if (preflightBefore.ok) {
      expect(Number(preflightBefore.result.issueCount)).toBeGreaterThan(0);
    }

    const recolored = executeTool('recolor_palette', {
      palette: ['#ffffff', '#0f172a', '#e11d48'],
      includeBackground: true,
      preserveContrast: true,
    });
    expect(recolored.ok).toBe(true);
  });
});
