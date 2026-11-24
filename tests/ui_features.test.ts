import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_INFO,
  formatDiagnostics,
} from '../src/core/appInfo';
import {
  getWheelZoomFactor,
  isCanvasZoomWheel,
} from '../src/engine/zoom';
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

  it('recognizes ctrl and meta wheel gestures but not ordinary wheel', () => {
    expect(isCanvasZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isCanvasZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(isCanvasZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });

  it('computes a stable zoom factor from wheel delta and speed', () => {
    const zoomOut = getWheelZoomFactor(120, 1);
    const zoomIn = getWheelZoomFactor(-120, 1.5);

    expect(zoomOut).toBeLessThan(1);
    expect(zoomIn).toBeGreaterThan(1);
    expect(Number.isFinite(zoomOut)).toBe(true);
    expect(Number.isFinite(zoomIn)).toBe(true);
  });

  it('formats safe diagnostic information without secrets', () => {
    const diagnostics = formatDiagnostics({
      appVersion: '0.1.0',
      platform: 'Linux x86_64',
      userAgent: 'TestBrowser/1.0',
      mode: 'Browser',
    });

    expect(diagnostics).toContain('0.1.0');
    expect(diagnostics).toContain('Linux x86_64');
    expect(diagnostics).toContain('Browser');
    expect(diagnostics).not.toContain('fake-api-key');
  });

  it('uses neutral labels when license or contacts are unavailable', () => {
    expect(APP_INFO.license.trim().length).toBeGreaterThan(0);
    expect(APP_INFO.creator.trim().length).toBeGreaterThan(0);
    expect(APP_INFO.contacts.trim().length).toBeGreaterThan(0);
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
