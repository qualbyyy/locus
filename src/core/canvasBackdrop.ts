import { create } from 'zustand';
import { bytesToDataUrl } from './assets';
import { readAppConfigText, writeAppConfigText } from '../platform/io';

export const CANVAS_BACKDROP_FILE = 'canvas-background.json';
export const CANVAS_BACKDROP_MAX_BYTES = 8 * 1024 * 1024;

interface CanvasBackdropMeta {
  name: string;
  mimeType: string;
  dataUrl: string;
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

export const useCanvasBackdropStore = create<CanvasBackdropState>((set) => ({
  meta: null,

  load: async () => {
    try {
      const text = await readAppConfigText(CANVAS_BACKDROP_FILE);
      if (!text) return null;
      const parsed = JSON.parse(text) as Partial<CanvasBackdropMeta>;
      if (!parsed || typeof parsed.dataUrl !== 'string' || !parsed.dataUrl) {
        return null;
      }
      const meta: CanvasBackdropMeta = {
        name: typeof parsed.name === 'string' ? parsed.name : 'background',
        mimeType:
          typeof parsed.mimeType === 'string' ? parsed.mimeType : 'image/png',
        dataUrl: parsed.dataUrl,
      };
      set({ meta });
      return meta;
    } catch {
      return null;
    }
  },

  save: async ({ name, mimeType, bytes }) => {
    if (bytes.byteLength > CANVAS_BACKDROP_MAX_BYTES) {
      throw new Error('Изображение больше 8 МБ');
    }
    const safeMime = /^image\/(png|jpeg|webp)$/.test(mimeType)
      ? mimeType
      : 'image/png';
    const meta: CanvasBackdropMeta = {
      name,
      mimeType: safeMime,
      dataUrl: bytesToDataUrl(bytes, safeMime),
    };
    await writeAppConfigText(CANVAS_BACKDROP_FILE, JSON.stringify(meta));
    set({ meta });
    return meta;
  },

  clear: async () => {
    try {
      await writeAppConfigText(CANVAS_BACKDROP_FILE, '');
    } catch {
      // In-memory state resets regardless.
    }
    set({ meta: null });
  },
}));
