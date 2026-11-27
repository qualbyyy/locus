import type { SmartShapeOptions, SmartShapePreset, ToolType } from '../../core/types';
import { NumberField } from '../InspectorControls';
import { Slider } from '../controls';

const SHAPE_PRESETS: Array<{ id: SmartShapePreset; label: string }> = [
  { id: 'ellipse', label: 'Круг' },
  { id: 'rect', label: 'Прям.' },
  { id: 'polygon', label: 'Полигон' },
  { id: 'star', label: 'Звезда' },
  { id: 'capsule', label: 'Капсула' },
];

export interface InspectorToolOptionsProps {
  activeTool: ToolType;
  smartShapeOptions: SmartShapeOptions;
  pencilSmoothness: number;
  onChangeSmartShapeOptions: (patch: Partial<SmartShapeOptions>) => void;
  onChangePencilSmoothness: (val: number) => void;
}

export function InspectorToolOptions({
  activeTool,
  smartShapeOptions,
  pencilSmoothness,
  onChangeSmartShapeOptions,
  onChangePencilSmoothness,
}: InspectorToolOptionsProps) {
  return (
    <>
      {activeTool === 'pencil' && (
        <div className="flex flex-col gap-2 border-b border-paper-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
              Карандаш
            </span>
            <span className="font-display text-[11px] text-paper-ink">
              {pencilSmoothness.toFixed(1)}
            </span>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-paper-muted">Авто-сглаживание</span>
            <Slider
              value={pencilSmoothness}
              min={0.5}
              max={12}
              step={0.5}
              ariaLabel="Сглаживание карандаша"
              onChange={onChangePencilSmoothness}
            />
          </label>
        </div>
      )}

      {activeTool === 'shapeBuilder' && (
        <div className="flex flex-col gap-1 border-b border-paper-border p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
            Конструктор фигур
          </span>
          <p className="text-[11px] leading-snug text-paper-muted">
            Проведите по пересечениям для объединения; Alt + клик или штрих — удалить область.
          </p>
        </div>
      )}

      {activeTool === 'knife' && (
        <div className="flex flex-col gap-1 border-b border-paper-border p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
            Нож и Ножницы
          </span>
          <p className="text-[11px] leading-snug text-paper-muted">
            Проведите линию — разрезать фигуру (Shift — прямо); клик по контуру — точка разреза.
          </p>
        </div>
      )}

      {activeTool === 'blob' && (
        <div className="flex flex-col gap-2.5 border-b border-paper-border p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
            Умная фигура
          </span>

          <div className="grid grid-cols-3 gap-1">
            {SHAPE_PRESETS.map((preset) => {
              const active = smartShapeOptions.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onChangeSmartShapeOptions({ preset: preset.id })}
                  className={`h-6 rounded border px-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-paper-accent bg-paper-accent text-white'
                      : 'border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {(smartShapeOptions.preset === 'blob' ||
            smartShapeOptions.preset === 'polygon' ||
            smartShapeOptions.preset === 'star') && (
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] text-paper-muted">
                <span>Точки / лучи</span>
                <span className="font-display text-paper-ink">{smartShapeOptions.points}</span>
              </div>
              <Slider
                value={smartShapeOptions.points}
                min={3}
                max={24}
                step={1}
                ariaLabel="Точки и лучи"
                onChange={(points) => onChangeSmartShapeOptions({ points })}
              />
            </label>
          )}

          {smartShapeOptions.preset === 'blob' && (
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] text-paper-muted">
                <span>Неровность (Wobble)</span>
                <span className="font-display text-paper-ink">
                  {smartShapeOptions.wobble.toFixed(2)}
                </span>
              </div>
              <Slider
                value={smartShapeOptions.wobble}
                min={0}
                max={1}
                step={0.05}
                ariaLabel="Неровность"
                onChange={(wobble) => onChangeSmartShapeOptions({ wobble })}
              />
            </label>
          )}

          {smartShapeOptions.preset === 'rect' && (
            <NumberField
              label="Скругление углов (px)"
              value={smartShapeOptions.cornerRadius}
              min={0}
              max={400}
              onCommit={(cornerRadius) => onChangeSmartShapeOptions({ cornerRadius })}
            />
          )}

          {smartShapeOptions.preset === 'star' && (
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] text-paper-muted">
                <span>Внутренний радиус</span>
                <span className="font-display text-paper-ink">
                  {smartShapeOptions.innerRadiusRatio.toFixed(2)}
                </span>
              </div>
              <Slider
                value={smartShapeOptions.innerRadiusRatio}
                min={0.1}
                max={0.9}
                step={0.05}
                ariaLabel="Внутренний радиус"
                onChange={(innerRadiusRatio) =>
                  onChangeSmartShapeOptions({ innerRadiusRatio })
                }
              />
            </label>
          )}
        </div>
      )}
    </>
  );
}
