import { beforeEach, describe, expect, it } from 'vitest';
import paper from 'paper/dist/paper-core';
import {
  createShapeLayer,
  createTextLayer,
  resetDocument,
  updateLayerEffects,
  updateLayers,
} from '../src/core/commands';
import { useEditorStore } from '../src/core/store';
import { traceRgbaToVectorPaths } from '../src/engine/imageTrace';
import { syncSceneToPaper } from '../src/engine/sync';
import { renderOverlay } from '../src/engine/overlay';
import { createBlobTool } from '../src/engine/tools/blobTool';
import { createEyedropperTool } from '../src/engine/tools/eyedropperTool';
import { createKnifeTool } from '../src/engine/tools/knifeTool';
import type { ToolContext, ToolPointerEvent } from '../src/engine/tools/types';
import { findLayerById } from '../src/core/layerTree';
import type { TextLayer } from '../src/core/types';
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

  it('renders linear and radial Paper.js gradients accurately on transformed PathLayer and TextLayer', () => {
    const scope = new paper.PaperScope();
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 120;
    scope.setup(canvas);
    const sceneLayer = new scope.Layer();

    const linearRect = createShapeLayer({
      preset: 'rect',
      x: 110,
      y: 60,
      width: 80,
      height: 40,
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
    updateLayers([linearRect.id], {
      rotation: 90,
      scaleX: 1.5,
      scaleY: 1.5,
    });

    const radialCircle = createShapeLayer({
      preset: 'ellipse',
      x: 40,
      y: 60,
      width: 50,
      height: 50,
      fill: {
        kind: 'radial',
        start: { x: 0.5, y: 0.5 },
        end: { x: 1, y: 0.5 },
        stops: [
          { offset: 0, color: '#00ff00' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    });
    updateLayers([radialCircle.id], { scaleX: 1.2, scaleY: 1.2 });

    const textLayer = createTextLayer({
      x: 100,
      y: 20,
      content: 'GRAD',
      fontSize: 18,
      fill: {
        kind: 'linear',
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#00ff00' },
        ],
      },
    });

    const itemMap = syncSceneToPaper(scope, sceneLayer, useEditorStore.getState().scene);
    scope.view.update();

    const ctx = canvas.getContext('2d')!;
    // linearRect is centered at (110, 60), width=80*1.5=120 rotated 90deg => spans y in [0, 120]
    const topPx = ctx.getImageData(110, 10, 1, 1).data;
    const bottomPx = ctx.getImageData(110, 110, 1, 1).data;
    expect(topPx[0]).toBeGreaterThan(180);
    expect(topPx[2]).toBeLessThan(80);
    expect(bottomPx[2]).toBeGreaterThan(180);
    expect(bottomPx[0]).toBeLessThan(80);

    // radialCircle is centered at (40, 60), radius ~30 => center green, outer blue
    const centerPx = ctx.getImageData(40, 60, 1, 1).data;
    const edgePx = ctx.getImageData(66, 60, 1, 1).data;
    expect(centerPx[1]).toBeGreaterThan(180);
    expect(edgePx[2]).toBeGreaterThan(150);

    // TextLayer PointText items received shifted matrix gradient colors (not identical unshifted stop)
    const textGroup = itemMap.get(textLayer.id);
    expect(textGroup).toBeDefined();
    const firstPointText = textGroup!.children[0] as paper.PointText;
    expect(firstPointText.fillColor?.gradient).toBeDefined();
    expect(firstPointText.fillColor?.origin?.y).toBeCloseTo(
      firstPointText.fillColor!.destination!.y,
      4
    );
    // PointText has matrix.ty = baselineY (~15.3), so origin.y should match baselineY
    expect(firstPointText.fillColor!.origin!.y).toBeGreaterThan(10);

    scope.project.remove();
  });

  it('renders motionBlur, innerShadow, colorAdjust, and 150px blur on Canvas 2D', async () => {
    const rect = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 60,
      width: 80,
      height: 60,
      fill: '#da7756',
    });
    updateLayerEffects([rect.id], {
      motionBlur: { amount: 24, angle: 0 },
      innerShadow: {
        color: '#000000',
        opacity: 0.6,
        offsetX: 0,
        offsetY: 4,
        blur: 6,
      },
      colorAdjust: {
        brightness: 15,
        contrast: 10,
        saturate: 20,
        hue: 15,
      },
    });

    const canvas = await rasterizeComposite(useEditorStore.getState().scene, {
      scale: 1,
      transparent: true,
    });
    const ctx = canvas.getContext('2d')!;
    // Motion blur along 0deg should extend alpha horizontally beyond the 80px rect [60..140]
    const trailLeft = ctx.getImageData(52, 60, 1, 1).data;
    const trailRight = ctx.getImageData(148, 60, 1, 1).data;
    expect(trailLeft[3]).toBeGreaterThan(0);
    expect(trailRight[3]).toBeGreaterThan(0);

    updateLayerEffects([rect.id], { blur: 150 });
    const blurred = rasterizeLayerLocalWithEffects(useEditorStore.getState().scene.layers[0]);
    expect(blurred).not.toBeNull();
    expect(blurred!.canvas.width).toBeGreaterThan(80);
  });

  it('syncs text stroke-before-fill passes and baseline path transform in Paper.js', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 160;
    const scope = new paper.PaperScope();
    scope.setup(canvas);
    const sceneLayer = new scope.Layer();

    const circle = createShapeLayer({
      preset: 'ellipse',
      x: 120,
      y: 80,
      width: 90,
      height: 90,
      fill: null,
      stroke: { color: '#333333', width: 1 },
    });
    const curved = createTextLayer({
      x: 0,
      y: 0,
      content: 'AB',
      fontSize: 18,
      fill: '#1c1b1a',
      stroke: { color: '#da7756', width: 3, lineCap: 'round', lineJoin: 'round' },
      align: 'center',
      pathId: circle.id,
      pathOffset: 50,
      pathBaselineOffset: 10,
    });

    const itemMap = syncSceneToPaper(scope, sceneLayer, useEditorStore.getState().scene);
    scope.view.update();

    const textGroup = itemMap.get(curved.id);
    expect(textGroup).toBeDefined();
    expect(textGroup!.children.length).toBe(4);
    expect(textGroup!.children[0].data?.textPass).toBe('stroke');
    expect(textGroup!.children[1].data?.textPass).toBe('stroke');
    expect(textGroup!.children[2].data?.textPass).toBe('fill');
    expect(textGroup!.children[3].data?.textPass).toBe('fill');

    // Live path editing keeps curved text visible and renders live draft content
    const liveMap = syncSceneToPaper(scope, sceneLayer, useEditorStore.getState().scene, {
      editingTextLayerId: curved.id,
      editingTextDraft: { layerId: curved.id, content: 'LIVE' },
    });
    const liveGroup = liveMap.get(curved.id);
    expect(liveGroup).toBeDefined();
    expect(liveGroup!.visible).toBe(true);
    expect(liveGroup!.children.length).toBe(8); // 4 chars * 2 passes

    const raster = await rasterizeComposite(useEditorStore.getState().scene, {
      scale: 1,
      transparent: true,
    });
    const ctx = raster.getContext('2d')!;
    const rgba = ctx.getImageData(0, 0, raster.width, raster.height).data;
    let nonZeroAlpha = 0;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] > 0) nonZeroAlpha += 1;
    }
    expect(nonZeroAlpha).toBeGreaterThan(20);

    scope.project.remove();
  });

  it('supports click-to-create in BlobTool, Eyedropper stroke on TextLayer, Knife fill guard, and TextPath anchor overlays', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const scope = new paper.PaperScope();
    scope.setup(canvas);
    const sceneLayer = new scope.Layer();
    const overlayLayer = new scope.Layer();

    let itemMap = syncSceneToPaper(scope, sceneLayer, useEditorStore.getState().scene);
    const toolCtx: ToolContext = {
      scope,
      sceneLayer,
      overlayLayer,
      getItemMap: () => itemMap,
      redrawOverlay: () => {},
      startTextEditing: () => {},
    };
    const mkEvt = (x: number, y: number, altKey = false): ToolPointerEvent => ({
      point: { x, y },
      startPoint: { x, y },
      shiftKey: false,
      altKey,
      metaKey: false,
      ctrlKey: false,
      detail: 1,
    });

    // 1. BlobTool single click creates default 120x120 circle with #1c1b1a fill
    const blobTool = createBlobTool();
    blobTool.onMouseDown(mkEvt(100, 100), toolCtx);
    blobTool.onMouseUp(mkEvt(100, 100), toolCtx);
    expect(useEditorStore.getState().scene.layers).toHaveLength(1);
    const createdCircle = useEditorStore.getState().scene.layers[0];
    expect(createdCircle.type).toBe('path');
    if (createdCircle.type === 'path') {
      expect(createdCircle.fill).toBe('#1c1b1a');
    }

    // 2. Eyedropper Alt+click samples & applies stroke color to selected TextLayer
    const swatch = createShapeLayer({
      preset: 'rect',
      x: 240,
      y: 240,
      width: 40,
      height: 40,
      fill: '#2f5d62',
      stroke: { color: '#2f5d62', width: 2 },
    });
    const txt = createTextLayer({
      x: 0,
      y: 0,
      content: 'ANCHOR',
      pathId: createdCircle.id,
      pathOffset: 50,
    });
    itemMap = syncSceneToPaper(scope, sceneLayer, useEditorStore.getState().scene);
    scope.view.update();
    useEditorStore.getState().setSelectedIds([txt.id]);
    const eyedropper = createEyedropperTool();
    eyedropper.onMouseDown(mkEvt(240, 240, true), toolCtx);
    const updatedTxt = findLayerById(
      useEditorStore.getState().scene.layers,
      txt.id
    ) as TextLayer;
    expect(updatedTxt.stroke?.color).toBe('#2f5d62');

    // 3. Scissors click deep inside a filled front rect does not punch through to layer behind it
    useEditorStore.getState().setKnifeToolMode('scissors');
    const knife = createKnifeTool();
    knife.onMouseDown(mkEvt(240, 240), toolCtx);
    knife.onMouseUp(mkEvt(240, 240), toolCtx);
    const sameSwatch = findLayerById(useEditorStore.getState().scene.layers, swatch.id);
    expect(sameSwatch?.type).toBe('path');

    // 4. Text-on-path overlay hides corner resize handles and exposes offset + baseline anchors in both Select and Text modes
    for (const toolMode of ['select', 'text'] as const) {
      renderOverlay(scope, overlayLayer, {
        scene: useEditorStore.getState().scene,
        selectedIds: [txt.id],
        selectedNode: null,
        activeTool: toolMode,
      });
      const selectHandles = overlayLayer.children.filter((c) => c.data?.selectHandle);
      const pathHandles = overlayLayer.children
        .map((c) => c.data?.textPathHandle)
        .filter(Boolean);
      expect(selectHandles).toHaveLength(0);
      expect(pathHandles).toEqual(['offset', 'baseline']);
    }

    scope.project.remove();
  });
});
