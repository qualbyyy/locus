import {
  deleteLayers,
  deselectAllLayers,
  duplicateLayers,
  invertSelection,
  reorderLayer,
  selectAllLayers,
  selectSimilarLayers,
  setClipMask,
  transformTextCase,
  updateLayers,
} from '../../core/commands';
import {
  findLayerById,
  flattenLayers,
  getLayerWorldMatrix,
  getParentGroupId,
  getParentWorldMatrix,
} from '../../core/layerTree';
import {
  computeLayerBBoxWithMatrix,
  decomposeMatrix,
  safeScale,
} from '../../core/math';
import { BLEND_MODE_OPTIONS, isBlendMode } from '../../core/paint';
import { useEditorStore } from '../../core/store';
import type {
  BlendMode,
  FontFamily,
  Layer,
  PathLayer,
  StrokeStyle,
} from '../../core/types';
import {
  LAYER_IDS_SCHEMA,
  STROKE_SCHEMA,
  type ToolSpec,
  asRecord,
  fail,
  isLayerEffectivelyLocked,
  normalizeHexColor,
  optionalNumber,
  optionalStroke,
  readFontFamily,
  readFontWeight,
  readNumberValue,
  readStringValue,
  requiredEnum,
  requiredNumber,
  requiredString,
  resolveLayerIds,
  selectedOrGivenLayerIds,
} from './validation';

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
  blendMode?: BlendMode;
  fill?: string | null;
  stroke?: StrokeStyle | null;
  fillRule?: 'nonzero' | 'evenodd';
  content?: string;
  fontSize?: number;
  fontFamily?: FontFamily;
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
    patch.scaleX = safeScale(readNumberValue(obj.scaleX, 'patch.scaleX', -1000, 1000));
  }
  if (obj.scaleY !== undefined) {
    patch.scaleY = safeScale(readNumberValue(obj.scaleY, 'patch.scaleY', -1000, 1000));
  }
  if (obj.opacity !== undefined) {
    patch.opacity = readNumberValue(obj.opacity, 'patch.opacity', 0, 1);
  }
  if (obj.blendMode !== undefined) {
    if (!isBlendMode(obj.blendMode)) {
      fail(
        `patch.blendMode: допустимые значения — ${BLEND_MODE_OPTIONS.map((o) => o.value).join(', ')}`
      );
    }
    patch.blendMode = obj.blendMode;
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
    patch.fontFamily = readFontFamily(obj.fontFamily, 'patch.fontFamily');
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
    if (patch.blendMode !== undefined) next.blendMode = patch.blendMode;
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
    if (patch.blendMode !== undefined) next.blendMode = patch.blendMode;
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
  if (patch.blendMode !== undefined) next.blendMode = patch.blendMode;
  return next;
}

function updateLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const patch = parseLayerPatch(args.patch);
  const idSet = new Set(ids);
  const targets = flattenLayers(useEditorStore.getState().scene.layers).filter((layer) =>
    idSet.has(layer.id)
  );
  if (patch.fill === null && targets.some((layer) => layer.type === 'text')) {
    fail('patch.fill: для текстового слоя нельзя задать пустую заливку (null)');
  }
  updateLayers(ids, (layer) => applyLayerPatch(layer, patch));
  const names = flattenLayers(useEditorStore.getState().scene.layers)
    .filter((layer) => idSet.has(layer.id))
    .map((layer) => layer.name);
  return {
    summary: `Изменено слоёв: ${ids.length}${names.length ? ` (${names.join(', ')})` : ''}`,
    layerIds: ids,
  };
}

function deleteLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveLayerIds(args.layerIds);
  const scene = useEditorStore.getState().scene;
  const idSet = new Set(ids);
  const names = flattenLayers(scene.layers)
    .filter((layer) => idSet.has(layer.id))
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
  const target = findLayerById(scene.layers, layerId);
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
    rawMask === null ||
    rawMask === undefined ||
    (typeof rawMask === 'string' &&
      ['', 'none', 'null'].includes(rawMask.trim().toLowerCase()))
      ? null
      : readStringValue(rawMask, 'maskLayerId', 200);
  const targets = resolveLayerIds(args.targetLayerIds, 'targetLayerIds');

  if (maskLayerId === null) {
    setClipMask(null, targets);
    return { summary: `Маска снята со слоёв: ${targets.length}`, targetLayerIds: targets };
  }

  const layers = useEditorStore.getState().scene.layers;
  const mask = findLayerById(layers, maskLayerId);
  if (!mask || mask.type !== 'path') {
    fail(`Маска «${maskLayerId}» не найдена или не является векторным контуром`);
  }
  const maskParent = getParentGroupId(layers, maskLayerId);
  const validTargets = targets.filter(
    (id) => id !== maskLayerId && getParentGroupId(layers, id) === maskParent
  );
  if (validTargets.length === 0) {
    fail('Маска и маскируемые слои должны находиться в одной группе (на одном уровне)');
  }
  setClipMask(maskLayerId, validTargets);
  return {
    summary: `Маска «${mask.name}» применена к слоям: ${validTargets.length}`,
    maskLayerId,
    targetLayerIds: validTargets,
  };
}

function textCaseTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = selectedOrGivenLayerIds(args);
  const mode = requiredEnum(args, 'mode', ['upper', 'lower', 'title'] as const);
  const idSet = new Set(ids);
  const sceneLayers = useEditorStore.getState().scene.layers;
  const textLayers = flattenLayers(sceneLayers).filter(
    (layer) => idSet.has(layer.id) && layer.type === 'text'
  );
  if (textLayers.length === 0) fail('text_case: среди слоёв нет текста');
  const unlockedText = textLayers.filter(
    (layer) => !isLayerEffectivelyLocked(sceneLayers, layer.id)
  );
  if (unlockedText.length === 0) fail('text_case: все текстовые слои заблокированы');
  const before = new Map(
    unlockedText.map((layer) => [layer.id, layer.type === 'text' ? layer.content : ''])
  );
  const unlockedIds = unlockedText.map((layer) => layer.id);
  transformTextCase(unlockedIds, mode);
  const changed = flattenLayers(useEditorStore.getState().scene.layers).filter((layer) => {
    if (layer.type !== 'text') return false;
    const previous = before.get(layer.id);
    return previous !== undefined && previous !== layer.content;
  }).length;
  return {
    summary: `Регистр изменён: ${changed} текстовых слоёв (${mode})`,
    changed,
  };
}

function selectLayersTool(args: Record<string, unknown>): Record<string, unknown> {
  const mode = requiredEnum(args, 'mode', [
    'ids',
    'all',
    'none',
    'invert',
    'similar_fill',
    'similar_stroke',
    'similar_type',
  ] as const);

  if (mode === 'ids') {
    const ids = resolveLayerIds(args.layerIds);
    useEditorStore.setState({ selectedIds: ids, selectedNode: null });
  } else if (mode === 'all') {
    selectAllLayers();
  } else if (mode === 'none') {
    deselectAllLayers();
  } else if (mode === 'invert') {
    invertSelection();
  } else {
    const criterion =
      mode === 'similar_fill' ? 'fill' : mode === 'similar_stroke' ? 'stroke' : 'type';
    const matched = selectSimilarLayers(criterion);
    if (matched === 0) {
      fail('Для выделения похожих нужен выделенный слой с заливкой или обводкой');
    }
  }

  const state = useEditorStore.getState();
  const names = flattenLayers(state.scene.layers)
    .filter((layer) => state.selectedIds.includes(layer.id))
    .map((layer) => layer.name);
  return {
    summary: `Выделено слоёв: ${state.selectedIds.length}${
      names.length > 0 ? ` (${names.slice(0, 10).join(', ')})` : ''
    }`,
    selectedIds: state.selectedIds,
  };
}

function getLayerGeometryTool(args: Record<string, unknown>): Record<string, unknown> {
  const state = useEditorStore.getState();
  let ids: string[];
  if (args.layerIds === undefined || args.layerIds === null) {
    ids = state.selectedIds;
    if (ids.length === 0) {
      fail('Укажите layerIds или сначала выделите слои');
    }
  } else {
    ids = resolveLayerIds(args.layerIds);
  }

  const round = (value: number) => Math.round(value * 10) / 10;
  const MAX_ANCHORS = 200;
  const idSet = new Set(ids);
  const layers = flattenLayers(state.scene.layers)
    .filter((layer) => idSet.has(layer.id))
    .map((layer) => {
      const box = computeLayerBBoxWithMatrix(
        layer,
        getParentWorldMatrix(state.scene.layers, layer.id)
      );
      const worldDecomp = decomposeMatrix(
        getLayerWorldMatrix(state.scene.layers, layer.id)
      );
      const parentGroupId = getParentGroupId(state.scene.layers, layer.id);
      const base = {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        visible: layer.visible,
        locked: layer.locked,
        x: round(layer.x),
        y: round(layer.y),
        rotation: round(layer.rotation),
        scaleX: round(layer.scaleX),
        scaleY: round(layer.scaleY),
        opacity: round(layer.opacity),
        ...(parentGroupId ? { parentGroupId } : {}),
        world: {
          x: round(worldDecomp.x),
          y: round(worldDecomp.y),
          rotation: round(worldDecomp.rotation),
          scaleX: round(worldDecomp.scaleX),
          scaleY: round(worldDecomp.scaleY),
        },
        bbox: {
          x: round(box.x),
          y: round(box.y),
          width: round(box.width),
          height: round(box.height),
        },
      };

      if (layer.type === 'path') {
        const anchorCount = layer.subpaths.reduce(
          (total, subpath) => total + subpath.anchors.length,
          0
        );
        let budget = MAX_ANCHORS;
        const subpaths = layer.subpaths.map((subpath) => {
          const anchors = subpath.anchors.slice(0, Math.max(0, budget)).map((anchor) => ({
            x: round(anchor.x),
            y: round(anchor.y),
            handleIn: { x: round(anchor.handleIn.x), y: round(anchor.handleIn.y) },
            handleOut: { x: round(anchor.handleOut.x), y: round(anchor.handleOut.y) },
            smooth: anchor.smooth,
          }));
          budget -= anchors.length;
          return { closed: subpath.closed, anchors };
        });
        return {
          ...base,
          fill: layer.fill,
          stroke: layer.stroke,
          fillRule: layer.fillRule,
          anchorCount,
          anchorsTruncated: anchorCount > MAX_ANCHORS,
          subpaths,
        };
      }

      if (layer.type === 'text') {
        return {
          ...base,
          content: layer.content,
          fontFamily: layer.fontFamily,
          fontWeight: layer.fontWeight,
          fontSize: layer.fontSize,
          lineHeight: layer.lineHeight,
          letterSpacing: layer.letterSpacing ?? 0,
          align: layer.align,
          fill: layer.fill,
        };
      }

      if (layer.type === 'group') {
        return {
          ...base,
          childIds: layer.children.map((child) => child.id),
          childrenCount: layer.children.length,
        };
      }

      return { ...base, width: layer.width, height: layer.height, assetId: layer.assetId };
    });

  return {
    summary: `Геометрия слоёв: ${layers.length}`,
    layers,
  };
}

export const LAYER_TOOLS: ToolSpec[] = [
  {
    label: 'Изменение слоёв',
    handler: updateLayersTool,
    definition: {
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
              blendMode: {
                type: 'string',
                enum: BLEND_MODE_OPTIONS.map((o) => o.value),
                description: 'Режим наложения слоя',
              },
              fill: { type: 'string', description: 'hex или "none"' },
              stroke: STROKE_SCHEMA,
              fillRule: { type: 'string', enum: ['nonzero', 'evenodd'] },
              content: { type: 'string', description: 'Текст для TextLayer' },
              fontSize: { type: 'number' },
              fontFamily: {
                type: 'string',
                description: 'Семейство шрифта (встроенное или загруженное в проект)',
              },
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
  },
  {
    label: 'Удаление слоёв',
    handler: deleteLayersTool,
    definition: {
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
  },
  {
    label: 'Дублирование',
    handler: duplicateLayersTool,
    definition: {
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
  },
  {
    label: 'Порядок слоёв',
    handler: reorderLayersTool,
    definition: {
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
  },
  {
    label: 'Маска',
    handler: setClipMaskTool,
    definition: {
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
  },
  {
    label: 'Регистр текста',
    handler: textCaseTool,
    definition: {
      name: 'text_case',
      description:
        'Сменить регистр текстовых слоёв: upper, lower или title (каждое слово с заглавной).',
      parameters: {
        type: 'object',
        properties: {
          layerIds: LAYER_IDS_SCHEMA,
          mode: { type: 'string', enum: ['upper', 'lower', 'title'] },
        },
        required: ['mode'],
      },
    },
  },
  {
    label: 'Выделение',
    handler: selectLayersTool,
    definition: {
      name: 'select_layers',
      description:
        'Управлять выделением: ids (по списку), all, none, invert, similar_fill, similar_stroke, similar_type. Выбор не меняет сцену, но влияет на инструменты без layerIds.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: [
              'ids',
              'all',
              'none',
              'invert',
              'similar_fill',
              'similar_stroke',
              'similar_type',
            ],
          },
          layerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Только для mode=ids',
          },
        },
        required: ['mode'],
      },
    },
  },
  {
    label: 'Геометрия слоёв',
    handler: getLayerGeometryTool,
    definition: {
      name: 'get_layer_geometry',
      description:
        'Прочитать точную геометрию слоёв: локальные anchors с усиками, fill, stroke и мировой bbox. Вызывай перед изменением или доработкой существующей фигуры, чтобы понять её форму.',
      parameters: {
        type: 'object',
        properties: {
          layerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'id слоёв; без него — текущее выделение',
          },
        },
      },
    },
  },
];
