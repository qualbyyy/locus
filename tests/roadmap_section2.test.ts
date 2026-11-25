import paper from 'paper/dist/paper-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { copyLayerStyle, pasteLayerStyle } from '../src/core/clipboard';
import {
  applyShapeBuilderOperation,
  applyTextPathArc,
  attachTextToPath,
  convertTextLayersToOutlines,
  createCircleTextPreset,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  createTextOnPathFromShape,
  cutPathAtPoint,
  deleteLayers,
  deselectAllLayers,
  detachTextFromPath,
  resetDocument,
  slicePathLayers,
  splitTextLayers,
  traceImageLayer,
  undoCommand,
  updateLayers,
} from '../src/core/commands';
import { primeFontBytesCache } from '../src/core/fonts';
import { findLayerById, flattenLayers } from '../src/core/layerTree';
import { computeSubPathsBBox } from '../src/core/math';
import { useEditorStore } from '../src/core/store';
import type { GroupLayer, Point2D, TextLayer } from '../src/core/types';
import { registerAssetFromBytes } from '../src/core/assets';
import { fitFreehandSubPath } from '../src/engine/freehand';
import { traceRgbaToVectorPaths } from '../src/engine/imageTrace';
import {
  applyShapeBuilderRegions,
  computeShapeBuilderRegions,
  hitTestShapeBuilderRegions,
} from '../src/engine/shapeBuilder';
import {
  computeTextOnPathCaretAndAnchors,
  computeTextOnPathPlacements,
  projectPointToTextPathOffset,
} from '../src/engine/textOnPath';
import { sceneToSvg } from '../src/export/toSvg';

// Valid 1x1 white PNG bytes
const MINI_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0xff,
  0x7f, 0x00, 0x09, 0xfb, 0x03, 0xfd, 0x05, 0x61, 0x88, 0xe8, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function makeTestRgba(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number, number]
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const off = (y * w + x) * 4;
      data[off] = r;
      data[off + 1] = g;
      data[off + 2] = b;
      data[off + 3] = a;
    }
  }
  return data;
}

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

describe('Section 2 Roadmap Tools', () => {
  beforeAll(async () => {
    primeFontBytesCache('Inter', 400, await loadDiskFont('public/fonts/Inter-Regular.ttf'));
    primeFontBytesCache('Inter', 700, await loadDiskFont('public/fonts/Inter-Bold.ttf'));
  });

  beforeEach(() => {
    resetDocument();
  });

  it('1. Shape Builder partitions overlapping shapes, merges via cursor stroke, erases regions, and supports Undo', () => {
    const r1 = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      fill: '#da7756',
      stroke: null,
    });
    const r2 = createShapeLayer({
      preset: 'rect',
      x: 150,
      y: 100,
      width: 100,
      height: 100,
      fill: '#2f5d62',
      stroke: null,
    });

    const regions = computeShapeBuilderRegions([r1, r2]);
    expect(regions).toHaveLength(3);

    const scope = new paper.PaperScope();
    scope.settings.applyMatrix = false;
    scope.settings.insertItems = false;
    const proj = new scope.Project(undefined as unknown as HTMLCanvasElement);

    try {
      const leftId = hitTestShapeBuilderRegions(scope, regions, { x: 70, y: 100 });
      const midId = hitTestShapeBuilderRegions(scope, regions, { x: 125, y: 100 });
      const rightId = hitTestShapeBuilderRegions(scope, regions, { x: 180, y: 100 });
      expect(leftId).toBeTruthy();
      expect(midId).toBeTruthy();
      expect(rightId).toBeTruthy();
      expect(new Set([leftId, midId, rightId]).size).toBe(3);

      // Merge left + center
      const mergedPieces = applyShapeBuilderRegions(regions, [leftId!, midId!], 'merge');
      expect(mergedPieces).toHaveLength(2);
      const created = applyShapeBuilderOperation([r1.id, r2.id], mergedPieces);
      expect(created).toHaveLength(2);
      expect(useEditorStore.getState().scene.layers).toHaveLength(2);

      // Undo restores original 2 rectangles
      undoCommand();
      expect(useEditorStore.getState().scene.layers).toHaveLength(2);
      expect(findLayerById(useEditorStore.getState().scene.layers, r1.id)).not.toBeNull();
      expect(findLayerById(useEditorStore.getState().scene.layers, r2.id)).not.toBeNull();

      // Erase right region
      const erasedPieces = applyShapeBuilderRegions(regions, [rightId!], 'erase');
      expect(erasedPieces).toHaveLength(2);
      const afterErase = applyShapeBuilderOperation([r1.id, r2.id], erasedPieces);
      expect(afterErase).toHaveLength(2);
    } finally {
      proj.remove();
    }
  });

  it('2. Pencil smooths freehand strokes; Scissors opens/splits paths; Knife slices closed shapes into pieces', () => {
    const rawPts: Point2D[] = [];
    for (let i = 0; i <= 24; i += 1) {
      rawPts.push({
        x: i * 10,
        y: 100 + Math.sin(i * 0.4) * 30 + (i % 2 === 0 ? 1.8 : -1.8),
      });
    }
    const smoothed = fitFreehandSubPath(rawPts, { tolerance: 3.5, closed: false });
    expect(smoothed).not.toBeNull();
    expect(smoothed!.closed).toBe(false);
    expect(smoothed!.anchors.length).toBeLessThan(rawPts.length);
    expect(smoothed!.anchors.some((a) => Math.hypot(a.handleOut.x, a.handleOut.y) > 0.1)).toBe(true);

    // Scissors on a closed rectangle opens the contour at click point
    const box = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      fill: '#da7756',
    });
    const opened = cutPathAtPoint(box.id, { x: 200, y: 150 }, 8);
    expect(opened).toHaveLength(1);
    expect(opened[0].subpaths[0].closed).toBe(false);

    // Scissors on open path splits into 2 separate layers
    const lineLayer = {
      ...opened[0],
      id: 'open_line_1',
      name: 'Отрезок',
      x: 100,
      y: 100,
      subpaths: [
        {
          closed: false,
          anchors: [
            { x: -60, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
            { x: 60, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
          ],
        },
      ],
    };
    resetDocument();
    const targetOpen = createShapeLayer({ preset: 'rect', x: 100, y: 100, width: 120, height: 10 });
    updateLayers([targetOpen.id], () => ({ ...lineLayer, id: targetOpen.id }));
    const splitOpen = cutPathAtPoint(targetOpen.id, { x: 100, y: 100 }, 8);
    expect(splitOpen).toHaveLength(2);
    expect(useEditorStore.getState().scene.layers).toHaveLength(2);

    // Knife slices closed rect into 2 pieces
    resetDocument();
    const rect = createShapeLayer({
      preset: 'rect',
      x: 300,
      y: 300,
      width: 120,
      height: 120,
      fill: '#2f5d62',
    });
    const sliced = slicePathLayers([rect.id], [
      { x: 200, y: 300 },
      { x: 400, y: 300 },
    ]);
    expect(sliced).toHaveLength(2);
    const totalArea = sliced.reduce((sum, l) => {
      const b = computeSubPathsBBox(l.subpaths);
      return sum + b.width * b.height;
    }, 0);
    expect(Math.round(totalArea)).toBeGreaterThan(13500);
    expect(Math.round(totalArea)).toBeLessThan(15000);
  });

  it('3. Text on Path places curved glyphs, flips side, exports <textPath> to SVG, converts to outlines, and cleans up on path deletion', async () => {
    const circle = createShapeLayer({
      preset: 'ellipse',
      x: 400,
      y: 400,
      width: 240,
      height: 240,
      fill: null,
      stroke: { color: '#1c1b1a', width: 2 },
    });
    const text = createTextLayer({
      x: 0,
      y: 0,
      content: 'LOCUS CURVE TEXT',
      fontSize: 28,
      fontFamily: 'Inter',
    });

    const attached = attachTextToPath(text.id, circle.id);
    expect(attached?.pathId).toBe(circle.id);

    const placements = computeTextOnPathPlacements(attached!, circle);
    expect(placements.length).toBeGreaterThan(5);
    const angles = new Set(placements.map((p) => Math.round(p.angleDeg)));
    expect(angles.size).toBeGreaterThan(2);

    updateLayers([text.id], { pathFlip: true, pathOffset: 15 });
    const flippedLayer = findLayerById(useEditorStore.getState().scene.layers, text.id) as TextLayer;
    const flippedPlacements = computeTextOnPathPlacements(flippedLayer, circle);
    expect(flippedPlacements[0].angleDeg).not.toBeCloseTo(placements[0].angleDeg, 0);

    const svg = await sceneToSvg(useEditorStore.getState().scene);
    expect(svg).toContain('<textPath');
    expect(svg).toContain('startOffset="15%"');

    const outlines = await convertTextLayersToOutlines([text.id]);
    expect(outlines).toHaveLength(1);
    expect(outlines[0].type).toBe('path');
    expect(outlines[0].subpaths.length).toBeGreaterThan(3);

    // Undo text-to-outlines, then delete host path -> cleans pathId on TextLayer
    undoCommand();
    deleteLayers([circle.id]);
    const detachedAfterDelete = findLayerById(
      useEditorStore.getState().scene.layers,
      text.id
    ) as TextLayer;
    expect(detachedAfterDelete.pathId).toBeUndefined();

    // Re-create path and verify manual detach
    const line = createShapeLayer({ preset: 'rect', x: 200, y: 200, width: 160, height: 80 });
    attachTextToPath(text.id, line.id);
    const detached = detachTextFromPath(text.id);
    expect(detached?.pathId).toBeUndefined();
  });

  it('4. Image Trace vectorizes B/W silhouettes and multi-color bitmaps cleanly with Undo support', async () => {
    // 32x32 white canvas with a 16x16 dark square centered inside
    const bwRgba = makeTestRgba(32, 32, (x, y) => {
      if (x >= 8 && x < 24 && y >= 8 && y < 24) {
        return [20, 20, 20, 255];
      }
      return [255, 255, 255, 255];
    });
    const bwTraced = traceRgbaToVectorPaths(bwRgba, 32, 32, 160, 160, {
      mode: 'bw',
      threshold: 140,
      simplify: 1.5,
    });
    expect(bwTraced).toHaveLength(1);
    expect(bwTraced[0].subpaths.length).toBeGreaterThanOrEqual(1);
    expect(bwTraced[0].subpaths[0].closed).toBe(true);
    const bwBox = computeSubPathsBBox(bwTraced[0].subpaths);
    expect(bwBox.width).toBeGreaterThan(60);
    expect(bwBox.height).toBeGreaterThan(60);

    // 2-color blocks on white background -> produces 2 vector layers in GroupLayer
    const colorRgba = makeTestRgba(32, 32, (x, y) => {
      if (x >= 4 && x < 14 && y >= 8 && y < 24) return [218, 119, 86, 255];
      if (x >= 18 && x < 28 && y >= 8 && y < 24) return [47, 93, 98, 255];
      return [255, 255, 255, 255];
    });
    const colorTraced = traceRgbaToVectorPaths(colorRgba, 32, 32, 200, 200, {
      mode: 'color',
      colors: 3,
      ignoreWhite: true,
    });
    expect(colorTraced.length).toBe(2);

    const asset = await registerAssetFromBytes({
      bytes: MINI_PNG_BYTES,
      name: 'sample.png',
      mimeType: 'image/png',
    });
    const imgLayer = createImageLayer({
      assetId: asset.id,
      width: 200,
      height: 200,
      x: 500,
      y: 500,
    });
    const resultGroup = traceImageLayer(
      imgLayer.id,
      { mode: 'color', colors: 3, ignoreWhite: true },
      { data: colorRgba, width: 32, height: 32 }
    ) as GroupLayer;
    expect(resultGroup).not.toBeNull();
    expect(resultGroup.type).toBe('group');
    expect(resultGroup.children).toHaveLength(2);
    expect(resultGroup.x).toBe(500);
    expect(resultGroup.y).toBe(500);

    undoCommand();
    const restored = flattenLayers(useEditorStore.getState().scene.layers).find(
      (l) => l.id === imgLayer.id
    );
    expect(restored?.type).toBe('image');
  });

  it('5. Circle text preset, baseline offset, pathStretch, text stroke, and splitTextLayers work with Undo', async () => {
    const circle = createShapeLayer({
      preset: 'ellipse',
      x: 400,
      y: 400,
      width: 240,
      height: 240,
      fill: null,
      stroke: { color: '#1c1b1a', width: 2 },
    });

    const onShape = createTextOnPathFromShape(circle.id, {
      content: 'AROUND CIRCLE',
      fontSize: 24,
      baselineOffset: 16,
      arc: 'top',
    });
    expect(onShape).not.toBeNull();
    expect(onShape!.pathId).toBe(circle.id);
    expect(onShape!.pathBaselineOffset).toBe(16);

    const basePlacements = computeTextOnPathPlacements(
      { ...onShape!, pathBaselineOffset: 0 },
      circle
    );
    const offsetPlacements = computeTextOnPathPlacements(onShape!, circle);
    expect(offsetPlacements.length).toBe(basePlacements.length);
    const distBase = Math.hypot(basePlacements[0].x - 400, basePlacements[0].y - 400);
    const distOffset = Math.hypot(offsetPlacements[0].x - 400, offsetPlacements[0].y - 400);
    expect(Math.abs(distOffset - distBase)).toBeGreaterThan(8);

    const stretchedPlacements = computeTextOnPathPlacements(
      { ...onShape!, pathStretch: true },
      circle
    );
    const spanBase = Math.hypot(
      basePlacements[basePlacements.length - 1].x - basePlacements[0].x,
      basePlacements[basePlacements.length - 1].y - basePlacements[0].y
    );
    const spanStretched = Math.hypot(
      stretchedPlacements[stretchedPlacements.length - 1].x - stretchedPlacements[0].x,
      stretchedPlacements[stretchedPlacements.length - 1].y - stretchedPlacements[0].y
    );
    expect(spanStretched).not.toBeCloseTo(spanBase, 0);

    updateLayers([onShape!.id], {
      stroke: { color: '#da7756', width: 4, lineCap: 'round', lineJoin: 'round' },
    });
    const styledText = findLayerById(
      useEditorStore.getState().scene.layers,
      onShape!.id
    ) as TextLayer;
    expect(styledText.stroke?.width).toBe(4);

    // Style copy/paste transfers text stroke
    const targetText = createTextLayer({ x: 80, y: 80, content: 'Строка 1\nСтрока 2' });
    copyLayerStyle(styledText.id);
    pasteLayerStyle([targetText.id]);
    const pasted = findLayerById(
      useEditorStore.getState().scene.layers,
      targetText.id
    ) as TextLayer;
    expect(pasted.stroke?.color).toBe('#da7756');
    expect(pasted.stroke?.width).toBe(4);

    const svg = await sceneToSvg(useEditorStore.getState().scene);
    expect(svg).toContain('paint-order="stroke fill"');
    expect(svg).toContain('stroke="rgb(218,119,86)"');
    expect(svg).toContain('<textPath');

    // Split curved text into individual rotated char layers and undo in 1 step
    const charGroups = splitTextLayers([styledText.id], 'chars');
    expect(charGroups).toHaveLength(1);
    expect(charGroups[0].type).toBe('group');
    expect(charGroups[0].children.length).toBe('AROUND CIRCLE'.replace(/\s+/g, '').length);
    const firstChar = charGroups[0].children[0] as TextLayer;
    expect(firstChar.pathId).toBeUndefined();
    expect(firstChar.stroke?.width).toBe(4);

    undoCommand();
    expect(
      findLayerById(useEditorStore.getState().scene.layers, styledText.id)?.type
    ).toBe('text');

    // Split multi-line text into lines
    const lineGroups = splitTextLayers([targetText.id], 'lines');
    expect(lineGroups).toHaveLength(1);
    expect(lineGroups[0].children).toHaveLength(2);
    expect((lineGroups[0].children[1] as TextLayer).content).toBe('Строка 2');

    // Create standalone circle text preset when nothing is selected
    deselectAllLayers();
    const presetText = createCircleTextPreset();
    expect(presetText.pathId).toBeTruthy();
    expect(presetText.content).toBe('ТЕКСТ ПО КРУГУ');

    // Sliced circle at (460, 380): text placements & outlines must stay at (460, 380), not drift to (0, 0)
    const bigCircle = createShapeLayer({
      preset: 'ellipse',
      x: 460,
      y: 380,
      width: 240,
      height: 240,
      fill: '#da7756',
      stroke: null,
    });
    const pieces = slicePathLayers([bigCircle.id], [
      { x: 280, y: 380 },
      { x: 640, y: 380 },
    ]);
    expect(pieces.length).toBe(2);
    const topPiece = pieces[0].y < pieces[1].y ? pieces[0] : pieces[1];
    const slicedText = createTextOnPathFromShape(topPiece.id, {
      content: 'SLICED',
      fontSize: 22,
    })!;
    expect(slicedText).not.toBeNull();
    const slicedPlacements = computeTextOnPathPlacements(
      slicedText,
      topPiece,
      undefined,
      useEditorStore.getState().scene.layers
    );
    expect(slicedPlacements.length).toBeGreaterThanOrEqual(4);
    for (const gp of slicedPlacements) {
      expect(gp.x).toBeGreaterThan(280);
      expect(gp.y).toBeGreaterThan(200);
    }

    // applyTextPathArc flips top/bottom without accumulating baseline offset
    const bottomArc = applyTextPathArc(slicedText.id, 'bottom')!;
    const firstBottomOffset = bottomArc.pathBaselineOffset!;
    expect(firstBottomOffset).toBeLessThan(0);
    const bottomArcAgain = applyTextPathArc(slicedText.id, 'bottom')!;
    expect(bottomArcAgain.pathBaselineOffset).toBe(firstBottomOffset);

    const outlinedSliced = await convertTextLayersToOutlines([slicedText.id]);
    expect(outlinedSliced).toHaveLength(1);
    expect(outlinedSliced[0].x).toBeGreaterThan(280);
    expect(outlinedSliced[0].y).toBeGreaterThan(200);

    // Anchor & caret projection for moving text along path and radial baseline offset
    const anchorInfo = computeTextOnPathCaretAndAnchors(
      bottomArc,
      topPiece,
      useEditorStore.getState().scene.layers,
      3
    );
    expect(anchorInfo).not.toBeNull();
    expect(anchorInfo!.curvePt.x).toBeGreaterThan(250);
    expect(
      Math.hypot(
        anchorInfo!.caretTop.x - anchorInfo!.caretBottom.x,
        anchorInfo!.caretTop.y - anchorInfo!.caretBottom.y
      )
    ).toBeGreaterThan(10);

    const projected = projectPointToTextPathOffset(
      bottomArc,
      topPiece,
      { x: 460 + 130, y: 380 },
      useEditorStore.getState().scene.layers
    );
    expect(projected).not.toBeNull();
    expect(projected!.pathOffset).toBeGreaterThanOrEqual(0);
    expect(projected!.pathOffset).toBeLessThanOrEqual(100);
  });
});
