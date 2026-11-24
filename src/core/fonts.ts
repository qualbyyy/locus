import type { BuiltinFontFamily } from './types';

export interface BuiltinFontDescriptor {
  family: BuiltinFontFamily;
  label: string;
  files: Record<400 | 700, string>;
}

export const BUILTIN_FONTS: BuiltinFontDescriptor[] = [
  {
    family: 'Inter',
    label: 'Inter',
    files: {
      400: '/fonts/Inter-Regular.ttf',
      700: '/fonts/Inter-Bold.ttf',
    },
  },
  {
    family: 'Manrope',
    label: 'Manrope',
    files: {
      400: '/fonts/Manrope-Regular.ttf',
      700: '/fonts/Manrope-Bold.ttf',
    },
  },
  {
    family: 'Golos Text',
    label: 'Golos Text',
    files: {
      400: '/fonts/GolosText-Regular.ttf',
      700: '/fonts/GolosText-Bold.ttf',
    },
  },
  {
    family: 'Playfair Display',
    label: 'Playfair Display',
    files: {
      400: '/fonts/PlayfairDisplay-Regular.ttf',
      700: '/fonts/PlayfairDisplay-Bold.ttf',
    },
  },
  {
    family: 'JetBrains Mono',
    label: 'JetBrains Mono',
    files: {
      400: '/fonts/JetBrainsMono-Regular.ttf',
      700: '/fonts/JetBrainsMono-Bold.ttf',
    },
  },
  {
    family: 'Unbounded',
    label: 'Unbounded',
    files: {
      400: '/fonts/Unbounded-Regular.ttf',
      700: '/fonts/Unbounded-Bold.ttf',
    },
  },
];

const fontBytesCache = new Map<string, Uint8Array>();

export function primeFontBytesCache(
  family: BuiltinFontFamily,
  weight: 400 | 700,
  bytes: Uint8Array
): void {
  fontBytesCache.set(`${family}:${weight}`, bytes);
}

export function getFontUrl(family: BuiltinFontFamily, weight: 400 | 700): string {
  const entry = BUILTIN_FONTS.find((font) => font.family === family) ?? BUILTIN_FONTS[0];
  return entry.files[weight];
}

export async function loadFontBytes(
  family: BuiltinFontFamily,
  weight: 400 | 700
): Promise<Uint8Array> {
  const key = `${family}:${weight}`;
  const cached = fontBytesCache.get(key);
  if (cached) {
    return cached;
  }

  const url = getFontUrl(family, weight);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить шрифт ${family} (${weight}): ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  fontBytesCache.set(key, bytes);
  return bytes;
}

export async function preloadBuiltinFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return;
  }

  const loads = BUILTIN_FONTS.flatMap((font) => [
    document.fonts.load(`400 16px "${font.family}"`),
    document.fonts.load(`700 16px "${font.family}"`),
  ]);

  await Promise.allSettled(loads);
}
