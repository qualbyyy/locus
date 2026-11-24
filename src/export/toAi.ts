import fontkit from '@pdf-lib/fontkit';
import { getAsset } from '../core/assets';
import { loadFontBytes } from '../core/fonts';
import { localToWorld, type LayerTransform } from '../core/math';
import type { Layer, PathLayer, Scene, TextLayer } from '../core/types';
import { PDFOperator, PDFOperatorNames, PDFNumber } from 'pdf-lib/cjs/core';
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  rgb,
  appendBezierCurve,
  clip,
  clipEvenOdd,
  closePath,
  endPath,
  fill,
  fillAndStroke,
  LineCapStyle,
  LineJoinStyle,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from 'pdf-lib';
import {
  isLinearCubic,
  parseColorToRgba,
  subPathToCubicSegments,
  type MappedPoint,
} from './pathData';

export interface AiExportOptions {
  /** Вписать фон артборда первым прямоугольником (по умолчанию `true`). */
  includeBackground?: boolean;
}

function ptPerPx(scene: Scene): number {
  return 72 / Math.max(1, scene.dpi || 72);
}

/** Локальная точка слоя → PDF-точки (Y снизу вверх) с учётом ptPerPx. */
function toPdf(layer: LayerTransform, scene: Scene, scale: number) {
  const h = scene.height;
  return (pt: { x: number; y: number }): MappedPoint => {
    const w = localToWorld(layer, pt);
    return { x: w.x * scale, y: (h - w.y) * scale, lx: pt.x, ly: pt.y };
  };
}

function toRgb(color: string) {
  const rgba = parseColorToRgba(color);
  if (!rgba) return rgb(0, 0, 0);
  return rgb(rgba[0] / 255, rgba[1] / 255, rgba[2] / 255);
}

function lineCapStyle(cap: 'butt' | 'round' | 'square' | undefined): LineCapStyle {
  if (cap === 'butt') return LineCapStyle.Butt;
  if (cap === 'square') return LineCapStyle.Projecting;
  return LineCapStyle.Round;
}

function lineJoinStyle(join: 'miter' | 'round' | 'bevel' | undefined): LineJoinStyle {
  if (join === 'miter') return LineJoinStyle.Miter;
  if (join === 'bevel') return LineJoinStyle.Bevel;
  return LineJoinStyle.Round;
}

/** Регистрирует ExtGState с прозрачностью и возвращает его имя (для `gs`). */
function opacityState(page: PDFPage, opacity: number): string {
  const dict = page.doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity });
  return page.node.newExtGState('GS', dict).toString();
}

/** Имя шрифта в ресурсах страницы (регистрирует словарь при первом использовании). */
function fontResourceName(page: PDFPage, font: PDFFont): string {
  const key = page.node.newFontDictionary('F', font.ref);
  return key.toString();
}

/** Числовой аргумент low-level оператора. */
function num(value: number): PDFNumber {
  return PDFNumber.of(value);
}

/** Обводит все subpath слоя операторами `m` / `l` / `c` (+ `h` для замкнутых). */
function tracePath(page: PDFPage, layer: PathLayer, scene: Scene, scale: number): void {
  const map = toPdf(layer, scene, scale);
  for (const subpath of layer.subpaths) {
    const segments = subPathToCubicSegments(subpath, map);
    if (segments.length === 0) continue;
    page.pushOperators(moveTo(segments[0].start.x, segments[0].start.y));
    for (const seg of segments) {
      if (isLinearCubic(seg)) {
        page.pushOperators(PDFOperator.of(PDFOperatorNames.LineTo, [num(seg.end.x), num(seg.end.y)]));
      } else {
        page.pushOperators(
          appendBezierCurve(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y)
        );
      }
    }
    if (subpath.closed) {
      page.pushOperators(closePath());
    }
  }
}

/** Заливка/обводка: `f` / `f*` / `S` / `B` / `B*` / `n`. */
function paintPath(page: PDFPage, layer: PathLayer, scene: Scene, scale: number): void {
  const hasFill = Boolean(layer.fill);
  const hasStroke = Boolean(layer.stroke && layer.stroke.width > 0);
  if (hasFill) {
    const c = toRgb(layer.fill as string);
    page.pushOperators(setFillingRgbColor(c.red, c.green, c.blue));
  }
  if (hasStroke) {
    const s = layer.stroke!;
    const c = toRgb(s.color);
    page.pushOperators(
      setStrokingRgbColor(c.red, c.green, c.blue),
      setLineWidth(s.width * scale),
      setLineCap(lineCapStyle(s.lineCap)),
      setLineJoin(lineJoinStyle(s.lineJoin))
    );
  }

  tracePath(page, layer, scene, scale);

  const evenOdd = layer.fillRule === 'evenodd';
  if (hasFill && hasStroke) {
    page.pushOperators(
      evenOdd ? PDFOperator.of(PDFOperatorNames.FillEvenOddAndStroke) : fillAndStroke()
    );
  } else if (hasFill) {
    page.pushOperators(evenOdd ? PDFOperator.of(PDFOperatorNames.FillEvenOdd) : fill());
  } else if (hasStroke) {
    page.pushOperators(stroke());
  } else {
    page.pushOperators(endPath());
  }
}

/** Контур маски как clipping path (`W n` / `W* n`). */
function traceClipMask(page: PDFPage, mask: PathLayer, scene: Scene, scale: number): void {
  tracePath(page, mask, scene, scale);
  page.pushOperators(mask.fillRule === 'evenodd' ? clipEvenOdd() : clip(), endPath());
}

interface FontCache {
  doc: PDFDocument;
  fonts: Map<string, { font: PDFFont; resourceName: string }>;
}

async function resolveFont(
  page: PDFPage,
  layer: TextLayer,
  cache: FontCache
): Promise<{ font: PDFFont; resourceName: string }> {
  const key = `${layer.fontFamily}:${layer.fontWeight}`;
  const cached = cache.fonts.get(key);
  if (cached) return cached;
  const bytes = await loadFontBytes(layer.fontFamily, layer.fontWeight);
  const font = await cache.doc.embedFont(bytes, { subset: true });
  const entry = { font, resourceName: fontResourceName(page, font) };
  cache.fonts.set(key, entry);
  return entry;
}

/**
 * Текст: матрица `T·R·S` в PDF-координатах, построчный вывод через единый `baselineY`.
 * В PDF ось Y вверх, поэтому экранный поворот по часовой → против часовой.
 */
function drawTextLayer(
  page: PDFPage,
  layer: TextLayer,
  font: PDFFont,
  resourceName: string,
  scene: Scene,
  scale: number,
  opacity: string | null
): void {
  const lines = (layer.content || '').split('\n');
  const size = layer.fontSize * scale;
  const tracking = (layer.letterSpacing ?? 0) * scale;
  const rad = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = layer.scaleX * cos;
  const b = -layer.scaleX * sin;
  const c = layer.scaleY * sin;
  const d = layer.scaleY * cos;
  const fillColor = toRgb(layer.fill);

  page.pushOperators(pushGraphicsState());
  if (opacity) {
    page.pushOperators(setGraphicsState(opacity));
  }
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.BeginText),
    setFillingRgbColor(fillColor.red, fillColor.green, fillColor.blue),
    setFontAndSizeOp(resourceName, size),
    PDFOperator.of(PDFOperatorNames.SetCharacterSpacing, [num(tracking)])
  );

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const baselineY = layer.fontSize * 0.85 + i * layer.fontSize * layer.lineHeight;
    const widthPx =
      font.widthOfTextAtSize(line, size) / scale +
      Math.max(0, line.length - 1) * (layer.letterSpacing ?? 0);
    const shiftX = layer.align === 'center' ? -widthPx / 2 : layer.align === 'right' ? -widthPx : 0;
    const anchor = localToWorld(layer, { x: shiftX, y: baselineY });
    const px = anchor.x * scale;
    const py = (scene.height - anchor.y) * scale;
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.SetTextMatrix, [num(a), num(b), num(c), num(d), num(px), num(py)]),
      PDFOperator.of(PDFOperatorNames.ShowText, [font.encodeText(line)])
    );
  }

  page.pushOperators(PDFOperator.of(PDFOperatorNames.EndText), popGraphicsState());
}

function setFontAndSizeOp(resourceName: string, size: number) {
  return PDFOperator.of(PDFOperatorNames.SetFontAndSize, [resourceName, num(size)]);
}

/** Картинка: PNG/JPEG напрямую, остальное перекодируется в PNG через offscreen canvas. */
async function embedImage(
  doc: PDFDocument,
  bytes: Uint8Array,
  mimeType: string
): Promise<PDFImage> {
  if (mimeType === 'image/png' || isPngSignature(bytes)) {
    return doc.embedPng(bytes);
  }
  if (mimeType === 'image/jpeg' || isJpegSignature(bytes)) {
    return doc.embedJpg(bytes);
  }
  const pngBytes = await transcodeToPng(bytes, mimeType);
  return doc.embedPng(pngBytes);
}

function isPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isJpegSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function transcodeToPng(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error(`Формат ${mimeType} требует перекодирования в PNG (недоступно без canvas)`));
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
      type: mimeType,
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось создать canvas для перекодирования изображения'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (pngBlob) => {
          if (!pngBlob) {
            reject(new Error('Не удалось перекодировать изображение в PNG'));
            return;
          }
          pngBlob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
        },
        'image/png'
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Не удалось декодировать изображение (${mimeType})`));
    };
    img.src = url;
  });
}

function collectMaskLayers(scene: Scene): PathLayer[] {
  const byId = new Map(scene.layers.map((l) => [l.id, l] as const));
  const result: PathLayer[] = [];
  const seen = new Set<string>();
  for (const layer of scene.layers) {
    if (!layer.clipMaskId || seen.has(layer.clipMaskId)) continue;
    const mask = byId.get(layer.clipMaskId);
    if (mask?.type === 'path') {
      result.push(mask);
      seen.add(mask.id);
    }
  }
  return result;
}

async function drawImageLayer(
  page: PDFPage,
  layer: Layer & { type: 'image' },
  doc: PDFDocument,
  scene: Scene,
  scale: number,
  opacity: string | null
): Promise<void> {
  const entry = getAsset(layer.assetId);
  if (!entry) return;
  const bytes = new Uint8Array(await entry.blob.arrayBuffer());
  const image = await embedImage(doc, bytes, entry.mimeType);

  // Картинка рисуется в локальных координатах [-w/2..w/2] и затем трансформируется матрицей слоя.
  const rad = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = layer.scaleX * cos;
  const b = -layer.scaleX * sin;
  const c = layer.scaleY * sin;
  const d = layer.scaleY * cos;
  const center = localToWorld(layer, { x: 0, y: 0 });
  const cx = center.x * scale;
  const cy = (scene.height - center.y) * scale;

  page.pushOperators(pushGraphicsState());
  if (opacity) {
    page.pushOperators(setGraphicsState(opacity));
  }
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [
      num(a),
      num(b),
      num(c),
      num(d),
      num(cx - (a * layer.width * scale) / 2 - (c * layer.height * scale) / 2),
      num(cy - (b * layer.width * scale) / 2 - (d * layer.height * scale) / 2),
    ])
  );
  page.drawImage(image, { x: 0, y: 0, width: layer.width * scale, height: layer.height * scale });
  page.pushOperators(popGraphicsState());
}

function opacityFor(page: PDFPage, layer: Layer): string | null {
  return layer.opacity < 1 ? opacityState(page, layer.opacity) : null;
}

/**
 * Собирает PDF-документ (поток, совместимый с Adobe Illustrator) из `Scene`.
 * Порядок: фон → для каждой клип-группы `q` + маска `W n` + слои + `Q`.
 */
export async function sceneToAiPdf(
  scene: Scene,
  options: AiExportOptions = {}
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(scene.name);
  const scale = ptPerPx(scene);
  const page = doc.addPage([scene.width * scale, scene.height * scale]);
  const fontCache: FontCache = { doc, fonts: new Map() };

  if (options.includeBackground !== false) {
    const bg = toRgb(scene.background);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: scene.width * scale,
      height: scene.height * scale,
      color: bg,
    });
  }

  const maskLayers = collectMaskLayers(scene);
  const maskLayerIds = new Set<string>();
  for (const m of maskLayers) maskLayerIds.add(m.id);

  let activeClip: PathLayer | null = null;
  let clipOpen = false;

  const closeClip = () => {
    if (clipOpen) {
      page.pushOperators(popGraphicsState());
      clipOpen = false;
    }
    activeClip = null;
  };

  for (const layer of scene.layers) {
    if (maskLayerIds.has(layer.id) || !layer.visible) continue;

    const mask = layer.clipMaskId ? maskLayers.find((m) => m.id === layer.clipMaskId) : undefined;
    if (mask && mask !== activeClip) {
      closeClip();
      page.pushOperators(pushGraphicsState());
      traceClipMask(page, mask, scene, scale);
      clipOpen = true;
      activeClip = mask;
    } else if (!mask && clipOpen) {
      closeClip();
    }

    const opacity = opacityFor(page, layer);
    if (layer.type === 'path') {
      if (opacity) page.pushOperators(pushGraphicsState(), setGraphicsState(opacity));
      paintPath(page, layer, scene, scale);
      if (opacity) page.pushOperators(popGraphicsState());
    } else if (layer.type === 'text') {
      const { font, resourceName } = await resolveFont(page, layer, fontCache);
      drawTextLayer(page, layer, font, resourceName, scene, scale, opacity);
    } else {
      await drawImageLayer(page, layer, doc, scene, scale, opacity);
    }
  }
  closeClip();

  return doc;
}

export async function sceneToAiBytes(scene: Scene, options: AiExportOptions = {}): Promise<Uint8Array> {
  const doc = await sceneToAiPdf(scene, options);
  return doc.save();
}
