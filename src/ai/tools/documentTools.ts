import { getActiveArtboard } from '../../core/artboards';
import { updateArtboard, updateLayers } from '../../core/commands';
import { flattenLayers } from '../../core/layerTree';
import { useEditorStore } from '../../core/store';
import { recolorSceneWithPalette } from '../palette';
import { runPreflightCheck } from '../preflight';
import {
  LAYER_IDS_SCHEMA,
  type ToolSpec,
  fail,
  isLayerEffectivelyLocked,
  normalizeHexColor,
  optionalBoolean,
  optionalNumber,
  optionalString,
  readStringValue,
  requiredNumber,
  resolveLayerIds,
} from './validation';

function reportPlan(args: Record<string, unknown>): Record<string, unknown> {
  const steps = Math.round(requiredNumber(args, 'steps', 1, 12));
  const summary = optionalString(args, 'summary', 500);
  return {
    summary: summary ? `План: ${summary}` : 'План готов',
    plannedSteps: steps,
  };
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
  const flatLayers = flattenLayers(scene.layers);
  const requested =
    args.layerIds === undefined || args.layerIds === null
      ? flatLayers.filter((layer) => layer.type === 'path' || layer.type === 'text')
      : (() => {
          const ids = resolveLayerIds(args.layerIds, 'layerIds');
          const idSet = new Set(ids);
          return flatLayers.filter(
            (layer) =>
              idSet.has(layer.id) &&
              (layer.type === 'path' || layer.type === 'text')
          );
        })();

  const unlocked = requested.filter(
    (layer) => !isLayerEffectivelyLocked(scene.layers, layer.id)
  );

  if (unlocked.length === 0 && !includeBackground) {
    fail('Нет разблокированных слоёв для перекраски');
  }

  const colorById = new Map(
    unlocked.map((layer, index) => [layer.id, colors[index % colors.length]])
  );

  if (unlocked.length > 0) {
    updateLayers(
      unlocked.map((layer) => layer.id),
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
    summary: `Палитра применена: ${unlocked.length} сл.${includeBackground ? `, фон ${colors[0]}` : ''}`,
    colors,
    paintedLayerIds: unlocked.map((layer) => layer.id),
  };
}

function setArtboardTool(args: Record<string, unknown>): Record<string, unknown> {
  if (args.name !== undefined) {
    fail('set_artboard: менять имя документа и метаданные файла запрещено');
  }
  const patch: {
    width?: number;
    height?: number;
    dpi?: number;
    background?: string;
  } = {};
  if (args.width !== undefined) patch.width = optionalNumber(args, 'width', 64, 16000, 1080);
  if (args.height !== undefined) {
    patch.height = optionalNumber(args, 'height', 64, 16000, 1080);
  }
  if (args.dpi !== undefined) patch.dpi = optionalNumber(args, 'dpi', 72, 600, 72);
  if (args.background !== undefined) {
    patch.background = normalizeHexColor(args.background, 'background');
  }
  if (Object.keys(patch).length === 0) {
    fail('set_artboard: передайте хотя бы одно из полей width, height, dpi, background');
  }
  const scene = updateArtboard(patch);
  const activeAb = getActiveArtboard(scene, useEditorStore.getState().activeArtboardId);
  return {
    summary: `Артборд: ${activeAb.width}×${activeAb.height} px, DPI ${scene.dpi}, фон ${activeAb.background}`,
    artboard: {
      id: activeAb.id,
      name: activeAb.name,
      width: activeAb.width,
      height: activeAb.height,
      dpi: scene.dpi,
      background: activeAb.background,
    },
  };
}

function recolorPaletteTool(args: Record<string, unknown>): Record<string, unknown> {
  const rawPalette = args.palette;
  if (!Array.isArray(rawPalette) || rawPalette.length === 0) {
    fail('recolor_palette: нужен непустой массив palette из hex-цветов');
  }
  const palette = rawPalette.map((item, idx) =>
    readStringValue(item, `palette[${idx}]`, 32)
  );
  const layerIds =
    args.layerIds !== undefined && args.layerIds !== null
      ? resolveLayerIds(args.layerIds, 'layerIds')
      : undefined;
  let includeBackground: boolean | undefined;
  if (args.includeBackground !== undefined && args.includeBackground !== null) {
    if (typeof args.includeBackground !== 'boolean') {
      fail('includeBackground: ожидается true или false');
    }
    includeBackground = args.includeBackground;
  }
  const preserveContrast = optionalBoolean(args, 'preserveContrast', true);

  const res = recolorSceneWithPalette(palette, {
    layerIds,
    includeBackground,
    preserveContrast,
  });
  return {
    summary: `Перекрашено по палитре (${res.palette.slice(0, 4).join(', ')}): ${res.updatedLayers} сл.${res.updatedBackground && res.backgroundColor ? `, фон ${res.backgroundColor}` : ''}`,
    ...res,
  };
}

function preflightCheckTool(args: Record<string, unknown>): Record<string, unknown> {
  const artboardId = optionalString(args, 'artboardId', 128);
  const state = useEditorStore.getState();
  const report = runPreflightCheck(
    state.scene,
    artboardId ?? state.activeArtboardId
  );
  return {
    summary: report.summary,
    dpi: report.dpi,
    issueCount: report.issues.length,
    issues: report.issues,
  };
}

export const DOCUMENT_TOOLS: ToolSpec[] = [
  {
    label: 'План',
    handler: reportPlan,
    definition: {
      name: 'report_plan',
      description:
        'Зафиксировать план работы. Вызывай первым действием: steps — сколько всего ответов с инструментами понадобится (2–10), summary — план одной строкой. Не меняет сцену.',
      parameters: {
        type: 'object',
        properties: {
          steps: { type: 'integer', description: 'Сколько шагов планируется, 2–10' },
          summary: { type: 'string', description: 'Краткий план действий' },
        },
        required: ['steps'],
      },
    },
  },
  {
    label: 'Палитра',
    handler: applyPaletteTool,
    definition: {
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
  },
  {
    label: 'Артборд',
    handler: setArtboardTool,
    definition: {
      name: 'set_artboard',
      description:
        'Изменить артборд: размер в px, DPI, цвет фона. Единственный способ залить фон холста. Метаданные и имя документа не меняет.',
      parameters: {
        type: 'object',
        properties: {
          width: { type: 'number', description: '64..16000 px' },
          height: { type: 'number', description: '64..16000 px' },
          dpi: { type: 'number', description: '72..600' },
          background: { type: 'string', description: 'Фон артборда, hex #rrggbb' },
        },
      },
    },
  },
  {
    label: 'Перекраска по палитре',
    handler: recolorPaletteTool,
    definition: {
      name: 'recolor_palette',
      description:
        'Перекрасить макет (фигуры, градиенты, фон и текст) в заданную hex-палитру с автоматической защитой контраста WCAG для текста.',
      parameters: {
        type: 'object',
        properties: {
          palette: {
            type: 'array',
            items: { type: 'string' },
            description: 'Массив hex-цветов референса (#rrggbb), 2–6 цветов',
          },
          layerIds: LAYER_IDS_SCHEMA,
          includeBackground: {
            type: 'boolean',
            description: 'Обновлять ли цвет фона артборда (по умолчанию true для всей сцены)',
          },
          preserveContrast: {
            type: 'boolean',
            description: 'Гарантировать читаемый контраст текста WCAG >= 4.5 (по умолчанию true)',
          },
        },
        required: ['palette'],
      },
    },
  },
  {
    label: 'Проверка макета',
    handler: preflightCheckTool,
    definition: {
      name: 'preflight_check',
      description:
        'Проверить макет (preflight): контраст текста WCAG, мелкий кегль для 300 dpi и слои, выходящие за края артборда.',
      parameters: {
        type: 'object',
        properties: {
          artboardId: {
            type: 'string',
            description: 'Опциональный ID артборда для проверки',
          },
        },
      },
    },
  },
];
