import {
  addLayer,
  alignLayers,
  booleanLayers,
  createShapeLayer,
  createTextLayer,
  createLayerId,
  deleteLayers,
  duplicateLayers,
  reorderLayer,
  setClipMask,
  updateArtboard,
  updateLayers,
  updatePathSubpaths,
  type AlignMode,
} from '../core/commands';
import { useEditorStore } from '../core/store';
import type {
  BuiltinFontFamily,
  Layer,
  PathLayer,
  SmartShapeOptions,
  SmartShapePreset,
  StrokeStyle,
} from '../core/types';
import { randomizeAnchors } from '../engine/geometry';
import type { BooleanOp } from '../engine/booleans';
import type { ToolDefinition } from './types';

const FONT_FAMILIES: BuiltinFontFamily[] = [
  'Inter',
  'Manrope',
  'Golos Text',
  'Playfair Display',
  'JetBrains Mono',
  'Unbounded',
];

const ALIGN_MODES: AlignMode[] = [
  'left',
  'center',
  'right',
  'top',
  'middle',
  'bottom',
  'distribute_h',
  'distribute_v',
  'artboard_center',
];

const BOOLEAN_OPS: BooleanOp[] = ['unite', 'subtract', 'intersect', 'exclude'];

const PRESETS: SmartShapePreset[] = ['ellipse', 'rect', 'polygon', 'star'];

export const TOOL_LABELS: Record<string, string> = {
  create_blob: 'Клякса',
  create_shape: 'Фигура',
  create_text: 'Текст',
  create_line: 'Линия',
  update_layers: 'Изменение слоёв',
  delete_layers: 'Удаление слоёв',
  duplicate_layers: 'Дублирование',
  reorder_layers: 'Порядок слоёв',
  set_clip_mask: 'Маска',
  randomize_anchors: 'Искажение узлов',
  align_layers: 'Выравнивание',
  apply_palette: 'Палитра',
  boolean_op: 'Булева операция',
};

class ToolError extends Error {}

function fail(message: string): never {
  throw new ToolError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${what}: ожидается объект`);
  }
  return value;
}

function readStringValue(raw: unknown, what: string, maxLength = 4000): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    fail(`${what}: ожидается непустая строка`);
  }
  const value = raw.trim();
  if (value.length > maxLength) {
    fail(`${what}: строка длиннее ${maxLength} символов`);
  }
  return value;
}

function readFontWeight(raw: unknown, what: string): 400 | 700 {
  const value =
    typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (value !== 400 && value !== 700) {
    fail(`${what}: допустимо 400 или 700`);
  }
  return value;
}

function optionalFontWeight(
  args: Record<string, unknown>,
  key: string
): 400 | 700 | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  return readFontWeight(raw, key);
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
  maxLength = 4000
): string | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  return readStringValue(raw, key, maxLength);
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
  maxLength = 4000
): string {
  return readStringValue(args[key], key, maxLength);
}

function readNumberValue(raw: unknown, what: string, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    fail(`${what}: ожидается число`);
  }
  if (raw < min || raw > max) {
    fail(`${what}: допустимый диапазон ${min}..${max}`);
  }
  return raw;
}

function requiredNumber(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number {
  return readNumberValue(args[key], key, min, max);
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fallback: number
): number {
  const raw = args[key];
  if (raw === undefined || raw === null) return fallback;
  return readNumberValue(raw, key, min, max);
}

function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const raw = args[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'boolean') fail(`${key}: ожидается true или false`);
  return raw;
}

function requiredEnum<T extends string | number>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T {
  const raw = args[key];
  if (
    (typeof raw !== 'string' && typeof raw !== 'number') ||
    !values.includes(raw as T)
  ) {
    fail(`${key}: допустимые значения — ${values.join(', ')}`);
  }
  return raw as T;
}

function optionalEnum<T extends string | number>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  if (
    (typeof raw !== 'string' && typeof raw !== 'number') ||
    !values.includes(raw as T)
  ) {
    fail(`${key}: допустимые значения — ${values.join(', ')}`);
  }
  return raw as T;
}

export function normalizeHexColor(raw: unknown, what: string): string {
  if (typeof raw !== 'string') {
    fail(`${what}: ожидается цвет в формате #rrggbb`);
  }
  const value = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value
      .slice(1)
      .split('')
      .map((ch) => `${ch}${ch}`)
      .join('')}`;
  }
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{8}$/.test(value)) return value.slice(0, 7);
  return fail(`${what}: некорректный цвет «${raw}», нужен hex вида #da7756`);
}

function optionalColor(
  args: Record<string, unknown>,
  key: string
): string | null | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  if (raw === null || raw === 'none' || raw === 'transparent') return null;
  return normalizeHexColor(raw, key);
}

function optionalStroke(
  args: Record<string, unknown>,
  key: string
): StrokeStyle | null | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  if (raw === null || raw === 'none') return null;
  const obj = asRecord(raw, key);
  const color = normalizeHexColor(obj.color, `${key}.color`);
  const width = readNumberValue(obj.width ?? 2, `${key}.width`, 0.1, 200);
  const lineCap =
    obj.lineCap === undefined
      ? undefined
      : (() => {
          if (obj.lineCap !== 'butt' && obj.lineCap !== 'round' && obj.lineCap !== 'square') {
            fail(`${key}.lineCap: допустимо butt, round, square`);
          }
          return obj.lineCap as 'butt' | 'round' | 'square';
        })();
  const lineJoin =
    obj.lineJoin === undefined
      ? undefined
      : (() => {
          if (
            obj.lineJoin !== 'miter' &&
            obj.lineJoin !== 'round' &&
            obj.lineJoin !== 'bevel'
          ) {
            fail(`${key}.lineJoin: допустимо miter, round, bevel`);
          }
          return obj.lineJoin as 'miter' | 'round' | 'bevel';
        })();

  return {
    color,
    width,
    ...(lineCap ? { lineCap } : {}),
    ...(lineJoin ? { lineJoin } : {}),
  };
}

function readIds(raw: unknown, what: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`${what}: ожидается непустой массив id слоёв`);
  }
  const ids = raw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  if (ids.length === 0) {
    fail(`${what}: не передано ни одного id слоя`);
  }
  return [...new Set(ids)];
}

function resolveLayerIds(raw: unknown, what = 'layerIds'): string[] {
  const requested = readIds(raw, what);
  const scene = useEditorStore.getState().scene;
  const existing = new Set(scene.layers.map((layer) => layer.id));
  const valid = requested.filter((id) => existing.has(id));
  if (valid.length === 0) {
    const available = scene.layers
      .slice(0, 12)
      .map((layer) => `${layer.id} («${layer.name}»)`)
      .join(', ');
    fail(
      `${what}: ни один id не найден на сцене.${available ? ` Доступные слои: ${available}` : ' Сцена пуста.'}`
    );
  }
  return valid;
}

function selectedOrGivenLayerIds(args: Record<string, unknown>): string[] {
  const raw = args.layerIds;
  if (raw === undefined || raw === null) {
    const selected = useEditorStore.getState().selectedIds;
    if (selected.length === 0) {
      fail('Нет выделенных слоёв и не передан layerIds');
    }
    return selected;
  }
  return resolveLayerIds(raw);
}

function describeLayer(layer: Layer, action: string): Record<string, unknown> {
  return {
    summary: `${action} «${layer.name}»`,
    layerId: layer.id,
    name: layer.name,
    type: layer.type,
  };
}

function applyLayerExtras(layerId: string, args: Record<string, unknown>): void {
  const rotation = optionalNumber(args, 'rotation', -3600, 3600, 0);
  const opacity = optionalNumber(args, 'opacity', 0, 1, 1);
  if (rotation !== 0 || opacity !== 1) {
    updateLayers([layerId], {
      ...(rotation !== 0 ? { rotation } : {}),
      ...(opacity !== 1 ? { opacity } : {}),
    });
  }
}

function createBlob(args: Record<string, unknown>): Record<string, unknown> {
  const radius = requiredNumber(args, 'radius', 1, 5000);
  const points = Math.round(optionalNumber(args, 'points', 3, 24, 6));
  const wobble = optionalNumber(args, 'wobble', 0, 1, 0.35);
  const layer = createShapeLayer({
    preset: 'blob',
    x: requiredNumber(args, 'x', -100000, 100000),
    y: requiredNumber(args, 'y', -100000, 100000),
    width: radius * 2,
    height: radius * 2,
    options: { points, wobble },
    fill: optionalColor(args, 'fill'),
    stroke: optionalStroke(args, 'stroke'),
    name: optionalString(args, 'name', 200),
  });
  applyLayerExtras(layer.id, args);
  return describeLayer(layer, 'Создана клякса');
}

function createShape(args: Record<string, unknown>): Record<string, unknown> {
  const preset = requiredEnum(args, 'preset', PRESETS);
  const options: Partial<SmartShapeOptions> = {};
  if (args.cornerRadius !== undefined) {
    options.cornerRadius = optionalNumber(args, 'cornerRadius', 0, 2000, 24);
  }
  if (args.points !== undefined) {
    options.points = Math.round(optionalNumber(args, 'points', 3, 24, 6));
  }
  if (args.innerRadiusRatio !== undefined) {
    options.innerRadiusRatio = optionalNumber(args, 'innerRadiusRatio', 0.1, 0.9, 0.5);
  }

  const layer = createShapeLayer({
    preset,
    x: requiredNumber(args, 'x', -100000, 100000),
    y: requiredNumber(args, 'y', -100000, 100000),
    width: requiredNumber(args, 'width', 1, 100000),
    height: requiredNumber(args, 'height', 1, 100000),
    options,
    fill: optionalColor(args, 'fill'),
    stroke: optionalStroke(args, 'stroke'),
    name: optionalString(args, 'name', 200),
  });

  applyLayerExtras(layer.id, args);
  return describeLayer(layer, 'Создана фигура');
}

function createText(args: Record<string, unknown>): Record<string, unknown> {
  const layer = createTextLayer({
    x: requiredNumber(args, 'x', -100000, 100000),
    y: requiredNumber(args, 'y', -100000, 100000),
    content: requiredString(args, 'content', 5000),
    fontSize: optionalNumber(args, 'fontSize', 6, 1000, 48),
    fontFamily: optionalEnum(args, 'fontFamily', FONT_FAMILIES),
    fontWeight: optionalFontWeight(args, 'fontWeight'),
    lineHeight: optionalNumber(args, 'lineHeight', 0.6, 4, 1.2),
    letterSpacing: optionalNumber(args, 'letterSpacing', -20, 200, 0),
    align: optionalEnum(args, 'align', ['left', 'center', 'right'] as const),
    fill: (() => {
      const color = optionalColor(args, 'fill');
      return color === null ? undefined : color;
    })(),
    name: optionalString(args, 'name', 200),
  });

  applyLayerExtras(layer.id, args);
  return describeLayer(layer, 'Создан текст');
}

function readPoints(raw: unknown): Array<{ x: number; y: number }> {
  if (!Array.isArray(raw) || raw.length < 2) {
    fail('points: нужно минимум 2 точки');
  }
  if (raw.length > 200) {
    fail('points: не больше 200 точек');
  }
  return raw.map((item, index) => {
    const point = asRecord(item, `points[${index}]`);
    return {
      x: readNumberValue(point.x, `points[${index}].x`, -100000, 100000),
      y: readNumberValue(point.y, `points[${index}].y`, -100000, 100000),
    };
  });
}

function buildLineAnchors(
  points: Array<{ x: number; y: number }>,
  smooth: boolean,
  closed: boolean
) {
  const count = points.length;
  return points.map((point, index) => {
    if (!smooth) {
      return {
        x: point.x,
        y: point.y,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
        smooth: false,
      };
    }
    const prev =
      index > 0 ? points[index - 1] : closed ? points[count - 1] : points[0];
    const next =
      index < count - 1 ? points[index + 1] : closed ? points[0] : points[count - 1];
    const dx = (next.x - prev.x) / 6;
    const dy = (next.y - prev.y) / 6;
    return {
      x: point.x,
      y: point.y,
      handleIn: { x: -dx, y: -dy },
      handleOut: { x: dx, y: dy },
      smooth: true,
    };
  });
}

function createLine(args: Record<string, unknown>): Record<string, unknown> {
  const points = readPoints(args.points);
  const closed = optionalBoolean(args, 'closed', false);
  const smooth = optionalBoolean(args, 'smooth', false);
  const strokeRaw = args.stroke;
  if (strokeRaw === undefined || strokeRaw === null) {
    fail('stroke: укажите цвет и толщину обводки для линии');
  }
  const stroke = optionalStroke(args, 'stroke');
  if (!stroke) {
    fail('stroke: линия не может быть без обводки');
  }
  const fill = optionalColor(args, 'fill') ?? null;
  const sameTypeCount =
    useEditorStore.getState().scene.layers.filter((l) => l.type === 'path').length + 1;

  const layer: PathLayer = {
    id: createLayerId('path'),
    name: optionalString(args, 'name', 200) || `Линия ${sameTypeCount}`,
    type: 'path',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    subpaths: [{ closed, anchors: buildLineAnchors(points, smooth, closed) }],
    fillRule: 'nonzero',
    fill,
    stroke,
  };

  const prepared = addLayer(layer) as PathLayer;
  applyLayerExtras(prepared.id, args);
  return describeLayer(prepared, closed ? 'Создан замкнутый контур' : 'Создана линия');
}

interface LayerPatch {
  name?: string;
  visible?: boolean;
  locked?: boolean;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  fill?: string | null;
  stroke?: StrokeStyle | null;
  fillRule?: 'nonzero' | 'evenodd';
  content?: string;
  fontSize?: number;
  fontFamily?: BuiltinFontFamily;
  fontWeight?: 400 | 700;
  lineHeight?: number;
  letterSpacing?: number;
  align?: 'left' | 'center' | 'right';
}

function parseLayerPatch(raw: unknown): LayerPatch {
  const obj = asRecord(raw, 'patch');
  const patch: LayerPatch = {};

  if (obj.name !== undefined) patch.name = readStringValue(obj.name, 'patch.name', 200);
  if (obj.visible !== undefined) {
    if (typeof obj.visible !== 'boolean') fail('patch.visible: ожидается true или false');
    patch.visible = obj.visible;
  }
  if (obj.locked !== undefined) {
    if (typeof obj.locked !== 'boolean') fail('patch.locked: ожидается true или false');
    patch.locked = obj.locked;
  }
  if (obj.x !== undefined) patch.x = readNumberValue(obj.x, 'patch.x', -100000, 100000);
  if (obj.y !== undefined) patch.y = readNumberValue(obj.y, 'patch.y', -100000, 100000);
  if (obj.rotation !== undefined) {
    patch.rotation = readNumberValue(obj.rotation, 'patch.rotation', -3600, 3600);
  }
  if (obj.scaleX !== undefined) {
    patch.scaleX = readNumberValue(obj.scaleX, 'patch.scaleX', -1000, 1000);
  }
  if (obj.scaleY !== undefined) {
    patch.scaleY = readNumberValue(obj.scaleY, 'patch.scaleY', -1000, 1000);
  }
  if (obj.opacity !== undefined) {
    patch.opacity = readNumberValue(obj.opacity, 'patch.opacity', 0, 1);
  }
  if (obj.fill !== undefined) {
    if (obj.fill === null || obj.fill === 'none' || obj.fill === 'transparent') {
      patch.fill = null;
    } else {
      patch.fill = normalizeHexColor(obj.fill, 'patch.fill');
    }
  }
  if (obj.stroke !== undefined) {
    patch.stroke = obj.stroke === null ? null : (optionalStroke(obj, 'stroke') ?? null);
  }
  if (obj.fillRule !== undefined) {
    const rule = requiredEnum(obj, 'fillRule', ['nonzero', 'evenodd'] as const);
    patch.fillRule = rule;
  }
  if (obj.content !== undefined) {
    patch.content = readStringValue(obj.content, 'patch.content', 5000);
  }
  if (obj.fontSize !== undefined) {
    patch.fontSize = readNumberValue(obj.fontSize, 'patch.fontSize', 6, 1000);
  }
  if (obj.fontFamily !== undefined) {
    patch.fontFamily = requiredEnum(obj, 'fontFamily', FONT_FAMILIES);
  }
  if (obj.fontWeight !== undefined) {
    patch.fontWeight = readFontWeight(obj.fontWeight, 'patch.fontWeight');
  }
  if (obj.lineHeight !== undefined) {
    patch.lineHeight = readNumberValue(obj.lineHeight, 'patch.lineHeight', 0.6, 4);
  }
  if (obj.letterSpacing !== undefined) {
    patch.letterSpacing = readNumberValue(obj.letterSpacing, 'patch.letterSpacing', -20, 200);
  }
  if (obj.align !== undefined) {
    patch.align = requiredEnum(obj, 'align', ['left', 'center', 'right'] as const);
  }

  return patch;
}

function applyLayerPatch(layer: Layer, patch: LayerPatch): Layer {
  if (layer.type === 'path') {
    const next: PathLayer = { ...layer };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.visible !== undefined) next.visible = patch.visible;
    if (patch.locked !== undefined) next.locked = patch.locked;
    if (patch.x !== undefined) next.x = patch.x;
    if (patch.y !== undefined) next.y = patch.y;
    if (patch.rotation !== undefined) next.rotation = patch.rotation;
    if (patch.scaleX !== undefined) next.scaleX = patch.scaleX;
    if (patch.scaleY !== undefined) next.scaleY = patch.scaleY;
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    if (patch.fill !== undefined) next.fill = patch.fill;
    if (patch.stroke !== undefined) next.stroke = patch.stroke;
    if (patch.fillRule !== undefined) next.fillRule = patch.fillRule;
    return next;
  }

  if (layer.type === 'text') {
    const next = { ...layer };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.visible !== undefined) next.visible = patch.visible;
    if (patch.locked !== undefined) next.locked = patch.locked;
    if (patch.x !== undefined) next.x = patch.x;
    if (patch.y !== undefined) next.y = patch.y;
    if (patch.rotation !== undefined) next.rotation = patch.rotation;
    if (patch.scaleX !== undefined) next.scaleX = patch.scaleX;
    if (patch.scaleY !== undefined) next.scaleY = patch.scaleY;
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    if (patch.fill !== undefined && patch.fill !== null) next.fill = patch.fill;
    if (patch.content !== undefined) next.content = patch.content;
    if (patch.fontSize !== undefined) next.fontSize = patch.fontSize;
    if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily;
    if (patch.fontWeight !== undefined) next.fontWeight = patch.fontWeight;
    if (patch.lineHeight !== undefined) next.lineHeight = patch.lineHeight;
    if (patch.letterSpacing !== undefined) next.letterSpacing = patch.letterSpacing;
    if (patch.align !== undefined) next.align = patch.align;
    return next;
  }

  const next = { ...layer };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.visible !== undefined) next.visible = patch.visible;
  if (patch.locked !== undefined) next.locked = patch.locked;
  if (patch.x !== undefined) next.x = patch.x;
  if (patch.y !== undefined) next.y = patch.y;
  if (patch.rotation !== undefined) next.rotation = patch.rotation;
  if (patch.scaleX !== undefined) next.scaleX = patch.scaleX;
  if (patch.scaleY !== undefined) next.scaleY = patch.scaleY;
  if (patch.opacity !== undefined) next.opacity = patch.opacity;
  return next;
}

function updateLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const patch = parseLayerPatch(args.patch);
  updateLayers(ids, (layer) => applyLayerPatch(layer, patch));
  const names = useEditorStore
    .getState()
    .scene.layers.filter((layer) => ids.includes(layer.id))
    .map((layer) => layer.name);
  return {
    summary: `Изменено слоёв: ${ids.length}${names.length ? ` (${names.join(', ')})` : ''}`,
    layerIds: ids,
  };
}

function deleteLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const scene = useEditorStore.getState().scene;
  const names = scene.layers
    .filter((layer) => ids.includes(layer.id))
    .map((layer) => layer.name);
  deleteLayers(ids);
  return {
    summary: `Удалено слоёв: ${ids.length}${names.length ? ` (${names.join(', ')})` : ''}`,
    layerIds: ids,
  };
}

function duplicateLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const offsetX = optionalNumber(args, 'offsetX', -10000, 10000, 16);
  const offsetY = optionalNumber(args, 'offsetY', -10000, 10000, 16);
  const created = duplicateLayers(ids, offsetX, offsetY);
  if (created.length === 0) {
    fail('Не удалось дублировать слои');
  }
  return {
    summary: `Дублировано слоёв: ${created.length}`,
    createdLayerIds: created.map((layer) => layer.id),
  };
}

function reorderLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const layerId = requiredString(args, 'layerId', 200);
  const mode = requiredEnum(args, 'mode', [
    'front',
    'back',
    'forward',
    'backward',
    'index',
  ] as const);
  const index =
    mode === 'index'
      ? Math.round(requiredNumber(args, 'index', 0, 10000))
      : undefined;
  const scene = useEditorStore.getState().scene;
  const target = scene.layers.find((layer) => layer.id === layerId);
  if (!target) {
    fail(`Слой «${layerId}» не найден`);
  }
  reorderLayer(layerId, mode, index);
  return {
    summary: `Слой «${target.name}» перемещён (${mode})`,
    layerId,
  };
}

function setClipMaskTool(args: Record<string, unknown>): Record<string, unknown> {
  const rawMask = args.maskLayerId;
  const maskLayerId =
    rawMask === null || rawMask === '' || rawMask === 'none'
      ? null
      : readStringValue(rawMask, 'maskLayerId', 200);
  const targets = resolveLayerIds(args.targetLayerIds, 'targetLayerIds');

  if (maskLayerId === null) {
    setClipMask(null, targets);
    return { summary: `Маска снята со слоёв: ${targets.length}`, targetLayerIds: targets };
  }

  const mask = useEditorStore
    .getState()
    .scene.layers.find((layer) => layer.id === maskLayerId);
  if (!mask || mask.type !== 'path') {
    fail(`Маска «${maskLayerId}» не найдена или не является векторным контуром`);
  }
  setClipMask(maskLayerId, targets);
  return {
    summary: `Маска «${mask.name}» применена к слоям: ${targets.length}`,
    maskLayerId,
    targetLayerIds: targets,
  };
}

function randomizeAnchorsTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const intensity = optionalNumber(args, 'intensity', 0.1, 200, 4);
  const seed =
    args.seed !== undefined && args.seed !== null
      ? Math.round(requiredNumber(args, 'seed', 0, 1_000_000))
      : undefined;
  const scene = useEditorStore.getState().scene;
  let changed = 0;
  for (const id of ids) {
    const layer = useEditorStore
      .getState()
      .scene.layers.find((item) => item.id === id);
    if (!layer || layer.type !== 'path' || layer.locked) continue;
    const next = randomizeAnchors(layer.subpaths, intensity, seed);
    if (updatePathSubpaths(id, next)) changed += 1;
  }
  if (changed === 0) {
    fail('Среди выбранных слоёв нет разблокированных векторных контуров');
  }
  return {
    summary: `Искажены узлы слоёв: ${changed} (intensity ${intensity.toFixed(1)}${seed !== undefined ? `, seed ${seed}` : ''})`,
    layerIds: ids.filter((id) => scene.layers.some((layer) => layer.id === id)),
    changed,
  };
}

function alignLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const mode = requiredEnum(args, 'mode', ALIGN_MODES);
  alignLayers(ids, mode);
  return { summary: `Выравнивание выполнено: ${mode}`, layerIds: ids };
}

function applyPaletteTool(args: Record<string, unknown>): Record<string, unknown> {
  const rawColors = args.colors;
  if (!Array.isArray(rawColors) || rawColors.length === 0) {
    fail('colors: ожидается непустой массив hex-цветов');
  }
  if (rawColors.length > 12) {
    fail('colors: не больше 12 цветов');
  }
  const colors = rawColors.map((raw, index) => normalizeHexColor(raw, `colors[${index}]`));
  const includeBackground = optionalBoolean(args, 'includeBackground', false);
  const scene = useEditorStore.getState().scene;
  const requested =
    args.layerIds === undefined || args.layerIds === null
      ? scene.layers.filter((layer) => layer.type === 'path' || layer.type === 'text')
      : (() => {
          const ids = readIds(args.layerIds, 'layerIds');
          return scene.layers.filter(
            (layer) =>
              ids.includes(layer.id) &&
              (layer.type === 'path' || layer.type === 'text')
          );
        })();

  if (requested.length === 0 && !includeBackground) {
    fail('Нет слоёв для перекраски');
  }

  const colorById = new Map(
    requested.map((layer, index) => [layer.id, colors[index % colors.length]])
  );

  if (requested.length > 0) {
    updateLayers(
      requested.map((layer) => layer.id),
      (layer) => {
        const color = colorById.get(layer.id);
        if (!color) return layer;
        if (layer.type === 'path') return { ...layer, fill: color };
        if (layer.type === 'text') return { ...layer, fill: color };
        return layer;
      }
    );
  }

  if (includeBackground) {
    updateArtboard({ background: colors[0] });
  }

  return {
    summary: `Палитра применена: ${requested.length} сл.${includeBackground ? `, фон ${colors[0]}` : ''}`,
    colors,
    paintedLayerIds: requested.map((layer) => layer.id),
  };
}

function booleanOpTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  if (ids.length < 2) {
    fail('boolean_op: нужно минимум 2 слоя');
  }
  const operation = requiredEnum(args, 'operation', BOOLEAN_OPS);
  const result = booleanLayers(ids, operation);
  if (!result) {
    fail('Булева операция не дала результата: фигуры не пересекаются или среди слоёв нет векторов');
  }
  return describeLayer(result, `Булева операция ${operation}:`);
}

type ToolHandler = (args: Record<string, unknown>) => Record<string, unknown>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  create_blob: createBlob,
  create_shape: createShape,
  create_text: createText,
  create_line: createLine,
  update_layers: updateLayersTool,
  delete_layers: deleteLayersTool,
  duplicate_layers: duplicateLayersTool,
  reorder_layers: reorderLayersTool,
  set_clip_mask: setClipMaskTool,
  randomize_anchors: randomizeAnchorsTool,
  align_layers: alignLayersTool,
  apply_palette: applyPaletteTool,
  boolean_op: booleanOpTool,
};

const STROKE_SCHEMA = {
  type: 'object' as const,
  properties: {
    color: { type: 'string' as const, description: 'Цвет обводки, hex #rrggbb' },
    width: { type: 'number' as const, description: 'Толщина в px' },
    lineCap: {
      type: 'string' as const,
      enum: ['butt', 'round', 'square'],
    },
    lineJoin: {
      type: 'string' as const,
      enum: ['miter', 'round', 'bevel'],
    },
  },
  required: ['color', 'width'],
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'create_blob',
    description:
      'Создать органическую кляксу (замкнутый контур с плавными узлами). x и y — центр фигуры.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Имя слоя' },
        x: { type: 'number', description: 'Центр по X в px артборда' },
        y: { type: 'number', description: 'Центр по Y в px артборда' },
        radius: { type: 'number', description: 'Радиус кляксы в px' },
        points: { type: 'integer', description: 'Число узлов, 3..24' },
        wobble: { type: 'number', description: 'Органичность, 0..1' },
        opacity: { type: 'number', description: 'Прозрачность, 0..1' },
        fill: { type: 'string', description: 'Заливка hex #rrggbb или "none"' },
        stroke: STROKE_SCHEMA,
      },
      required: ['x', 'y', 'radius'],
    },
  },
  {
    name: 'create_shape',
    description:
      'Создать геометрический примитив: ellipse, rect, polygon или star. x и y — центр фигуры.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Имя слоя' },
        preset: { type: 'string', enum: PRESETS },
        x: { type: 'number', description: 'Центр по X в px артборда' },
        y: { type: 'number', description: 'Центр по Y в px артборда' },
        width: { type: 'number', description: 'Ширина в px' },
        height: { type: 'number', description: 'Высота в px' },
        cornerRadius: { type: 'number', description: 'Скругление rect, px' },
        points: { type: 'integer', description: 'Число вершин polygon/star, 3..24' },
        innerRadiusRatio: {
          type: 'number',
          description: 'Внутренний радиус star, 0.1..0.9',
        },
        rotation: { type: 'number', description: 'Поворот в градусах по часовой стрелке' },
        opacity: { type: 'number', description: 'Прозрачность, 0..1' },
        fill: { type: 'string', description: 'Заливка hex #rrggbb или "none"' },
        stroke: STROKE_SCHEMA,
      },
      required: ['preset', 'x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'create_text',
    description:
      'Добавить текстовый слой. x и y — верхняя якорная точка с учётом выравнивания.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Имя слоя' },
        content: { type: 'string', description: 'Текст, можно с переносами строк' },
        x: { type: 'number' },
        y: { type: 'number' },
        fontSize: { type: 'number', description: 'Кегль, px' },
        fontFamily: {
          type: 'string',
          enum: FONT_FAMILIES,
        },
        fontWeight: { type: 'integer', description: 'Жирность: 400 или 700' },
        lineHeight: { type: 'number', description: 'Межстрочный интервал, 0.6..4' },
        letterSpacing: { type: 'number', description: 'Трекинг, px' },
        align: { type: 'string', enum: ['left', 'center', 'right'] },
        fill: { type: 'string', description: 'Цвет текста hex #rrggbb' },
        rotation: { type: 'number', description: 'Поворот в градусах' },
        opacity: { type: 'number', description: 'Прозрачность, 0..1' },
      },
      required: ['content', 'x', 'y'],
    },
  },
  {
    name: 'create_line',
    description:
      'Нарисовать линию или открытый контур по точкам. Основной инструмент для усов, бровей, рта, контуров и любых тонких деталей: используйте обводку (stroke), а не заливку.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Имя слоя' },
        points: {
          type: 'array',
          description: 'Точки в координатах артборда, минимум 2',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
            },
            required: ['x', 'y'],
          },
        },
        closed: { type: 'boolean', description: 'Замкнуть контур' },
        smooth: { type: 'boolean', description: 'Сгладить линию кривыми Безье' },
        opacity: { type: 'number', description: 'Прозрачность, 0..1' },
        stroke: STROKE_SCHEMA,
        fill: { type: 'string', description: 'Обычно "none"; hex — только для замкнутых' },
      },
      required: ['points', 'stroke'],
    },
  },
  {
    name: 'update_layers',
    description:
      'Изменить свойства существующих слоёв. Передавайте только те поля patch, которые нужно поменять.',
    parameters: {
      type: 'object',
      properties: {
        layerIds: { type: 'array', items: { type: 'string' } },
        patch: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            visible: { type: 'boolean' },
            locked: { type: 'boolean' },
            x: { type: 'number' },
            y: { type: 'number' },
            rotation: { type: 'number' },
            scaleX: { type: 'number' },
            scaleY: { type: 'number' },
            opacity: { type: 'number', description: '0..1' },
            fill: { type: 'string', description: 'hex или "none"' },
            stroke: STROKE_SCHEMA,
            fillRule: { type: 'string', enum: ['nonzero', 'evenodd'] },
            content: { type: 'string', description: 'Текст для TextLayer' },
            fontSize: { type: 'number' },
            fontFamily: { type: 'string', enum: FONT_FAMILIES },
            fontWeight: { type: 'integer', description: 'Жирность: 400 или 700' },
            lineHeight: { type: 'number' },
            letterSpacing: { type: 'number' },
            align: { type: 'string', enum: ['left', 'center', 'right'] },
          },
        },
      },
      required: ['layerIds', 'patch'],
    },
  },
  {
    name: 'delete_layers',
    description: 'Удалить слои по id. Зависимые маски будут очищены автоматически.',
    parameters: {
      type: 'object',
      properties: {
        layerIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['layerIds'],
    },
  },
  {
    name: 'duplicate_layers',
    description: 'Дублировать слои со сдвигом.',
    parameters: {
      type: 'object',
      properties: {
        layerIds: { type: 'array', items: { type: 'string' } },
        offsetX: { type: 'number', description: 'Сдвиг по X, по умолчанию 16' },
        offsetY: { type: 'number', description: 'Сдвиг по Y, по умолчанию 16' },
      },
      required: ['layerIds'],
    },
  },
  {
    name: 'reorder_layers',
    description: 'Изменить Z-порядок слоя.',
    parameters: {
      type: 'object',
      properties: {
        layerId: { type: 'string' },
        mode: {
          type: 'string',
          enum: ['front', 'back', 'forward', 'backward', 'index'],
        },
        index: { type: 'integer', description: 'Только для mode=index, 0 — самый нижний' },
      },
      required: ['layerId', 'mode'],
    },
  },
  {
    name: 'set_clip_mask',
    description:
      'Назначить маску: маскирующий вектор и целевые слои. Чтобы снять маску, передайте maskLayerId: null.',
    parameters: {
      type: 'object',
      properties: {
        maskLayerId: { type: 'string', description: 'id векторного слоя-маски или null' },
        targetLayerIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['maskLayerId', 'targetLayerIds'],
    },
  },
  {
    name: 'randomize_anchors',
    description: 'Добавить органическое искажение узлам векторных контуров.',
    parameters: {
      type: 'object',
      properties: {
        layerIds: { type: 'array', items: { type: 'string' } },
        intensity: { type: 'number', description: 'Сила искажения в px, 0.1..200' },
        seed: { type: 'integer', description: 'Зерно случайности для повторяемости' },
      },
      required: ['layerIds'],
    },
  },
  {
    name: 'align_layers',
    description:
      'Выровнять или распределить слои. Если layerIds не передан, берётся текущее выделение.',
    parameters: {
      type: 'object',
      properties: {
        layerIds: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ALIGN_MODES },
      },
      required: ['mode'],
    },
  },
  {
    name: 'apply_palette',
    description:
      'Перекрасить слои (и при необходимости фон) в заданную палитру. Цвета распределяются по слоям по кругу.',
    parameters: {
      type: 'object',
      properties: {
        colors: { type: 'array', items: { type: 'string' }, description: 'Hex-цвета' },
        layerIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Необязательно; без него — все векторы и текст',
        },
        includeBackground: { type: 'boolean' },
      },
      required: ['colors'],
    },
  },
  {
    name: 'boolean_op',
    description: 'Булева операция над двумя и более векторными слоями.',
    parameters: {
      type: 'object',
      properties: {
        layerIds: { type: 'array', items: { type: 'string' } },
        operation: { type: 'string', enum: BOOLEAN_OPS },
      },
      required: ['layerIds', 'operation'],
    },
  },
];

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name);
}

export type ToolExecutionResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

export function executeTool(
  name: string,
  rawArgs: Record<string, unknown>
): ToolExecutionResult {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { ok: false, error: `Неизвестный инструмент «${name}»` };
  }
  if (!isRecord(rawArgs)) {
    return { ok: false, error: `${name}: аргументы должны быть объектом` };
  }
  try {
    return { ok: true, result: handler(rawArgs) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Не удалось выполнить инструмент',
    };
  }
}
