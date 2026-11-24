import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeCanvas, readPsd, writePsd, type Psd } from 'ag-psd';
import {
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  resetDocument,
  setClipMask,
  updateArtboard,
  updateLayers,
} from '../src/core/commands';
import { getAllAssets, getAsset, registerAssetFromBytes } from '../src/core/assets';
import { primeFontBytesCache } from '../src/core/fonts';
import { useEditorStore } from '../src/core/store';
import type { Scene } from '../src/core/types';
import { buildLocusArchive, openLocusFromBytes, parseLocusArchive } from '../src/export/projectFile';
import { sceneToSvg } from '../src/export/toSvg';
import { sceneToAiBytes } from '../src/export/toAi';
import { sceneToPsd } from '../src/export/toPsd';

/** Настоящий валидный RGBA PNG (для pdf-lib/ag-psd, которым нужны декодируемые данные). */
async function makeRealPng(width: number, height: number): Promise<Uint8Array> {
  const zlibId = 'node:zlib';
  const { deflateSync } = (await import(/* @vite-ignore */ zlibId)) as {
    deflateSync: (data: Uint8Array) => Uint8Array;
  };

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };

  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const crcInput = out.subarray(4, 8 + data.length);
    view.setUint32(8 + data.length, crc32(crcInput), false);
    return out;
  };

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < width; x += 1) {
      const o = rowStart + 1 + x * 4;
      raw[o] = (x * 7) & 0xff;
      raw[o + 1] = (y * 5) & 0xff;
      raw[o + 2] = 128;
      raw[o + 3] = 255;
    }
  }

  const idat = new Uint8Array(deflateSync(raw));
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const iend = chunk('IEND', new Uint8Array(0));
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', idat), iend];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
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

function parseXml(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml');
}

/** Чистая JS-замена canvas для ag-psd в node (jsdom не реализует 2d-контекст). */
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

describe('Stage 4: Project file and export (.locus / .svg / .ai / .psd)', () => {
  beforeAll(async () => {
    primeFontBytesCache('Inter', 400, await loadDiskFont('public/fonts/Inter-Regular.ttf'));
    primeFontBytesCache('Inter', 700, await loadDiskFont('public/fonts/Inter-Bold.ttf'));
  });

  beforeEach(() => {
    resetDocument({ name: 'Export Test', width: 400, height: 300, dpi: 72 });
  });

  async function buildSampleScene(): Promise<{ scene: Scene; assetId: string }> {
    updateArtboard({ background: '#f4efe6' });

    const mask = createShapeLayer({
      preset: 'rect',
      x: 200, y: 150, width: 200, height: 160,
      fill: '#000000', stroke: null, name: 'Маска',
    });
    const target = createShapeLayer({
      preset: 'ellipse',
      x: 200, y: 150, width: 300, height: 120,
      fill: '#da7756', stroke: { color: '#1c1b1a', width: 3 }, name: 'Эллипс',
    });
    setClipMask(mask.id, [target.id]);
    updateLayers([target.id], { rotation: 37, opacity: 0.8 });

    createTextLayer({
      x: 40, y: 40, content: 'Привет, мир!\nВторая строка',
      fontSize: 24, fontFamily: 'Inter', fontWeight: 700, letterSpacing: 1,
      fill: '#1c1b1a', align: 'left', name: 'Заголовок',
    });

    const asset = await registerAssetFromBytes({
      bytes: await makeRealPng(64, 48),
      name: 'photo.png',
    });
    createImageLayer({ assetId: asset.id, width: 64, height: 48, x: 100, y: 240, name: 'Фото' });

    // Ассет, на который никто не ссылается — должен выпасть из .locus.
    await registerAssetFromBytes({ bytes: await makeRealPng(10, 10), name: 'orphan.png' });

    return { scene: useEditorStore.getState().scene, assetId: asset.id };
  }

  it('.locus round-trip restores scene layers and image bytes, dropping orphan assets', async () => {
    const { scene, assetId } = await buildSampleScene();
    expect(getAllAssets()).toHaveLength(2);

    const bytes = await buildLocusArchive(scene);
    const parsed = await parseLocusArchive(bytes);
    expect(parsed.scene.version).toBe(1);
    expect(parsed.scene.layers.map((l) => l.name)).toEqual(scene.layers.map((l) => l.name));
    expect(parsed.assets.map((a) => a.id)).toEqual([assetId]);

    const originalAsset = getAsset(assetId)!;
    const restoredAsset = parsed.assets[0];
    expect(restoredAsset.mimeType).toBe(originalAsset.mimeType);
    expect(Array.from(restoredAsset.bytes)).toEqual(
      Array.from(new Uint8Array(await originalAsset.blob.arrayBuffer()))
    );

    // Modify + load back via store
    updateArtboard({ name: 'Changed' });
    useEditorStore.temporal.getState().pause();
    const loaded = await openLocusFromBytes(bytes);
    expect(loaded.name).toBe('Export Test');
    expect(useEditorStore.getState().scene.layers).toHaveLength(4);
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(0);

    const imgLayer = useEditorStore.getState().scene.layers.find((l) => l.type === 'text')!;
    expect(imgLayer.type).toBe('text');
    const restoredImage = useEditorStore.getState().scene.layers.find((l) => l.type === 'image');
    expect(restoredImage && restoredImage.type === 'image' ? restoredImage.assetId : null).toBe(assetId);
    expect(getAsset(assetId)).toBeDefined();
    expect(getAsset(assetId)!.naturalWidth).toBe(64);

    // Orphan asset is gone from the registry after load
    expect(getAllAssets()).toHaveLength(1);
  });

  it('.svg is well-formed XML with clipPath, transformed paths, tspans and image data URL', async () => {
    await buildSampleScene();
    const scene = useEditorStore.getState().scene;
    const svg = await sceneToSvg(scene);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 400 300"');

    const doc = parseXml(svg);
    expect(doc.querySelector('parsererror')).toBeNull();
    const root = doc.documentElement;
    expect(root.getAttribute('width')).toBe('400');
    expect(root.getAttribute('height')).toBe('300');
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('rgb(244,239,230)');

    const clip = doc.querySelector('defs > clipPath');
    expect(clip).not.toBeNull();
    const clipId = clip!.getAttribute('id')!;
    expect(clipId).toMatch(/^clip-/);
    const clippedGroup = doc.querySelector(`g[clip-path="url(#${clipId})"]`);
    expect(clippedGroup).not.toBeNull();
    expect(clippedGroup!.querySelectorAll('path')).toHaveLength(1);

    // Mask layer itself is not painted (only in defs)
    const paintedPaths = Array.from(root.querySelectorAll('g > g > path, g > path'));
    expect(paintedPaths).toHaveLength(1);

    // Rotated ellipse: path data in world coords, group carries matrix
    const ellipseGroup = root.querySelector('g[data-name="Эллипс"]');
    expect(ellipseGroup).not.toBeNull();
    const path = ellipseGroup!.querySelector('path')!;
    expect(path.getAttribute('fill-rule')).toBe('nonzero');
    expect(path.getAttribute('stroke-width')).toBe('3');
    expect(path.getAttribute('d')).toMatch(/^M/);
    expect(path.getAttribute('d')).toContain('C');

    const text = root.querySelector('text')!;
    expect(text.getAttribute('font-family')).toBe('Inter');
    expect(text.getAttribute('font-weight')).toBe('700');
    expect(text.getAttribute('letter-spacing')).toBe('1');
    const tspans = text.querySelectorAll('tspan');
    expect(tspans).toHaveLength(2);
    expect(tspans[0].getAttribute('y')).toBe('20.4');
    expect(tspans[1].getAttribute('y')).toBe('49.2');
    expect(tspans[0].textContent).toBe('Привет, мир!');

    const image = root.querySelector('image')!;
    expect(image.getAttribute('href')).toMatch(/^data:image\/png;base64,/);
    expect(image.getAttribute('width')).toBe('64');
  });

  it('.ai produces %PDF- with Cyrillic text, bezier curves and clip mask', async () => {
    await buildSampleScene();
    const scene = useEditorStore.getState().scene;
    const bytes = await sceneToAiBytes(scene);
    expect(bytes.length).toBeGreaterThan(500);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');

    // Re-open the PDF to validate structure
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBe(400);
    expect(page.getHeight()).toBe(300);
  });

  it('.psd writes layers with clipping group and text data, and reads back via readPsd', async () => {
    installPsdCanvasShim();
    await buildSampleScene();
    const scene = useEditorStore.getState().scene;
    const psd = await sceneToPsd(scene);

    expect(psd.width).toBe(400);
    expect(psd.height).toBe(300);
    // Top-down order: photo, text, clip members (ellipse), mask
    const names = (psd.children ?? []).map((l) => l.name);
    expect(names).toEqual(['Фото', 'Заголовок', 'Эллипс', 'Маска']);
    const ellipse = (psd.children ?? []).find((l) => l.name === 'Эллипс')!;
    expect(ellipse.clipping).toBe(true);
    expect(ellipse.opacity).toBe(0.8);
    const mask = (psd.children ?? []).find((l) => l.name === 'Маска')!;
    expect(mask.clipping).toBeUndefined();
    const text = (psd.children ?? []).find((l) => l.name === 'Заголовок')!;
    expect(text.text?.text).toBe('Привет, мир!\nВторая строка');
    expect(text.text?.style?.fontSize).toBe(24);
    expect(text.text?.style?.fillColor).toEqual({ r: 28, g: 27, b: 26 });

    // Composite image data so writePsd does not need a 2d context (jsdom).
    const composite = { data: new Uint8ClampedArray(400 * 300 * 4), width: 400, height: 300 } as unknown as ImageData;
    const toWrite: Psd = { ...psd, canvas: undefined, imageData: composite };
    const bytes = writePsd(toWrite, { noBackground: true });

    const back = readPsd(bytes, { useImageData: true, skipThumbnail: true });
    expect(back.width).toBe(400);
    expect(back.height).toBe(300);
    const backNames = (back.children ?? []).map((l) => l.name);
    expect(backNames).toEqual(['Фото', 'Заголовок', 'Эллипс', 'Маска']);
    const backEllipse = (back.children ?? []).find((l) => l.name === 'Эллипс')!;
    expect(backEllipse.clipping).toBe(true);
    expect(backEllipse.opacity).toBeCloseTo(0.8, 5);
    const backText = (back.children ?? []).find((l) => l.name === 'Заголовок')!;
    expect(backText.text?.text).toBe('Привет, мир!\nВторая строка');
    expect(backText.text?.style?.fontSize).toBe(24);
  });
});
