import {
  booleanLayers,
  combineCompoundPathLayers,
  offsetPathLayers,
  outlineStrokeLayers,
  roundCornersLayers,
  simplifyPathLayers,
  splitCompoundPathLayers,
  updatePathSubpaths,
} from '../../core/commands';
import { findLayerById, flattenLayers } from '../../core/layerTree';
import { useEditorStore } from '../../core/store';
import type { BooleanOp } from '../../engine/booleans';
import { randomizeAnchors } from '../../engine/geometry';
import {
  LAYER_IDS_SCHEMA,
  type ToolSpec,
  describeLayer,
  fail,
  isLayerEffectivelyLocked,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  requiredEnum,
  requiredNumber,
  resolveLayerIds,
  selectedOrGivenLayerIds,
} from './validation';

const BOOLEAN_OPS: BooleanOp[] = ['unite', 'subtract', 'intersect', 'exclude'];

function randomizeAnchorsTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const intensity = optionalNumber(args, 'intensity', 0.1, 200, 4);
  const seed =
    args.seed !== undefined && args.seed !== null
      ? Math.round(requiredNumber(args, 'seed', 0, 1_000_000))
      : undefined;
  let changed = 0;
  const changedIds: string[] = [];
  for (const id of ids) {
    const layers = useEditorStore.getState().scene.layers;
    const layer = findLayerById(layers, id);
    if (!layer || layer.type !== 'path' || isLayerEffectivelyLocked(layers, id)) continue;
    const next = randomizeAnchors(layer.subpaths, intensity, seed);
    if (updatePathSubpaths(id, next)) {
      changed += 1;
      changedIds.push(id);
    }
  }
  if (changed === 0) {
    fail('Среди выбранных слоёв нет разблокированных векторных контуров');
  }
  return {
    summary: `Искажены узлы слоёв: ${changed} (intensity ${intensity.toFixed(1)}${seed !== undefined ? `, seed ${seed}` : ''})`,
    layerIds: changedIds,
    changed,
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

function offsetPathTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const distance = requiredNumber(args, 'distance', -500, 500);
  if (Math.abs(distance) < 0.5) fail('distance: смещение не может быть нулевым');
  const copyBehind = optionalBoolean(args, 'copyBehind', true);
  const join = optionalEnum(args, 'join', ['round', 'miter', 'bevel'] as const) ?? 'round';
  const created = offsetPathLayers(ids, distance, { copyBehind, join });
  if (created.length === 0) {
    fail('Не удалось построить параллельный контур: нет векторов или смещение слишком велико');
  }
  return {
    summary: copyBehind
      ? `Создан параллельный контур: ${created.length} сл. (${distance > 0 ? '+' : ''}${distance} px)`
      : `Смещён контур: ${created.length} сл. (${distance > 0 ? '+' : ''}${distance} px)`,
    createdLayerIds: created.map((layer) => layer.id),
  };
}

function outlineStrokeTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const created = outlineStrokeLayers(ids);
  if (created.length === 0) {
    fail('Нечего обводить: у слоёв нет обводки (stroke)');
  }
  return {
    summary: `Обводка переведена в контуры: ${created.length} сл.`,
    layerIds: created.map((layer) => layer.id),
  };
}

function combineCompoundTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  if (ids.length < 2) fail('combine_compound: нужно минимум 2 векторных слоя');
  const result = combineCompoundPathLayers(ids);
  if (!result) fail('Не удалось собрать составной контур');
  return describeLayer(result, 'Собран составной контур');
}

function splitCompoundTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const created = splitCompoundPathLayers(ids);
  if (created.length === 0) {
    fail('У выбранных слоёв нет нескольких субконтуров для разбиения');
  }
  return {
    summary: `Контур разбит на части: ${created.length}`,
    createdLayerIds: created.map((layer) => layer.id),
  };
}

function countAnchors(ids: string[]): number {
  const idSet = new Set(ids);
  return flattenLayers(useEditorStore.getState().scene.layers).reduce((total, layer) => {
    if (!idSet.has(layer.id) || layer.type !== 'path') return total;
    return (
      total + layer.subpaths.reduce((sum, subpath) => sum + subpath.anchors.length, 0)
    );
  }, 0);
}

function simplifyPathTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const tolerance = optionalNumber(args, 'tolerance', 0.1, 100, 2.5);
  const before = countAnchors(ids);
  simplifyPathLayers(ids, tolerance);
  const after = countAnchors(ids);
  return {
    summary: `Контуры упрощены (tolerance ${tolerance}): узлов ${before} → ${after}`,
    layerIds: ids,
    anchorsBefore: before,
    anchorsAfter: after,
  };
}

function roundCornersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const radius = requiredNumber(args, 'radius', 0.5, 2000);
  const idSet = new Set(ids);
  const sceneLayers = useEditorStore.getState().scene.layers;
  const pathLayers = flattenLayers(sceneLayers).filter(
    (layer) => idSet.has(layer.id) && layer.type === 'path'
  );
  if (pathLayers.length === 0) fail('round_corners: среди слоёв нет векторов');
  const unlockedPaths = pathLayers.filter(
    (layer) => !isLayerEffectivelyLocked(sceneLayers, layer.id)
  );
  if (unlockedPaths.length === 0) {
    fail('round_corners: все векторные слои заблокированы');
  }
  const unlockedIds = unlockedPaths.map((layer) => layer.id);
  roundCornersLayers(unlockedIds, radius);
  return {
    summary: `Углы скруглены: ${unlockedPaths.length} контур(ов), радиус ${radius} px`,
    layerIds: unlockedIds,
  };
}

export const VECTOR_TOOLS: ToolSpec[] = [
  {
    label: 'Искажение узлов',
    handler: randomizeAnchorsTool,
    definition: {
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
  },
  {
    label: 'Булева операция',
    handler: booleanOpTool,
    definition: {
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
  },
  {
    label: 'Параллельный контур',
    handler: offsetPathTool,
    definition: {
      name: 'offset_path',
      description:
        'Построить параллельный контур: подложку, стикер-обводку, тень или утолщение. distance > 0 расширяет, < 0 сжимает. copyBehind=true (по умолчанию) оставляет исходник и кладёт контур под ним.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: LAYER_IDS_SCHEMA,
          distance: { type: 'number', description: 'Смещение в px, -500..500, не 0' },
          copyBehind: {
            type: 'boolean',
            description: 'Оставить исходный слой, по умолчанию true',
          },
          join: { type: 'string', enum: ['round', 'miter', 'bevel'] },
        },
        required: ['distance'],
      },
    },
  },
  {
    label: 'Обводка в контуры',
    handler: outlineStrokeTool,
    definition: {
      name: 'outline_stroke',
      description:
        'Перевести обводку вектора в залитый контур (как Object → Path → Outline Stroke). Нужно перед булевыми операциями с тонкими линиями или offset_path по ним.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'id векторных слоёв с обводкой',
          },
        },
        required: ['layerIds'],
      },
    },
  },
  {
    label: 'Составной контур',
    handler: combineCompoundTool,
    definition: {
      name: 'combine_compound',
      description:
        'Собрать несколько векторных слоёв в один составной контур (как Ctrl+8): дырки и пересечения сохраняются через fillRule evenodd.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Минимум 2 векторных слоя',
          },
        },
        required: ['layerIds'],
      },
    },
  },
  {
    label: 'Разбиение контура',
    handler: splitCompoundTool,
    definition: {
      name: 'split_compound',
      description:
        'Разбить составной контур на отдельные части (как Ctrl+Shift+8): буквы слова, отдельные субконтуры, дырки становятся самостоятельными фигурами.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'id составных контуров (2+ субконтура)',
          },
        },
        required: ['layerIds'],
      },
    },
  },
  {
    label: 'Упрощение контура',
    handler: simplifyPathTool,
    definition: {
      name: 'simplify_path',
      description:
        'Упростить контуры, убрав лишние узлы. Полезно после randomize_anchors или для тяжёлых силуэтов. tolerance — допуск в px, больше = грубее.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'id векторных слоёв',
          },
          tolerance: { type: 'number', description: '0.1..100, по умолчанию 2.5' },
        },
        required: ['layerIds'],
      },
    },
  },
  {
    label: 'Скругление углов',
    handler: roundCornersTool,
    definition: {
      name: 'round_corners',
      description:
        'Скруглить прямые углы векторного контура (polygon, star, rect без скругления, ломаные). Кривые участки не меняются.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: LAYER_IDS_SCHEMA,
          radius: { type: 'number', description: 'Радиус скругления в px, 0.5..2000' },
        },
        required: ['radius'],
      },
    },
  },
];
