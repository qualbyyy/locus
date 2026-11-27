import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  type AppSettings,
  type SettingsPatch,
  loadSceneDraft,
  useSettingsStore,
} from '../../core/settings';
import type { Scene } from '../../core/types';
import { NumberField } from '../InspectorControls';
import { SettingNumberRow, ToggleRow } from './SettingsPrimitives';

interface TechTabProps {
  settings: AppSettings;
  updateSettings: (patch: SettingsPatch) => void;
  resetSettings: () => void;
  onRestoreDraft?: (scene: Scene) => void;
}

export function TechTab({
  settings,
  updateSettings,
  resetSettings,
  onRestoreDraft,
}: TechTabProps) {
  const lastAutosaveAt = useSettingsStore((s) => s.lastAutosaveAt);
  const [confirmReset, setConfirmReset] = useState(false);
  const [draftState, setDraftState] = useState<{
    savedAt: number;
    scene: Scene;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSceneDraft().then((draft) => {
      if (!cancelled) {
        setDraftState(draft);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lastAutosaveAt]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 rounded border border-paper-border bg-paper-bg/60 p-3">
        <NumberField
          label="Лимит истории Undo"
          value={settings.undoLimit}
          min={20}
          max={300}
          onCommit={(undoLimit) => updateSettings({ undoLimit })}
        />
        <NumberField
          label="Скорость зума колёсиком"
          value={settings.wheelZoomSpeed}
          min={0.5}
          max={2.5}
          step={0.1}
          decimals={2}
          onCommit={(wheelZoomSpeed) =>
            updateSettings({ wheelZoomSpeed })
          }
        />
        <NumberField
          label="Сдвиг стрелками (px)"
          value={settings.nudgeStep}
          min={1}
          max={50}
          onCommit={(nudgeStep) => updateSettings({ nudgeStep })}
        />
        <NumberField
          label="Сдвиг Shift + стрелка (px)"
          value={settings.nudgeShiftStep}
          min={2}
          max={100}
          onCommit={(nudgeShiftStep) =>
            updateSettings({ nudgeShiftStep })
          }
        />
      </div>

      <ToggleRow
        label="Анимации интерфейса"
        hint="Отключите на слабом ПК — переходы и появления станут мгновенными"
        checked={settings.animationsEnabled}
        onChange={(animationsEnabled) =>
          updateSettings({ animationsEnabled })
        }
      />

      <ToggleRow
        label="Счётчик слоёв и узлов внизу холста"
        checked={settings.showPerfStats}
        onChange={(showPerfStats) => updateSettings({ showPerfStats })}
      />

      <ToggleRow
        label="Автосохранение черновика"
        hint="Сохраняет сцену локально для защиты от случайного закрытия"
        checked={settings.autosaveEnabled}
        onChange={(autosaveEnabled) =>
          updateSettings({ autosaveEnabled })
        }
      />

      {settings.autosaveEnabled && (
        <SettingNumberRow
          label="Интервал автосохранения (сек)"
          hint="Период записи резервной копии (15–300 сек)"
          value={settings.autosaveIntervalSec}
          min={15}
          max={300}
          onCommit={(autosaveIntervalSec) =>
            updateSettings({ autosaveIntervalSec })
          }
        />
      )}

      <div className="flex items-center justify-between gap-2 rounded border border-paper-border bg-paper-bg/60 px-3 py-2">
        <div className="text-[11px] text-paper-muted">
          {draftState
            ? `Черновик: ${draftState.scene.name} (${new Date(
                draftState.savedAt
              ).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
              })}, слоёв: ${draftState.scene.layers.length})`
            : 'Сохранённого черновика пока нет'}
        </div>
        <button
          type="button"
          disabled={!draftState || !onRestoreDraft}
          onClick={() => {
            if (draftState && onRestoreDraft) {
              onRestoreDraft(draftState.scene);
            }
          }}
          className="h-7 shrink-0 rounded border border-paper-border bg-paper-panel px-2.5 text-[11px] font-medium text-paper-ink hover:bg-paper-hover disabled:opacity-40"
        >
          Восстановить
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-paper-border pt-3">
        <span className="text-[11px] text-paper-muted">
          Вернуть все параметры к исходным значениям
        </span>
        {confirmReset ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="h-7 rounded border border-paper-border bg-paper-bg px-2.5 text-[11px] text-paper-ink hover:bg-paper-hover"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => {
                resetSettings();
                setConfirmReset(false);
              }}
              className="h-7 rounded bg-paper-danger px-2.5 text-[11px] font-medium text-white"
            >
              Подтвердить сброс
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="flex h-7 items-center gap-1.5 rounded border border-paper-border bg-paper-bg px-2.5 text-[11px] text-paper-danger hover:bg-paper-hover"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Сбросить настройки</span>
          </button>
        )}
      </div>
    </div>
  );
}
