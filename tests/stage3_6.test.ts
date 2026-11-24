import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearClipboard,
  copyLayerStyle,
  copySelectedLayers,
  pasteLayers,
  pasteLayerStyle,
} from '../src/core/clipboard';
import {
  booleanLayers,
  convertTextLayersToOutlines,
  createShapeLayer,
  createTextLayer,
  nudgeLayers,
  redoCommand,
  resetDocument,
  setClipMask,
  undoCommand,
  updateLayers,
} from '../src/core/commands';
import {
  DEFAULT_SETTINGS,
  loadSceneDraft,
  sanitizeSettings,
  saveSceneDraft,
  useSettingsStore,
} from '../src/core/settings';
import {
  findShortcutConflict,
  matchShortcut,
  SHORTCUT_DEFINITIONS,
} from '../src/core/shortcuts';
import { getUndoLimit, useEditorStore } from '../src/core/store';
import {
  applyThemeToDom,
  computeAccentHover,
  THEME_PRESETS,
} from '../src/core/themes';
import { snapBoundsMove, snapPointToGrid } from '../src/engine/snapping';
import { rgbToHex } from '../src/engine/tools/eyedropperTool';
import { collectDocumentColors } from '../src/ui/inspector/InspectorAppearance';

describe('Stage 3.6: Themes, Settings, Shortcuts, Clipboard, Snapping & Refactors', () => {
  beforeEach(() => {
    localStorage.clear();
    clearClipboard();
    useSettingsStore.getState().resetSettings();
    resetDocument({ name: 'Stage 3.6 Test', width: 1080, height: 1080 });
    useEditorStore.getState().setActiveTool('select');
    useEditorStore.getState().setSelectedIds([]);
  });

  it('applies 4 theme presets, custom accent hover and custom canvas background to DOM', () => {
    expect(THEME_PRESETS.map((t) => t.id)).toEqual([
      'paper',
      'studio',
      'graphite',
      'midnight',
    ]);

    expect(computeAccentHover('#da7756', false)).not.toBe('#da7756');
    expect(computeAccentHover('#6384ff', true)).not.toBe('#6384ff');

    applyThemeToDom({
      themeId: 'graphite',
      accentColor: '#4f6ef7',
      customCanvasBg: '#101218',
      uiScale: 'compact',
    });

    const root = document.documentElement;
    expect(root.dataset.theme).toBe('graphite');
    expect(root.dataset.uiScale).toBe('compact');
    expect(root.style.getPropertyValue('--color-paper-bg')).toBe('#1c1d20');
    expect(root.style.getPropertyValue('--color-paper-canvas')).toBe('#101218');
    expect(root.style.getPropertyValue('--color-paper-accent')).toBe('#4f6ef7');
  });

  it('sanitizes malformed settings, persists via localStorage, restores drafts and enforces dynamic undoLimit', async () => {
    const sanitized = sanitizeSettings({
      themeId: 'unknown-theme',
      gridSize: 999,
      undoLimit: 5,
      snapThreshold: 1,
      accentColor: 'not-a-hex',
      ai: { provider: 'openai', openaiModel: '   ' },
    });

    expect(sanitized.themeId).toBe(DEFAULT_SETTINGS.themeId);
    expect(sanitized.gridSize).toBe(128);
    expect(sanitized.undoLimit).toBe(20);
    expect(sanitized.snapThreshold).toBe(2);
    expect(sanitized.ai.provider).toBe('openai');
    expect(sanitized.ai.openaiModel).toBe(DEFAULT_SETTINGS.ai.openaiModel);

    useSettingsStore.getState().updateSettings({
      themeId: 'midnight',
      showGrid: true,
      gridSize: 24,
      undoLimit: 20,
      nudgeStep: 3,
      showPerfStats: true,
    });
    expect(getUndoLimit()).toBe(20);

    const shape = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 100,
      width: 60,
      height: 60,
    });
    for (let i = 1; i <= 25; i++) {
      updateLayers([shape.id], { x: 100 + i });
    }
    expect(useEditorStore.temporal.getState().pastStates.length).toBeLessThanOrEqual(
      20
    );

    useSettingsStore.setState({ settings: sanitizeSettings(DEFAULT_SETTINGS) });
    const reloaded = await useSettingsStore.getState().loadSettings();
    expect(reloaded.themeId).toBe('midnight');
    expect(reloaded.showGrid).toBe(true);
    expect(reloaded.gridSize).toBe(24);
    expect(reloaded.nudgeStep).toBe(3);

    const draftTime = await saveSceneDraft(useEditorStore.getState().scene);
    expect(draftTime).not.toBeNull();
    const draft = await loadSceneDraft();
    expect(draft?.scene.layers.length).toBe(1);
    expect(draft?.scene.name).toBe('Stage 3.6 Test');
  });

  it('keeps shortcuts conflict-free (I for image, E for eyedropper) and distinguishes modifiers', () => {
    const seen = new Set<string>();
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(seen.has(def.defaultCombo)).toBe(false);
      seen.add(def.defaultCombo);
      for (const alt of def.altCombos ?? []) {
        expect(seen.has(alt)).toBe(false);
        seen.add(alt);
      }
    }

    const mkEvt = (
      code: string,
      mods?: { ctrl?: boolean; alt?: boolean; shift?: boolean }
    ) => ({
      code,
      ctrlKey: Boolean(mods?.ctrl),
      metaKey: false,
      altKey: Boolean(mods?.alt),
      shiftKey: Boolean(mods?.shift),
    });

    expect(matchShortcut(mkEvt('KeyI'))).toBe('action.placeImage');
    expect(matchShortcut(mkEvt('KeyE'))).toBe('tool.eyedropper');
    expect(matchShortcut(mkEvt('Comma', { ctrl: true }))).toBe('app.openSettings');
    expect(matchShortcut(mkEvt('KeyV', { ctrl: true }))).toBe('edit.paste');
    expect(matchShortcut(mkEvt('KeyV', { ctrl: true, shift: true }))).toBe(
      'edit.pasteInPlace'
    );
    expect(matchShortcut(mkEvt('KeyC', { ctrl: true, alt: true }))).toBe(
      'edit.copyStyle'
    );
    expect(matchShortcut(mkEvt('KeyV', { ctrl: true, alt: true }))).toBe(
      'edit.pasteStyle'
    );

    const conflict = findShortcutConflict('tool.eyedropper', 'KeyI');
    expect(conflict?.id).toBe('action.placeImage');
  });

  it('copies/pastes layers (incremental offset & inPlace in 1 undo step) and transfers layer styles', () => {
    const mask = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 200,
      width: 120,
      height: 120,
      fill: '#1f9d74',
      stroke: { color: '#111827', width: 3, lineCap: 'square', lineJoin: 'bevel' },
    });
    const rect = createShapeLayer({
      preset: 'rect',
      x: 220,
      y: 220,
      width: 80,
      height: 80,
      fill: '#cccccc',
      stroke: null,
    });
    setClipMask(mask.id, [rect.id]);

    expect(copySelectedLayers([rect.id, mask.id])).toBe(2);

    const pastedOffset = pasteLayers({ inPlace: false });
    expect(pastedOffset.length).toBe(2);
    expect(pastedOffset[0].x).toBe(216);
    expect(pastedOffset[1].x).toBe(236);
    expect(pastedOffset[1].clipMaskId).toBe(pastedOffset[0].id);

    const pastedSecond = pasteLayers({ inPlace: false });
    expect(pastedSecond[0].x).toBe(232);

    const pastedInPlace = pasteLayers({ inPlace: true });
    expect(pastedInPlace[0].x).toBe(200);
    expect(useEditorStore.getState().scene.layers.length).toBe(8);

    undoCommand();
    expect(useEditorStore.getState().scene.layers.length).toBe(6);

    const txt = createTextLayer({ x: 500, y: 500, content: 'Привет', fill: '#000000' });
    updateLayers([mask.id], { fillRule: 'evenodd', opacity: 0.65 });
    const style = copyLayerStyle(mask.id);
    expect(style?.fill).toBe('#1f9d74');
    expect(style?.fillRule).toBe('evenodd');

    expect(pasteLayerStyle([rect.id, txt.id])).toBe(2);
    const layers = useEditorStore.getState().scene.layers;
    const updatedRect = layers.find((l) => l.id === rect.id);
    const updatedText = layers.find((l) => l.id === txt.id);
    expect(updatedRect?.type === 'path' && updatedRect.fill).toBe('#1f9d74');
    expect(updatedRect?.type === 'path' && updatedRect.fillRule).toBe('evenodd');
    expect(updatedRect?.opacity).toBe(0.65);
    expect(updatedText?.type === 'text' && updatedText.fill).toBe('#1f9d74');
    expect(updatedText?.opacity).toBe(0.65);
  });

  it('snaps moving bounds to artboard center, sibling edges (Smart Guides) and grid', () => {
    const snapCenter = snapBoundsMove(
      { x: 493, y: 487, width: 100, height: 100 },
      [],
      { width: 1080, height: 1080 },
      {
        snapToGrid: false,
        gridSize: 16,
        snapToObjects: true,
        snapToArtboard: true,
        thresholdWorld: 6,
      }
    );
    expect(snapCenter.dx).toBe(-3);
    expect(snapCenter.dy).toBe(3);
    expect(snapCenter.guides).toHaveLength(2);
    expect(snapCenter.guides[0]).toMatchObject({ orientation: 'vertical', pos: 540 });
    expect(snapCenter.guides[1]).toMatchObject({ orientation: 'horizontal', pos: 540 });

    const snapObj = snapBoundsMove(
      { x: 196, y: 310, width: 80, height: 50 },
      [{ x: 200, y: 100, width: 100, height: 80 }],
      { width: 1080, height: 1080 },
      {
        snapToGrid: false,
        gridSize: 16,
        snapToObjects: true,
        snapToArtboard: false,
        thresholdWorld: 6,
      }
    );
    expect(snapObj.dx).toBe(4);
    expect(snapObj.guides[0]).toMatchObject({
      orientation: 'vertical',
      pos: 200,
      start: 100,
      end: 360,
    });

    const snapGrid = snapBoundsMove(
      { x: 30, y: 66, width: 40, height: 40 },
      [],
      { width: 1080, height: 1080 },
      {
        snapToGrid: true,
        gridSize: 16,
        snapToObjects: false,
        snapToArtboard: false,
        thresholdWorld: 6,
      }
    );
    expect(snapGrid.dx).toBe(2);
    expect(snapGrid.dy).toBe(-2);
    expect(snapGrid.guides).toHaveLength(0);

    expect(snapPointToGrid({ x: 19, y: 29 }, 16)).toEqual({ x: 16, y: 32 });
  });

  it('exposes eyedropper hex, document palette, nudgeLayers (skipping locked) and commands re-exports', () => {
    expect(rgbToHex(218, 119, 86)).toBe('#da7756');

    const a = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      fill: '#4F6EF7',
      stroke: { color: '#1C1B1A', width: 2 },
    });
    const b = createShapeLayer({
      preset: 'rect',
      x: 120,
      y: 120,
      width: 50,
      height: 50,
      fill: '#4f6ef7',
      stroke: null,
    });
    updateLayers([b.id], { locked: true });

    nudgeLayers([a.id, b.id], 10, -5);
    const layers = useEditorStore.getState().scene.layers;
    expect(layers.find((l) => l.id === a.id)?.x).toBe(110);
    expect(layers.find((l) => l.id === a.id)?.y).toBe(95);
    expect(layers.find((l) => l.id === b.id)?.x).toBe(120);

    undoCommand();
    expect(useEditorStore.getState().scene.layers.find((l) => l.id === a.id)?.x).toBe(
      100
    );
    redoCommand();
    expect(useEditorStore.getState().scene.layers.find((l) => l.id === a.id)?.x).toBe(
      110
    );

    const palette = collectDocumentColors(useEditorStore.getState().scene);
    expect(palette).toEqual(['#4f6ef7', '#1c1b1a', '#ffffff']);

    expect(typeof booleanLayers).toBe('function');
    expect(typeof convertTextLayersToOutlines).toBe('function');
  });
});
