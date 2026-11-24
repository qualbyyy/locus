import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  booleanLayers,
  combineCompoundPathLayers,
  convertTextLayersToOutlines,
  createShapeLayer,
  createTextLayer,
  flipLayers,
  offsetPathLayers,
  outlineStrokeLayers,
  redoCommand,
  resetDocument,
  simplifyPathLayers,
  splitCompoundPathLayers,
  transformTextCase,
  undoCommand,
  updateLayers,
  updatePathSubpaths,
} from '../src/core/commands';
import { primeFontBytesCache } from '../src/core/fonts';
import {
  computeLayerWorldBBox,
  computeSubPathsBBox,
  localToWorld,
} from '../src/core/math';
import { useEditorStore } from '../src/core/store';
import type { AnchorPoint, PathLayer, TextLayer } from '../src/core/types';

async function loadDiskFont(relPath: string): Promise<Uint8Array> {
  const fsId = 'node:fs';
  const pathId = 'node:path';
  const { readFileSync } = (await import(/* @vite-ignore */ fsId)) as {
    readFileSync: (p: string) => Uint8Array;
  };
  const { resolve } = (await import(/* @vite-ignore */ pathId)) as {
    resolve: (...paths: string[]) => string;
  };
  const cwd = (
    globalThis as unknown as { process: { cwd(): string } }
  ).process.cwd();
  const buf = readFileSync(resolve(cwd, relPath));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe('Stage 3.5: Text-to-Outlines, Typography & Illustrator Vector Ops', () => {
  beforeAll(async () => {
    primeFontBytesCache(
      'Inter',
      700,
      await loadDiskFont('public/fonts/Inter-Bold.ttf')
    );
    primeFontBytesCache(
      'Unbounded',
      400,
      await loadDiskFont('public/fonts/Unbounded-Regular.ttf')
    );
  });

  beforeEach(() => {
    resetDocument({ name: 'Stage 3.5 Test', width: 1080, height: 1080 });
    useEditorStore.getState().setActiveTool('select');
    useEditorStore.getState().setSelectedIds([]);
    useEditorStore.getState().setSelectedNode(null);
  });

  it('converts rotated Cyrillic text with letterSpacing to outlines and undoes in 1 step', async () => {
    const txt = createTextLayer({
      x: 540,
      y: 360,
      content: 'Привет',
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSize: 96,
      letterSpacing: 4,
      align: 'center',
      fill: '#da7756',
    });
    updateLayers([txt.id], { rotation: 25 });

    const pastBefore = useEditorStore.temporal.getState().pastStates.length;
    const created = await convertTextLayersToOutlines([txt.id]);

    expect(created).toHaveLength(1);
    const outlined = created[0];
    expect(outlined.type).toBe('path');
    expect(outlined.fill).toBe('#da7756');
    expect(outlined.stroke).toBeNull();
    expect(outlined.fillRule).toBe('evenodd');
    expect(outlined.subpaths.length).toBeGreaterThanOrEqual(6);

    const localBox = computeSubPathsBBox(outlined.subpaths);
    expect(localBox.x + localBox.width / 2).toBeCloseTo(0, 3);
    expect(localBox.y + localBox.height / 2).toBeCloseTo(0, 3);
    expect(localBox.width).toBeGreaterThan(200);
    expect(localBox.height).toBeGreaterThan(60);

    expect(useEditorStore.getState().scene.layers).toHaveLength(1);
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(
      pastBefore + 1
    );

    undoCommand();
    const reverted = useEditorStore.getState().scene.layers[0];
    expect(reverted.type).toBe('text');
    expect((reverted as TextLayer).content).toBe('Привет');
    redoCommand();
    expect(useEditorStore.getState().scene.layers[0].type).toBe('path');
  });

  it('splits outlined Cyrillic word into 6 letter layers preserving inner holes, then splits single letter and recombines', async () => {
    const txt = createTextLayer({
      x: 400,
      y: 400,
      content: 'Привет',
      fontFamily: 'Unbounded',
      fontWeight: 400,
      fontSize: 80,
      align: 'left',
    });

    const [outlined] = await convertTextLayersToOutlines([txt.id]);
    const letters = splitCompoundPathLayers([outlined.id]);

    // "Привет" has 6 letters; letters like "р", "в", "е" keep their holes attached!
    expect(letters).toHaveLength(6);
    expect(letters.some((l) => l.subpaths.length >= 2)).toBe(true);

    // Selecting a single letter with a hole (e.g. 'р' or 'е') and splitting again releases raw subpaths
    const letterWithHole = letters.find((l) => l.subpaths.length === 2)!;
    expect(letterWithHole).toBeDefined();
    const rawParts = splitCompoundPathLayers([letterWithHole.id]);
    expect(rawParts).toHaveLength(2);
    expect(rawParts.every((p) => p.subpaths.length === 1)).toBe(true);

    // Ctrl+8 recombines them back into 1 CompoundPath in 1 Undo step
    const pastBefore = useEditorStore.temporal.getState().pastStates.length;
    const recombined = combineCompoundPathLayers(rawParts.map((p) => p.id));
    expect(recombined).not.toBeNull();
    expect(recombined!.subpaths).toHaveLength(2);
    expect(recombined!.fillRule).toBe('evenodd');
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(
      pastBefore + 1
    );
  });

  it('performs exclude and divide boolean operations accurately', () => {
    const c1 = createShapeLayer({
      preset: 'ellipse',
      x: 400,
      y: 400,
      width: 160,
      height: 160,
      fill: '#da7756',
    });
    const c2 = createShapeLayer({
      preset: 'ellipse',
      x: 480,
      y: 400,
      width: 160,
      height: 160,
      fill: '#1c1b1a',
    });

    const excluded = booleanLayers([c1.id, c2.id], 'exclude');
    expect(excluded).not.toBeNull();
    expect(excluded!.subpaths.length).toBeGreaterThanOrEqual(2);

    undoCommand();
    expect(useEditorStore.getState().scene.layers).toHaveLength(2);

    const pastBeforeDivide = useEditorStore.temporal.getState().pastStates.length;
    booleanLayers([c1.id, c2.id], 'divide');
    const pieces = useEditorStore.getState().scene.layers as PathLayer[];
    expect(pieces).toHaveLength(3);
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(
      pastBeforeDivide + 1
    );

    undoCommand();
    expect(useEditorStore.getState().scene.layers).toHaveLength(2);
  });

  it('performs offset path (copyBehind and in-place), outline stroke, simplify, flip, and text case transform', async () => {
    const rect = createShapeLayer({
      preset: 'rect',
      x: 500,
      y: 500,
      width: 120,
      height: 80,
      options: { cornerRadius: 0 },
      fill: '#da7756',
      stroke: { color: '#1c1b1a', width: 10, lineCap: 'round', lineJoin: 'round' },
    });

    // Offset copyBehind (+12px) inserts new larger contour BEFORE original
    const behind = offsetPathLayers([rect.id], 12, { copyBehind: true });
    expect(behind).toHaveLength(1);
    const layersAfterOffset = useEditorStore.getState().scene.layers;
    expect(layersAfterOffset).toHaveLength(2);
    expect(layersAfterOffset[0].id).toBe(behind[0].id);
    expect(layersAfterOffset[1].id).toBe(rect.id);
    const behindBox = computeLayerWorldBBox(behind[0]);
    expect(behindBox.width).toBeCloseTo(144, 0);
    expect(behindBox.height).toBeCloseTo(104, 0);

    // In-place negative offset shrinks rect
    offsetPathLayers([rect.id], -10, { copyBehind: false });
    const shrunkRect = useEditorStore
      .getState()
      .scene.layers.find((l) => l.id === rect.id)!;
    const shrunkBox = computeLayerWorldBBox(shrunkRect);
    expect(shrunkBox.width).toBeCloseTo(100, 0);
    expect(shrunkBox.height).toBeCloseTo(60, 0);

    // Outline stroke on rect with fill creates separate ring stroke layer above
    const outlinedStrokes = outlineStrokeLayers([rect.id]);
    expect(outlinedStrokes).toHaveLength(1);
    expect(outlinedStrokes[0].subpaths).toHaveLength(2);
    expect(outlinedStrokes[0].stroke).toBeNull();
    expect(outlinedStrokes[0].fill).toBe('#1c1b1a');
    const updatedBase = useEditorStore
      .getState()
      .scene.layers.find((l) => l.id === rect.id) as PathLayer;
    expect(updatedBase.stroke).toBeNull();

    // Outline stroke on stroke-only path converts in-place
    const strokeOnly = createShapeLayer({
      preset: 'ellipse',
      x: 200,
      y: 200,
      width: 100,
      height: 100,
      fill: null,
      stroke: { color: '#1c1b1a', width: 12 },
    });
    const inPlaceStroke = outlineStrokeLayers([strokeOnly.id]);
    expect(inPlaceStroke).toHaveLength(1);
    expect(inPlaceStroke[0].id).toBe(strokeOnly.id);
    expect(inPlaceStroke[0].fill).toBe('#1c1b1a');
    expect(inPlaceStroke[0].stroke).toBeNull();
    expect(inPlaceStroke[0].subpaths).toHaveLength(2);

    // Offset on an outlined letter with hole ('О') preserves hole
    const letterO = createTextLayer({
      x: 200,
      y: 500,
      content: 'О',
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSize: 100,
    });
    const [outlinedO] = await convertTextLayersToOutlines([letterO.id]);
    const offsetO = offsetPathLayers([outlinedO.id], 6, { copyBehind: true });
    expect(offsetO).toHaveLength(1);
    expect(offsetO[0].subpaths.length).toBeGreaterThanOrEqual(2);

    // Simplify dense polygon
    const denseAnchors: AnchorPoint[] = [];
    const totalPts = 36;
    for (let i = 0; i < totalPts; i++) {
      const a = (i * Math.PI * 2) / totalPts;
      denseAnchors.push({
        x: Math.cos(a) * 60,
        y: Math.sin(a) * 60,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
        smooth: false,
      });
    }
    const denseLayer = createShapeLayer({
      preset: 'polygon',
      x: 700,
      y: 700,
      width: 120,
      height: 120,
    });
    updatePathSubpaths(denseLayer.id, [{ closed: true, anchors: denseAnchors }]);
    simplifyPathLayers([denseLayer.id], 2.5);
    const simplified = useEditorStore
      .getState()
      .scene.layers.find((l) => l.id === denseLayer.id) as PathLayer;
    expect(simplified.subpaths[0].anchors.length).toBeLessThan(totalPts);

    // Flip rotated asymmetric triangle horizontally & verify reflected vertex
    const tri = createShapeLayer({
      preset: 'polygon',
      x: 300,
      y: 300,
      width: 100,
      height: 80,
      options: { points: 3 },
    });
    updatePathSubpaths(tri.id, [
      {
        closed: true,
        anchors: [
          { x: -40, y: -30, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
          { x: 40, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
          { x: -20, y: 30, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
        ],
      },
    ]);
    updateLayers([tri.id], { rotation: 30, scaleX: 1.5 });
    const triBefore = useEditorStore
      .getState()
      .scene.layers.find((l) => l.id === tri.id) as PathLayer;
    const boxBefore = computeLayerWorldBBox(triBefore);
    const pivotX = boxBefore.x + boxBefore.width / 2;
    const v0Before = localToWorld(triBefore, triBefore.subpaths[0].anchors[0]);

    flipLayers([tri.id], 'horizontal');
    const triAfter = useEditorStore
      .getState()
      .scene.layers.find((l) => l.id === tri.id) as PathLayer;
    const v0After = localToWorld(triAfter, triAfter.subpaths[0].anchors[0]);
    expect(v0After.x).toBeCloseTo(2 * pivotX - v0Before.x, 4);
    expect(v0After.y).toBeCloseTo(v0Before.y, 4);

    // Text case transforms on Cyrillic
    const caseTxt = createTextLayer({
      x: 100,
      y: 100,
      content: 'привет, locus-мир!',
    });
    transformTextCase([caseTxt.id], 'upper');
    expect(
      (useEditorStore.getState().scene.layers.find((l) => l.id === caseTxt.id) as TextLayer)
        .content
    ).toBe('ПРИВЕТ, LOCUS-МИР!');

    transformTextCase([caseTxt.id], 'lower');
    expect(
      (useEditorStore.getState().scene.layers.find((l) => l.id === caseTxt.id) as TextLayer)
        .content
    ).toBe('привет, locus-мир!');

    transformTextCase([caseTxt.id], 'title');
    expect(
      (useEditorStore.getState().scene.layers.find((l) => l.id === caseTxt.id) as TextLayer)
        .content
    ).toBe('Привет, Locus-Мир!');
  });
});
