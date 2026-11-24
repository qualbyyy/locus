import { create } from 'zustand';
import { readAppConfigText, writeAppConfigText } from '../platform/io';
import { clamp } from './math';
import { setUndoLimit } from './store';
import {
  applyThemeToDom,
  getThemePreset,
  isValidHexColor,
  THEME_PRESETS,
  type ThemeId,
} from './themes';
import {
  FONT_PRESET_IDS,
  useCustomFontStore,
  type FontPresetId,
} from './typography';
import type { AIConfig, AIProviderType, Scene } from './types';

export const SETTINGS_FILE_PATH = 'settings.json';
export const AUTOSAVE_DRAFT_PATH = 'autosave-draft.json';

export type UiScale = 'compact' | 'normal';

export interface AppSettings {
  version: 1;
  themeId: ThemeId;
  accentColor: string;
  customCanvasBg: string | null;
  fontPreset: FontPresetId;
  customFontFamily: string;
  uiScale: UiScale;
  showGrid: boolean;
  gridSize: number;
  gridOpacity: number;
  snapToGrid: boolean;
  snapToObjects: boolean;
  snapToArtboard: boolean;
  snapThreshold: number;
  undoLimit: number;
  nudgeStep: number;
  nudgeShiftStep: number;
  autosaveEnabled: boolean;
  autosaveIntervalSec: number;
  wheelZoomSpeed: number;
  showPerfStats: boolean;
  customShortcuts: Record<string, string>;
  ai: AIConfig;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'openai',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-5',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5-coder:7b',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
};

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  themeId: 'paper',
  accentColor: '#da7756',
  customCanvasBg: null,
  fontPreset: 'paper',
  customFontFamily: '',
  uiScale: 'normal',
  showGrid: false,
  gridSize: 16,
  gridOpacity: 0.16,
  snapToGrid: false,
  snapToObjects: true,
  snapToArtboard: true,
  snapThreshold: 6,
  undoLimit: 100,
  nudgeStep: 1,
  nudgeShiftStep: 10,
  autosaveEnabled: true,
  autosaveIntervalSec: 45,
  wheelZoomSpeed: 1,
  showPerfStats: false,
  customShortcuts: {},
  ai: { ...DEFAULT_AI_CONFIG },
};

const VALID_THEME_IDS = new Set<ThemeId>(THEME_PRESETS.map((t) => t.id));

function readFinite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function sanitizeSettings(raw: unknown): AppSettings {
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const themeId: ThemeId =
    typeof src.themeId === 'string' && VALID_THEME_IDS.has(src.themeId as ThemeId)
      ? (src.themeId as ThemeId)
      : DEFAULT_SETTINGS.themeId;

  const preset = getThemePreset(themeId);
  const accentColor =
    typeof src.accentColor === 'string' && isValidHexColor(src.accentColor)
      ? src.accentColor
      : preset.defaultAccent;

  const customCanvasBg =
    typeof src.customCanvasBg === 'string' && isValidHexColor(src.customCanvasBg)
      ? src.customCanvasBg
      : null;

  const fontPreset: FontPresetId =
    typeof src.fontPreset === 'string' &&
    FONT_PRESET_IDS.includes(src.fontPreset as FontPresetId)
      ? (src.fontPreset as FontPresetId)
      : DEFAULT_SETTINGS.fontPreset;

  const customFontFamily =
    typeof src.customFontFamily === 'string'
      ? src.customFontFamily.trim().slice(0, 80)
      : DEFAULT_SETTINGS.customFontFamily;

  const uiScale: UiScale = src.uiScale === 'compact' ? 'compact' : 'normal';

  const customShortcuts: Record<string, string> = {};
  if (src.customShortcuts && typeof src.customShortcuts === 'object') {
    for (const [k, v] of Object.entries(
      src.customShortcuts as Record<string, unknown>
    )) {
      if (typeof v === 'string' && v.trim().length > 0) {
        customShortcuts[k] = v.trim();
      }
    }
  }

  const rawAi =
    src.ai && typeof src.ai === 'object'
      ? (src.ai as Record<string, unknown>)
      : {};
  const validProviders = new Set<AIProviderType>([
    'gemini',
    'anthropic',
    'ollama',
    'openai',
  ]);
  const provider: AIProviderType =
    typeof rawAi.provider === 'string' &&
    validProviders.has(rawAi.provider as AIProviderType)
      ? (rawAi.provider as AIProviderType)
      : DEFAULT_AI_CONFIG.provider;

  return {
    version: 1,
    themeId,
    accentColor,
    customCanvasBg,
    fontPreset,
    customFontFamily,
    uiScale,
    showGrid: readBool(src.showGrid, DEFAULT_SETTINGS.showGrid),
    gridSize: Math.round(readFinite(src.gridSize, DEFAULT_SETTINGS.gridSize, 4, 128)),
    gridOpacity: Number(
      readFinite(src.gridOpacity, DEFAULT_SETTINGS.gridOpacity, 0.05, 0.6).toFixed(2)
    ),
    snapToGrid: readBool(src.snapToGrid, DEFAULT_SETTINGS.snapToGrid),
    snapToObjects: readBool(src.snapToObjects, DEFAULT_SETTINGS.snapToObjects),
    snapToArtboard: readBool(src.snapToArtboard, DEFAULT_SETTINGS.snapToArtboard),
    snapThreshold: Math.round(
      readFinite(src.snapThreshold, DEFAULT_SETTINGS.snapThreshold, 2, 20)
    ),
    undoLimit: Math.round(
      readFinite(src.undoLimit, DEFAULT_SETTINGS.undoLimit, 20, 300)
    ),
    nudgeStep: Number(
      readFinite(src.nudgeStep, DEFAULT_SETTINGS.nudgeStep, 1, 50).toFixed(1)
    ),
    nudgeShiftStep: Math.round(
      readFinite(src.nudgeShiftStep, DEFAULT_SETTINGS.nudgeShiftStep, 2, 100)
    ),
    autosaveEnabled: readBool(src.autosaveEnabled, DEFAULT_SETTINGS.autosaveEnabled),
    autosaveIntervalSec: Math.round(
      readFinite(
        src.autosaveIntervalSec,
        DEFAULT_SETTINGS.autosaveIntervalSec,
        15,
        300
      )
    ),
    wheelZoomSpeed: Number(
      readFinite(src.wheelZoomSpeed, DEFAULT_SETTINGS.wheelZoomSpeed, 0.5, 2.5).toFixed(
        2
      )
    ),
    showPerfStats: readBool(src.showPerfStats, DEFAULT_SETTINGS.showPerfStats),
    customShortcuts,
    ai: {
      provider,
      geminiApiKey: readString(rawAi.geminiApiKey, DEFAULT_AI_CONFIG.geminiApiKey),
      geminiModel:
        readString(rawAi.geminiModel, DEFAULT_AI_CONFIG.geminiModel).trim() ||
        DEFAULT_AI_CONFIG.geminiModel,
      anthropicApiKey: readString(
        rawAi.anthropicApiKey,
        DEFAULT_AI_CONFIG.anthropicApiKey
      ),
      anthropicModel:
        readString(rawAi.anthropicModel, DEFAULT_AI_CONFIG.anthropicModel).trim() ||
        DEFAULT_AI_CONFIG.anthropicModel,
      ollamaBaseUrl:
        readString(rawAi.ollamaBaseUrl, DEFAULT_AI_CONFIG.ollamaBaseUrl).trim() ||
        DEFAULT_AI_CONFIG.ollamaBaseUrl,
      ollamaModel:
        readString(rawAi.ollamaModel, DEFAULT_AI_CONFIG.ollamaModel).trim() ||
        DEFAULT_AI_CONFIG.ollamaModel,
      openaiBaseUrl:
        readString(rawAi.openaiBaseUrl, DEFAULT_AI_CONFIG.openaiBaseUrl).trim() ||
        DEFAULT_AI_CONFIG.openaiBaseUrl,
      openaiApiKey: readString(rawAi.openaiApiKey, DEFAULT_AI_CONFIG.openaiApiKey),
      openaiModel:
        readString(rawAi.openaiModel, DEFAULT_AI_CONFIG.openaiModel).trim() ||
        DEFAULT_AI_CONFIG.openaiModel,
    },
  };
}

function applyRuntimeSideEffects(settings: AppSettings): void {
  applyThemeToDom({
    themeId: settings.themeId,
    accentColor: settings.accentColor,
    customCanvasBg: settings.customCanvasBg,
    uiScale: settings.uiScale,
    fontPreset: settings.fontPreset,
    customFontFamily: settings.customFontFamily,
  });
  setUndoLimit(settings.undoLimit);
}

function persistSettingsAsync(settings: AppSettings): void {
  void writeAppConfigText(
    SETTINGS_FILE_PATH,
    JSON.stringify(settings, null, 2)
  ).catch(() => {});
}

export type SettingsPatch = Partial<Omit<AppSettings, 'ai'>> & {
  ai?: Partial<AIConfig>;
};

export interface SettingsStoreState {
  settings: AppSettings;
  loaded: boolean;
  lastAutosaveAt: number | null;
  loadSettings: () => Promise<AppSettings>;
  updateSettings: (patch: SettingsPatch) => AppSettings;
  setShortcutOverride: (actionId: string, combo: string | null) => void;
  resetShortcuts: () => void;
  resetSettings: () => AppSettings;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: sanitizeSettings(DEFAULT_SETTINGS),
  loaded: false,
  lastAutosaveAt: null,

  loadSettings: async () => {
    let parsed: unknown = null;
    try {
      const text = await readAppConfigText(SETTINGS_FILE_PATH);
      if (text) {
        parsed = JSON.parse(text) as unknown;
      }
    } catch {
      parsed = null;
    }
    const next = sanitizeSettings(parsed);
    set({ settings: next, loaded: true });
    applyRuntimeSideEffects(next);
    void useCustomFontStore
      .getState()
      .load()
      .then(() => applyRuntimeSideEffects(useSettingsStore.getState().settings));
    return next;
  },

  updateSettings: (patch) => {
    const current = get().settings;
    const merged = {
      ...current,
      ...patch,
      ai: patch.ai ? { ...current.ai, ...patch.ai } : current.ai,
    };
    const next = sanitizeSettings(merged);
    set({ settings: next, loaded: true });
    applyRuntimeSideEffects(next);
    persistSettingsAsync(next);
    return next;
  },

  setShortcutOverride: (actionId, combo) => {
    const nextShortcuts = { ...get().settings.customShortcuts };
    if (!combo) {
      delete nextShortcuts[actionId];
    } else {
      nextShortcuts[actionId] = combo;
    }
    get().updateSettings({ customShortcuts: nextShortcuts });
  },

  resetShortcuts: () => {
    get().updateSettings({ customShortcuts: {} });
  },

  resetSettings: () => {
    const next = sanitizeSettings(DEFAULT_SETTINGS);
    set({ settings: next, loaded: true });
    applyRuntimeSideEffects(next);
    persistSettingsAsync(next);
    return next;
  },
}));

export async function saveSceneDraft(scene: Scene): Promise<number | null> {
  const savedAt = Date.now();
  try {
    await writeAppConfigText(
      AUTOSAVE_DRAFT_PATH,
      JSON.stringify({ savedAt, scene })
    );
    useSettingsStore.setState({ lastAutosaveAt: savedAt });
    return savedAt;
  } catch {
    return null;
  }
}

export async function loadSceneDraft(): Promise<{
  savedAt: number;
  scene: Scene;
} | null> {
  try {
    const text = await readAppConfigText(AUTOSAVE_DRAFT_PATH);
    if (!text) return null;
    const parsed = JSON.parse(text) as { savedAt?: unknown; scene?: unknown };
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      !parsed.scene ||
      typeof parsed.scene !== 'object'
    ) {
      return null;
    }
    const scene = parsed.scene as Partial<Scene>;
    if (
      scene.version !== 1 ||
      typeof scene.width !== 'number' ||
      typeof scene.height !== 'number' ||
      !Array.isArray(scene.layers)
    ) {
      return null;
    }
    return {
      savedAt: parsed.savedAt,
      scene: scene as Scene,
    };
  } catch {
    return null;
  }
}
