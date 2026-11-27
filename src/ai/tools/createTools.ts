import {
  addLayer,
  createLayerId,
  createShapeLayer,
  createTextLayer,
  updateLayers,
} from '../../core/commands';
import { flattenLayers } from '../../core/layerTree';
import { useEditorStore } from '../../core/store';
import type { PathLayer, SmartShapeOptions, SmartShapePreset } from '../../core/types';
import {
  STROKE_SCHEMA,
  type ToolSpec,
  asRecord,
  describeLayer,
  fail,
  optionalBoolean,
  optionalColor,
  optionalEnum,
  optionalFontWeight,
  optionalNumber,
  optionalString,
  optionalStroke,
  readFontFamily,
  readNumberValue,
  requiredEnum,
  requiredNumber,
  requiredString,
} from './validation';

const PRESETS: SmartShapePreset[] = ['ellipse', 'rect', 'polygon', 'star', 'capsule'];

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
    fontFamily:
      args.fontFamily !== undefined && args.fontFamily !== null
        ? readFontFamily(args.fontFamily, 'fontFamily')
        : undefined,
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
    flattenLayers(useEditorStore.getState().scene.layers).filter((l) => l.type === 'path').length +
    1;

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

export const CREATE_TOOLS: ToolSpec[] = [
  {
    label: 'Клякса',
    handler: createBlob,
    definition: {
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
  },
  {
    label: 'Фигура',
    handler: createShape,
    definition: {
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
  },
  {
    label: 'Текст',
    handler: createText,
    definition: {
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
            description:
              'Семейство шрифта (встроенное: Inter, Manrope, Golos Text, Playfair Display, JetBrains Mono, Unbounded или загруженное в проект)',
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
  },
  {
    label: 'Линия',
    handler: createLine,
    definition: {
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
  },
];
