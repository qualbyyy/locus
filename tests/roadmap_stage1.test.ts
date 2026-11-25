import paper from 'paper/dist/paper-core';
import { initializeCanvas, readPsd, writePsd, type Psd } from 'ag-psd';
import { PDFDict, PDFName } from 'pdf-lib/cjs/core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { copyLayerStyle, clearClipboard, pasteLayerStyle } from '../src/core/clipboard';
import {
  createShapeLayer,
  createTextLayer,
  resetDocument,
  selectSimilarLayers,
  updateLayerEffects,
  updateLayers,
} from '../src/core/commands';
import { primeFontBytesCache } from '../src/core/fonts';
import {
  cloneStroke,
  getGradientAngleDeg,
  gradientToCss,
  localPointToNormalized,
  paintEquals,
  resolveGradientEndpoints,
  sanitizeDashArray,
  setGradientAngleDeg,
} from '../src/core/paint';
import { useEditorStore } from '../src/core/store';
import type { GradientPaint, PathLayer, StrokeStyle, TextLayer } from '../src/core/types';
import { syncSceneToPaper } from '../src/engine/sync';
import { parseSvgToLayers } from '../src/export/importSvg';
import { buildLocusArchive, parseLocusArchive } from '../src/export/projectFile';
import { sceneToAiBytes } from '../src/export/toAi';
import { sceneToPsd } from '../src/export/toPsd';
import { sceneToSvg } from '../src/export/toSvg';

async function loadDiskFont(relPath: string): Promise<Uint8Array> {
  const fsId = 'node:fs';
  const pathId = 'node:path';
  const { readFileSync } = (await import(/* @vite-ignore */ fsId)) as {
    readFileSync: (p: string) => Uint8Array;
  };
  const { resolve } = (await import(/* @vite-ignore */ pathId)) as {
    resolve: (...paths: string[]) => string;
  };
  const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
  const buf = readFileSync(resolve(cwd, relPath));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function installPsdCanvasShim(): void {
  initializeCanvas(
    (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    (width, height) => {
      const data = new Uint8ClampedArray(width * height * 4);
      return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
    }
  );
}

describe('Roadmap Stage 1: Gradients, Dashed Strokes, Blend Modes, Style Copy', () => {
  beforeAll(async () => {
    primeFontBytesCache('Inter', 400, await loadDiskFont('public/fonts/Inter-Regular.ttf'));
    primeFontBytesCache('Inter', 700, await loadDiskFont('public/fonts/Inter-Bold.ttf'));
  });

  beforeEach(() => {
    clearClipboard();
    resetDocument({
      name: 'Stage 1 Test',
      width: 600,
      height: 400,
      dpi: 72,
      background: '#ffffff',
    });
  });

  it('paint helpers handle angles, endpoints, CSS preview, equality, and stroke isolation', () => {
    const grad: GradientPaint = {
      kind: 'linear',
      stops: [
        { offset: 0, color: '#da7756' },
        { offset: 0.5, color: '#f59e0b', opacity: 0.5 },
        { offset: 1, color: '#2563eb' },
      ],
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
    };

    expect(getGradientAngleDeg(grad)).toBeCloseTo(0, 3);
    const rotated = setGradientAngleDeg(grad, 90);
    expect(getGradientAngleDeg(rotated)).toBeCloseTo(90, 3);
    expect(rotated.start.x).toBeCloseTo(0.5, 3);
    expect(rotated.start.y).toBeCloseTo(0, 3);
    expect(rotated.end.x).toBeCloseTo(0.5, 3);
    expect(rotated.end.y).toBeCloseTo(1, 3);

    const box = { x: -50, y: -25, width: 100, height: 50 };
    const ep = resolveGradientEndpoints(grad, box);
    expect(ep.origin).toEqual({ x: -50, y: 0 });
    expect(ep.destination).toEqual({ x: 50, y: 0 });
    expect(ep.radius).toBeCloseTo(100, 3);
    expect(localPointToNormalized(ep.destination, box)).toEqual({ x: 1, y: 0.5 });

    const css = gradientToCss(grad);
    expect(css).toContain('linear-gradient(90deg');
    expect(css).toContain('rgba(245, 158, 11, 0.500) 50%');

    expect(paintEquals(grad, rotated)).toBe(false);
    expect(paintEquals(grad, { ...grad, stops: [...grad.stops] })).toBe(true);

    expect(sanitizeDashArray([0, -2])).toBeUndefined();
    expect(sanitizeDashArray([8, 4])).toEqual([8, 4]);

    const stroke: StrokeStyle = {
      color: grad,
      width: 4,
      dashArray: [10, 5],
      dashOffset: 3,
    };
    const cloned = cloneStroke(stroke)!;
    (cloned.color as GradientPaint).stops[0].color = '#000000';
    cloned.dashArray![0] = 99;
    expect(grad.stops[0].color).toBe('#da7756');
    expect(stroke.dashArray).toEqual([10, 5]);
  });

  it('syncSceneToPaper applies gradients, dashed stroke, and blendMode in Paper.js', () => {
    const linearGrad: GradientPaint = {
      kind: 'linear',
      stops: [
        { offset: 0, color: '#ec4899' },
        { offset: 1, color: '#8b5cf6' },
      ],
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
    };
    const radialGrad: GradientPaint = {
      kind: 'radial',
      stops: [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '#0f172a' },
      ],
      start: { x: 0.5, y: 0.5 },
      end: { x: 1, y: 0.5 },
    };

    const rect = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 150,
      width: 140,
      height: 80,
      fill: linearGrad,
      stroke: { color: radialGrad, width: 4, dashArray: [8, 4], dashOffset: 2 },
    });
    updateLayers([rect.id], { blendMode: 'multiply' });

    const txt = createTextLayer({
      x: 100,
      y: 260,
      content: 'Gradient Text',
      fontSize: 32,
      fill: linearGrad,
    });
    updateLayers([txt.id], { blendMode: 'screen' });

    const scope = new paper.PaperScope();
    scope.settings.applyMatrix = false;
    scope.settings.insertItems = false;
    new scope.Project(undefined as unknown as HTMLCanvasElement);
    const sceneLayer = new scope.Layer({ applyMatrix: false });

    const itemMap = syncSceneToPaper(scope, sceneLayer, useEditorStore.getState().scene);
    const rectItem = itemMap.get(rect.id)!;
    expect(rectItem.blendMode).toBe('multiply');
    expect(rectItem.fillColor?.type).toBe('gradient');
    expect(rectItem.fillColor?.gradient?.stops).toHaveLength(2);
    expect(rectItem.strokeColor?.type).toBe('gradient');
    expect(rectItem.strokeColor?.gradient?.radial).toBe(true);
    expect(rectItem.dashArray).toEqual([8, 4]);
    expect(rectItem.dashOffset).toBe(2);

    const txtItem = itemMap.get(txt.id) as paper.Group;
    expect(txtItem.blendMode).toBe('screen');
    const pointText = txtItem.children[0] as paper.PointText;
    expect(pointText.fillColor?.type).toBe('gradient');
  });

  it('round-trips gradients, dash pattern, and blendMode across .locus, .svg, .ai, and .psd', async () => {
    installPsdCanvasShim();
    const fillGrad: GradientPaint = {
      kind: 'linear',
      stops: [
        { offset: 0, color: '#da7756', opacity: 0.8 },
        { offset: 0.5, color: '#f59e0b' },
        { offset: 1, color: '#2563eb' },
      ],
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
    };
    const strokeGrad: GradientPaint = {
      kind: 'radial',
      stops: [
        { offset: 0, color: '#16a34a' },
        { offset: 1, color: '#1c1b1a' },
      ],
      start: { x: 0.5, y: 0.5 },
      end: { x: 1, y: 0.5 },
    };

    const rect = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 160,
      width: 160,
      height: 100,
      fill: fillGrad,
      stroke: { color: strokeGrad, width: 5, dashArray: [10, 6], dashOffset: 3 },
      name: 'Карточка',
    });
    updateLayers([rect.id], { blendMode: 'multiply' });

    const dot = createShapeLayer({
      preset: 'ellipse',
      x: 420,
      y: 160,
      width: 90,
      height: 90,
      fill: '#2563eb',
      stroke: null,
      name: 'Блик',
    });
    updateLayers([dot.id], { blendMode: 'color-dodge' });

    const heading = createTextLayer({
      x: 60,
      y: 40,
      content: 'Градиент',
      fontSize: 28,
      fill: fillGrad,
      name: 'ТекстГрад',
    });
    updateLayers([heading.id], { blendMode: 'soft-light' });

    const scene = useEditorStore.getState().scene;

    // 1. .locus round-trip
    const locusBytes = await buildLocusArchive(scene);
    const parsedLocus = await parseLocusArchive(locusBytes);
    const locusRect = parsedLocus.scene.layers[0] as PathLayer;
    expect(locusRect.blendMode).toBe('multiply');
    expect(locusRect.stroke?.dashArray).toEqual([10, 6]);
    expect(locusRect.stroke?.dashOffset).toBe(3);
    expect(paintEquals(locusRect.fill, fillGrad)).toBe(true);

    // 2. .svg export + import round-trip
    const svg = await sceneToSvg(scene);
    expect(svg).toContain('<linearGradient id="grad-fill-');
    expect(svg).toContain('<radialGradient id="grad-stroke-');
    expect(svg).toContain('stop-opacity="0.8"');
    expect(svg).toContain('stroke-dasharray="10 6"');
    expect(svg).toContain('stroke-dashoffset="3"');
    expect(svg).toContain('mix-blend-mode:multiply');
    expect(svg).toContain('mix-blend-mode:color-dodge');

    const imported = await parseSvgToLayers(svg);
    const impRect = imported.layers.find((l) => l.name === 'Карточка') as PathLayer;
    expect(impRect).toBeDefined();
    expect(impRect.blendMode).toBe('multiply');
    expect(impRect.stroke?.dashArray).toEqual([10, 6]);
    expect(impRect.stroke?.dashOffset).toBe(3);
    expect(typeof impRect.fill).toBe('object');
    expect((impRect.fill as GradientPaint).stops).toHaveLength(3);
    expect(typeof impRect.stroke?.color).toBe('object');
    expect((impRect.stroke?.color as GradientPaint).kind).toBe('radial');

    // 3. .ai export
    const aiBytes = await sceneToAiBytes(scene);
    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(aiBytes);
    const page = pdfDoc.getPage(0);
    const resources = page.node.normalizedEntries().Resources;
    const patterns = resources.lookupMaybe(PDFName.of('Pattern'), PDFDict);
    expect(patterns).toBeDefined();
    expect(patterns!.entries().length).toBeGreaterThanOrEqual(3);
    const extGState = resources.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
    expect(extGState).toBeDefined();
    const hasMultiply = extGState!
      .entries()
      .some(([, val]) => {
        const d = pdfDoc.context.lookupMaybe(val, PDFDict);
        return d?.get(PDFName.of('BM')) === PDFName.of('Multiply');
      });
    expect(hasMultiply).toBe(true);

    // 4. .psd export + readPsd round-trip
    const psd = await sceneToPsd(scene);
    const composite = {
      data: new Uint8ClampedArray(scene.width * scene.height * 4),
      width: scene.width,
      height: scene.height,
    } as unknown as ImageData;
    const psdBytes = writePsd({ ...psd, canvas: undefined, imageData: composite } as Psd, {
      noBackground: true,
    });
    const back = readPsd(psdBytes, { useImageData: true, skipThumbnail: true });
    const psdRect = back.children!.find((c) => c.name === 'Карточка')!;
    const psdDot = back.children!.find((c) => c.name === 'Блик')!;
    const psdText = back.children!.find((c) => c.name === 'ТекстГрад')!;
    expect(psdRect.blendMode).toBe('multiply');
    expect(psdDot.blendMode).toBe('color dodge');
    expect(psdText.blendMode).toBe('soft light');
    const psdTextColor = psdText.text?.style?.fillColor as { r: number; g: number; b: number };
    expect(psdTextColor.r).toBeCloseTo(218, 2);
    expect(psdTextColor.g).toBeCloseTo(119, 2);
    expect(psdTextColor.b).toBeCloseTo(86, 2);
  });

  it('copyLayerStyle/pasteLayerStyle transfers gradients, dash, blendMode, and effects safely, and selectSimilar compares gradients', () => {
    const grad: GradientPaint = {
      kind: 'linear',
      stops: [
        { offset: 0, color: '#da7756' },
        { offset: 1, color: '#2563eb' },
      ],
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    };

    const src = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      fill: grad,
      stroke: { color: '#1c1b1a', width: 3, dashArray: [6, 4], dashOffset: 2 },
    });
    updateLayers([src.id], { opacity: 0.75, blendMode: 'overlay' });
    updateLayerEffects([src.id], {
      dropShadow: { color: '#000000', opacity: 0.4, offsetX: 3, offsetY: 5, blur: 8 },
    });

    const dst = createShapeLayer({
      preset: 'ellipse',
      x: 300,
      y: 100,
      width: 80,
      height: 80,
      fill: '#000000',
      stroke: null,
    });
    const txt = createTextLayer({
      x: 300,
      y: 250,
      content: 'Стиль',
      fill: '#000000',
    });

    expect(copyLayerStyle(src.id)).not.toBeNull();
    expect(pasteLayerStyle([dst.id, txt.id])).toBe(2);

    const sceneAfter = useEditorStore.getState().scene;
    const updatedDst = sceneAfter.layers.find((l) => l.id === dst.id) as PathLayer;
    const updatedTxt = sceneAfter.layers.find((l) => l.id === txt.id) as TextLayer;

    expect(updatedDst.opacity).toBe(0.75);
    expect(updatedDst.blendMode).toBe('overlay');
    expect(updatedDst.stroke?.dashArray).toEqual([6, 4]);
    expect(updatedDst.stroke?.dashOffset).toBe(2);
    expect(updatedDst.effects?.dropShadow?.blur).toBe(8);
    expect(paintEquals(updatedDst.fill, grad)).toBe(true);
    expect(updatedDst.fill).not.toBe(
      (sceneAfter.layers.find((l) => l.id === src.id) as PathLayer).fill
    );

    expect(updatedTxt.opacity).toBe(0.75);
    expect(updatedTxt.blendMode).toBe('overlay');
    expect(updatedTxt.effects?.dropShadow?.offsetY).toBe(5);
    expect(paintEquals(updatedTxt.fill, grad)).toBe(true);

    // Selecting similar by gradient fill matches src, dst, txt
    useEditorStore.getState().setSelectedIds([src.id]);
    expect(selectSimilarLayers('fill')).toBe(3);
  });
});
