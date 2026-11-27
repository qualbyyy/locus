import { getProjectFonts } from '../../core/fonts';
import { findLayerPath, flattenLayers } from '../../core/layerTree';
import { sanitizeDashArray } from '../../core/paint';
import { useEditorStore } from '../../core/store';
import type {
  BuiltinFontFamily,
  FontFamily,
  Layer,
  StrokeStyle,
} from '../../core/types';
import type { ToolDefinition, ToolParameterProperty } from '../types';

export type ToolHandler = (args: Record<string, unknown>) => Record<string, unknown>;

export interface ToolSpec {
  label: string;
  definition: ToolDefinition;
  handler: ToolHandler;
}

export const FONT_FAMILIES: BuiltinFontFamily[] = [
  'Inter',
  'Manrope',
  'Golos Text',
  'Playfair Display',
  'JetBrains Mono',
  'Unbounded',
];

export const LAYER_IDS_SCHEMA: ToolParameterProperty = {
  type: 'array',
  items: { type: 'string' },
  description: 'id слоёв; если не указано — берётся текущее выделение',
};

export const STROKE_SCHEMA: ToolParameterProperty = {
  type: 'object',
  properties: {
    color: { type: 'string', description: 'Цвет обводки, hex #rrggbb' },
    width: { type: 'number', description: 'Толщина в px' },
    lineCap: {
      type: 'string',
      enum: ['butt', 'round', 'square'],
    },
    lineJoin: {
      type: 'string',
      enum: ['miter', 'round', 'bevel'],
    },
    dashArray: {
      type: 'array',
      items: { type: 'number' },
      description: 'Пунктир: [штрих, пробел, ...]',
    },
    dashOffset: {
      type: 'number',
      description: 'Сдвиг пунктира, px',
    },
  },
  required: ['color', 'width'],
};

export class ToolError extends Error {}

export function fail(message: string): never {
  throw new ToolError(message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${what}: ожидается объект`);
  }
  return value;
}

export function readStringValue(raw: unknown, what: string, maxLength = 4000): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    fail(`${what}: ожидается непустая строка`);
  }
  const value = raw.trim();
  if (value.length > maxLength) {
    fail(`${what}: строка длиннее ${maxLength} символов`);
  }
  return value;
}

export function getAllowedFontFamilies(): string[] {
  const custom = getProjectFonts().map((f) => f.family);
  return Array.from(new Set([...FONT_FAMILIES, ...custom]));
}

export function readFontFamily(raw: unknown, what: string): FontFamily {
  const str = readStringValue(raw, what, 200);
  const allowed = getAllowedFontFamilies();
  const match = allowed.find((f) => f.toLowerCase() === str.toLowerCase());
  if (!match) {
    fail(`${what}: неизвестный шрифт «${str}». Доступные: ${allowed.join(', ')}`);
  }
  return match;
}

export function readFontWeight(raw: unknown, what: string): 400 | 700 {
  const value =
    typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (value !== 400 && value !== 700) {
    fail(`${what}: допустимо 400 или 700`);
  }
  return value;
}

export function optionalFontWeight(
  args: Record<string, unknown>,
  key: string
): 400 | 700 | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  return readFontWeight(raw, key);
}

export function optionalString(
  args: Record<string, unknown>,
  key: string,
  maxLength = 4000
): string | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  return readStringValue(raw, key, maxLength);
}

export function requiredString(
  args: Record<string, unknown>,
  key: string,
  maxLength = 4000
): string {
  return readStringValue(args[key], key, maxLength);
}

export function readNumberValue(raw: unknown, what: string, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    fail(`${what}: ожидается число`);
  }
  if (raw < min || raw > max) {
    fail(`${what}: допустимый диапазон ${min}..${max}`);
  }
  return raw;
}

export function requiredNumber(
  args: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number {
  return readNumberValue(args[key], key, min, max);
}

export function optionalNumber(
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

export function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const raw = args[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'boolean') fail(`${key}: ожидается true или false`);
  return raw;
}

export function requiredEnum<T extends string | number>(
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

export function optionalEnum<T extends string | number>(
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

export function optionalColor(
  args: Record<string, unknown>,
  key: string
): string | null | undefined {
  const raw = args[key];
  if (raw === undefined) return undefined;
  if (raw === null || raw === 'none' || raw === 'transparent') return null;
  return normalizeHexColor(raw, key);
}

export function optionalStroke(
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

  let dashArray: number[] | undefined;
  if (obj.dashArray !== undefined && obj.dashArray !== null) {
    if (!Array.isArray(obj.dashArray)) {
      fail(`${key}.dashArray: ожидается массив чисел > 0`);
    }
    const nums = obj.dashArray.map((n, idx) =>
      readNumberValue(n, `${key}.dashArray[${idx}]`, 0.1, 2000)
    );
    dashArray = sanitizeDashArray(nums);
  }
  const dashOffset =
    obj.dashOffset !== undefined && obj.dashOffset !== null
      ? readNumberValue(obj.dashOffset, `${key}.dashOffset`, -2000, 2000)
      : undefined;

  return {
    color,
    width,
    ...(lineCap ? { lineCap } : {}),
    ...(lineJoin ? { lineJoin } : {}),
    ...(dashArray ? { dashArray } : {}),
    ...(dashOffset !== undefined ? { dashOffset } : {}),
  };
}

export function readIds(raw: unknown, what: string): string[] {
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

export function resolveLayerIds(raw: unknown, what = 'layerIds'): string[] {
  const requested = readIds(raw, what);
  const scene = useEditorStore.getState().scene;
  const allLayers = flattenLayers(scene.layers);
  const existing = new Set(allLayers.map((layer) => layer.id));
  const valid = requested.filter((id) => existing.has(id));
  if (valid.length === 0) {
    const available = allLayers
      .slice(0, 12)
      .map((layer) => `${layer.id} («${layer.name}»)`)
      .join(', ');
    fail(
      `${what}: ни один id не найден на сцене.${available ? ` Доступные слои: ${available}` : ' Сцена пуста.'}`
    );
  }
  return valid;
}

export function isLayerEffectivelyLocked(layers: Layer[], id: string): boolean {
  return (findLayerPath(layers, id) ?? []).some((node) => node.locked);
}

export function selectedOrGivenLayerIds(args: Record<string, unknown>): string[] {
  const raw = args.layerIds;
  if (raw === undefined || raw === null) {
    const state = useEditorStore.getState();
    const existing = new Set(flattenLayers(state.scene.layers).map((layer) => layer.id));
    const valid = state.selectedIds.filter((id) => existing.has(id));
    if (valid.length === 0) {
      fail('Нет выделенных слоёв и не передан layerIds');
    }
    return valid;
  }
  return resolveLayerIds(raw);
}

export function describeLayer(layer: Layer, action: string): Record<string, unknown> {
  return {
    summary: `${action} «${layer.name}»`,
    layerId: layer.id,
    name: layer.name,
    type: layer.type,
  };
}
