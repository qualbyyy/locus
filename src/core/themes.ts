import { getFontStacks, type FontPresetId } from './typography';

export type ThemeId = 'paper' | 'studio' | 'graphite' | 'midnight';

export interface ThemeTokens {
  bg: string;
  canvas: string;
  panel: string;
  hover: string;
  border: string;
  ink: string;
  muted: string;
  danger: string;
}

export interface ThemePreset {
  id: ThemeId;
  label: string;
  isDark: boolean;
  defaultAccent: string;
  tokens: ThemeTokens;
}

export interface AccentPreset {
  color: string;
  label: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'paper',
    label: 'Тёплая бумага',
    isDark: false,
    defaultAccent: '#da7756',
    tokens: {
      bg: '#f5f2eb',
      canvas: '#ebe6dc',
      panel: '#faf8f4',
      hover: '#f0ece3',
      border: '#dfd9ce',
      ink: '#1c1b1a',
      muted: '#6b665e',
      danger: '#b83b2e',
    },
  },
  {
    id: 'studio',
    label: 'Светлая студия',
    isDark: false,
    defaultAccent: '#2563eb',
    tokens: {
      bg: '#f3f4f6',
      canvas: '#e5e7eb',
      panel: '#ffffff',
      hover: '#f1f5f9',
      border: '#d6dae0',
      ink: '#111827',
      muted: '#64748b',
      danger: '#dc2626',
    },
  },
  {
    id: 'graphite',
    label: 'Графитовая',
    isDark: true,
    defaultAccent: '#e0825f',
    tokens: {
      bg: '#1c1d20',
      canvas: '#141517',
      panel: '#23252a',
      hover: '#2c2f36',
      border: '#363a43',
      ink: '#f0f1f4',
      muted: '#9aa0ac',
      danger: '#e55b50',
    },
  },
  {
    id: 'midnight',
    label: 'Ночной индиго',
    isDark: true,
    defaultAccent: '#6384ff',
    tokens: {
      bg: '#121622',
      canvas: '#0b0e17',
      panel: '#181e2f',
      hover: '#212940',
      border: '#2c3654',
      ink: '#ecf1ff',
      muted: '#8e9bc0',
      danger: '#f06262',
    },
  },
];

export const ACCENT_PRESETS: AccentPreset[] = [
  { color: '#da7756', label: 'Терракота' },
  { color: '#4f6ef7', label: 'Кобальт' },
  { color: '#1f9d74', label: 'Изумруд' },
  { color: '#d9822b', label: 'Охра' },
  { color: '#d4497a', label: 'Кармин' },
  { color: '#4b5563', label: 'Графит' },
];

export function isValidHexColor(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!isValidHexColor(hex)) return null;
  const raw = hex.slice(1);
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function toHexChannel(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0');
}

export interface HsvColor {
  /** Оттенок: 0..360° */
  h: number;
  /** Насыщенность: 0..1 */
  s: number;
  /** Яркость (Value): 0..1 */
  v: number;
}

export function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const rn = Math.max(0, Math.min(1, r / 255));
  const gn = Math.max(0, Math.min(1, g / 255));
  const bn = Math.max(0, Math.min(1, b / 255));
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d > 1e-8) {
    if (max === rn) {
      h = 60 * (((gn - bn) / d) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / d + 2);
    } else {
      h = 60 * ((rn - gn) / d + 4);
    }
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

export function hsvToRgb(
  h: number,
  s: number,
  v: number
): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s));
  const vv = Math.max(0, Math.min(1, v));
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hh < 60) {
    r1 = c;
    g1 = x;
  } else if (hh < 120) {
    r1 = x;
    g1 = c;
  } else if (hh < 180) {
    g1 = c;
    b1 = x;
  } else if (hh < 240) {
    g1 = x;
    b1 = c;
  } else if (hh < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

export function hexToHsv(hex: string): HsvColor | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb.r, rgb.g, rgb.b) : null;
}

export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
}

export function computeAccentHover(hex: string, isDark: boolean): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return isDark ? '#e89578' : '#c86443';
  const factor = 0.12;
  const r = isDark ? rgb.r + (255 - rgb.r) * factor : rgb.r * (1 - factor);
  const g = isDark ? rgb.g + (255 - rgb.g) * factor : rgb.g * (1 - factor);
  const b = isDark ? rgb.b + (255 - rgb.b) * factor : rgb.b * (1 - factor);
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
}

export function getThemePreset(themeId: ThemeId): ThemePreset {
  return THEME_PRESETS.find((preset) => preset.id === themeId) ?? THEME_PRESETS[0];
}

export function applyThemeToDom(opts: {
  themeId: ThemeId;
  accentColor?: string;
  customCanvasBg?: string | null;
  uiScale?: 'compact' | 'normal';
  fontPreset?: FontPresetId;
  customFontFamily?: string | null;
}): void {
  if (typeof document === 'undefined') return;

  const preset = getThemePreset(opts.themeId);
  const accent =
    opts.accentColor && isValidHexColor(opts.accentColor)
      ? opts.accentColor
      : preset.defaultAccent;
  const accentHover = computeAccentHover(accent, preset.isDark);
  const canvasBg =
    opts.customCanvasBg && isValidHexColor(opts.customCanvasBg)
      ? opts.customCanvasBg
      : preset.tokens.canvas;

  const root = document.documentElement;
  root.style.setProperty('--color-paper-bg', preset.tokens.bg);
  root.style.setProperty('--color-paper-canvas', canvasBg);
  root.style.setProperty('--color-paper-panel', preset.tokens.panel);
  root.style.setProperty('--color-paper-hover', preset.tokens.hover);
  root.style.setProperty('--color-paper-border', preset.tokens.border);
  root.style.setProperty('--color-paper-accent', accent);
  root.style.setProperty('--color-paper-accent-hover', accentHover);
  root.style.setProperty('--color-paper-ink', preset.tokens.ink);
  root.style.setProperty('--color-paper-muted', preset.tokens.muted);
  root.style.setProperty('--color-paper-danger', preset.tokens.danger);

  const fonts = getFontStacks(opts.fontPreset ?? 'paper', opts.customFontFamily);
  root.style.setProperty('--font-ui', fonts.ui);
  root.style.setProperty('--font-display', fonts.display);

  root.dataset.theme = preset.id;
  root.dataset.uiScale = opts.uiScale ?? 'normal';
  root.dataset.fontPreset = opts.fontPreset ?? 'paper';
}
