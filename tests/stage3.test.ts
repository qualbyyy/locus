import paper from 'paper/dist/paper-core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAsset,
  inferImageMimeType,
  parseImageDimensionsFromBytes,
  registerAssetFromBytes,
} from '../src/core/assets';
import {
  alignLayers,
  booleanLayers,
  createClipMaskFromSelection,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  deleteLayers,
  redoCommand,
  releaseClipMask,
  replaceImageLayerAsset,
  resetDocument,
  undoCommand,
  updateLayers,
} from '../src/core/commands';
import {
  computeLayerWorldBBox,
  computeSubPathsBBox,
  localToWorld,
  normalizePathLayer,
} from '../src/core/math';
import { useEditorStore } from '../src/core/store';
import type { PathLayer } from '../src/core/types';
import { syncSceneToPaper } from '../src/engine/sync';

function makePngHeaderBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  // PNG signature
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length = 13 + type 'IHDR'
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function makeJpegHeaderBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x0b, // length
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // components
    0xff, 0xd9, // EOI
  ]);
}

describe('Stage 3: Booleans, Assets/Images, Clipping Masks, Text & Alignment', () => {
  beforeEach(() => {
    resetDocument({ name: 'Stage 3 Test', width: 1080, height: 1080 });
    useEditorStore.getState().setActiveTool('select');
    useEditorStore.getState().setSelectedIds([]);
    useEditorStore.getState().setSelectedNode(null);
  });

  it('performs boolean subtract with real hole, supports rotation without jump, and undoes in 1 step', () => {
    const outer = createShapeLayer({
      preset: 'ellipse',
      x: 500,
      y: 500,
      width: 240,
      height: 240,
      fill: '#da7756',
      stroke: null,
    });
    const inner = createShapeLayer({
      preset: 'ellipse',
      x: 500,
      y: 500,
      width: 100,
      height: 100,
      fill: '#1c1b1a',
      stroke: null,
    });

    const pastBefore = useEditorStore.temporal.getState().pastStates.length;
    const ring = booleanLayers([outer.id, inner.id], 'subtract');

    expect(ring).not.toBeNull();
    expect(ring!.subpaths).toHaveLength(2);
    expect(ring!.fillRule).toBe('evenodd');
    expect(ring!.x).toBeCloseTo(500, 2);
    expect(ring!.y).toBeCloseTo(500, 2);

    const localBox = computeSubPathsBBox(ring!.subpaths);
    expect(localBox.x + localBox.width / 2).toBeCloseTo(0, 3);
    expect(localBox.y + localBox.height / 2).toBeCloseTo(0, 3);
    expect(localBox.width).toBeCloseTo(240, 1);
    expect(localBox.height).toBeCloseTo(240, 1);

    expect(useEditorStore.getState().scene.layers).toHaveLength(1);
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(
      pastBefore + 1
    );

    // 1-step Undo restores both original ellipses
    undoCommand();
    expect(useEditorStore.getState().scene.layers).toHaveLength(2);
    redoCommand();

    // Rotate 37 degrees and ensure normalization does not cause jump
    updateLayers([ring!.id], { rotation: 37 });
    const rotated = useEditorStore.getState().scene.layers[0] as PathLayer;
    const anchorWorldBefore = localToWorld(rotated, rotated.subpaths[0].anchors[0]);
    const normalized = normalizePathLayer(rotated);
    const anchorWorldAfter = localToWorld(
      normalized,
      normalized.subpaths[0].anchors[0]
    );
    expect(normalized.x).toBeCloseTo(500, 2);
    expect(normalized.y).toBeCloseTo(500, 2);
    expect(anchorWorldAfter.x).toBeCloseTo(anchorWorldBefore.x, 5);
    expect(anchorWorldAfter.y).toBeCloseTo(anchorWorldBefore.y, 5);

    // Subtracting a bar from the evenodd CompoundPath ring splits cleanly without collapsing hole
    const bar = createShapeLayer({
      preset: 'rect',
      x: 500,
      y: 500,
      width: 300,
      height: 40,
      options: { cornerRadius: 0 },
    });
    const splitRing = booleanLayers([ring!.id, bar.id], 'subtract');
    expect(splitRing).not.toBeNull();
    expect(splitRing!.subpaths.length).toBeGreaterThanOrEqual(2);
  });

  it('handles unite, intersect on rotated shapes, compound subtract, and disjoint null result', () => {
    const a = createShapeLayer({
      preset: 'rect',
      x: 300,
      y: 300,
      width: 140,
      height: 100,
      options: { cornerRadius: 0 },
    });
    updateLayers([a.id], { rotation: 30 });

    const b = createShapeLayer({
      preset: 'rect',
      x: 350,
      y: 320,
      width: 140,
      height: 100,
      options: { cornerRadius: 0 },
    });
    updateLayers([b.id], { rotation: -20 });

    const united = booleanLayers([a.id, b.id], 'unite');
    expect(united).not.toBeNull();
    expect(united!.subpaths.length).toBeGreaterThanOrEqual(1);
    const unitedBox = computeLayerWorldBBox(united!);
    expect(unitedBox.width).toBeGreaterThan(150);

    undoCommand();

    const intersected = booleanLayers([a.id, b.id], 'intersect');
    expect(intersected).not.toBeNull();
    const interBox = computeLayerWorldBBox(intersected!);
    expect(interBox.width).toBeGreaterThan(40);
    expect(interBox.width).toBeLessThan(140);

    // Disjoint shapes return null without mutating scene
    const far1 = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 100,
      width: 40,
      height: 40,
    });
    const far2 = createShapeLayer({
      preset: 'rect',
      x: 800,
      y: 800,
      width: 40,
      height: 40,
    });
    const layersCountBefore = useEditorStore.getState().scene.layers.length;
    const pastBefore = useEditorStore.temporal.getState().pastStates.length;
    expect(booleanLayers([far1.id, far2.id], 'intersect')).toBeNull();
    expect(useEditorStore.getState().scene.layers).toHaveLength(layersCountBefore);
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(pastBefore);
  });

  it('registers image assets, preserves ObjectURL across delete/undo, and clears on resetDocument', async () => {
    const pngBytes = makePngHeaderBytes(64, 48);
    expect(inferImageMimeType('photo.bin', pngBytes)).toBe('image/png');
    expect(parseImageDimensionsFromBytes(pngBytes, 'image/png')).toEqual({
      width: 64,
      height: 48,
    });

    const jpegBytes = makeJpegHeaderBytes(320, 240);
    expect(inferImageMimeType('pic', jpegBytes)).toBe('image/jpeg');
    expect(parseImageDimensionsFromBytes(jpegBytes, 'image/jpeg')).toEqual({
      width: 320,
      height: 240,
    });

    const svgBytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 90"></svg>'
    );
    expect(inferImageMimeType('icon.svg', svgBytes)).toBe('image/svg+xml');
    expect(parseImageDimensionsFromBytes(svgBytes, 'image/svg+xml')).toEqual({
      width: 180,
      height: 90,
    });

    const asset = await registerAssetFromBytes({
      bytes: pngBytes,
      name: 'sample.png',
    });
    expect(asset.naturalWidth).toBe(64);
    expect(asset.naturalHeight).toBe(48);
    expect(asset.objectUrl.length).toBeGreaterThan(0);

    const imgLayer = createImageLayer({
      assetId: asset.id,
      width: asset.naturalWidth,
      height: asset.naturalHeight,
      name: 'Sample',
    });
    expect(imgLayer.scaleX).toBe(1);

    // Replace asset keeps consistent rendered width
    const asset2 = await registerAssetFromBytes({
      bytes: makePngHeaderBytes(128, 96),
      name: 'sample2.png',
    });
    const replaced = replaceImageLayerAsset(imgLayer.id, asset2);
    expect(replaced).not.toBeNull();
    expect(replaced!.width).toBe(128);
    expect(replaced!.scaleX).toBeCloseTo(0.5, 4);

    // Delete layer -> asset stays alive for Ctrl+Z
    deleteLayers([imgLayer.id]);
    expect(useEditorStore.getState().scene.layers).toHaveLength(0);
    expect(getAsset(asset2.id)).toBeDefined();
    expect(getAsset(asset2.id)!.objectUrl).toBe(asset2.objectUrl);

    // Undo restores ImageLayer with intact asset
    undoCommand();
    const restored = useEditorStore.getState().scene.layers[0];
    expect(restored?.type).toBe('image');
    if (restored?.type === 'image') {
      expect(getAsset(restored.assetId)?.objectUrl).toBe(asset2.objectUrl);
    }

    // Document reset releases assets
    resetDocument();
    expect(getAsset(asset.id)).toBeUndefined();
    expect(getAsset(asset2.id)).toBeUndefined();
  });

  it('renders clipping mask without own fill/stroke in syncSceneToPaper and releases cleanly', () => {
    const bgRect = createShapeLayer({
      preset: 'rect',
      x: 400,
      y: 400,
      width: 300,
      height: 240,
      fill: '#da7756',
      stroke: null,
    });
    const title = createTextLayer({
      x: 400,
      y: 400,
      content: 'Маска',
      fontFamily: 'Unbounded',
      fontWeight: 700,
    });
    const maskCircle = createShapeLayer({
      preset: 'ellipse',
      x: 400,
      y: 400,
      width: 180,
      height: 180,
      fill: '#ffffff',
      stroke: { color: '#1c1b1a', width: 2 },
    });

    const createdMask = createClipMaskFromSelection([
      bgRect.id,
      title.id,
      maskCircle.id,
    ]);
    expect(createdMask).not.toBeNull();
    expect(createdMask!.isClipMask).toBe(true);

    const scene = useEditorStore.getState().scene;
    expect(scene.layers.find((l) => l.id === bgRect.id)?.clipMaskId).toBe(
      maskCircle.id
    );
    expect(scene.layers.find((l) => l.id === title.id)?.clipMaskId).toBe(
      maskCircle.id
    );

    const scope = new paper.PaperScope();
    scope.settings.applyMatrix = false;
    const project = new scope.Project(undefined as unknown as HTMLCanvasElement);
    try {
      const sceneLayer = new scope.Layer({ name: 'sceneLayer' });
      const itemMap = syncSceneToPaper(scope, sceneLayer, scene);

      const maskPaperItem = itemMap.get(maskCircle.id)!;
      expect(maskPaperItem.fillColor).toBeNull();
      expect(maskPaperItem.strokeColor).toBeNull();

      const clipGroups = sceneLayer.children.filter(
        (c) => c instanceof scope.Group && c.clipped
      );
      expect(clipGroups).toHaveLength(1);
      expect(clipGroups[0].children.length).toBe(3);
    } finally {
      project.remove();
    }

    releaseClipMask(maskCircle.id);
    const releasedScene = useEditorStore.getState().scene;
    expect(
      releasedScene.layers.find((l) => l.id === bgRect.id)?.clipMaskId
    ).toBeUndefined();
    expect(
      (releasedScene.layers.find((l) => l.id === maskCircle.id) as PathLayer)
        .isClipMask
    ).toBe(false);
  });

  it('creates Cyrillic text layers and aligns/distributes layers accurately', () => {
    const txt = createTextLayer({
      x: 200,
      y: 120,
      content: 'Привет, Locus!\nВторая строка',
      fontFamily: 'Playfair Display',
      fontWeight: 700,
      fontSize: 40,
      align: 'center',
    });
    expect(txt.content).toContain('Привет');
    expect(txt.fontFamily).toBe('Playfair Display');

    const b1 = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 100,
      width: 60,
      height: 40,
    });
    const b2 = createShapeLayer({
      preset: 'rect',
      x: 180,
      y: 220,
      width: 100,
      height: 80,
    });
    const b3 = createShapeLayer({
      preset: 'rect',
      x: 500,
      y: 400,
      width: 80,
      height: 60,
    });

    alignLayers([b1.id, b2.id, b3.id], 'distribute_h');
    let layers = useEditorStore.getState().scene.layers;
    const d1 = computeLayerWorldBBox(layers.find((l) => l.id === b1.id)!);
    const d2 = computeLayerWorldBBox(layers.find((l) => l.id === b2.id)!);
    const d3 = computeLayerWorldBBox(layers.find((l) => l.id === b3.id)!);
    const gap1 = d2.x - (d1.x + d1.width);
    const gap2 = d3.x - (d2.x + d2.width);
    expect(gap1).toBeCloseTo(gap2, 4);

    alignLayers([b1.id, b2.id], 'left');
    layers = useEditorStore.getState().scene.layers;
    const left1 = computeLayerWorldBBox(layers.find((l) => l.id === b1.id)!);
    const left2 = computeLayerWorldBBox(layers.find((l) => l.id === b2.id)!);
    expect(left1.x).toBeCloseTo(left2.x, 4);

    alignLayers([b1.id], 'artboard_center');
    layers = useEditorStore.getState().scene.layers;
    const centered = computeLayerWorldBBox(layers.find((l) => l.id === b1.id)!);
    expect(centered.x + centered.width / 2).toBeCloseTo(540, 4);
    expect(centered.y + centered.height / 2).toBeCloseTo(540, 4);
  });
});
