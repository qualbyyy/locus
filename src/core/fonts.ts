import * as fontkitModule from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';
import type { BuiltinFontFamily, FontFamily } from './types';

export interface BuiltinFontDescriptor {
  family: BuiltinFontFamily;
  label: string;
  files: Record<400 | 700, string>;
}

export interface ProjectFontEntry {
  id: string;
  family: string;
  fileName: string;
  weight: 400 | 700;
  mimeType: string;
  bytes: Uint8Array;
}

export const PROJECT_FONT_MAX_BYTES = 10 * 1024 * 1024;

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
const projectFonts = new Map<string, ProjectFontEntry>();
const loadedFontFaces = new Map<string, FontFace[]>();
const fontListeners = new Set<() => void>();

let fontIdCounter = 0;

function createProjectFontId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `font_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  fontIdCounter += 1;
  return `font_${Date.now().toString(36)}_${fontIdCounter}`;
}

function notifyFontListeners(): void {
  for (const listener of fontListeners) {
    listener();
  }
}

export function createFontkitFont(bytes: Uint8Array): Font {
  const mod = fontkitModule as unknown as {
    create?: (buf: Uint8Array) => Font;
    default?: { create: (buf: Uint8Array) => Font };
  };
  const fn = mod.create ?? mod.default?.create;
  if (!fn) {
    throw new Error('fontkit.create недоступен');
  }
  return fn(bytes);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length && offset + i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[offset + i]);
  }
  return out;
}

export function inferFontMimeType(fileName: string, bytes?: Uint8Array): string {
  if (bytes && bytes.length >= 4) {
    const tag = asciiAt(bytes, 0, 4);
    if (tag === 'wOF2') return 'font/woff2';
    if (tag === 'OTTO') return 'font/otf';
    if (
      (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
      tag === 'true'
    ) {
      return 'font/ttf';
    }
  }
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'woff2') return 'font/woff2';
  if (ext === 'otf') return 'font/otf';
  return 'font/ttf';
}

export function extensionForFontMime(mimeType: string): string {
  if (mimeType === 'font/woff2') return 'woff2';
  if (mimeType === 'font/otf') return 'otf';
  return 'ttf';
}

function fallbackFamilyFromFileName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_](regular|bold|italic|light|medium|semibold|black|400|700)$/i, '')
    .trim();
  return base || 'Custom Font';
}

function isBrowserFontLoadingSupported(): boolean {
  if (
    typeof document === 'undefined' ||
    typeof FontFace === 'undefined' ||
    !('fonts' in document)
  ) {
    return false;
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return false;
  }
  return true;
}

async function syncBrowserFontFacesForFamily(familyKey: string): Promise<void> {
  if (!isBrowserFontLoadingSupported()) return;

  const existing = loadedFontFaces.get(familyKey);
  if (existing) {
    for (const face of existing) {
      document.fonts.delete(face);
    }
    loadedFontFaces.delete(familyKey);
  }

  const entries = Array.from(projectFonts.values()).filter(
    (entry) => entry.family.toLowerCase() === familyKey
  );
  if (entries.length === 0) return;

  const createdFaces: FontFace[] = [];
  const multiWeight = entries.length > 1;
  for (const entry of entries) {
    try {
      const bufferCopy = entry.bytes.buffer.slice(
        entry.bytes.byteOffset,
        entry.bytes.byteOffset + entry.bytes.byteLength
      ) as ArrayBuffer;
      const face = new FontFace(entry.family, bufferCopy, {
        weight: multiWeight ? String(entry.weight) : '100 900',
      });
      await face.load();
      document.fonts.add(face);
      createdFaces.push(face);
    } catch {
      // Ignore browser decode failures; fontkit outline/AI export still works.
    }
  }
  if (createdFaces.length > 0) {
    loadedFontFaces.set(familyKey, createdFaces);
  }
}

export function prepareProjectFontEntry(params: {
  bytes: Uint8Array;
  fileName: string;
  family?: string;
  weight?: 400 | 700;
  id?: string;
}): ProjectFontEntry {
  if (params.bytes.byteLength > PROJECT_FONT_MAX_BYTES) {
    throw new Error('Файл шрифта превышает ограничение 10 МБ');
  }
  const copy = new Uint8Array(params.bytes.byteLength);
  copy.set(params.bytes);

  const font = createFontkitFont(copy);
  const family =
    params.family?.trim() ||
    font.familyName?.trim() ||
    fallbackFamilyFromFileName(params.fileName);
  const os2 = font['OS/2'] as { usWeightClass?: number } | undefined;
  const inferredBold =
    (os2?.usWeightClass !== undefined && os2.usWeightClass >= 600) ||
    /bold|semibold|demibold|black|heavy|700|800|900/i.test(
      `${font.subfamilyName ?? ''} ${params.fileName}`
    );
  const weight: 400 | 700 = params.weight ?? (inferredBold ? 700 : 400);
  const mimeType = inferFontMimeType(params.fileName, copy);

  return {
    id: params.id ?? createProjectFontId(),
    family,
    fileName: params.fileName,
    weight,
    mimeType,
    bytes: copy,
  };
}

export async function commitLoadedProjectFonts(entries: ProjectFontEntry[]): Promise<void> {
  clearProjectFonts();
  const families = new Set<string>();
  for (const entry of entries) {
    projectFonts.set(entry.id, entry);
    families.add(entry.family.toLowerCase());
  }
  for (const familyKey of families) {
    await syncBrowserFontFacesForFamily(familyKey);
  }
  notifyFontListeners();
}

export async function registerProjectFontFromBytes(params: {
  bytes: Uint8Array;
  fileName: string;
  family?: string;
  weight?: 400 | 700;
  id?: string;
}): Promise<ProjectFontEntry> {
  const entry = prepareProjectFontEntry(params);
  const familyKey = entry.family.toLowerCase();
  for (const [existingId, existing] of projectFonts.entries()) {
    if (existing.family.toLowerCase() === familyKey && existing.weight === entry.weight) {
      projectFonts.delete(existingId);
    }
  }
  projectFonts.set(entry.id, entry);
  await syncBrowserFontFacesForFamily(familyKey);
  notifyFontListeners();
  return entry;
}

export function getProjectFonts(): ProjectFontEntry[] {
  return Array.from(projectFonts.values());
}

export function getProjectFontBytes(
  family: string,
  weight: 400 | 700
): ProjectFontEntry | undefined {
  const familyKey = family.trim().toLowerCase();
  let fallback: ProjectFontEntry | undefined;
  for (const entry of projectFonts.values()) {
    if (entry.family.toLowerCase() !== familyKey) continue;
    if (entry.weight === weight) return entry;
    if (!fallback) fallback = entry;
  }
  return fallback;
}

export function removeProjectFont(id: string): void {
  const existing = projectFonts.get(id);
  if (!existing) return;
  projectFonts.delete(id);
  void syncBrowserFontFacesForFamily(existing.family.toLowerCase());
  notifyFontListeners();
}

export function removeProjectFontFamily(family: string): void {
  const familyKey = family.trim().toLowerCase();
  let removed = false;
  for (const [id, entry] of projectFonts.entries()) {
    if (entry.family.toLowerCase() === familyKey) {
      projectFonts.delete(id);
      removed = true;
    }
  }
  if (!removed) return;
  void syncBrowserFontFacesForFamily(familyKey);
  notifyFontListeners();
}

export function clearProjectFonts(): void {
  if (projectFonts.size === 0 && loadedFontFaces.size === 0) return;
  projectFonts.clear();
  if (typeof document !== 'undefined' && 'fonts' in document) {
    for (const faces of loadedFontFaces.values()) {
      for (const face of faces) {
        document.fonts.delete(face);
      }
    }
  }
  loadedFontFaces.clear();
  notifyFontListeners();
}

export function subscribeFonts(listener: () => void): () => void {
  fontListeners.add(listener);
  return () => {
    fontListeners.delete(listener);
  };
}

export function primeFontBytesCache(
  family: FontFamily,
  weight: 400 | 700,
  bytes: Uint8Array
): void {
  fontBytesCache.set(`${family}:${weight}`, bytes);
}

export function getFontUrl(family: FontFamily, weight: 400 | 700): string {
  const entry = BUILTIN_FONTS.find((font) => font.family === family) ?? BUILTIN_FONTS[0];
  return entry.files[weight];
}

export async function loadFontBytes(
  family: FontFamily,
  weight: 400 | 700
): Promise<Uint8Array> {
  const projectEntry = getProjectFontBytes(family, weight);
  if (projectEntry) {
    return projectEntry.bytes;
  }

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
