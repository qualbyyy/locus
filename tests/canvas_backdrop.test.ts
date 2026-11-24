import { afterEach, describe, expect, it } from 'vitest';
import { useCanvasBackdropStore } from '../src/core/canvasBackdrop';

describe('workspace canvas backdrop', () => {
  afterEach(async () => {
    await useCanvasBackdropStore.getState().clear();
    useCanvasBackdropStore.setState({ meta: null });
  });

  it('saves, reloads and clears a background image', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);
    const saved = await useCanvasBackdropStore.getState().save({
      name: 'bg.png',
      mimeType: 'image/png',
      bytes,
    });
    expect(saved.url).toMatch(/^(blob:|data:image\/png)/);

    useCanvasBackdropStore.setState({ meta: null });
    const loaded = await useCanvasBackdropStore.getState().load();
    expect(loaded?.name).toBe('bg.png');

    await useCanvasBackdropStore.getState().clear();
    expect(useCanvasBackdropStore.getState().meta).toBeNull();
  });

  it('rejects images larger than 24 MB', async () => {
    await expect(
      useCanvasBackdropStore.getState().save({
        name: 'huge.png',
        mimeType: 'image/png',
        bytes: new Uint8Array(24 * 1024 * 1024 + 1),
      })
    ).rejects.toThrow('24 МБ');
  });
});
