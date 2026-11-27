import type { AppSettings, SettingsPatch } from '../../core/settings';
import { NumberField } from '../InspectorControls';
import { Slider } from '../controls';
import { SettingNumberRow, ToggleRow } from './SettingsPrimitives';

interface CanvasTabProps {
  settings: AppSettings;
  updateSettings: (patch: SettingsPatch) => void;
}

export function CanvasTab({ settings, updateSettings }: CanvasTabProps) {
  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        label="Показывать сетку на артборде"
        hint="Горячая клавиша: Ctrl+'"
        checked={settings.showGrid}
        onChange={(showGrid) => updateSettings({ showGrid })}
      />

      <div className="flex flex-col gap-2 rounded border border-paper-border bg-paper-bg/60 p-3">
        <div className="flex items-end justify-between gap-3">
          <div className="w-32">
            <NumberField
              label="Шаг сетки (px)"
              value={settings.gridSize}
              min={4}
              max={128}
              onCommit={(gridSize) => updateSettings({ gridSize })}
            />
          </div>
          <div className="flex gap-1">
            {[8, 16, 32, 64].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => updateSettings({ gridSize: size })}
                className={`h-7 rounded border px-2 font-display text-[11px] ${
                  settings.gridSize === size
                    ? 'border-paper-accent bg-paper-accent/15 font-medium text-paper-ink'
                    : 'border-paper-border bg-paper-panel text-paper-ink hover:bg-paper-hover'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-paper-muted">
            <span>Прозрачность сетки</span>
            <span className="font-display text-paper-ink">
              {Math.round(settings.gridOpacity * 100)}%
            </span>
          </div>
          <Slider
            value={settings.gridOpacity}
            min={0.05}
            max={0.6}
            step={0.01}
            ariaLabel="Прозрачность сетки"
            onChange={(gridOpacity) => updateSettings({ gridOpacity })}
          />
        </label>
      </div>

      <ToggleRow
        label="Привязка к сетке"
        hint="Удерживайте Ctrl при перетаскивании, чтобы временно отключить"
        checked={settings.snapToGrid}
        onChange={(snapToGrid) => updateSettings({ snapToGrid })}
      />
      <ToggleRow
        label="Умные направляющие (к объектам)"
        hint="Показывает линии выравнивания с соседними слоями"
        checked={settings.snapToObjects}
        onChange={(snapToObjects) => updateSettings({ snapToObjects })}
      />
      <ToggleRow
        label="Привязка к границам и центру артборда"
        checked={settings.snapToArtboard}
        onChange={(snapToArtboard) => updateSettings({ snapToArtboard })}
      />

      <SettingNumberRow
        label="Порог привязки (px)"
        hint="Дистанция срабатывания направляющих (2–20 px)"
        value={settings.snapThreshold}
        min={2}
        max={20}
        onCommit={(snapThreshold) =>
          updateSettings({ snapThreshold })
        }
      />
    </div>
  );
}
