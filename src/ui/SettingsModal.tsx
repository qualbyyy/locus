import { useEffect, useRef, useState } from 'react';
import {
  Grid3x3,
  Info,
  Keyboard,
  Palette,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useSettingsStore } from '../core/settings';
import type { ShortcutActionId } from '../core/shortcuts';
import { useCustomFontStore } from '../core/typography';
import type { AIProviderType, Scene } from '../core/types';
import { AboutTab } from './settings/AboutTab';
import { AiTab } from './settings/AiTab';
import { AppearanceTab } from './settings/AppearanceTab';
import { CanvasTab } from './settings/CanvasTab';
import { ShortcutsTab } from './settings/ShortcutsTab';
import { TechTab } from './settings/TechTab';

export type SettingsTabId =
  | 'appearance'
  | 'canvas'
  | 'tech'
  | 'shortcuts'
  | 'ai'
  | 'about';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreDraft?: (scene: Scene) => void;
  initialTab?: SettingsTabId | null;
  onOpenTutorial?: () => void;
}

const TABS: Array<{
  id: SettingsTabId;
  label: string;
  Icon: typeof Palette;
}> = [
  { id: 'appearance', label: 'Темы и цвета', Icon: Palette },
  { id: 'canvas', label: 'Холст и привязки', Icon: Grid3x3 },
  { id: 'tech', label: 'Технические', Icon: Wrench },
  { id: 'shortcuts', label: 'Горячие клавиши', Icon: Keyboard },
  { id: 'ai', label: 'ИИ', Icon: Sparkles },
  { id: 'about', label: 'О приложении', Icon: Info },
];

export function SettingsModal({
  isOpen,
  onClose,
  onRestoreDraft,
  initialTab = null,
  onOpenTutorial,
}: SettingsModalProps) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const setShortcutOverride = useSettingsStore((s) => s.setShortcutOverride);
  const resetShortcuts = useSettingsStore((s) => s.resetShortcuts);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance');
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const [recordingAction, setRecordingAction] = useState<ShortcutActionId | null>(
    null
  );
  const [shortcutConflict, setShortcutConflict] = useState<string | null>(null);
  const [customFontInput, setCustomFontInput] = useState(settings.customFontFamily);
  const [fetchedModelsMap, setFetchedModelsMap] = useState<
    Partial<Record<AIProviderType, string[]>>
  >({});

  useEffect(() => {
    setCustomFontInput(settings.customFontFamily);
  }, [settings.customFontFamily]);

  useEffect(() => {
    if (!isOpen) {
      setRecordingAction(null);
      setShortcutConflict(null);
      return;
    }
    if (initialTab) setActiveTab(initialTab);
    setCustomFontInput(settings.customFontFamily);
    void useCustomFontStore.getState().load();
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen || !contentScrollRef.current) return;
    contentScrollRef.current.scrollTop = 0;
  }, [activeTab, isOpen]);

  useEffect(() => {
    if (!isOpen || recordingAction) return;

    const handleCloseKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleCloseKeyDown, false);
    return () => window.removeEventListener('keydown', handleCloseKeyDown, false);
  }, [isOpen, onClose, recordingAction]);

  const handleApplyAndClose = () => {
    if (customFontInput !== settings.customFontFamily) {
      updateSettings({ customFontFamily: customFontInput });
    } else {
      updateSettings({});
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (
          e.defaultPrevented ||
          recordingAction ||
          e.key !== 'Enter' ||
          e.nativeEvent.isComposing
        ) {
          return;
        }
        const target = e.target as HTMLElement;
        if (target.closest('button, textarea, [role="listbox"]')) return;
        e.preventDefault();
        handleApplyAndClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-paper-ink/30 p-4 sm:items-center"
    >
      <div className="animate-rise my-auto flex h-[min(540px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded border border-paper-border bg-paper-panel">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-paper-border px-4">
          <span className="text-[14px] font-semibold text-paper-ink">
            Настройки Locus
          </span>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть (Esc)"
            className="flex h-7 w-7 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-paper-border bg-paper-bg/60 p-2">
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveTab(id);
                    setRecordingAction(null);
                    setShortcutConflict(null);
                  }}
                  className={`flex h-8 items-center gap-2 rounded px-2.5 text-left text-[12px] transition-colors ${
                    active
                      ? 'bg-paper-accent/15 font-medium text-paper-ink'
                      : 'text-paper-ink hover:bg-paper-hover'
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 ${
                      active ? 'text-paper-accent' : 'text-paper-muted'
                    }`}
                    strokeWidth={1.75}
                  />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
            <span className="mt-auto px-2.5 py-1 text-[10px] text-paper-muted/80">
              Сохраняется автоматически
            </span>
          </nav>

          <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            {activeTab === 'appearance' && (
              <AppearanceTab
                settings={settings}
                updateSettings={updateSettings}
                customFontInput={customFontInput}
                onChangeCustomFontInput={setCustomFontInput}
              />
            )}

            {activeTab === 'canvas' && (
              <CanvasTab settings={settings} updateSettings={updateSettings} />
            )}

            {activeTab === 'tech' && (
              <TechTab
                settings={settings}
                updateSettings={updateSettings}
                resetSettings={resetSettings}
                onRestoreDraft={onRestoreDraft}
              />
            )}

            {activeTab === 'shortcuts' && (
              <ShortcutsTab
                customShortcuts={settings.customShortcuts}
                recordingAction={recordingAction}
                shortcutConflict={shortcutConflict}
                onSetRecordingAction={setRecordingAction}
                onSetShortcutConflict={setShortcutConflict}
                onSetShortcutOverride={setShortcutOverride}
                onResetShortcuts={resetShortcuts}
              />
            )}

            {activeTab === 'ai' && (
              <AiTab
                ai={settings.ai}
                updateAi={(aiPatch) => updateSettings({ ai: aiPatch })}
                fetchedModelsMap={fetchedModelsMap}
                setFetchedModelsMap={setFetchedModelsMap}
              />
            )}

            {activeTab === 'about' && <AboutTab />}
          </div>
        </div>

        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-paper-border px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onOpenTutorial}
              disabled={!onOpenTutorial}
              title="Открыть обучение (F1)"
              className="h-7 rounded border border-paper-border bg-paper-bg px-2.5 text-[12px] text-paper-ink hover:bg-paper-hover disabled:cursor-not-allowed disabled:text-paper-muted disabled:opacity-60"
            >
              Обучение
            </button>
            <span className="truncate text-[11px] text-paper-muted">
              Настройки сохраняются автоматически
            </span>
          </div>
          <button
            type="button"
            onClick={handleApplyAndClose}
            title="Применить настройки и закрыть (Enter)"
            className="h-7 shrink-0 rounded bg-paper-accent px-3 text-[12px] font-medium text-white hover:bg-paper-accent-hover"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
