import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildContextMenuModel,
  runTextContextAction,
} from '../src/core/contextMenu';

describe('UI features: context menu and canvas zoom', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds object actions and an AI action for a layer context', () => {
    const items = buildContextMenuModel({
      area: 'canvas',
      layerIds: ['layer-1'],
      hasCopiedLayers: false,
    });
    const ids = items.map((item) => item.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'copy',
        'cut',
        'duplicate',
        'delete',
        'bringForward',
        'sendBackward',
        'ai',
      ])
    );
    expect(items.find((item) => item.id === 'ai')).toMatchObject({
      disabled: false,
      emphasis: 'accent',
    });
  });

  it('builds empty-area actions without object-only actions', () => {
    const items = buildContextMenuModel({
      area: 'canvas',
      layerIds: [],
      hasCopiedLayers: true,
    });
    const ids = items.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining(['paste', 'selectAll', 'deselect']));
    expect(ids).not.toEqual(expect.arrayContaining(['delete', 'ai', 'duplicate']));
  });

  it('builds text editing actions for an editable target', () => {
    const items = buildContextMenuModel({
      area: 'editable',
      layerIds: ['layer-1'],
      hasCopiedLayers: true,
    });
    const ids = items.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']));
    expect(ids).not.toEqual(expect.arrayContaining(['delete', 'ai', 'bringForward']));
  });

  it('runs text actions against the active selection', async () => {
    const input = document.createElement('input');
    input.value = 'Привет мир';
    document.body.append(input);
    input.focus();
    input.setSelectionRange(0, 6);

    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => true,
    });
    const execCommand = vi
      .spyOn(document, 'execCommand')
      .mockImplementation((command) => {
        if (command === 'selectAll') {
          input.setSelectionRange(0, input.value.length);
        }
        if (command === 'cut') {
          input.value = input.value.slice(input.selectionEnd ?? 0);
        }
        return true;
      });

    await runTextContextAction('selectAll', input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);

    await runTextContextAction('cut', input);
    expect(input.value).toBe('');
    expect(execCommand).toHaveBeenCalledWith('cut');
  });
});
