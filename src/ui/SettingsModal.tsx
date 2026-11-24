import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Grid3x3,
  Info,
  Keyboard,
  Palette,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import {
  fetchProviderModels,
  normalizeBaseUrl,
  OPENAI_COMPATIBLE_PRESETS,
  PROVIDER_QUICK_MODELS,
} from '../core/aiModels';
import {
  DEFAULT_SETTINGS,
  loadSceneDraft,
  useSettingsStore,
} from '../core/settings';
import {
  eventToShortcutCombo,
  findShortcutConflict,
  formatShortcutCombo,
  getEffectiveShortcut,
  SHORTCUT_CATEGORY_LABELS,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
  type ShortcutCategory,
} from '../core/shortcuts';
import {
  APP_INFO,
  formatDiagnostics,
  getRuntimeDiagnostics,
  type AppContactLink,
} from '../core/appInfo';
import { inferImageMimeType } from '../core/assets';
import { useCanvasBackdropStore } from '../core/canvasBackdrop';
import { ACCENT_PRESETS, getThemePreset, THEME_PRESETS } from '../core/themes';
import {
  CUSTOM_FONT_FAMILY,
  FONT_PRESETS,
  fontMimeFromName,
  getFontStacks,
  useCustomFontStore,
} from '../core/typography';
import { openExternalUrl, pickOpenFile } from '../platform/io';
import type { AIProviderType, Scene } from '../core/types';
import {
  HexColorRow,
  NumberField,
  SegmentedButton,
} from './InspectorControls';
import { Slider } from './controls';

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

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  'file',
  'tools',
  'edit',
  'view',
  'vector',
];

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-paper-border bg-paper-bg/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-paper-ink">{label}</div>
        {hint && <div className="text-[11px] text-paper-muted">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-paper-accent' : 'bg-paper-muted/30'
        }`}
      >
        <span
          className={`block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function SettingNumberRow({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  onCommit: (nextValue: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-paper-border bg-paper-bg/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-paper-ink">{label}</div>
        {hint && <div className="text-[11px] text-paper-muted">{hint}</div>}
      </div>
      <div className="w-24 shrink-0">
        <NumberField
          value={value}
          min={min}
          max={max}
          step={step}
          decimals={decimals}
          onCommit={onCommit}
        />
      </div>
    </div>
  );
}

function AIModelField({
  value,
  placeholder,
  quickModels,
  fetchedModels,
  isFetching,
  fetchError,
  onChange,
  onFetch,
}: {
  value: string;
  placeholder: string;
  quickModels: string[];
  fetchedModels: string[];
  isFetching: boolean;
  fetchError: string | null;
  onChange: (model: string) => void;
  onFetch: () => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-paper-muted">Модель</span>
        {fetchedModels.length > 0 && (
          <span className="text-[10px] text-paper-muted">
            Загружено: {fetchedModels.length}
          </span>
        )}
      </div>

      <div ref={dropdownRef} className="relative flex items-center gap-1.5">
        <div className="relative flex flex-1 items-center">
          <input
            type="text"
            value={value}
            spellCheck={false}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full rounded border border-paper-border bg-paper-bg pl-2.5 pr-8 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
          />
          {fetchedModels.length > 0 && (
            <button
              type="button"
              onClick={() => setDropdownOpen((open) => !open)}
              title="Выбрать из загруженных моделей"
              className="absolute right-1 flex h-6 w-6 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
            >
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={isFetching}
          onClick={() => {
            onFetch();
            setDropdownOpen(true);
          }}
          title="Загрузить список моделей от провайдера"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded border border-paper-border bg-paper-bg px-2.5 text-[11px] font-medium text-paper-ink hover:bg-paper-hover disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 text-paper-muted ${isFetching ? 'animate-spin' : ''}`}
            strokeWidth={1.75}
          />
          <span>{isFetching ? 'Загрузка…' : 'Обновить'}</span>
        </button>

        {dropdownOpen && fetchedModels.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded border border-paper-border bg-paper-panel py-1">
            {fetchedModels.map((modelId) => {
              const active = modelId === value;
              return (
                <button
                  key={modelId}
                  type="button"
                  onClick={() => {
                    onChange(modelId);
                    setDropdownOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left font-display text-[11px] ${
                    active
                      ? 'bg-paper-accent/15 text-paper-ink'
                      : 'text-paper-ink hover:bg-paper-hover'
                  }`}
                >
                  <span className="truncate">{modelId}</span>
                  {active && (
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-paper-accent"
                      strokeWidth={2}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {quickModels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {quickModels.map((modelId) => {
            const active = value === modelId;
            return (
              <button
                key={modelId}
                type="button"
                onClick={() => onChange(modelId)}
                className={`rounded border px-2 py-0.5 font-display text-[10px] transition-colors ${
                  active
                    ? 'border-paper-accent bg-paper-accent/15 text-paper-ink'
                    : 'border-paper-border bg-paper-bg/60 text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
                }`}
              >
                {modelId}
              </button>
            );
          })}
        </div>
      )}

      {fetchError && (
        <div className="rounded border border-paper-danger/40 bg-paper-danger/10 px-2.5 py-1 text-[11px] text-paper-danger">
          {fetchError}
        </div>
      )}
    </div>
  );
}

function AboutRow({
  label,
  value,
  links,
  onOpenLink,
}: {
  label: string;
  value?: string;
  links?: AppContactLink[];
  onOpenLink?: (url: string) => void;
}) {
  return (
    <>
      <dt className="text-paper-muted">{label}</dt>
      <dd className="break-all text-paper-ink">
        {value}
        {links && links.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {links.map((link) => (
              <button
                key={link.url}
                type="button"
                onClick={() => onOpenLink?.(link.url)}
                className="text-paper-accent underline underline-offset-2 hover:text-paper-accent-hover"
              >
                {link.label}
              </button>
            ))}
          </span>
        )}
      </dd>
    </>
  );
}

export function SettingsModal({
  isOpen,
  onClose,
  onRestoreDraft,
  initialTab,
}: SettingsModalProps) {
  const settings = useSettingsStore((s) => s.settings);
  const lastAutosaveAt = useSettingsStore((s) => s.lastAutosaveAt);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const setShortcutOverride = useSettingsStore((s) => s.setShortcutOverride);
  const resetShortcuts = useSettingsStore((s) => s.resetShortcuts);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance');
  const [recordingAction, setRecordingAction] = useState<ShortcutActionId | null>(
    null
  );
  const [shortcutConflict, setShortcutConflict] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [fetchedModelsMap, setFetchedModelsMap] = useState<
    Partial<Record<AIProviderType, string[]>>
  >({});
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelsFetchError, setModelsFetchError] = useState<string | null>(null);
  const [aboutStatus, setAboutStatus] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<{
    savedAt: number;
    scene: Scene;
  } | null>(null);
  const customFont = useCustomFontStore((s) => s.meta);
  const canvasBackdrop = useCanvasBackdropStore((s) => s.meta);
  const [customFontInput, setCustomFontInput] = useState(settings.customFontFamily);
  const [fontStatus, setFontStatus] = useState<string | null>(null);
  const [isFontLoading, setIsFontLoading] = useState(false);
  const [canvasStatus, setCanvasStatus] = useState<string | null>(null);
  const [isCanvasImageLoading, setIsCanvasImageLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setRecordingAction(null);
      setShortcutConflict(null);
      setConfirmReset(false);
      setModelsFetchError(null);
      return;
    }
    void loadSceneDraft().then((draft) => setDraftState(draft));
  }, [isOpen, lastAutosaveAt]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialTab) setActiveTab(initialTab);
    setCustomFontInput(settings.customFontFamily);
    void useCustomFontStore.getState().load();
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen || !recordingAction) return;

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
        setRecordingAction(null);
        setShortcutConflict(null);
        return;
      }

      const combo = eventToShortcutCombo(event);
      if (!combo) return;

      const conflict = findShortcutConflict(
        recordingAction,
        combo,
        settings.customShortcuts
      );
      if (conflict) {
        setShortcutConflict(
          `Комбинация ${formatShortcutCombo(combo)} уже занята: «${conflict.label}»`
        );
        return;
      }

      setShortcutOverride(recordingAction, combo);
      setRecordingAction(null);
      setShortcutConflict(null);
    };

    window.addEventListener('keydown', handleRecordKeyDown, true);
    return () => window.removeEventListener('keydown', handleRecordKeyDown, true);
  }, [isOpen, recordingAction, setShortcutOverride, settings.customShortcuts]);

  useEffect(() => {
    if (!isOpen || recordingAction) return;

    const handleCloseKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleCloseKeyDown);
    return () => window.removeEventListener('keydown', handleCloseKeyDown);
  }, [isOpen, onClose, recordingAction]);

  const handleOpenLink = async (url: string) => {
    try {
      await openExternalUrl(url);
      setAboutStatus(null);
    } catch {
      setAboutStatus('Не удалось открыть ссылку');
    }
  };

  const handleCopyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(
        formatDiagnostics(getRuntimeDiagnostics())
      );
      setAboutStatus('Сведения скопированы');
    } catch {
      setAboutStatus('Не удалось скопировать сведения');
    }
  };

  const handlePickCustomFont = async () => {
    setFontStatus(null);
    setIsFontLoading(true);
    try {
      const file = await pickOpenFile({
        title: 'Загрузить шрифт интерфейса',
        filters: [
          { name: 'Шрифты', extensions: ['ttf', 'otf', 'woff', 'woff2'] },
        ],
      });
      if (!file) return;
      await useCustomFontStore.getState().save({
        name: file.name,
        mimeType: fontMimeFromName(file.name),
        bytes: file.bytes,
      });
      updateSettings({
        fontPreset: 'custom',
        customFontFamily: CUSTOM_FONT_FAMILY,
      });
      setCustomFontInput(CUSTOM_FONT_FAMILY);
      setFontStatus('Шрифт загружен');
    } catch (err) {
      setFontStatus(
        err instanceof Error ? err.message : 'Не удалось загрузить шрифт'
      );
    } finally {
      setIsFontLoading(false);
    }
  };

  const handleClearCustomFont = async () => {
    await useCustomFontStore.getState().clear();
    updateSettings({ fontPreset: 'paper', customFontFamily: '' });
    setCustomFontInput('');
    setFontStatus('Свой шрифт удалён');
  };

  const handlePickCanvasImage = async () => {
    setCanvasStatus(null);
    setIsCanvasImageLoading(true);
    try {
      const file = await pickOpenFile({
        title: 'Фон рабочей области',
        filters: [
          { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        ],
      });
      if (!file) return;
      const mimeType = inferImageMimeType(file.name, file.bytes);
      if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
        setCanvasStatus('Поддерживаются PNG, JPEG и WebP');
        return;
      }
      await useCanvasBackdropStore
        .getState()
        .save({ name: file.name, mimeType, bytes: file.bytes });
      setCanvasStatus('Фон рабочей области обновлён');
    } catch (err) {
      setCanvasStatus(
        err instanceof Error
          ? `Не удалось загрузить изображение: ${err.message}`
          : 'Не удалось загрузить изображение'
      );
    } finally {
      setIsCanvasImageLoading(false);
    }
  };

  const handleClearCanvasImage = async () => {
    await useCanvasBackdropStore.getState().clear();
    setCanvasStatus('Фото убрано');
  };

  const handleFetchModels = async () => {
    const provider = settings.ai.provider;
    setIsFetchingModels(true);
    setModelsFetchError(null);
    try {
      const models = await fetchProviderModels(settings.ai);
      setFetchedModelsMap((prev) => ({ ...prev, [provider]: models }));
    } catch (err) {
      setModelsFetchError(
        err instanceof Error ? err.message : 'Не удалось загрузить список моделей'
      );
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleApplyAndClose = () => {
    updateSettings({});
    onClose();
  };

  if (!isOpen) return null;

  const activeThemePreset = getThemePreset(settings.themeId);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, textarea, [role="listbox"]')) return;
        e.preventDefault();
        handleApplyAndClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper-ink/30 p-4"
    >
      <div className="flex h-[540px] w-full max-w-3xl flex-col overflow-hidden rounded border border-paper-border bg-paper-panel">
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

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'appearance' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
                    Тема интерфейса
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {THEME_PRESETS.map((preset) => {
                      const active = settings.themeId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() =>
                            updateSettings({
                              themeId: preset.id,
                              accentColor: preset.defaultAccent,
                            })
                          }
                          className={`flex items-center justify-between gap-2 rounded border px-3 py-2 text-left transition-colors ${
                            active
                              ? 'border-paper-accent bg-paper-bg'
                              : 'border-paper-border bg-paper-panel hover:bg-paper-hover'
                          }`}
                        >
                          <span className="text-[12px] font-medium text-paper-ink">
                            {preset.label}
                          </span>
                          <div className="flex items-center gap-1">
                            <span
                              className="h-3.5 w-3.5 rounded-sm border border-paper-border"
                              style={{ backgroundColor: preset.tokens.bg }}
                            />
                            <span
                              className="h-3.5 w-3.5 rounded-sm border border-paper-border"
                              style={{ backgroundColor: preset.tokens.panel }}
                            />
                            <span
                              className="h-3.5 w-3.5 rounded-sm border border-paper-border"
                              style={{ backgroundColor: preset.defaultAccent }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-paper-border pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
                    Акцентный цвет
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ACCENT_PRESETS.map((preset) => {
                      const active =
                        settings.accentColor.toLowerCase() ===
                        preset.color.toLowerCase();
                      return (
                        <button
                          key={preset.color}
                          type="button"
                          title={preset.label}
                          onClick={() =>
                            updateSettings({ accentColor: preset.color })
                          }
                          className={`flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] transition-colors ${
                            active
                              ? 'border-paper-accent bg-paper-accent/12 font-medium text-paper-ink'
                              : 'border-paper-border bg-paper-panel text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
                          }`}
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-black/15"
                            style={{ backgroundColor: preset.color }}
                          />
                          <span className="truncate">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <HexColorRow
                    value={settings.accentColor}
                    onChange={(accentColor) => updateSettings({ accentColor })}
                  />
                </div>

                <div className="flex flex-col gap-2 border-t border-paper-border pt-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3.5 w-3.5 rounded-sm border border-paper-border"
                        style={{
                          backgroundColor:
                            settings.customCanvasBg ?? activeThemePreset.tokens.canvas,
                        }}
                      />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
                        Фон вокруг артборда
                      </span>
                    </div>
                    {settings.customCanvasBg ? (
                      <button
                        type="button"
                        onClick={() => updateSettings({ customCanvasBg: null })}
                        className="text-[11px] text-paper-accent hover:underline"
                      >
                        Сбросить к теме
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          updateSettings({
                            customCanvasBg: activeThemePreset.tokens.canvas,
                          })
                        }
                        className="text-[11px] text-paper-accent hover:underline"
                      >
                        Задать свой цвет
                      </button>
                    )}
                  </div>
                  {settings.customCanvasBg && (
                    <HexColorRow
                      value={settings.customCanvasBg}
                      onChange={(customCanvasBg) =>
                        updateSettings({ customCanvasBg })
                      }
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isCanvasImageLoading}
                      onClick={() => void handlePickCanvasImage()}
                      className="rounded border border-paper-border bg-paper-panel px-2 py-1 text-[11px] text-paper-ink hover:bg-paper-hover disabled:opacity-50"
                    >
                      {isCanvasImageLoading ? 'Загрузка…' : 'Своё фото…'}
                    </button>
                    {canvasBackdrop && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleClearCanvasImage()}
                          className="rounded px-1.5 py-1 text-[11px] text-paper-muted hover:text-paper-danger"
                        >
                          Убрать фото
                        </button>
                        <span className="max-w-40 truncate text-[10px] text-paper-muted">
                          {canvasBackdrop.name}
                        </span>
                      </>
                    )}
                  </div>
                  {canvasStatus && (
                    <span className="text-[10px] text-paper-muted">{canvasStatus}</span>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 border-t border-paper-border pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
                    Плотность интерфейса
                  </span>
                  <div className="flex gap-1.5">
                    <SegmentedButton
                      active={settings.uiScale === 'normal'}
                      label="Обычный"
                      onClick={() => updateSettings({ uiScale: 'normal' })}
                    />
                    <SegmentedButton
                      active={settings.uiScale === 'compact'}
                      label="Компактный"
                      onClick={() => updateSettings({ uiScale: 'compact' })}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-paper-border pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
                    Шрифты интерфейса
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FONT_PRESETS.map((preset) => {
                      const active = settings.fontPreset === preset.id;
                      const stack = getFontStacks(preset.id, null);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => updateSettings({ fontPreset: preset.id })}
                          className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-left transition-colors ${
                            active
                              ? 'border-paper-accent bg-paper-accent/10'
                              : 'border-paper-border bg-paper-bg/60 hover:bg-paper-hover'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-medium text-paper-ink">
                              {preset.label}
                            </span>
                            <span className="block truncate text-[10px] text-paper-muted">
                              {preset.hint}
                            </span>
                          </span>
                          <span
                            className="shrink-0 text-[17px] leading-none text-paper-ink"
                            style={{ fontFamily: stack.display }}
                          >
                            Aa
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div
                    className={`flex flex-col gap-2 rounded border p-2.5 ${
                      settings.fontPreset === 'custom'
                        ? 'border-paper-accent bg-paper-accent/10'
                        : 'border-paper-border bg-paper-bg/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => updateSettings({ fontPreset: 'custom' })}
                        className="text-[12px] font-medium text-paper-ink hover:text-paper-accent"
                      >
                        Свой шрифт
                      </button>
                      <span
                        className="text-[17px] leading-none text-paper-ink"
                        style={{
                          fontFamily: getFontStacks(
                            'custom',
                            customFontInput || settings.customFontFamily
                          ).ui,
                        }}
                      >
                        Aa
                      </span>
                    </div>
                    <input
                      type="text"
                      value={customFontInput}
                      spellCheck={false}
                      placeholder="Название семейства, например Locus Custom"
                      onChange={(e) => setCustomFontInput(e.target.value)}
                      onBlur={() =>
                        updateSettings({ customFontFamily: customFontInput })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateSettings({ customFontFamily: customFontInput });
                        }
                      }}
                      className="h-7 rounded border border-paper-border bg-paper-panel px-2 text-[12px] text-paper-ink outline-none placeholder:text-paper-muted focus:border-paper-accent"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isFontLoading}
                        onClick={() => void handlePickCustomFont()}
                        className="rounded border border-paper-border bg-paper-panel px-2 py-1 text-[11px] text-paper-ink hover:bg-paper-hover disabled:opacity-50"
                      >
                        {isFontLoading ? 'Загрузка…' : 'Загрузить .ttf / .otf'}
                      </button>
                      {(customFont || settings.customFontFamily) && (
                        <button
                          type="button"
                          onClick={() => void handleClearCustomFont()}
                          className="rounded px-1.5 py-1 text-[11px] text-paper-muted hover:text-paper-danger"
                        >
                          Сбросить
                        </button>
                      )}
                      {customFont && (
                        <span className="truncate text-[10px] text-paper-muted">
                          {customFont.fileName}
                        </span>
                      )}
                    </div>
                    {fontStatus && (
                      <span className="text-[10px] text-paper-muted">{fontStatus}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'canvas' && (
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
                  hint="Удерживайте Alt при перетаскивании, чтобы временно отключить"
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
            )}

            {activeTab === 'tech' && (
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
            )}

            {activeTab === 'shortcuts' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-paper-muted">
                    Нажмите на клавишу, чтобы переназначить. Конфликты с занятыми (включая I и E) проверяются автоматически.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      resetShortcuts();
                      setRecordingAction(null);
                      setShortcutConflict(null);
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
                          settings.customShortcuts
                        );
                        const isRecording = recordingAction === def.id;
                        const isOverridden = Boolean(
                          settings.customShortcuts[def.id]
                        );
                        return (
                          <div
                            key={def.id}
                            className="flex items-center justify-between gap-2 px-3 py-1.5"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate text-[12px] text-paper-ink">
                                {def.label}
                              </span>
                              {def.note && (
                                <span className="rounded border border-paper-border bg-paper-panel px-1.5 py-0.2 text-[10px] text-paper-muted">
                                  {def.note}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isOverridden && (
                                <button
                                  type="button"
                                  title="Вернуть стандартную клавишу"
                                  onClick={() =>
                                    setShortcutOverride(def.id, null)
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
                                  setShortcutConflict(null);
                                  setRecordingAction((prev) =>
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
            )}

            {activeTab === 'ai' && (
              <div className="flex flex-col gap-3">
                <div className="rounded border border-paper-border bg-paper-bg/70 px-3 py-2 text-[11px] text-paper-muted">
                  Параметры сохраняются в <span className="font-display text-paper-ink">settings.json</span> и не попадают в файл проекта. Панель команд открывается по{' '}
                  <span className="font-display text-paper-ink">Ctrl+K</span>.
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-paper-muted">Провайдер</span>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    <SegmentedButton
                      active={settings.ai.provider === 'openai'}
                      label="OpenAI / API"
                      onClick={() => {
                        setModelsFetchError(null);
                        updateSettings({ ai: { provider: 'openai' } });
                      }}
                    />
                    <SegmentedButton
                      active={settings.ai.provider === 'anthropic'}
                      label="Anthropic"
                      onClick={() => {
                        setModelsFetchError(null);
                        updateSettings({ ai: { provider: 'anthropic' } });
                      }}
                    />
                    <SegmentedButton
                      active={settings.ai.provider === 'gemini'}
                      label="Google Gemini"
                      onClick={() => {
                        setModelsFetchError(null);
                        updateSettings({ ai: { provider: 'gemini' } });
                      }}
                    />
                    <SegmentedButton
                      active={settings.ai.provider === 'ollama'}
                      label="Ollama"
                      onClick={() => {
                        setModelsFetchError(null);
                        updateSettings({ ai: { provider: 'ollama' } });
                      }}
                    />
                  </div>
                </div>

                {settings.ai.provider === 'gemini' && (
                  <div className="flex flex-col gap-2.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-paper-muted">
                        Gemini API Key
                      </span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type={showGeminiKey ? 'text' : 'password'}
                          value={settings.ai.geminiApiKey}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="AIza..."
                          onChange={(e) => {
                            setModelsFetchError(null);
                            updateSettings({
                              ai: { geminiApiKey: e.target.value },
                            });
                          }}
                          className="h-8 flex-1 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGeminiKey((v) => !v)}
                          className="flex h-8 w-8 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:text-paper-ink"
                        >
                          {showGeminiKey ? (
                            <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                          ) : (
                            <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                          )}
                        </button>
                      </div>
                    </label>

                    <AIModelField
                      value={settings.ai.geminiModel}
                      placeholder={DEFAULT_SETTINGS.ai.geminiModel}
                      quickModels={PROVIDER_QUICK_MODELS.gemini}
                      fetchedModels={fetchedModelsMap.gemini ?? []}
                      isFetching={isFetchingModels}
                      fetchError={modelsFetchError}
                      onChange={(geminiModel) =>
                        updateSettings({ ai: { geminiModel } })
                      }
                      onFetch={() => void handleFetchModels()}
                    />
                  </div>
                )}

                {settings.ai.provider === 'anthropic' && (
                  <div className="flex flex-col gap-2.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-paper-muted">
                        Anthropic API Key
                      </span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type={showAnthropicKey ? 'text' : 'password'}
                          value={settings.ai.anthropicApiKey}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="sk-ant-..."
                          onChange={(e) => {
                            setModelsFetchError(null);
                            updateSettings({
                              ai: { anthropicApiKey: e.target.value },
                            });
                          }}
                          className="h-8 flex-1 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                        />
                        <button
                          type="button"
                          onClick={() => setShowAnthropicKey((v) => !v)}
                          className="flex h-8 w-8 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:text-paper-ink"
                        >
                          {showAnthropicKey ? (
                            <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                          ) : (
                            <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                          )}
                        </button>
                      </div>
                    </label>

                    <AIModelField
                      value={settings.ai.anthropicModel}
                      placeholder={DEFAULT_SETTINGS.ai.anthropicModel}
                      quickModels={PROVIDER_QUICK_MODELS.anthropic}
                      fetchedModels={fetchedModelsMap.anthropic ?? []}
                      isFetching={isFetchingModels}
                      fetchError={modelsFetchError}
                      onChange={(anthropicModel) =>
                        updateSettings({ ai: { anthropicModel } })
                      }
                      onFetch={() => void handleFetchModels()}
                    />
                  </div>
                )}

                {settings.ai.provider === 'ollama' && (
                  <div className="flex flex-col gap-2.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-paper-muted">
                        Ollama Server URL
                      </span>
                      <input
                        type="text"
                        value={settings.ai.ollamaBaseUrl}
                        spellCheck={false}
                        placeholder={DEFAULT_SETTINGS.ai.ollamaBaseUrl}
                        onChange={(e) => {
                          setModelsFetchError(null);
                          updateSettings({
                            ai: { ollamaBaseUrl: e.target.value },
                          });
                        }}
                        className="h-8 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                      />
                    </label>

                    <AIModelField
                      value={settings.ai.ollamaModel}
                      placeholder={DEFAULT_SETTINGS.ai.ollamaModel}
                      quickModels={PROVIDER_QUICK_MODELS.ollama}
                      fetchedModels={fetchedModelsMap.ollama ?? []}
                      isFetching={isFetchingModels}
                      fetchError={modelsFetchError}
                      onChange={(ollamaModel) =>
                        updateSettings({ ai: { ollamaModel } })
                      }
                      onFetch={() => void handleFetchModels()}
                    />
                  </div>
                )}

                {settings.ai.provider === 'openai' && (() => {
                  const currentBase = normalizeBaseUrl(
                    settings.ai.openaiBaseUrl,
                    DEFAULT_SETTINGS.ai.openaiBaseUrl
                  );
                  const activePreset = OPENAI_COMPATIBLE_PRESETS.find(
                    (preset) => preset.baseUrl === currentBase
                  );
                  return (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-paper-muted">
                          Пресеты провайдеров
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {OPENAI_COMPATIBLE_PRESETS.map((preset) => {
                            const active = activePreset?.id === preset.id;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => {
                                  setModelsFetchError(null);
                                  setFetchedModelsMap((prev) => {
                                    const next = { ...prev };
                                    delete next.openai;
                                    return next;
                                  });
                                  updateSettings({
                                    ai: {
                                      openaiBaseUrl: preset.baseUrl,
                                      openaiModel: preset.defaultModel,
                                    },
                                  });
                                }}
                                className={`h-7 rounded border px-2.5 text-[11px] transition-colors ${
                                  active
                                    ? 'border-paper-accent bg-paper-accent/15 font-medium text-paper-ink'
                                    : 'border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
                                }`}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-paper-muted">Base URL</span>
                        <input
                          type="text"
                          value={settings.ai.openaiBaseUrl}
                          spellCheck={false}
                          placeholder={DEFAULT_SETTINGS.ai.openaiBaseUrl}
                          onChange={(e) => {
                            setModelsFetchError(null);
                            updateSettings({
                              ai: { openaiBaseUrl: e.target.value },
                            });
                          }}
                          className="h-8 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-paper-muted">API Key</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type={showOpenaiKey ? 'text' : 'password'}
                            value={settings.ai.openaiApiKey}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="sk-..."
                            onChange={(e) => {
                              setModelsFetchError(null);
                              updateSettings({
                                ai: { openaiApiKey: e.target.value },
                              });
                            }}
                            className="h-8 flex-1 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                          />
                          <button
                            type="button"
                            onClick={() => setShowOpenaiKey((v) => !v)}
                            className="flex h-8 w-8 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:text-paper-ink"
                          >
                            {showOpenaiKey ? (
                              <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                            ) : (
                              <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                            )}
                          </button>
                        </div>
                      </label>

                      <AIModelField
                        value={settings.ai.openaiModel}
                        placeholder={
                          activePreset?.defaultModel ??
                          DEFAULT_SETTINGS.ai.openaiModel
                        }
                        quickModels={
                          activePreset?.models.length
                            ? activePreset.models
                            : PROVIDER_QUICK_MODELS.openai
                        }
                        fetchedModels={fetchedModelsMap.openai ?? []}
                        isFetching={isFetchingModels}
                        fetchError={modelsFetchError}
                        onChange={(openaiModel) =>
                          updateSettings({ ai: { openaiModel } })
                        }
                        onFetch={() => void handleFetchModels()}
                      />
                    </div>
                  );
                })()}
              </div>
            )}

            {activeTab === 'about' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
                    О приложении
                  </span>
                  <div className="flex items-center gap-3 rounded border border-paper-border bg-paper-bg/50 p-3">
                    <img
                      src="/icon.svg"
                      alt={`Логотип ${APP_INFO.name}`}
                      className="h-12 w-12 shrink-0 rounded-[10px] border border-paper-border"
                    />
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-paper-ink">
                        {APP_INFO.name}
                      </div>
                      <p className="mt-1 text-[12px] text-paper-muted">
                        {APP_INFO.description}
                      </p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                    <AboutRow label="Версия" value={APP_INFO.version} />
                    <AboutRow label="Сборка" value={APP_INFO.build} />
                    <AboutRow label="Лицензия" value={APP_INFO.license} />
                    <AboutRow label="Создатель" value={APP_INFO.creator} />
                    <AboutRow
                      label="Контакты"
                      links={APP_INFO.contactsLinks}
                      onOpenLink={(url) => void handleOpenLink(url)}
                    />
                    <AboutRow
                      label="Документация"
                      links={[{ label: 'README', url: APP_INFO.documentation }]}
                      onOpenLink={(url) => void handleOpenLink(url)}
                    />
                    <AboutRow
                      label="Репозиторий"
                      links={[{ label: 'GitHub', url: APP_INFO.repository }]}
                      onOpenLink={(url) => void handleOpenLink(url)}
                    />
                    <AboutRow
                      label="Сообщить о проблеме"
                      links={[{ label: 'Issues', url: APP_INFO.issues }]}
                      onOpenLink={(url) => void handleOpenLink(url)}
                    />
                  </dl>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
                    Сторонние компоненты
                  </span>
                  <p className="text-[12px] text-paper-ink">{APP_INFO.thirdParty}</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
                    Диагностика
                  </span>
                  <p className="text-[12px] text-paper-muted">
                    Сведения о системе не содержат API-ключей, файлов проекта и изображений.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyDiagnostics()}
                      className="h-7 rounded border border-paper-border bg-paper-panel px-2.5 text-[12px] text-paper-ink hover:bg-paper-hover"
                    >
                      Скопировать сведения о системе
                    </button>
                    {aboutStatus && (
                      <span className="text-[11px] text-paper-muted">
                        {aboutStatus}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-paper-border px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              disabled
              title="Раздел будет добавлен позже"
              className="h-7 cursor-not-allowed rounded border border-paper-border bg-paper-bg px-2.5 text-[12px] text-paper-muted opacity-60"
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
