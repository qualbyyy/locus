import { sanitizeDashArray } from '../../core/paint';
import { useEditorStore } from '../../core/store';
import type { Layer, PathLayer, StrokeStyle } from '../../core/types';
import { NumberField, SegmentedButton } from '../InspectorControls';
import {
  collectDocumentColors,
  DocumentColorSwatches,
  PaintEditor,
} from './PaintEditor';

export { collectDocumentColors, DocumentColorSwatches };

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
  const activeDash = layer.stroke ? sanitizeDashArray(layer.stroke.dashArray) : undefined;
  const dashMode: 'solid' | 'dashed' | 'dotted' = !activeDash
    ? 'solid'
    : activeDash[0] <= 2
      ? 'dotted'
      : 'dashed';

  return (
    <div data-tour="inspector.appearance" className="flex flex-col gap-3">
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
          <PaintEditor
            value={layer.fill}
            documentColors={documentColors}
            onFocusGradient={() =>
              useEditorStore.getState().setActiveGradientTarget('fill')
            }
            onChange={(fill) => onUpdateLayers([layer.id], { fill })}
          />
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
            <PaintEditor
              value={layer.stroke.color}
              documentColors={documentColors}
              onFocusGradient={() =>
                useEditorStore.getState().setActiveGradientTarget('stroke')
              }
              onChange={(color) =>
                onUpdateLayers([layer.id], {
                  stroke: { ...layer.stroke!, color },
                })
              }
            />

            <NumberField
              label="Толщина (px)"
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

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] text-paper-muted">Пунктир</span>
              <div className="flex gap-1">
                <SegmentedButton
                  active={dashMode === 'solid'}
                  label="Сплошная"
                  onClick={() => {
                    const { dashArray: _d, dashOffset: _o, ...rest } = layer.stroke!;
                    onUpdateLayers([layer.id], { stroke: rest });
                  }}
                />
                <SegmentedButton
                  active={dashMode === 'dashed'}
                  label="Пунктир"
                  onClick={() =>
                    onUpdateLayers([layer.id], {
                      stroke: { ...layer.stroke!, dashArray: [8, 6] },
                    })
                  }
                />
                <SegmentedButton
                  active={dashMode === 'dotted'}
                  label="Точки"
                  onClick={() =>
                    onUpdateLayers([layer.id], {
                      stroke: { ...layer.stroke!, dashArray: [1, 6] },
                    })
                  }
                />
              </div>

              {activeDash && (
                <div className="grid grid-cols-3 gap-1.5">
                  <NumberField
                    label="Штрих"
                    value={activeDash[0]}
                    min={0.5}
                    max={500}
                    step={0.5}
                    decimals={1}
                    onCommit={(dashLen) =>
                      onUpdateLayers([layer.id], {
                        stroke: {
                          ...layer.stroke!,
                          dashArray: [dashLen, activeDash[1] ?? activeDash[0]],
                        },
                      })
                    }
                  />
                  <NumberField
                    label="Пробел"
                    value={activeDash[1] ?? activeDash[0]}
                    min={0.5}
                    max={500}
                    step={0.5}
                    decimals={1}
                    onCommit={(gapLen) =>
                      onUpdateLayers([layer.id], {
                        stroke: {
                          ...layer.stroke!,
                          dashArray: [activeDash[0], gapLen],
                        },
                      })
                    }
                  />
                  <NumberField
                    label="Сдвиг"
                    value={layer.stroke.dashOffset ?? 0}
                    min={-500}
                    max={500}
                    step={1}
                    decimals={1}
                    onCommit={(dashOffset) =>
                      onUpdateLayers([layer.id], {
                        stroke: { ...layer.stroke!, dashOffset },
                      })
                    }
                  />
                </div>
              )}
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
    </div>
  );
}
