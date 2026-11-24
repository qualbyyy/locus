import { beforeEach, describe, expect, it } from 'vitest';
import {
  createShapeLayer,
  deleteAnchor,
  deleteLayers,
  duplicateLayers,
  insertAnchorOnSegment,
  redoCommand,
  releaseClipMask,
  reorderLayer,
  resetDocument,
  runCommandBatch,
  setClipMask,
  toggleAnchorSmooth,
  undoCommand,
  updateLayers,
  updatePathSubpaths,
} from '../src/core/commands';
import { localToWorld } from '../src/core/math';
import { useEditorStore } from '../src/core/store';
import type { PathLayer } from '../src/core/types';

describe('core/commands & zundo store', () => {
  beforeEach(() => {
    resetDocument({ name: 'Test Doc', width: 1080, height: 1080 });
    useEditorStore.getState().setActiveTool('select');
    useEditorStore.getState().setSelectedIds([]);
    useEditorStore.getState().setSelectedNode(null);
    useEditorStore.getState().setZoomPercent(100);
  });

  it('excludes UI state from zundo history and preserves futureStates across selection changes', () => {
    const store = useEditorStore.getState();
    store.setActiveTool('blob');
    store.setZoomPercent(175);
    store.setSmartShapeOptions({ preset: 'rect', cornerRadius: 12 });
    store.setSelectedIds(['nonexistent']);

    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(0);

    const shape = createShapeLayer({
      preset: 'rect',
      x: 200,
      y: 200,
      width: 120,
      height: 80,
    });
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(1);

    undoCommand();
    expect(useEditorStore.getState().scene.layers).toHaveLength(0);
    expect(useEditorStore.temporal.getState().futureStates).toHaveLength(1);

    useEditorStore.getState().setActiveTool('pen');
    useEditorStore.getState().setSelectedIds([shape.id]);
    expect(useEditorStore.temporal.getState().futureStates).toHaveLength(1);

    redoCommand();
    expect(useEditorStore.getState().scene.layers).toHaveLength(1);
  });

  it('normalizes rotated PathLayer edits and supports 1-step undo', () => {
    const shape = createShapeLayer({
      preset: 'rect',
      x: 300,
      y: 250,
      width: 100,
      height: 100,
      options: { cornerRadius: 0 },
    });
    updateLayers([shape.id], { rotation: 37, scaleX: 1.4, scaleY: 0.85 });

    const beforeEdit = useEditorStore
      .getState()
      .scene.layers.find((l): l is PathLayer => l.id === shape.id)!;
    const anchor1WorldBefore = localToWorld(beforeEdit, {
      x: beforeEdit.subpaths[0].anchors[1].x,
      y: beforeEdit.subpaths[0].anchors[1].y,
    });

    const editedSubpaths = beforeEdit.subpaths.map((sp) => ({
      ...sp,
      anchors: sp.anchors.map((a, idx) =>
        idx === 0 ? { ...a, x: a.x - 40, y: a.y - 30 } : a
      ),
    }));

    const pastCountBefore =
      useEditorStore.temporal.getState().pastStates.length;
    const normalized = updatePathSubpaths(shape.id, editedSubpaths);
    expect(normalized).not.toBeNull();
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(
      pastCountBefore + 1
    );

    const anchor1WorldAfter = localToWorld(normalized!, {
      x: normalized!.subpaths[0].anchors[1].x,
      y: normalized!.subpaths[0].anchors[1].y,
    });
    expect(anchor1WorldAfter.x).toBeCloseTo(anchor1WorldBefore.x, 6);
    expect(anchor1WorldAfter.y).toBeCloseTo(anchor1WorldBefore.y, 6);

    undoCommand();
    const reverted = useEditorStore
      .getState()
      .scene.layers.find((l): l is PathLayer => l.id === shape.id)!;
    expect(reverted.x).toBeCloseTo(beforeEdit.x, 6);
    expect(reverted.y).toBeCloseTo(beforeEdit.y, 6);
  });

  it('inserts, toggles smooth, and deletes anchors while guarding minimum 2 anchors', () => {
    const shape = createShapeLayer({
      preset: 'polygon',
      x: 400,
      y: 400,
      width: 100,
      height: 100,
      options: { points: 3 },
    });

    const ref = insertAnchorOnSegment(shape.id, 0, 0, 0.5);
    expect(ref).toEqual({ layerId: shape.id, subpathIndex: 0, anchorIndex: 1 });
    let layer = useEditorStore.getState().scene.layers[0] as PathLayer;
    expect(layer.subpaths[0].anchors).toHaveLength(4);

    toggleAnchorSmooth(shape.id, 0, 1);
    layer = useEditorStore.getState().scene.layers[0] as PathLayer;
    expect(layer.subpaths[0].anchors[1].smooth).toBe(true);

    toggleAnchorSmooth(shape.id, 0, 1);
    layer = useEditorStore.getState().scene.layers[0] as PathLayer;
    expect(layer.subpaths[0].anchors[1].smooth).toBe(false);

    expect(deleteAnchor(shape.id, 0, 1)).toBe(true);
    expect(deleteAnchor(shape.id, 0, 0)).toBe(true);
    expect(deleteAnchor(shape.id, 0, 0)).toBe(false);
    layer = useEditorStore.getState().scene.layers[0] as PathLayer;
    expect(layer.subpaths[0].anchors).toHaveLength(2);
  });

  it('duplicates, reorders, manages clipping masks, and cleans up deleted masks', () => {
    const mask = createShapeLayer({
      preset: 'ellipse',
      x: 200,
      y: 200,
      width: 150,
      height: 150,
      fill: null,
      stroke: null,
      name: 'MaskCircle',
    });
    const rect = createShapeLayer({
      preset: 'rect',
      x: 220,
      y: 220,
      width: 200,
      height: 200,
      name: 'TargetRect',
    });

    const dupes = duplicateLayers([rect.id], 16, 16);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].x).toBe(236);
    expect(dupes[0].y).toBe(236);

    reorderLayer(mask.id, 'front');
    let layers = useEditorStore.getState().scene.layers;
    expect(layers[layers.length - 1].id).toBe(mask.id);

    setClipMask(mask.id, [mask.id, rect.id, dupes[0].id]);
    layers = useEditorStore.getState().scene.layers;
    const updatedMask = layers.find((l) => l.id === mask.id) as PathLayer;
    const updatedRect = layers.find((l) => l.id === rect.id)!;
    expect(updatedMask.isClipMask).toBe(true);
    expect(updatedMask.clipMaskId).toBeUndefined();
    expect(updatedRect.clipMaskId).toBe(mask.id);

    releaseClipMask(mask.id);
    layers = useEditorStore.getState().scene.layers;
    const releasedMask = layers.find((l) => l.id === mask.id) as PathLayer;
    const releasedRect = layers.find((l) => l.id === rect.id)!;
    expect(releasedMask.isClipMask).toBe(false);
    expect(releasedMask.stroke).not.toBeNull();
    expect(releasedRect.clipMaskId).toBeUndefined();

    setClipMask(mask.id, [rect.id]);
    deleteLayers([mask.id]);
    layers = useEditorStore.getState().scene.layers;
    expect(layers.find((l) => l.id === rect.id)?.clipMaskId).toBeUndefined();
  });

  it('batches multiple commands into a single Undo/Redo step', () => {
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(0);

    runCommandBatch(() => {
      const a = createShapeLayer({
        preset: 'rect',
        x: 100,
        y: 100,
        width: 80,
        height: 80,
      });
      const b = createShapeLayer({
        preset: 'ellipse',
        x: 220,
        y: 220,
        width: 90,
        height: 90,
      });
      updateLayers([a.id, b.id], { opacity: 0.5 });
      duplicateLayers([b.id], 20, 20);
    });

    expect(useEditorStore.getState().scene.layers).toHaveLength(3);
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(1);

    undoCommand();
    expect(useEditorStore.getState().scene.layers).toHaveLength(0);
    expect(useEditorStore.temporal.getState().futureStates).toHaveLength(1);

    redoCommand();
    expect(useEditorStore.getState().scene.layers).toHaveLength(3);
  });
});
