import JSZip from 'jszip';
import paper from 'paper/dist/paper-core';
import { initializeCanvas, readPsd, writePsd, type Psd } from 'ag-psd';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractArtboardScene,
  getSceneArtboards,
  PRIMARY_ARTBOARD_ID,
} from '../src/core/artboards';
import { clearAssets, getAllAssets, registerAssetFromBytes } from '../src/core/assets';
import {
  addArtboard,
  convertTextLayersToOutlines,
  createClipMaskFromSelection,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  deleteArtboard,
  duplicateArtboard,
  duplicateLayers,
  groupLayers,
  redoCommand,
  resetDocument,
  undoCommand,
  ungroupLayers,
  updateArtboardById,
  updateLayers,
} from '../src/core/commands';
import {
  clearProjectFonts,
  getProjectFonts,
  inferFontMimeType,
  loadFontBytes,
  registerProjectFontFromBytes,
} from '../src/core/fonts';
import { findLayerById, flattenLayers, getParentWorldMatrix } from '../src/core/layerTree';
import { computeLayerBBoxWithMatrix } from '../src/core/math';
import { useEditorStore } from '../src/core/store';
import type { GroupLayer, Layer } from '../src/core/types';
import { syncSceneToPaper } from '../src/engine/sync';
import { buildLocusArchive, openLocusFromBytes } from '../src/export/projectFile';
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

function makeMinimalPngBytes(): Uint8Array {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function serializePsdForJsdom(psd: Psd): Uint8Array {
  const composite = {
    data: new Uint8ClampedArray(psd.width * psd.height * 4),
    width: psd.width,
    height: psd.height,
  } as unknown as ImageData;
  return new Uint8Array(
    writePsd({ ...psd, canvas: undefined, imageData: composite } as Psd, {
      noBackground: true,
    })
  );
}

function createPaperHarness(): {
  scope: paper.PaperScope;
  sceneLayer: paper.Layer;
} {
  const scope = new paper.PaperScope();
  scope.settings.applyMatrix = false;
  scope.settings.insertItems = false;
  new scope.Project(undefined as unknown as HTMLCanvasElement);
  const sceneLayer = new scope.Layer({ applyMatrix: false });
  return { scope, sceneLayer };
}

describe('Roadmap Stage 2: Groups, Multi-Artboards, Custom Fonts', () => {
  beforeEach(() => {
    clearProjectFonts();
    clearAssets();
    resetDocument({
      name: 'Stage 2 Test',
      width: 800,
      height: 600,
      dpi: 72,
      background: '#ffffff',
    });
  });

  afterEach(() => {
    clearProjectFonts();
    clearAssets();
  });

  it('groups and ungroups nested rotated/scaled layers with world bbox preservation and Undo/Redo', () => {
    const a = createShapeLayer({
      preset: 'rect',
      x: 180,
      y: 160,
      width: 80,
      height: 60,
      fill: '#da7756',
      stroke: null,
    });
    const b = createShapeLayer({
      preset: 'ellipse',
      x: 340,
      y: 220,
      width: 100,
      height: 70,
      fill: '#2563eb',
      stroke: null,
    });
    const c = createShapeLayer({
      preset: 'rect',
      x: 500,
      y: 300,
      width: 60,
      height: 60,
      fill: '#16a34a',
      stroke: null,
    });

    const inner = groupLayers([a.id, b.id]);
    expect(inner).not.toBeNull();
    expect(inner!.children).toHaveLength(2);

    updateLayers([inner!.id], { rotation: 30, scaleX: 1.4, scaleY: 0.9, x: 290, y: 210 });
    const innerWorldABefore = computeLayerBBoxWithMatrix(
      findLayerById(useEditorStore.getState().scene.layers, a.id)!,
      getParentWorldMatrix(useEditorStore.getState().scene.layers, a.id)
    );

    const outer = groupLayers([inner!.id, c.id]);
    expect(outer).not.toBeNull();
    updateLayers([outer!.id], { rotation: -15, scaleX: 1.2, scaleY: 1.2 });

    const beforeOuterState = useEditorStore.getState().scene.layers;
    const worldAAfterOuterTransform = computeLayerBBoxWithMatrix(
      findLayerById(beforeOuterState, a.id)!,
      getParentWorldMatrix(beforeOuterState, a.id)
    );
    const worldCAfterOuterTransform = computeLayerBBoxWithMatrix(
      findLayerById(beforeOuterState, c.id)!,
      getParentWorldMatrix(beforeOuterState, c.id)
    );

    const releasedOuter = ungroupLayers([outer!.id]);
    expect(releasedOuter).toHaveLength(2);

    const afterUngroupOuter = useEditorStore.getState().scene.layers;
    expect(findLayerById(afterUngroupOuter, outer!.id)).toBeNull();
    const restoredInner = findLayerById(afterUngroupOuter, inner!.id) as GroupLayer;
    expect(restoredInner.type).toBe('group');

    const worldAAfterUngroup = computeLayerBBoxWithMatrix(
      findLayerById(afterUngroupOuter, a.id)!,
      getParentWorldMatrix(afterUngroupOuter, a.id)
    );
    const worldCAfterUngroup = computeLayerBBoxWithMatrix(
      findLayerById(afterUngroupOuter, c.id)!,
      getParentWorldMatrix(afterUngroupOuter, c.id)
    );

    expect(worldAAfterUngroup.x).toBeCloseTo(worldAAfterOuterTransform.x, 3);
    expect(worldAAfterUngroup.y).toBeCloseTo(worldAAfterOuterTransform.y, 3);
    expect(worldAAfterUngroup.width).toBeCloseTo(worldAAfterOuterTransform.width, 3);
    expect(worldAAfterUngroup.height).toBeCloseTo(worldAAfterOuterTransform.height, 3);
    expect(worldCAfterUngroup.x).toBeCloseTo(worldCAfterOuterTransform.x, 3);
    expect(worldCAfterUngroup.y).toBeCloseTo(worldCAfterOuterTransform.y, 3);
    expect(innerWorldABefore.width).toBeGreaterThan(0);

    undoCommand();
    expect(findLayerById(useEditorStore.getState().scene.layers, outer!.id)).not.toBeNull();
    redoCommand();
    expect(findLayerById(useEditorStore.getState().scene.layers, outer!.id)).toBeNull();
  });

  it('duplicates groups with unique IDs, syncs with isolation dimming, and round-trips .locus, .svg, .ai, .psd', async () => {
    installPsdCanvasShim();
    const asset = await registerAssetFromBytes({
      bytes: makeMinimalPngBytes(),
      name: 'badge.png',
      mimeType: 'image/png',
    });
    const rect = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 200,
      width: 120,
      height: 80,
      fill: '#da7756',
      stroke: null,
    });
    const img = createImageLayer({
      assetId: asset.id,
      width: asset.naturalWidth,
      height: asset.naturalHeight,
      x: 240,
      y: 200,
    });
    const outside = createShapeLayer({
      preset: 'ellipse',
      x: 520,
      y: 220,
      width: 70,
      height: 70,
      fill: '#0ea5e9',
      stroke: null,
    });

    const grp = groupLayers([rect.id, img.id])!;
    const dupes = duplicateLayers([grp.id], 20, 20);
    expect(dupes).toHaveLength(1);
    const clonedGrp = dupes[0] as GroupLayer;
    expect(clonedGrp.id).not.toBe(grp.id);
    expect(clonedGrp.children.map((c) => c.id)).not.toEqual(
      grp.children.map((c) => c.id)
    );

    const scene = useEditorStore.getState().scene;
    const { scope, sceneLayer } = createPaperHarness();
    const itemMap = syncSceneToPaper(scope, sceneLayer, scene, {
      editingGroupId: grp.id,
    });
    expect(itemMap.get(grp.id)).toBeInstanceOf(scope.Group);
    const outsideItem = itemMap.get(outside.id)!;
    expect(outsideItem.opacity).toBeLessThan(0.5);

    const svg = await sceneToSvg(scene);
    expect(svg).toContain('<g ');

    const aiBytes = await sceneToAiBytes(scene);
    expect(new TextDecoder('ascii').decode(aiBytes.subarray(0, 8))).toContain('%PDF-');

    const psd = await sceneToPsd(scene);
    const psdBytes = serializePsdForJsdom(psd);
    const parsedPsd = readPsd(psdBytes, { useImageData: true, skipThumbnail: true });
    const psdFolder = parsedPsd.children?.find((c) => c.children && c.children.length >= 2);
    expect(psdFolder).toBeDefined();

    const archive = await buildLocusArchive(scene);
    clearAssets();
    const loadedScene = await openLocusFromBytes(archive);
    expect(getAllAssets().length).toBe(1);
    const loadedGroup = findLayerById(loadedScene.layers, grp.id) as GroupLayer;
    expect(loadedGroup.type).toBe('group');
    expect(flattenLayers(loadedScene.layers).length).toBe(
      flattenLayers(scene.layers).length
    );
  });

  it('supports multi-artboard commands, isolation, .locus persistence, and per-artboard/multi-page exports', async () => {
    installPsdCanvasShim();
    const mask1 = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 200,
      width: 140,
      height: 140,
      fill: '#111111',
      stroke: null,
    });
    const masked1 = createShapeLayer({
      preset: 'ellipse',
      x: 210,
      y: 210,
      width: 100,
      height: 100,
      fill: '#da7756',
      stroke: null,
    });
    createClipMaskFromSelection([masked1.id, mask1.id]);

    const ab2 = addArtboard({ name: 'Экран 2', width: 500, height: 500, background: '#f4f4f5' });
    expect(ab2.x).toBeGreaterThan(800);
    expect(getSceneArtboards(useEditorStore.getState().scene)).toHaveLength(2);

    const shape2 = createShapeLayer({
      preset: 'rect',
      x: ab2.x + 150,
      y: ab2.y + 150,
      width: 120,
      height: 90,
      fill: '#2563eb',
      stroke: null,
    });

    updateArtboardById(ab2.id, { name: 'Карточка 2', x: 900, y: 40 });
    expect(
      getSceneArtboards(useEditorStore.getState().scene).find((a) => a.id === ab2.id)?.name
    ).toBe('Карточка 2');

    const ab3 = duplicateArtboard(PRIMARY_ARTBOARD_ID, true);
    expect(ab3).not.toBeNull();
    expect(getSceneArtboards(useEditorStore.getState().scene)).toHaveLength(3);

    const sceneAfterDup = useEditorStore.getState().scene;
    const ab3Scene = extractArtboardScene(sceneAfterDup, ab3!);
    const clonedMasked = ab3Scene.layers.find((l) => l.clipMaskId !== undefined);
    expect(clonedMasked).toBeDefined();
    expect(clonedMasked!.clipMaskId).not.toBe(mask1.id);
    expect(ab3Scene.layers.some((l) => l.id === clonedMasked!.clipMaskId)).toBe(true);

    expect(deleteArtboard(ab3!.id)).toBe(true);
    expect(getSceneArtboards(useEditorStore.getState().scene)).toHaveLength(2);

    undoCommand();
    expect(getSceneArtboards(useEditorStore.getState().scene)).toHaveLength(3);
    redoCommand();
    expect(getSceneArtboards(useEditorStore.getState().scene)).toHaveLength(2);

    expect(deleteArtboard(ab2.id)).toBe(true);
    expect(deleteArtboard(PRIMARY_ARTBOARD_ID)).toBe(false);
    undoCommand();

    const finalScene = useEditorStore.getState().scene;
    expect(getSceneArtboards(finalScene)).toHaveLength(2);

    const svg2 = await sceneToSvg(finalScene, { artboardId: ab2.id });
    expect(svg2).toContain('width="500" height="500"');
    expect(svg2).toContain(shape2.id);
    expect(svg2).not.toContain(masked1.id);

    const psd2 = await sceneToPsd(finalScene, { artboardId: ab2.id });
    const psdBytes2 = serializePsdForJsdom(psd2);
    const parsedPsd2 = readPsd(psdBytes2, { useImageData: true, skipThumbnail: true });
    expect(parsedPsd2.width).toBe(500);
    expect(parsedPsd2.height).toBe(500);

    const multiAiBytes = await sceneToAiBytes(finalScene, { artboardId: 'all' });
    const pdfDoc = await PDFDocument.load(multiAiBytes);
    expect(pdfDoc.getPageCount()).toBe(2);

    const archive = await buildLocusArchive(finalScene);
    const reopened = await openLocusFromBytes(archive);
    expect(getSceneArtboards(reopened)).toHaveLength(2);
    expect(reopened.artboards?.[1].name).toBe('Карточка 2');
  });

  it('registers custom project fonts, converts text to outlines, embeds in SVG/AI/.locus, and clears on reset', async () => {
    const fontBytes = await loadDiskFont('public/fonts/Inter-Regular.ttf');
    expect(inferFontMimeType('sample.ttf')).toBe('font/ttf');
    expect(inferFontMimeType('sample.otf')).toBe('font/otf');
    expect(inferFontMimeType('sample.woff2')).toBe('font/woff2');

    const entry = await registerProjectFontFromBytes({
      bytes: fontBytes,
      fileName: 'CustomFont.ttf',
      family: 'StudioCustom',
    });
    expect(entry.family).toBe('StudioCustom');
    expect(getProjectFonts()).toHaveLength(1);

    const loaded400 = await loadFontBytes('StudioCustom', 400);
    const loaded700 = await loadFontBytes('StudioCustom', 700);
    expect(loaded400.byteLength).toBe(fontBytes.byteLength);
    expect(loaded700.byteLength).toBe(fontBytes.byteLength);

    const unusedText = createTextLayer({
      x: 100,
      y: 120,
      content: 'Builtin',
      fontSize: 36,
      fontFamily: 'Inter',
      fill: '#111111',
    });
    const svgWithoutCustom = await sceneToSvg(useEditorStore.getState().scene);
    expect(svgWithoutCustom).not.toContain('@font-face');

    updateLayers([unusedText.id], { fontFamily: 'StudioCustom', content: 'Abc' });
    const sceneWithCustom = useEditorStore.getState().scene;

    const svgWithCustom = await sceneToSvg(sceneWithCustom);
    expect(svgWithCustom).toContain('<style>@font-face');
    expect(svgWithCustom).toContain('StudioCustom');

    const aiBytes = await sceneToAiBytes(sceneWithCustom);
    expect(new TextDecoder('ascii').decode(aiBytes.subarray(0, 8))).toContain('%PDF-');

    const archive = await buildLocusArchive(sceneWithCustom);
    const zip = await JSZip.loadAsync(archive);
    const zipPaths = Object.keys(zip.files);
    expect(zipPaths).toContain('fonts/manifest.json');
    expect(zipPaths.some((p) => p.startsWith('fonts/') && p !== 'fonts/manifest.json')).toBe(
      true
    );

    clearProjectFonts();
    expect(getProjectFonts()).toHaveLength(0);
    const restored = await openLocusFromBytes(archive);
    expect((restored.layers[0] as Layer & { fontFamily?: string }).fontFamily).toBe(
      'StudioCustom'
    );
    expect(getProjectFonts().some((f) => f.family === 'StudioCustom')).toBe(true);

    const outlines = await convertTextLayersToOutlines([unusedText.id]);
    expect(outlines).toHaveLength(1);
    expect(outlines[0].subpaths.length).toBeGreaterThan(0);

    resetDocument({
      name: 'Clean Doc',
      width: 400,
      height: 400,
      dpi: 72,
      background: '#ffffff',
    });
    expect(getProjectFonts()).toHaveLength(0);
  });
});
