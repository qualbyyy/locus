import { create } from 'zustand';
import { bytesToDataUrl } from './assets';
import {
  readAppConfigBytes,
  readAppConfigText,
  writeAppConfigBytes,
  writeAppConfigText,
} from '../platform/io';

export const CANVAS_BACKDROP_META_FILE = 'canvas-background.json';
export const CANVAS_BACKDROP_MAX_BYTES = 24 * 1024 * 1024;

interface CanvasBackdropMeta {
  name: string;
  mimeType: string;
  url: string;
}

interface StoredBackdropMeta {
  name?: string;
  mimeType?: string;
  dataUrl?: string;
  fileName?: string;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function createBackdropUrl(bytes: Uint8Array, mimeType: string): string | null {
  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof Blob === 'undefined'
  ) {
    return null;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }));
}

function releaseBackdropUrl(url: string | null): void {
  if (
    url &&
    url.startsWith('blob:') &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    URL.revokeObjectURL(url);
  }
}

interface CanvasBackdropState {
  meta: CanvasBackdropMeta | null;
  load: () => Promise<CanvasBackdropMeta | null>;
  save: (file: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  }) => Promise<CanvasBackdropMeta>;
  clear: () => Promise<void>;
}

export const useCanvasBackdropStore = create<CanvasBackdropState>((set, get) => ({
  meta: null,

  load: async () => {
    try {
      const text = await readAppConfigText(CANVAS_BACKDROP_META_FILE);
      if (!text) return null;
      const parsed = JSON.parse(text) as StoredBackdropMeta;
      if (!parsed || typeof parsed !== 'object') return null;

      if (typeof parsed.dataUrl === 'string' && parsed.dataUrl) {
        const meta: CanvasBackdropMeta = {
          name: typeof parsed.name === 'string' ? parsed.name : 'background',
          mimeType:
            typeof parsed.mimeType === 'string' ? parsed.mimeType : 'image/png',
          url: parsed.dataUrl,
        };
        set({ meta });
        return meta;
      }

      const mimeType =
        typeof parsed.mimeType === 'string' ? parsed.mimeType : 'image/png';
      const fileName =
        typeof parsed.fileName === 'string'
          ? parsed.fileName
          : `canvas-background.${extensionForMime(mimeType)}`;
      const bytes = await readAppConfigBytes(fileName);
      if (!bytes || bytes.byteLength === 0) return null;

      const objectUrl =
        createBackdropUrl(bytes, mimeType) ?? bytesToDataUrl(bytes, mimeType);
      releaseBackdropUrl(get().meta?.url ?? null);
      const meta: CanvasBackdropMeta = {
        name: typeof parsed.name === 'string' ? parsed.name : fileName,
        mimeType,
        url: objectUrl,
      };
      set({ meta });
      return meta;
    } catch {
      return null;
    }
  },

  save: async ({ name, mimeType, bytes }) => {
    if (bytes.byteLength > CANVAS_BACKDROP_MAX_BYTES) {
      throw new Error('Файл больше 24 МБ');
    }
    const safeMime = /^image\/(png|jpeg|webp)$/.test(mimeType)
      ? mimeType
      : 'image/png';
    const fileName = `canvas-background.${extensionForMime(safeMime)}`;

    await writeAppConfigBytes(fileName, bytes);
    await writeAppConfigText(
      CANVAS_BACKDROP_META_FILE,
      JSON.stringify({ name, mimeType: safeMime, fileName })
    );

    releaseBackdropUrl(get().meta?.url ?? null);
    const objectUrl =
      createBackdropUrl(bytes, safeMime) ?? bytesToDataUrl(bytes, safeMime);
    const meta: CanvasBackdropMeta = { name, mimeType: safeMime, url: objectUrl };
    set({ meta });
    return meta;
  },

  clear: async () => {
    releaseBackdropUrl(get().meta?.url ?? null);
    try {
      await writeAppConfigText(CANVAS_BACKDROP_META_FILE, '');
    } catch {
      // In-memory state resets regardless.
    }
    set({ meta: null });
  },
}));
