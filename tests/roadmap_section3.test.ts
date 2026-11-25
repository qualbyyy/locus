import { beforeEach, describe, expect, it } from 'vitest';
import {
  addGuide,
  attachTextToPath,
  clearGuides,
  createShapeLayer,
  createTextLayer,
  deleteGuide,
  groupLayers,
  redoCommand,
  resetDocument,
  undoCommand,
  updateGuide,
  updateLayerEffects,
} from '../src/core/commands';
import {
  clearSceneDraft,
  loadSceneDraft,
  saveSceneDraft,
  useSettingsStore,
} from '../src/core/settings';
import { useEditorStore } from '../src/core/store';
import { snapBoundsMove } from '../src/engine/snapping';
import { buildLocusArchive, openLocusFromBytes } from '../src/export/projectFile';
import { extractSelectionScene } from '../src/export/selectionScene';
import { sceneToSvg } from '../src/export/toSvg';
import { DEFAULT_EFFECT_PATCH } from '../src/ui/inspector/InspectorEffects';

describe('Section 3 Roadmap UX & Reliability', () => {
  beforeEach(async () => {
    resetDocument({ name: 'TestDoc', width: 800, height: 600 });
    await clearSceneDraft();
  });

  it('1. Autosave draft saves, loads for crash recovery, and clears on save/discard', async () => {
    createShapeLayer({
      preset: 'rect',
      x: 150,
      y: 120,
      width: 100,
      height: 80,
      fill: '#da7756',
    });

    const savedAt = await saveSceneDraft(useEditorStore.getState().scene);
    expect(savedAt).not.toBeNull();
    expect(useSettingsStore.getState().lastAutosaveAt).toBe(savedAt);

    const loaded = await loadSceneDraft();
    expect(loaded).not.toBeNull();
    expect(loaded!.scene.name).toBe('TestDoc');
    expect(loaded!.scene.layers).toHaveLength(1);

    await clearSceneDraft();
    expect(await loadSceneDraft()).toBeNull();
    expect(useSettingsStore.getState().lastAutosaveAt).toBeNull();
  });

  it('2. Export selection and Copy as SVG crop bounds, deduplicate group+child, bake group transforms, and keep textPath host', async () => {
    const inside = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 100,
      width: 80,
      height: 40,
      fill: '#da7756',
      stroke: null,
    });
    const outside = createShapeLayer({
      preset: 'ellipse',
      x: 600,
      y: 450,
      width: 60,
      height: 60,
      fill: '#1e3a8a',
      stroke: null,
    });
    const grp = groupLayers([inside.id]);
    expect(grp).not.toBeNull();

    const curve = createShapeLayer({
      preset: 'ellipse',
      x: 140,
      y: 180,
      width: 120,
      height: 60,
      fill: null,
      stroke: { color: '#111111', width: 2 },
    });
    const txt = createTextLayer({
      content: 'CURVE',
      x: 140,
      y: 180,
      fontSize: 18,
    });
    attachTextToPath(txt.id, curve.id);

    const scene = useEditorStore.getState().scene;
    // Pass both group ID and child ID plus curved text (without selecting outside shape or host path directly)
    const sub = extractSelectionScene(scene, [grp!.id, inside.id, txt.id], 0);
    expect(sub).not.toBeNull();
    expect(sub!.background).toBe('transparent');
    expect(sub!.width).toBeLessThan(300);
    expect(sub!.layers.some((l) => l.id === outside.id)).toBe(false);
    // Deduplicated: group present, child not duplicated at root
    expect(sub!.layers.filter((l) => l.id === grp!.id)).toHaveLength(1);
    expect(sub!.layers.some((l) => l.id === inside.id)).toBe(false);

    const svg = await sceneToSvg(scene, {
      layerIds: [grp!.id, txt.id],
      includeBackground: true,
    });
    expect(svg).toContain('<textPath');
    expect(svg).not.toContain('#1e3a8a');
    // Background rect skipped for transparent selection scene
    expect(svg).not.toMatch(/<svg[^>]*>\s*<rect x="0" y="0" width="\d+" height="\d+" fill="rgb/);
  });

  it('3. Live inspector effect patches apply cleanly and undo in a single step', () => {
    const rect = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 200,
      width: 120,
      height: 80,
      fill: '#da7756',
    });

    updateLayerEffects([rect.id], DEFAULT_EFFECT_PATCH.dropShadow);
    const updated = useEditorStore.getState().scene.layers[0];
    expect(updated.effects?.dropShadow?.blur).toBe(12);

    updateLayerEffects([rect.id], { blur: 6 });
    expect(useEditorStore.getState().scene.layers[0].effects?.blur).toBe(6);

    undoCommand();
    expect(useEditorStore.getState().scene.layers[0].effects?.blur).toBeUndefined();
    expect(useEditorStore.getState().scene.layers[0].effects?.dropShadow?.blur).toBe(12);

    undoCommand();
    expect(useEditorStore.getState().scene.layers[0].effects).toBeUndefined();
  });

  it('4. Manual guides support add/update/delete/undo/redo, .locus serialization, and snapping', async () => {
    const gx = addGuide('vertical', 240);
    const gy = addGuide('horizontal', 180);
    expect(useEditorStore.getState().scene.guides).toHaveLength(2);

    updateGuide(gx.id, 250);
    expect(useEditorStore.getState().scene.guides?.[0].position).toBe(250);

    undoCommand();
    expect(useEditorStore.getState().scene.guides?.[0].position).toBe(240);
    redoCommand();
    expect(useEditorStore.getState().scene.guides?.[0].position).toBe(250);

    // .locus archive preserves manual guides
    const archive = await buildLocusArchive(useEditorStore.getState().scene);
    resetDocument();
    expect(useEditorStore.getState().scene.guides).toBeUndefined();
    const reopened = await openLocusFromBytes(archive);
    expect(reopened.guides).toHaveLength(2);
    expect(reopened.guides?.[0].position).toBe(250);

    // Snapping to manual guide
    const snap = snapBoundsMove(
      { x: 247, y: 50, width: 100, height: 60 },
      [],
      { x: 0, y: 0, width: 800, height: 600 },
      {
        snapToGrid: false,
        gridSize: 16,
        snapToObjects: false,
        snapToArtboard: false,
        snapToGuides: true,
        manualGuides: reopened.guides,
        thresholdWorld: 6,
      }
    );
    expect(snap.dx).toBe(3);
    expect(snap.guides.some((g) => g.orientation === 'vertical' && g.pos === 250)).toBe(
      true
    );

    deleteGuide(gy.id);
    expect(useEditorStore.getState().scene.guides).toHaveLength(1);
    clearGuides();
    expect(useEditorStore.getState().scene.guides).toBeUndefined();
  });
});
