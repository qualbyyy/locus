import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_INFO,
  formatDiagnostics,
  getRuntimeDiagnostics,
} from '../src/core/appInfo';
import {
  getWheelZoomFactor,
  isCanvasZoomWheel,
} from '../src/engine/zoom';
import { openExternalUrl } from '../src/platform/io';
import {
  CONTEXT_MENU_ACTION_KINDS,
  buildContextMenuModel,
  isObjectContextAction,
  runTextContextAction,
} from '../src/core/contextMenu';
import { DEFAULT_SMART_SHAPE_OPTIONS, useEditorStore } from '../src/core/store';
import { hexToHsv, hsvToHex, hsvToRgb, rgbToHsv } from '../src/core/themes';
import { Toolbar } from '../src/ui/Toolbar';

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

  it('maps every object action kind explicitly', () => {
    for (const action of [
      'copy',
      'cut',
      'duplicate',
      'delete',
      'bringForward',
      'sendBackward',
      'ai',
    ] as const) {
      expect(CONTEXT_MENU_ACTION_KINDS[action]).toBeTruthy();
    }

    expect(isObjectContextAction('delete')).toBe(true);
    expect(isObjectContextAction('bringForward')).toBe(true);
    expect(isObjectContextAction('ai')).toBe(true);
    expect(isObjectContextAction('selectAll')).toBe(false);
    expect(isObjectContextAction('paste')).toBe(false);
  });

  it('builds empty-area actions without object-only actions', () => {
    const items = buildContextMenuModel({
      area: 'canvas',
      layerIds: [],
      hasCopiedLayers: true,
    });
    const ids = items.map((item) => item.id);

    expect(ids).toEqual(expect.arrayContaining(['paste', 'selectAll', 'deselect']));
    expect(ids).not.toEqual(
      expect.arrayContaining(['delete', 'ai', 'duplicate', 'bringForward', 'sendBackward'])
    );
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

  it('uses modifier-only wheel zoom semantics', () => {
    expect(isCanvasZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
    expect(isCanvasZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isCanvasZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
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
      appVersion: APP_INFO.version,
      platform: 'Linux x86_64',
      userAgent: 'TestBrowser/1.0',
      mode: 'Browser',
    });

    expect(diagnostics).toContain(APP_INFO.version);
    expect(diagnostics).toContain('Linux x86_64');
    expect(diagnostics).toContain('Browser');
    expect(diagnostics).not.toContain('fake-api-key');
  });

  it('exposes identity-only about data without a capabilities list', () => {
    expect(APP_INFO.name).toBe('Locus');
    expect(APP_INFO.version).toBe('1.0.0');
    expect(Object.keys(APP_INFO)).not.toContain('capabilities');
    expect(Object.keys(APP_INFO)).not.toContain('features');
  });

  it('never copies API keys into diagnostics', () => {
    const runtime = {
      ...getRuntimeDiagnostics(),
      ai: {
        geminiApiKey: 'fake-api-key',
        openaiApiKey: 'fake-api-key',
      },
    };
    const diagnostics = formatDiagnostics(runtime);

    expect(diagnostics).not.toContain('fake-api-key');
  });

  it('provides Telegram and GitHub contact links', () => {
    const labels = APP_INFO.contactsLinks.map((link) => link.label);
    expect(labels).toEqual(expect.arrayContaining(['Telegram', 'GitHub']));
    for (const link of APP_INFO.contactsLinks) {
      expect(link.url).toMatch(/^https:\/\//);
    }
    expect(APP_INFO.repository).toMatch(/^https:\/\//);
  });

  it('rejects non-http external links', async () => {
    await expect(openExternalUrl('javascript:alert(1)')).rejects.toThrow();
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

  it('converts RGB/HEX to HSV and back accurately for color wheel', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 255, 0)).toEqual({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv(0, 0, 255)).toEqual({ h: 240, s: 1, v: 1 });
    expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsvToHex(0, 0, 0)).toBe('#000000');
    expect(hsvToHex(0, 0, 1)).toBe('#ffffff');

    const hsv = hexToHsv('#da7756');
    expect(hsv).not.toBeNull();
    expect(hsvToHex(hsv!.h, hsv!.s, hsv!.v)).toBe('#da7756');
  });

  it('opens tool flyouts via contextmenu/hold and extended drawer via "..." button', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const onSelectTool = vi.fn();
    const onSelectShapePreset = vi.fn();
    const onSelectTextMode = vi.fn();
    const onCreateCircleText = vi.fn();
    const onSelectKnifeMode = vi.fn();

    act(() => {
      root.render(
        createElement(Toolbar, {
          activeTool: 'select',
          showGrid: false,
          snapEnabled: true,
          smartShapePreset: 'blob',
          textToolMode: 'point',
          knifeToolMode: 'knife',
          onSelectTool,
          onSelectShapePreset,
          onSelectTextMode,
          onCreateCircleText,
          onSelectKnifeMode,
          onPlaceImage: vi.fn(),
          onToggleGrid: vi.fn(),
          onToggleSnap: vi.fn(),
          onFitArtboard: vi.fn(),
        })
      );
    });

    // Default smart shape preset is ellipse (circle), default fill is black (#1c1b1a), and blob menu ends with Capsule after Star without Blob
    expect(DEFAULT_SMART_SHAPE_OPTIONS.preset).toBe('ellipse');
    expect(useEditorStore.getState().defaultFill).toBe('#1c1b1a');

    // Right-click on Smart Shape opens flyout and picks Ellipse
    const blobBtn = container.querySelector('[data-tour="tool.blob"]') as HTMLButtonElement;
    expect(blobBtn).not.toBeNull();
    act(() => {
      blobBtn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    const popover = document.body.querySelector('[data-toolbar-popover="true"]');
    expect(popover).not.toBeNull();
    const flyoutLabels = Array.from(popover!.querySelectorAll('button')).map((b) =>
      b.textContent?.replace(/B$/, '').trim()
    );
    expect(flyoutLabels).toEqual([
      'Круг / Эллипс',
      'Прямоугольник',
      'Многоугольник',
      'Звезда',
      'Капсула',
    ]);
    const ellipseItem = Array.from(popover!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Круг / Эллипс')
    );
    expect(ellipseItem).toBeDefined();
    act(() => {
      ellipseItem!.click();
    });
    expect(onSelectShapePreset).toHaveBeenCalledWith('ellipse');
    expect(onSelectTool).toHaveBeenCalledWith('blob');
    expect(document.body.querySelector('[data-toolbar-popover="true"]')).toBeNull();

    // Hold on Text tool (>= 280ms) opens text mode flyout
    vi.useFakeTimers();
    const textBtn = container.querySelector('[data-tour="tool.text"]') as HTMLButtonElement;
    act(() => {
      textBtn.dispatchEvent(
        new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true })
      );
      vi.advanceTimersByTime(320);
    });
    vi.useRealTimers();
    const textPopover = document.body.querySelector('[data-toolbar-popover="true"]');
    expect(textPopover?.textContent).toContain('Текст по контуру (вокруг фигуры)');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.querySelector('[data-toolbar-popover="true"]')).toBeNull();

    // Clicking "..." button opens extended tools drawer and allows invoking circle text
    const moreBtn = container.querySelector('[data-tour="toolbar.more"]') as HTMLButtonElement;
    expect(moreBtn).not.toBeNull();
    act(() => {
      moreBtn.click();
    });
    const drawer = document.body.querySelector('[data-toolbar-popover="true"]');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent).toContain('Фигуры (B)');
    expect(drawer!.textContent).toContain('Текст и кривые (T)');
    expect(drawer!.textContent).toContain('Резка и рисование');

    const circlePresetBtn = Array.from(drawer!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Создать текст по кругу')
    );
    expect(circlePresetBtn).toBeDefined();
    act(() => {
      circlePresetBtn!.click();
    });
    expect(onCreateCircleText).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
  });
});
