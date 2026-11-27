import {
  type AlignMode,
  alignLayers,
  flipLayers,
  mirrorDuplicateLayers,
  placeLayersInBounds,
  repeatLayers,
  rotateLayersBy,
} from '../../core/commands';
import { flattenLayers } from '../../core/layerTree';
import { useEditorStore } from '../../core/store';
import {
  LAYER_IDS_SCHEMA,
  type ToolSpec,
  fail,
  optionalEnum,
  optionalNumber,
  requiredEnum,
  requiredNumber,
  selectedOrGivenLayerIds,
} from './validation';

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

function alignLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const mode = requiredEnum(args, 'mode', ALIGN_MODES);
  alignLayers(ids, mode);
  return { summary: `Выравнивание выполнено: ${mode}`, layerIds: ids };
}

function flipLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const axis = requiredEnum(args, 'axis', ['horizontal', 'vertical'] as const);
  flipLayers(ids, axis);
  return {
    summary: `Отражено слоёв: ${ids.length} (${axis === 'horizontal' ? 'по горизонтали' : 'по вертикали'})`,
    layerIds: ids,
  };
}

function rotateLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const angle = requiredNumber(args, 'angle', -3600, 3600);
  if (Math.abs(angle) < 1e-4) fail('angle: угол не может быть нулевым');
  const locked = flattenLayers(useEditorStore.getState().scene.layers).filter(
    (layer) => ids.includes(layer.id) && layer.locked
  ).length;
  if (locked === ids.length) fail('Все указанные слои заблокированы');
  rotateLayersBy(ids, angle);
  return {
    summary: `Слоёв повёрнуто: ${ids.length - locked} на ${angle}°`,
    layerIds: ids,
  };
}

function mirrorDuplicateTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const axis = requiredEnum(args, 'axis', ['horizontal', 'vertical'] as const);
  const created = mirrorDuplicateLayers(ids, axis);
  if (created.length === 0) fail('Не удалось создать зеркальные копии');
  return {
    summary: `Созданы зеркальные копии: ${created.length}`,
    createdLayerIds: created.map((layer) => layer.id),
  };
}

function repeatLayerTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const mode = requiredEnum(args, 'mode', ['row', 'column', 'grid', 'ring'] as const);
  const count = Math.round(requiredNumber(args, 'count', 2, 40));
  const gap = optionalNumber(args, 'gap', 0, 5000, 20);
  const columns = Math.round(optionalNumber(args, 'columns', 2, 10, 3));
  const radius =
    args.radius === undefined || args.radius === null
      ? undefined
      : optionalNumber(args, 'radius', 1, 5000, 200);
  const sweep = optionalNumber(args, 'sweep', -360, 360, 360);

  const created = repeatLayers(ids, { mode, count, gap, columns, radius, sweep });
  if (created.length === 0) fail('Не удалось размножить слои');
  return {
    summary: `Создано копий: ${created.length} (${mode}, всего ${count} элементов)`,
    createdLayerIds: created.map((layer) => layer.id),
  };
}

function placeInBoundsTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const box = {
    x: requiredNumber(args, 'x', -100000, 100000),
    y: requiredNumber(args, 'y', -100000, 100000),
    width: requiredNumber(args, 'width', 1, 100000),
    height: requiredNumber(args, 'height', 1, 100000),
  };
  const mode = optionalEnum(args, 'mode', ['fit', 'fill'] as const) ?? 'fit';
  const locked = flattenLayers(useEditorStore.getState().scene.layers).filter(
    (layer) => ids.includes(layer.id) && layer.locked
  ).length;
  if (locked === ids.length) fail('Все указанные слои заблокированы');
  placeLayersInBounds(ids, box, mode);
  return {
    summary: `Вписано в прямоугольник ${box.width}×${box.height}: ${ids.length - locked} сл. (${mode})`,
    layerIds: ids,
    box,
  };
}

export const TRANSFORM_TOOLS: ToolSpec[] = [
  {
    label: 'Выравнивание',
    handler: alignLayersTool,
    definition: {
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
  },
  {
    label: 'Отражение',
    handler: flipLayersTool,
    definition: {
      name: 'flip_layers',
      description:
        'Отразить слои зеркально относительно общего центра. axis=horizontal — лево/право, vertical — верх/низ. Меняет сами слои, не создаёт копий.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: LAYER_IDS_SCHEMA,
          axis: { type: 'string', enum: ['horizontal', 'vertical'] },
        },
        required: ['axis'],
      },
    },
  },
  {
    label: 'Поворот',
    handler: rotateLayersTool,
    definition: {
      name: 'rotate_layers',
      description:
        'Повернуть каждый слой вокруг своей опорной точки на angle градусов по часовой стрелке. Для точной ориентации деталей.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: LAYER_IDS_SCHEMA,
          angle: { type: 'number', description: 'Градусы, -3600..3600' },
        },
        required: ['angle'],
      },
    },
  },
  {
    label: 'Зеркальный дубль',
    handler: mirrorDuplicateTool,
    definition: {
      name: 'mirror_duplicate',
      description:
        'Дублировать слои зеркально относительно центральной оси артборда: горизонтальное отражение ставит копию слева/справа, вертикальное — сверху/снизу. Основной способ делать симметричные пары (уши, глаза, крылья).',
      parameters: {
        type: 'object',
        properties: {
          layerIds: LAYER_IDS_SCHEMA,
          axis: { type: 'string', enum: ['horizontal', 'vertical'] },
        },
        required: ['axis'],
      },
    },
  },
  {
    label: 'Повтор',
    handler: repeatLayerTool,
    definition: {
      name: 'repeat_layer',
      description:
        'Размножить слои: row — в ряд по X, column — в столбец по Y, grid — сеткой, ring — по кольцу вокруг центра артборда. count — всего элементов вместе с исходным.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: LAYER_IDS_SCHEMA,
          mode: { type: 'string', enum: ['row', 'column', 'grid', 'ring'] },
          count: { type: 'integer', description: 'Всего элементов, 2..40' },
          gap: { type: 'number', description: 'Зазор между копиями в px, по умолчанию 20' },
          columns: {
            type: 'integer',
            description: 'Колонок для grid, 2..10, по умолчанию 3',
          },
          radius: {
            type: 'number',
            description: 'Радиус кольца в px (по умолчанию от центра артборда)',
          },
          sweep: { type: 'number', description: 'Угол кольца, -360..360, по умолчанию 360' },
        },
        required: ['mode', 'count'],
      },
    },
  },
  {
    label: 'Вписать в прямоугольник',
    handler: placeInBoundsTool,
    definition: {
      name: 'place_in_bounds',
      description:
        'Точно вписать слои в прямоугольник (x, y, width, height) с сохранением пропорций: fit — целиком внутри, fill — заполнить с обрезкой краёв. Избавляет от ручного пересчёта scale.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: LAYER_IDS_SCHEMA,
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          mode: { type: 'string', enum: ['fit', 'fill'] },
        },
        required: ['x', 'y', 'width', 'height'],
      },
    },
  },
];
