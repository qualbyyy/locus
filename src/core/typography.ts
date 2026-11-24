import { create } from 'zustand';
import { readAppConfigText, writeAppConfigText } from '../platform/io';

export type FontPresetId = 'paper' | 'editorial' | 'geometric' | 'soft' | 'custom';

export interface FontPreset {
  id: Exclude<FontPresetId, 'custom'>;
  label: string;
  hint: string;
  ui: string;
  display: string;
}

export const FONT_PRESETS: FontPreset[] = [
  {
    id: 'paper',
    label: 'Бумага',
    hint: 'Manrope · Golos Text',
    ui: 'Manrope',
    display: 'Golos Text',
  },
  {
    id: 'editorial',
    label: 'Редакционный',
    hint: 'Golos Text · Playfair Display',
    ui: 'Golos Text',
    display: 'Playfair Display',
  },
  {
    id: 'geometric',
    label: 'Геометрический',
    hint: 'Inter · Unbounded',
    ui: 'Inter',
    display: 'Unbounded',
  },
  {
    id: 'soft',
    label: 'Мягкий',
    hint: 'Inter · Manrope',
    ui: 'Inter',
    display: 'Manrope',
  },
];

export const FONT_PRESET_IDS: FontPresetId[] = [
  ...FONT_PRESETS.map((preset) => preset.id),
  'custom',
];

export const CUSTOM_FONT_FAMILY = 'Locus Custom';
export const CUSTOM_FONT_FILE = 'ui-font.json';
export const CUSTOM_FONT_MAX_BYTES = 4 * 1024 * 1024;

export interface CustomFontMeta {
  family: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export function getFontPreset(id: FontPresetId): FontPreset | null {
  return FONT_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function getFontStacks(
  presetId: FontPresetId,
  customFamily?: string | null
): { ui: string; display: string } {
  const custom = (customFamily ?? '').trim();
  const fallbackUi = '"Manrope", "Inter", system-ui, sans-serif';
  const fallbackDisplay = '"Golos Text", "Manrope", system-ui, sans-serif';

  if (presetId === 'custom') {
    const family = custom || CUSTOM_FONT_FAMILY;
    const stack = `"${family}", ${fallbackUi}`;
    return { ui: stack, display: stack };
  }

  const preset = getFontPreset(presetId) ?? FONT_PRESETS[0];
  return {
    ui: `"${preset.ui}", system-ui, sans-serif`,
    display: `"${preset.display}", ${fallbackDisplay}`,
  };
}

export function fontMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.otf')) return 'font/otf';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  if (lower.endsWith('.woff')) return 'font/woff';
  return 'font/ttf';
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

export async function registerCustomFont(meta: CustomFontMeta): Promise<boolean> {
  if (
    typeof document === 'undefined' ||
    typeof FontFace === 'undefined' ||
    !('fonts' in document)
  ) {
    return false;
  }
  try {
    const bytes = base64ToBytes(meta.dataBase64);
    const face = new FontFace(meta.family, bytes.buffer as ArrayBuffer, {
      weight: '100 900',
    });
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}

interface CustomFontState {
  meta: CustomFontMeta | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<CustomFontMeta | null>;
  save: (file: { name: string; mimeType: string; bytes: Uint8Array }) => Promise<CustomFontMeta>;
  clear: () => Promise<void>;
}

export const useCustomFontStore = create<CustomFontState>((set, get) => ({
  meta: null,
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return get().meta;
    set({ loading: true, error: null });
    try {
      const text = await readAppConfigText(CUSTOM_FONT_FILE);
      if (!text) {
        set({ loading: false });
        return null;
      }
      const parsed = JSON.parse(text) as Partial<CustomFontMeta>;
      if (!parsed || typeof parsed.dataBase64 !== 'string' || !parsed.dataBase64) {
        set({ loading: false });
        return null;
      }
      const meta: CustomFontMeta = {
        family: CUSTOM_FONT_FAMILY,
        fileName: typeof parsed.fileName === 'string' ? parsed.fileName : 'font.ttf',
        mimeType:
          typeof parsed.mimeType === 'string' ? parsed.mimeType : 'font/ttf',
        dataBase64: parsed.dataBase64,
      };
      await registerCustomFont(meta);
      set({ meta, loading: false });
      return meta;
    } catch {
      set({ loading: false });
      return null;
    }
  },

  save: async ({ name, mimeType, bytes }) => {
    if (bytes.byteLength > CUSTOM_FONT_MAX_BYTES) {
      throw new Error('Файл шрифта больше 4 МБ');
    }
    const meta: CustomFontMeta = {
      family: CUSTOM_FONT_FAMILY,
      fileName: name,
      mimeType: mimeType || fontMimeFromName(name),
      dataBase64: bytesToBase64(bytes),
    };
    const registered = await registerCustomFont(meta);
    if (!registered) {
      throw new Error('Не удалось загрузить шрифт — проверьте формат файла');
    }
    await writeAppConfigText(CUSTOM_FONT_FILE, JSON.stringify(meta));
    set({ meta, error: null });
    return meta;
  },

  clear: async () => {
    try {
      await writeAppConfigText(CUSTOM_FONT_FILE, '');
    } catch {
      // Ignore: the in-memory state still resets below.
    }
    set({ meta: null, error: null });
  },
}));
