import { isValidHexColor } from '../../core/themes';
import type { Layer, PathLayer, Scene, StrokeStyle } from '../../core/types';
import { HexColorRow, NumberField, SegmentedButton } from '../InspectorControls';

const DEFAULT_STROKE: StrokeStyle = {
  color: '#1c1b1a',
  width: 2,
  lineCap: 'round',
  lineJoin: 'round',
};

const LINE_CAP_OPTIONS: Array<{
  value: NonNullable<StrokeStyle['lineCap']>;
  label: string;
}> = [
  { value: 'butt', label: 'Плоский' },
  { value: 'round', label: 'Круглый' },
  { value: 'square', label: 'Квадратный' },
];

const LINE_JOIN_OPTIONS: Array<{
  value: NonNullable<StrokeStyle['lineJoin']>;
  label: string;
}> = [
  { value: 'miter', label: 'Острый' },
  { value: 'round', label: 'Круглый' },
  { value: 'bevel', label: 'Скошенный' },
];

const FILL_RULE_OPTIONS: Array<{
  value: PathLayer['fillRule'];
  label: string;
  title: string;
}> = [
  { value: 'nonzero', label: 'Сплошная', title: 'Сплошная (nonzero)' },
  { value: 'evenodd', label: 'С вырезами', title: 'С вырезами (evenodd)' },
];

export function collectDocumentColors(scene: Scene, maxColors = 16): string[] {
  const seen = new Set<string>();
  const add = (hex: string | null | undefined) => {
    if (!hex) return;
    const normalized = hex.trim().toLowerCase();
    if (!isValidHexColor(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
  };

  for (const layer of scene.layers) {
    if (layer.type === 'path') {
      add(layer.fill);
      add(layer.stroke?.color);
    } else if (layer.type === 'text') {
      add(layer.fill);
    }
    if (seen.size >= maxColors) break;
  }

  if (seen.size < maxColors) {
    add(scene.background);
  }

  return Array.from(seen).slice(0, maxColors);
}

export function DocumentColorSwatches({
  colors,
  activeColor,
  onSelect,
}: {
  colors: string[];
  activeColor?: string | null;
  onSelect: (hex: string) => void;
}) {
  if (colors.length === 0) return null;
  const activeNormalized = activeColor?.toLowerCase() ?? null;

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <span className="text-[10px] text-paper-muted">Цвета документа</span>
      <div className="flex flex-wrap gap-1">
        {colors.map((hex) => {
          const isCurrent = activeNormalized === hex;
          return (
            <button
              key={hex}
              type="button"
              title={`Применить ${hex}`}
              onClick={() => onSelect(hex)}
              style={{ backgroundColor: hex }}
              className={`h-4 w-4 rounded-sm border transition-transform hover:scale-110 ${
                isCurrent
                  ? 'border-paper-accent ring-1 ring-paper-accent'
                  : 'border-paper-border'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

interface InspectorAppearanceProps {
  layer: PathLayer;
  documentColors: string[];
  onUpdateLayers: (
    layerIds: string[],
    patch: Partial<Layer> | ((layer: Layer) => Layer)
  ) => void;
}

export function InspectorAppearance({
  layer,
  documentColors,
  onUpdateLayers,
}: InspectorAppearanceProps) {
  return (
    <>
      <div className="border-t border-paper-border pt-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-paper-muted">Заливка</span>
          {layer.fill !== null ? (
            <button
              type="button"
              onClick={() => onUpdateLayers([layer.id], { fill: null })}
              className="text-[11px] text-paper-muted hover:text-paper-danger"
            >
              Без заливки
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onUpdateLayers([layer.id], { fill: '#da7756' })}
              className="text-[11px] text-paper-accent hover:underline"
            >
              Добавить
            </button>
          )}
        </div>

        {layer.fill !== null && (
          <>
            <HexColorRow
              value={layer.fill}
              onChange={(fill) => onUpdateLayers([layer.id], { fill })}
            />
            <DocumentColorSwatches
              colors={documentColors}
              activeColor={layer.fill}
              onSelect={(fill) => onUpdateLayers([layer.id], { fill })}
            />
          </>
        )}
      </div>

      <div className="border-t border-paper-border pt-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-paper-muted">Обводка</span>
          {layer.stroke !== null ? (
            <button
              type="button"
              onClick={() => onUpdateLayers([layer.id], { stroke: null })}
              className="text-[11px] text-paper-muted hover:text-paper-danger"
            >
              Убрать
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                onUpdateLayers([layer.id], {
                  stroke: { ...DEFAULT_STROKE },
                })
              }
              className="text-[11px] text-paper-accent hover:underline"
            >
              Добавить
            </button>
          )}
        </div>

        {layer.stroke !== null && (
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <HexColorRow
                  value={layer.stroke.color}
                  onChange={(color) =>
                    onUpdateLayers([layer.id], {
                      stroke: { ...layer.stroke!, color },
                    })
                  }
                />
              </div>
              <div className="w-16">
                <NumberField
                  label="Толщ."
                  value={layer.stroke.width}
                  min={0.5}
                  max={200}
                  step={0.5}
                  decimals={1}
                  onCommit={(width) =>
                    onUpdateLayers([layer.id], {
                      stroke: { ...layer.stroke!, width },
                    })
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-paper-muted">Концы линии</span>
              <div className="flex gap-1">
                {LINE_CAP_OPTIONS.map((opt) => (
                  <SegmentedButton
                    key={opt.value}
                    active={(layer.stroke?.lineCap ?? 'round') === opt.value}
                    label={opt.label}
                    title={`${opt.label} (${opt.value})`}
                    onClick={() =>
                      onUpdateLayers([layer.id], {
                        stroke: { ...layer.stroke!, lineCap: opt.value },
                      })
                    }
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-paper-muted">Углы линии</span>
              <div className="flex gap-1">
                {LINE_JOIN_OPTIONS.map((opt) => (
                  <SegmentedButton
                    key={opt.value}
                    active={(layer.stroke?.lineJoin ?? 'round') === opt.value}
                    label={opt.label}
                    title={`${opt.label} (${opt.value})`}
                    onClick={() =>
                      onUpdateLayers([layer.id], {
                        stroke: { ...layer.stroke!, lineJoin: opt.value },
                      })
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-paper-border pt-2.5">
        <span className="text-[11px] text-paper-muted">Правило заливки</span>
        <div className="flex gap-1">
          {FILL_RULE_OPTIONS.map((opt) => (
            <SegmentedButton
              key={opt.value}
              active={layer.fillRule === opt.value}
              label={opt.label}
              title={opt.title}
              onClick={() => onUpdateLayers([layer.id], { fillRule: opt.value })}
            />
          ))}
        </div>
      </div>
    </>
  );
}
