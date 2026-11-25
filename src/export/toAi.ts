import fontkit from '@pdf-lib/fontkit';
import {
  extractArtboardScene,
  getActiveArtboard,
  getSceneArtboards,
} from '../core/artboards';
import { getAsset } from '../core/assets';
import { loadFontBytes } from '../core/fonts';
import {
  IDENTITY_MATRIX,
  applyMatrixToPoint,
  clamp,
  computeLayerLocalBBox,
  computeSubPathsBBox,
  degToRad,
  getLayerMatrix,
  multiplyMatrices,
  type Matrix2D,
} from '../core/math';
import {
  computeTextOnPathLocalBBox,
  computeTextOnPathPlacements,
  resolveHostPathLayer,
} from '../engine/textOnPath';
import { getPrimaryColor, isGradientPaint, normalizeGradientStops, resolveGradientEndpoints, sanitizeDashArray } from '../core/paint';
import type {
  BBox,
  BlendMode,
  GradientPaint,
  Layer,
  PathLayer,
  Scene,
  TextLayer,
} from '../core/types';
import {
  PDFDict,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFRef,
} from 'pdf-lib/cjs/core';
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
  setDashPattern,
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
  /** ID артборда или `'all'` для многостраничного `.ai`. */
  artboardId?: string | 'all';
}

function ptPerPx(scene: Scene): number {
  return 72 / Math.max(1, scene.dpi || 72);
}

/** Локальная точка слоя → PDF-точки (Y снизу вверх) с учётом матрицы и ptPerPx. */
function toPdf(worldMatrix: Matrix2D, sceneHeight: number, scale: number) {
  return (pt: { x: number; y: number }): MappedPoint => {
    const w = applyMatrixToPoint(worldMatrix, pt);
    return { x: w.x * scale, y: (sceneHeight - w.y) * scale, lx: pt.x, ly: pt.y };
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

const PDF_BLEND_MODES: Partial<Record<BlendMode, string>> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn',
  'hard-light': 'HardLight',
  'soft-light': 'SoftLight',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

/** Регистрирует ExtGState с прозрачностью и/или blendMode и возвращает его имя (для `gs`). */
function layerGraphicsState(page: PDFPage, layer: Layer): string | null {
  const hasOpacity = layer.opacity < 1;
  const pdfBm =
    layer.blendMode && layer.blendMode !== 'normal'
      ? PDF_BLEND_MODES[layer.blendMode]
      : undefined;
  if (!hasOpacity && !pdfBm) return null;

  const entries: Record<string, PDFName | number> = {
    Type: PDFName.of('ExtGState'),
  };
  if (hasOpacity) {
    const op = clamp(layer.opacity, 0, 1);
    entries.ca = op;
    entries.CA = op;
  }
  if (pdfBm) {
    entries.BM = PDFName.of(pdfBm);
  }
  const dict = page.doc.context.obj(entries);
  return page.node.newExtGState('GS', dict).toString();
}

function buildGradientFunction(doc: PDFDocument, grad: GradientPaint): PDFRef {
  let stops = normalizeGradientStops(grad.stops);
  if (stops[0].offset > 1e-6) {
    stops = [{ ...stops[0], offset: 0 }, ...stops];
  }
  if (stops[stops.length - 1].offset < 1 - 1e-6) {
    stops = [...stops, { ...stops[stops.length - 1], offset: 1 }];
  }

  const segments: Array<{
    from: [number, number, number];
    to: [number, number, number];
    endOffset: number;
  }> = [];

  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (b.offset - a.offset <= 1e-6) continue;
    const ca = parseColorToRgba(a.color) ?? [0, 0, 0, 1];
    const cb = parseColorToRgba(b.color) ?? [0, 0, 0, 1];
    segments.push({
      from: [ca[0] / 255, ca[1] / 255, ca[2] / 255],
      to: [cb[0] / 255, cb[1] / 255, cb[2] / 255],
      endOffset: b.offset,
    });
  }

  if (segments.length <= 1) {
    const seg = segments[0] ?? {
      from: [0, 0, 0] as [number, number, number],
      to: [1, 1, 1] as [number, number, number],
    };
    return doc.context.register(
      doc.context.obj({
        FunctionType: 2,
        Domain: [0, 1],
        C0: seg.from,
        C1: seg.to,
        N: 1,
      })
    );
  }

  const fnRefs = segments.map((seg) =>
    doc.context.register(
      doc.context.obj({
        FunctionType: 2,
        Domain: [0, 1],
        C0: seg.from,
        C1: seg.to,
        N: 1,
      })
    )
  );
  const bounds = segments.slice(0, -1).map((seg) => seg.endOffset);
  const encode: number[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    encode.push(0, 1);
  }

  return doc.context.register(
    doc.context.obj({
      FunctionType: 3,
      Domain: [0, 1],
      Functions: fnRefs,
      Bounds: bounds,
      Encode: encode,
    })
  );
}

function registerGradientPattern(
  page: PDFPage,
  grad: GradientPaint,
  worldMatrix: Matrix2D,
  localBox: BBox,
  sceneHeight: number,
  scale: number,
  counterRef: { value: number }
): string {
  const map = toPdf(worldMatrix, sceneHeight, scale);
  const endpoints = resolveGradientEndpoints(grad, localBox);
  const p0 = map(endpoints.origin);
  const p1 = map(endpoints.destination);
  const fnRef = buildGradientFunction(page.doc, grad);

  const shading =
    grad.kind === 'radial'
      ? page.doc.context.obj({
          ShadingType: 3,
          ColorSpace: PDFName.of('DeviceRGB'),
          Coords: [
            p0.x,
            p0.y,
            0,
            p0.x,
            p0.y,
            Math.max(0.001, Math.hypot(p1.x - p0.x, p1.y - p0.y)),
          ],
          Function: fnRef,
          Extend: [true, true],
        })
      : page.doc.context.obj({
          ShadingType: 2,
          ColorSpace: PDFName.of('DeviceRGB'),
          Coords: [p0.x, p0.y, p1.x, p1.y],
          Function: fnRef,
          Extend: [true, true],
        });

  const shadingRef = page.doc.context.register(shading);
  const pattern = page.doc.context.obj({
    Type: PDFName.of('Pattern'),
    PatternType: 2,
    Shading: shadingRef,
  });
  const patternRef = page.doc.context.register(pattern);

  counterRef.value += 1;
  const keyName = `P${counterRef.value}`;
  const resources = page.node.normalizedEntries().Resources;
  let patternDict = resources.lookupMaybe(PDFName.of('Pattern'), PDFDict);
  if (!patternDict) {
    patternDict = page.doc.context.obj({});
    resources.set(PDFName.of('Pattern'), patternDict);
  }
  patternDict.set(PDFName.of(keyName), patternRef);
  return keyName;
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
function tracePath(
  page: PDFPage,
  layer: PathLayer,
  worldMatrix: Matrix2D,
  sceneHeight: number,
  scale: number
): void {
  const map = toPdf(worldMatrix, sceneHeight, scale);
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
function paintPath(
  page: PDFPage,
  layer: PathLayer,
  worldMatrix: Matrix2D,
  sceneHeight: number,
  scale: number,
  graphicsState: string | null,
  patternCounter: { value: number }
): void {
  const hasFill = Boolean(layer.fill);
  const hasStroke = Boolean(layer.stroke && layer.stroke.width > 0);
  const localBox = computeSubPathsBBox(layer.subpaths);

  page.pushOperators(pushGraphicsState());
  if (graphicsState) {
    page.pushOperators(setGraphicsState(graphicsState));
  }

  if (hasFill) {
    if (isGradientPaint(layer.fill)) {
      const patternName = registerGradientPattern(
        page,
        layer.fill,
        worldMatrix,
        localBox,
        sceneHeight,
        scale,
        patternCounter
      );
      page.pushOperators(
        PDFOperator.of(PDFOperatorNames.NonStrokingColorspace, [
          PDFName.of('Pattern'),
        ]),
        PDFOperator.of(PDFOperatorNames.NonStrokingColorN, [
          PDFName.of(patternName),
        ])
      );
    } else {
      const c = toRgb(layer.fill as string);
      page.pushOperators(setFillingRgbColor(c.red, c.green, c.blue));
    }
  }
  if (hasStroke) {
    const s = layer.stroke!;
    if (isGradientPaint(s.color)) {
      const patternName = registerGradientPattern(
        page,
        s.color,
        worldMatrix,
        localBox,
        sceneHeight,
        scale,
        patternCounter
      );
      page.pushOperators(
        PDFOperator.of(PDFOperatorNames.StrokingColorspace, [
          PDFName.of('Pattern'),
        ]),
        PDFOperator.of(PDFOperatorNames.StrokingColorN, [
          PDFName.of(patternName),
        ])
      );
    } else {
      const c = toRgb(s.color);
      page.pushOperators(setStrokingRgbColor(c.red, c.green, c.blue));
    }
    page.pushOperators(
      setLineWidth(s.width * scale),
      setLineCap(lineCapStyle(s.lineCap)),
      setLineJoin(lineJoinStyle(s.lineJoin))
    );
    const dash = sanitizeDashArray(s.dashArray);
    if (dash) {
      page.pushOperators(
        setDashPattern(
          dash.map((v) => v * scale),
          (s.dashOffset ?? 0) * scale
        )
      );
    }
  }

  tracePath(page, layer, worldMatrix, sceneHeight, scale);

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

  page.pushOperators(popGraphicsState());
}

/** Контур маски как clipping path (`W n` / `W* n`). */
function traceClipMask(
  page: PDFPage,
  mask: PathLayer,
  worldMatrix: Matrix2D,
  sceneHeight: number,
  scale: number
): void {
  tracePath(page, mask, worldMatrix, sceneHeight, scale);
  page.pushOperators(mask.fillRule === 'evenodd' ? clipEvenOdd() : clip(), endPath());
}

interface FontCache {
  doc: PDFDocument;
  fonts: Map<string, PDFFont>;
  pageNames: WeakMap<PDFPage, Map<PDFFont, string>>;
}

async function resolveFont(
  page: PDFPage,
  layer: TextLayer,
  cache: FontCache
): Promise<{ font: PDFFont; resourceName: string }> {
  const key = `${layer.fontFamily}:${layer.fontWeight}`;
  let font = cache.fonts.get(key);
  if (!font) {
    const bytes = await loadFontBytes(layer.fontFamily, layer.fontWeight);
    font = await cache.doc.embedFont(bytes, { subset: true });
    cache.fonts.set(key, font);
  }
  let pageMap = cache.pageNames.get(page);
  if (!pageMap) {
    pageMap = new Map();
    cache.pageNames.set(page, pageMap);
  }
  let resourceName = pageMap.get(font);
  if (!resourceName) {
    resourceName = fontResourceName(page, font);
    pageMap.set(font, resourceName);
  }
  return { font, resourceName };
}

/**
 * Текст: матрица `T·R·S` в PDF-координатах, построчный вывод через единый `baselineY`.
 */
function drawTextLayer(
  page: PDFPage,
  layer: TextLayer,
  worldMatrix: Matrix2D,
  font: PDFFont,
  resourceName: string,
  sceneHeight: number,
  scale: number,
  graphicsState: string | null,
  patternCounter: { value: number },
  sceneLayers: Layer[]
): void {
  const hostPath = resolveHostPathLayer(sceneLayers, layer.pathId);
  const localBox = hostPath
    ? computeTextOnPathLocalBBox(layer, hostPath, sceneLayers)
    : computeLayerLocalBBox(layer);
  const lines = (layer.content || '').split('\n');
  const size = layer.fontSize * scale;
  const tracking = (layer.letterSpacing ?? 0) * scale;
  const a = worldMatrix.a;
  const b = -worldMatrix.b;
  const c = -worldMatrix.c;
  const d = worldMatrix.d;

  const fillPatternName = isGradientPaint(layer.fill)
    ? registerGradientPattern(
        page,
        layer.fill,
        worldMatrix,
        localBox,
        sceneHeight,
        scale,
        patternCounter
      )
    : null;

  const hasStroke = Boolean(layer.stroke && layer.stroke.width > 0);
  const strokeColor =
    hasStroke && layer.stroke
      ? toRgb(getPrimaryColor(layer.stroke.color, '#1c1b1a'))
      : null;

  const emitTextPass = (isStrokePass: boolean) => {
    page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginText));
    if (isStrokePass && layer.stroke && strokeColor) {
      page.pushOperators(
        PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [num(1)]),
        setStrokingRgbColor(strokeColor.red, strokeColor.green, strokeColor.blue),
        setLineWidth(layer.stroke.width * scale),
        setLineCap(lineCapStyle(layer.stroke.lineCap)),
        setLineJoin(lineJoinStyle(layer.stroke.lineJoin))
      );
    } else {
      page.pushOperators(
        PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [num(0)])
      );
      if (fillPatternName) {
        page.pushOperators(
          PDFOperator.of(PDFOperatorNames.NonStrokingColorspace, [
            PDFName.of('Pattern'),
          ]),
          PDFOperator.of(PDFOperatorNames.NonStrokingColorN, [
            PDFName.of(fillPatternName),
          ])
        );
      } else {
        const fillColor = toRgb(layer.fill as string);
        page.pushOperators(
          setFillingRgbColor(fillColor.red, fillColor.green, fillColor.blue)
        );
      }
    }
    page.pushOperators(
      setFontAndSizeOp(resourceName, size),
      PDFOperator.of(PDFOperatorNames.SetCharacterSpacing, [num(hostPath ? 0 : tracking)])
    );

    if (hostPath) {
      const placements = computeTextOnPathPlacements(
        layer,
        hostPath,
        (ch) => Math.max(0.5, font.widthOfTextAtSize(ch, size) / scale),
        sceneLayers
      );
      for (const p of placements) {
        const rad = degToRad(p.angleDeg);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const startX = p.x - cos * (p.advance / 2);
        const startY = p.y - sin * (p.advance / 2);
        const gm = multiplyMatrices(worldMatrix, {
          a: cos,
          b: sin,
          c: -sin,
          d: cos,
          tx: startX,
          ty: startY,
        });
        const px = gm.tx * scale;
        const py = (sceneHeight - gm.ty) * scale;
        page.pushOperators(
          PDFOperator.of(PDFOperatorNames.SetTextMatrix, [
            num(gm.a),
            num(-gm.b),
            num(-gm.c),
            num(gm.d),
            num(px),
            num(py),
          ]),
          PDFOperator.of(PDFOperatorNames.ShowText, [font.encodeText(p.char)])
        );
      }
    } else {
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const baselineY = layer.fontSize * 0.85 + i * layer.fontSize * layer.lineHeight;
        const widthPx =
          font.widthOfTextAtSize(line, size) / scale +
          Math.max(0, line.length - 1) * (layer.letterSpacing ?? 0);
        const shiftX = layer.align === 'center' ? -widthPx / 2 : layer.align === 'right' ? -widthPx : 0;
        const anchor = applyMatrixToPoint(worldMatrix, { x: shiftX, y: baselineY });
        const px = anchor.x * scale;
        const py = (sceneHeight - anchor.y) * scale;
        page.pushOperators(
          PDFOperator.of(PDFOperatorNames.SetTextMatrix, [num(a), num(b), num(c), num(d), num(px), num(py)]),
          PDFOperator.of(PDFOperatorNames.ShowText, [font.encodeText(line)])
        );
      }
    }
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndText));
  };

  page.pushOperators(pushGraphicsState());
  if (graphicsState) {
    page.pushOperators(setGraphicsState(graphicsState));
  }
  if (hasStroke) {
    emitTextPass(true);
  }
  emitTextPass(false);
  page.pushOperators(popGraphicsState());
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

function collectMaskLayersInList(layers: Layer[]): PathLayer[] {
  const byId = new Map(layers.map((l) => [l.id, l] as const));
  const result: PathLayer[] = [];
  const seen = new Set<string>();
  for (const layer of layers) {
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
  worldMatrix: Matrix2D,
  doc: PDFDocument,
  sceneHeight: number,
  scale: number,
  opacity: string | null
): Promise<void> {
  const entry = getAsset(layer.assetId);
  if (!entry) return;
  const bytes = new Uint8Array(await entry.blob.arrayBuffer());
  const image = await embedImage(doc, bytes, entry.mimeType);

  const a = worldMatrix.a;
  const b = -worldMatrix.b;
  const c = -worldMatrix.c;
  const d = worldMatrix.d;
  const center = applyMatrixToPoint(worldMatrix, { x: 0, y: 0 });
  const cx = center.x * scale;
  const cy = (sceneHeight - center.y) * scale;

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

async function drawLayerList(
  page: PDFPage,
  doc: PDFDocument,
  layers: Layer[],
  sceneHeight: number,
  scale: number,
  parentMatrix: Matrix2D,
  fontCache: FontCache,
  patternCounter: { value: number },
  sceneLayers: Layer[] = layers
): Promise<void> {
  const maskLayers = collectMaskLayersInList(layers);
  const maskLayerIds = new Set(maskLayers.map((m) => m.id));

  let activeClip: PathLayer | null = null;
  let clipOpen = false;
  const closeClip = () => {
    if (clipOpen) {
      page.pushOperators(popGraphicsState());
      clipOpen = false;
    }
    activeClip = null;
  };

  for (const layer of layers) {
    if (maskLayerIds.has(layer.id) || !layer.visible) continue;

    const mask = layer.clipMaskId
      ? maskLayers.find((m) => m.id === layer.clipMaskId)
      : undefined;
    if (mask && mask !== activeClip) {
      closeClip();
      page.pushOperators(pushGraphicsState());
      traceClipMask(
        page,
        mask,
        multiplyMatrices(parentMatrix, getLayerMatrix(mask)),
        sceneHeight,
        scale
      );
      clipOpen = true;
      activeClip = mask;
    } else if (!mask && clipOpen) {
      closeClip();
    }

    const worldMatrix = multiplyMatrices(parentMatrix, getLayerMatrix(layer));
    const graphicsState = layerGraphicsState(page, layer);

    if (layer.type === 'group') {
      page.pushOperators(pushGraphicsState());
      if (graphicsState) {
        page.pushOperators(setGraphicsState(graphicsState));
      }
      await drawLayerList(
        page,
        doc,
        layer.children,
        sceneHeight,
        scale,
        worldMatrix,
        fontCache,
        patternCounter,
        sceneLayers
      );
      page.pushOperators(popGraphicsState());
    } else if (layer.type === 'path') {
      paintPath(page, layer, worldMatrix, sceneHeight, scale, graphicsState, patternCounter);
    } else if (layer.type === 'text') {
      const { font, resourceName } = await resolveFont(page, layer, fontCache);
      drawTextLayer(
        page,
        layer,
        worldMatrix,
        font,
        resourceName,
        sceneHeight,
        scale,
        graphicsState,
        patternCounter,
        sceneLayers
      );
    } else {
      await drawImageLayer(
        page,
        layer,
        worldMatrix,
        doc,
        sceneHeight,
        scale,
        graphicsState
      );
    }
  }
  closeClip();
}

async function renderScenePage(
  doc: PDFDocument,
  pageScene: Scene,
  options: AiExportOptions,
  fontCache: FontCache
): Promise<void> {
  const scale = ptPerPx(pageScene);
  const page = doc.addPage([pageScene.width * scale, pageScene.height * scale]);

  if (options.includeBackground !== false) {
    const bg = toRgb(pageScene.background);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageScene.width * scale,
      height: pageScene.height * scale,
      color: bg,
    });
  }

  const patternCounter = { value: 0 };
  await drawLayerList(
    page,
    doc,
    pageScene.layers,
    pageScene.height,
    scale,
    IDENTITY_MATRIX,
    fontCache,
    patternCounter
  );
}

/**
 * Собирает PDF-документ (поток, совместимый с Adobe Illustrator) из `Scene`.
 */
export async function sceneToAiPdf(
  scene: Scene,
  options: AiExportOptions = {}
): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(scene.name);
  const fontCache: FontCache = {
    doc,
    fonts: new Map(),
    pageNames: new WeakMap(),
  };

  if (options.artboardId === 'all') {
    for (const ab of getSceneArtboards(scene)) {
      await renderScenePage(doc, extractArtboardScene(scene, ab), options, fontCache);
    }
  } else if (options.artboardId) {
    const ab = getActiveArtboard(scene, options.artboardId);
    await renderScenePage(doc, extractArtboardScene(scene, ab), options, fontCache);
  } else {
    await renderScenePage(doc, scene, options, fontCache);
  }

  return doc;
}

export async function sceneToAiBytes(scene: Scene, options: AiExportOptions = {}): Promise<Uint8Array> {
  const doc = await sceneToAiPdf(scene, options);
  return doc.save();
}
