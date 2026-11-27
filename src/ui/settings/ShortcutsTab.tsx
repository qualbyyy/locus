import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  eventToShortcutCombo,
  findShortcutConflict,
  formatShortcutCombo,
  getEffectiveShortcut,
  SHORTCUT_CATEGORY_LABELS,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
  type ShortcutCategory,
} from '../../core/shortcuts';

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  'file',
  'tools',
  'edit',
  'view',
  'vector',
];

interface ShortcutsTabProps {
  customShortcuts: Record<string, string>;
  recordingAction: ShortcutActionId | null;
  shortcutConflict: string | null;
  onSetRecordingAction: Dispatch<SetStateAction<ShortcutActionId | null>>;
  onSetShortcutConflict: (msg: string | null) => void;
  onSetShortcutOverride: (actionId: string, combo: string | null) => void;
  onResetShortcuts: () => void;
}

export function ShortcutsTab({
  customShortcuts,
  recordingAction,
  shortcutConflict,
  onSetRecordingAction,
  onSetShortcutConflict,
  onSetShortcutOverride,
  onResetShortcuts,
}: ShortcutsTabProps) {
  useEffect(() => {
    if (!recordingAction) return;

    const handleRecordKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (
        event.key === 'Escape' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        onSetRecordingAction(null);
        onSetShortcutConflict(null);
        return;
      }

      const combo = eventToShortcutCombo(event);
      if (!combo) return;

      const conflict = findShortcutConflict(
        recordingAction,
        combo,
        customShortcuts
      );
      if (conflict) {
        onSetShortcutConflict(
          `Комбинация ${formatShortcutCombo(combo)} уже занята: «${conflict.label}»`
        );
        return;
      }

      onSetShortcutOverride(recordingAction, combo);
      onSetRecordingAction(null);
      onSetShortcutConflict(null);
    };

    window.addEventListener('keydown', handleRecordKeyDown, true);
    return () => window.removeEventListener('keydown', handleRecordKeyDown, true);
  }, [
    customShortcuts,
    onSetRecordingAction,
    onSetShortcutConflict,
    onSetShortcutOverride,
    recordingAction,
  ]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-paper-muted">
          Нажмите на клавишу, чтобы переназначить. Конфликты с занятыми (включая I и E) проверяются автоматически.
        </span>
        <button
          type="button"
          onClick={() => {
            onResetShortcuts();
            onSetRecordingAction(null);
            onSetShortcutConflict(null);
          }}
          className="flex h-7 shrink-0 items-center gap-1 rounded border border-paper-border bg-paper-bg px-2 text-[11px] text-paper-ink hover:bg-paper-hover"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
          <span>Сбросить клавиши</span>
        </button>
      </div>

      {shortcutConflict && (
        <div className="rounded border border-paper-danger/50 bg-paper-danger/10 px-3 py-1.5 text-[11px] text-paper-danger">
          {shortcutConflict}
        </div>
      )}

      {SHORTCUT_CATEGORIES.map((category) => (
        <div key={category} className="flex flex-col gap-1">
          <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
            {SHORTCUT_CATEGORY_LABELS[category]}
          </span>
          <div className="divide-y divide-paper-border rounded border border-paper-border bg-paper-bg/50">
            {SHORTCUT_DEFINITIONS.filter(
              (d) => d.category === category
            ).map((def) => {
              const effective = getEffectiveShortcut(
                def.id,
                customShortcuts
              );
              const isRecording = recordingAction === def.id;
              const isOverridden = Boolean(customShortcuts[def.id]);
              return (
                <div
                  key={def.id}
                  className="flex items-center justify-between gap-2 px-3 py-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[12px] text-paper-ink">
                      {def.label}
                    </span>
                    {def.note && (
                      <span className="rounded border border-paper-border bg-paper-panel px-1.5 py-0.2 text-[10px] text-paper-muted">
                        {def.note}
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {isOverridden && (
                      <button
                        type="button"
                        title="Вернуть стандартную клавишу"
                        onClick={() =>
                          onSetShortcutOverride(def.id, null)
                        }
                        className="text-paper-muted hover:text-paper-ink"
                      >
                        <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={def.editable === false}
                      onClick={() => {
                        if (def.editable === false) return;
                        onSetShortcutConflict(null);
                        onSetRecordingAction((prev) =>
                          prev === def.id ? null : def.id
                        );
                      }}
                      className={`min-w-20 rounded border px-2 py-0.5 font-display text-[11px] transition-colors ${
                        isRecording
                          ? 'border-paper-accent bg-paper-accent text-white'
                          : def.editable === false
                            ? 'border-paper-border bg-paper-panel text-paper-muted opacity-65'
                            : 'border-paper-border bg-paper-panel text-paper-ink hover:border-paper-accent'
                      }`}
                    >
                      {isRecording
                        ? 'Нажмите…'
                        : formatShortcutCombo(effective)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
