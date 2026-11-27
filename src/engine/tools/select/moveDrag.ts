import { getActiveArtboard } from '../../../core/artboards';
import { duplicateLayers } from '../../../core/commands';
import { getScopeLayers, getScopeWorldMatrix } from '../../../core/layerTree';
import {
  applyMatrixToVector,
  invertMatrix,
  snapVector45,
  type Matrix2D,
} from '../../../core/math';
import { useSettingsStore } from '../../../core/settings';
import {
  pauseHistory,
  resumeHistory,
  useEditorStore,
} from '../../../core/store';
import type { BBox, Layer, Point2D, Scene } from '../../../core/types';
import { combineLayerWorldBBoxes, resolveLayerWorldBBox } from '../../geometryBounds';
import { snapBoundsMove, type SmartGuideLine } from '../../snapping';
import type { ToolContext, ToolPointerEvent } from '../types';

export interface MoveDragMode {
  kind: 'move';
  initialLayers: Map<string, Layer>;
  initialWorldBBox: BBox;
  otherWorldBoxes: BBox[];
  invScopeM: Matrix2D;
  hasMoved: boolean;
  altDuplicateBase?: {
    scene: Scene;
    selectedIds: string[];
    sourceIds: string[];
    lastDelta: Point2D;
  };
}

export function startMoveDrag(
  scene: Scene,
  editingGroupId: string | null,
  moveTargets: Layer[]
): MoveDragMode {
  const scopeLayers = getScopeLayers(scene.layers, editingGroupId);
  const scopeM = getScopeWorldMatrix(scene.layers, editingGroupId);
  const moveTargetIds = new Set(moveTargets.map((l) => l.id));
  const otherWorldBoxes = scopeLayers
    .filter((l) => l.visible && !moveTargetIds.has(l.id))
    .map((l) => resolveLayerWorldBBox(l, scopeM, scene.layers));

  return {
    kind: 'move',
    initialLayers: new Map(moveTargets.map((l) => [l.id, l])),
    initialWorldBBox: combineLayerWorldBBoxes(scene.layers, moveTargets),
    otherWorldBoxes,
    invScopeM: invertMatrix(scopeM),
    hasMoved: false,
  };
}

export function updateMoveDrag(
  drag: MoveDragMode,
  event: ToolPointerEvent,
  ctx: ToolContext
): {
  nextOverrides: Map<string, Partial<Layer>>;
  guides: SmartGuideLine[] | null;
  skipApplyDraft: boolean;
} {
  let dx = event.point.x - event.startPoint.x;
  let dy = event.point.y - event.startPoint.y;
  if (event.shiftKey) {
    const snapped = snapVector45({ x: dx, y: dy });
    dx = snapped.x;
    dy = snapped.y;
  }

  let guides: SmartGuideLine[] | null = null;
  const settings = useSettingsStore.getState().settings;
  const canSnap =
    !(event.ctrlKey || event.metaKey) &&
    (settings.snapToGrid ||
      settings.snapToObjects ||
      settings.snapToArtboard ||
      (settings.snapToGuides && settings.showGuides));
  if (canSnap) {
    const state = useEditorStore.getState();
    const ab = getActiveArtboard(state.scene, state.activeArtboardId);
    const movingBox: BBox = {
      x: drag.initialWorldBBox.x + dx,
      y: drag.initialWorldBBox.y + dy,
      width: drag.initialWorldBBox.width,
      height: drag.initialWorldBBox.height,
    };
    const snap = snapBoundsMove(
      movingBox,
      drag.otherWorldBoxes,
      { x: ab.x, y: ab.y, width: ab.width, height: ab.height },
      {
        snapToGrid: settings.snapToGrid,
        gridSize: settings.gridSize,
        snapToObjects: settings.snapToObjects,
        snapToArtboard: settings.snapToArtboard,
        snapToGuides: settings.snapToGuides && settings.showGuides,
        manualGuides: state.scene.guides,
        thresholdWorld:
          settings.snapThreshold / Math.max(0.05, ctx.scope.view.zoom),
      }
    );
    dx += snap.dx;
    dy += snap.dy;
    guides = snap.guides.length > 0 ? snap.guides : null;
  }

  const localDelta = applyMatrixToVector(drag.invScopeM, { x: dx, y: dy });

  if (Math.hypot(dx, dy) > 0.25) {
    drag.hasMoved = true;
  }

  if (event.altKey && !drag.altDuplicateBase && Math.hypot(dx, dy) > 0.25) {
    const st = useEditorStore.getState();
    const sourceIds = Array.from(drag.initialLayers.keys());
    drag.altDuplicateBase = {
      scene: st.scene,
      selectedIds: st.selectedIds,
      sourceIds,
      lastDelta: localDelta,
    };
    pauseHistory();
    const copies = duplicateLayers(sourceIds, localDelta.x, localDelta.y);
    if (copies.length > 0) {
      drag.initialLayers = new Map(
        copies.map((c) => [
          c.id,
          { ...c, x: c.x - localDelta.x, y: c.y - localDelta.y },
        ])
      );
      const nextOverrides = new Map<string, Partial<Layer>>();
      for (const c of copies) {
        nextOverrides.set(c.id, { x: c.x, y: c.y });
      }
      ctx.redrawOverlay({ guides });
      ctx.scope.view.update();
      return { nextOverrides, guides, skipApplyDraft: true };
    }
    resumeHistory();
    drag.altDuplicateBase = undefined;
  }

  if (drag.altDuplicateBase) {
    drag.altDuplicateBase.lastDelta = localDelta;
  }

  const nextOverrides = new Map<string, Partial<Layer>>();
  for (const [id, initial] of drag.initialLayers.entries()) {
    if (
      initial.type === 'text' &&
      initial.pathId &&
      drag.initialLayers.has(initial.pathId)
    ) {
      continue;
    }
    nextOverrides.set(id, {
      x: initial.x + localDelta.x,
      y: initial.y + localDelta.y,
    });
  }
  return { nextOverrides, guides, skipApplyDraft: false };
}

export function commitAltDuplicateMove(
  drag: MoveDragMode,
  reset: (ctx?: ToolContext) => void,
  ctx: ToolContext
): boolean {
  if (!drag.altDuplicateBase) return false;
  const { scene, selectedIds, sourceIds, lastDelta } = drag.altDuplicateBase;
  drag.altDuplicateBase = undefined;
  reset(ctx);
  useEditorStore.setState({ scene, selectedIds });
  resumeHistory();
  duplicateLayers(sourceIds, lastDelta.x, lastDelta.y);
  return true;
}

export function cancelAltDuplicateMove(drag: MoveDragMode): boolean {
  if (!drag.altDuplicateBase) return false;
  const { scene, selectedIds } = drag.altDuplicateBase;
  drag.altDuplicateBase = undefined;
  useEditorStore.setState({ scene, selectedIds });
  resumeHistory();
  return true;
}
