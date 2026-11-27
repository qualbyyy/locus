import { findArtboardAtPoint } from '../../core/artboards';
import { updateLayers } from '../../core/commands';
import {
  findLayerById,
  getParentGroupId,
  getScopeLayers,
} from '../../core/layerTree';
import { useEditorStore } from '../../core/store';
import type { Layer } from '../../core/types';
import {
  findTopLayerAtPoint,
  getSelectHandleHit,
  getTextPathHandleHit,
} from '../hitTest';
import {
  applyDraftToPaper,
  rebuildTextLayerItemInPlace,
  restoreDraftToPaper,
} from '../liveDraftSync';
import {
  type GradientHandleDragMode,
  normalizeCommittedGradientStops,
  tryStartGradientHandleDrag,
  updateGradientHandleDrag,
} from './select/gradientDrag';
import {
  type MarqueeDragMode,
  type MoveGuideDragMode,
  finishGuideDrag,
  finishMarqueeDrag,
  startMarqueeDrag,
  tryStartGuideDrag,
  updateGuideDrag,
  updateMarqueeDrag,
} from './select/guideAndMarqueeDrag';
import {
  type MoveDragMode,
  cancelAltDuplicateMove,
  commitAltDuplicateMove,
  startMoveDrag,
  updateMoveDrag,
} from './select/moveDrag';
import {
  type TextPathDragMode,
  type TextPathHandleDragState,
  beginTextPathHandleDrag,
  computeTextPathHandlePatch,
  tryStartCurvedTextBodyDrag,
  tryStartTextPathHandleDrag,
  updateTextPathHandleDrag,
} from './select/textPathDrag';
import {
  type TransformDragMode,
  startTransformDrag,
  updateResizeMultiDrag,
  updateResizeSingleDrag,
  updateRotateDrag,
} from './select/transformDrag';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

export {
  getTextPathHandleHit,
  findTopLayerAtPoint,
  rebuildTextLayerItemInPlace,
  beginTextPathHandleDrag,
  computeTextPathHandlePatch,
};
export type { TextPathHandleDragState };

type DragMode =
  | MoveDragMode
  | TransformDragMode
  | GradientHandleDragMode
  | TextPathDragMode
  | MarqueeDragMode
  | MoveGuideDragMode;

export function createSelectTool(): CanvasToolController {
  let drag: DragMode | null = null;
  let draftOverrides = new Map<string, Partial<Layer>>();
  let lastHoveredMaskId: string | null = null;

  const reset = (ctx?: ToolContext) => {
    drag = null;
    draftOverrides = new Map();
    lastHoveredMaskId = null;
    if (ctx) {
      ctx.redrawOverlay({
        draftOverrides: undefined,
        marquee: null,
        hoveredMaskId: null,
        guides: null,
        draggingGuide: null,
      });
      ctx.scope.view.update();
    }
  };

  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      const state = useEditorStore.getState();
      const selectedLayers = state.selectedIds
        .map((id) => findLayerById(state.scene.layers, id))
        .filter((l): l is Layer => l !== null);
      const selectedSet = new Set(selectedLayers.map((l) => l.id));
      const unlockedSelected = selectedLayers.filter((l) => !l.locked);

      if (unlockedSelected.length === 1 && selectedLayers.length === 1) {
        const textPathDrag = tryStartTextPathHandleDrag(
          ctx,
          state.scene.layers,
          unlockedSelected[0],
          event.point
        );
        if (textPathDrag) {
          drag = textPathDrag;
          return;
        }

        const gradDrag = tryStartGradientHandleDrag(
          ctx,
          state.scene.layers,
          unlockedSelected[0],
          event.point
        );
        if (gradDrag) {
          drag = gradDrag;
          return;
        }
      }

      const hitHandle =
        unlockedSelected.length > 0 ? getSelectHandleHit(ctx, event.point) : null;
      if (hitHandle) {
        drag = startTransformDrag(
          hitHandle,
          event.point,
          state.scene,
          state.editingGroupId,
          selectedLayers,
          unlockedSelected
        );
        return;
      }

      const hitLayer = findTopLayerAtPoint(ctx, event.point);
      if (hitLayer) {
        const hitAb = findArtboardAtPoint(state.scene, event.point);
        if (hitAb && hitAb.id !== state.activeArtboardId) {
          state.setActiveArtboardId(hitAb.id);
        }

        let nextIds = state.selectedIds;
        if (event.shiftKey) {
          if (selectedSet.has(hitLayer.id)) {
            nextIds = state.selectedIds.filter((id) => id !== hitLayer.id);
          } else {
            nextIds = [...state.selectedIds, hitLayer.id];
          }
          state.setSelectedIds(nextIds);
        } else if (!selectedSet.has(hitLayer.id)) {
          nextIds = [hitLayer.id];
          state.setSelectedIds(nextIds);
        }

        const activeSet = new Set(nextIds);
        const scopeLayers = getScopeLayers(state.scene.layers, state.editingGroupId);
        const moveTargets = scopeLayers.filter(
          (l) => activeSet.has(l.id) && !l.locked
        );
        if (moveTargets.length > 0 && activeSet.has(hitLayer.id)) {
          if (
            moveTargets.length === 1 &&
            moveTargets[0].type === 'text' &&
            moveTargets[0].pathId &&
            !event.altKey
          ) {
            const curvedTextDrag = tryStartCurvedTextBodyDrag(
              state.scene.layers,
              moveTargets[0],
              event.point
            );
            if (curvedTextDrag) {
              drag = curvedTextDrag;
              return;
            }
          }

          drag = startMoveDrag(state.scene, state.editingGroupId, moveTargets);
        }
        return;
      }

      const guideDrag = tryStartGuideDrag(ctx, state.scene, event);
      if (guideDrag) {
        drag = guideDrag;
        return;
      }

      const clickedAb = findArtboardAtPoint(state.scene, event.point);
      if (clickedAb && clickedAb.id !== state.activeArtboardId) {
        state.setActiveArtboardId(clickedAb.id);
      }

      if (!event.shiftKey && state.selectedIds.length > 0) {
        state.setSelectedIds([]);
      }

      drag = startMarqueeDrag(event);
    },

    onMouseDrag(event: ToolPointerEvent, ctx: ToolContext) {
      if (!drag) return;

      if (drag.kind === 'text-path-handle') {
        const nextOverrides = updateTextPathHandleDrag(drag, event.point);
        if (!nextOverrides) return;
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'gradient-handle') {
        const nextOverrides = updateGradientHandleDrag(drag, event);
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'move-guide') {
        updateGuideDrag(drag, event.point, ctx);
        return;
      }

      if (drag.kind === 'marquee') {
        updateMarqueeDrag(drag, event, ctx);
        return;
      }

      if (drag.kind === 'move') {
        const res = updateMoveDrag(drag, event, ctx);
        draftOverrides = res.nextOverrides;
        if (!res.skipApplyDraft) {
          applyDraftToPaper(ctx, res.nextOverrides, res.guides);
        }
        return;
      }

      if (drag.kind === 'rotate') {
        const nextOverrides = updateRotateDrag(drag, event);
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'resize-single') {
        const nextOverrides = updateResizeSingleDrag(drag, event);
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'resize-multi') {
        const nextOverrides = updateResizeMultiDrag(drag, event);
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
      }
    },

    onMouseMove(event: ToolPointerEvent, ctx: ToolContext) {
      if (drag) return;
      const hitLayer = findTopLayerAtPoint(ctx, event.point);
      let nextHoveredMaskId: string | null = null;
      if (hitLayer) {
        if (hitLayer.type === 'path' && hitLayer.isClipMask) {
          nextHoveredMaskId = hitLayer.id;
        } else if (hitLayer.clipMaskId) {
          nextHoveredMaskId = hitLayer.clipMaskId;
        }
      }
      if (nextHoveredMaskId !== lastHoveredMaskId) {
        lastHoveredMaskId = nextHoveredMaskId;
        ctx.redrawOverlay({ hoveredMaskId: nextHoveredMaskId });
        ctx.scope.view.update();
      }
    },

    onMouseUp(event: ToolPointerEvent, ctx: ToolContext) {
      if (!drag) return;

      if (drag.kind === 'move-guide') {
        finishGuideDrag(drag, event.point, reset, ctx);
        return;
      }

      if (drag.kind === 'marquee') {
        finishMarqueeDrag(drag, reset, ctx);
        return;
      }

      if (drag.kind === 'move' && commitAltDuplicateMove(drag, reset, ctx)) {
        return;
      }

      const shouldCommit = drag.hasMoved && draftOverrides.size > 0;
      const committedOverrides = new Map(draftOverrides);
      const sortStopsTarget =
        drag.kind === 'gradient-handle' && drag.handleKind === 'stop'
          ? drag.target
          : null;
      reset(ctx);

      if (shouldCommit) {
        updateLayers(Array.from(committedOverrides.keys()), (layer) => {
          const patch = committedOverrides.get(layer.id);
          if (!patch) return layer;
          const next = { ...layer, ...patch } as Layer;
          return normalizeCommittedGradientStops(next, sortStopsTarget);
        });
      }
    },

    onDoubleClick(event: ToolPointerEvent, ctx: ToolContext) {
      const state = useEditorStore.getState();
      const hitLayer = findTopLayerAtPoint(ctx, event.point);

      if (!hitLayer) {
        if (state.editingGroupId !== null) {
          const parentGroupId = getParentGroupId(
            state.scene.layers,
            state.editingGroupId
          );
          state.setEditingGroupId(parentGroupId);
          state.setSelectedIds([]);
        }
        return;
      }

      if (hitLayer.type === 'group') {
        state.setEditingGroupId(hitLayer.id);
        const childHit = findTopLayerAtPoint(ctx, event.point);
        state.setSelectedIds(childHit ? [childHit.id] : []);
        return;
      }

      if (hitLayer.type === 'text') {
        state.setSelectedIds([hitLayer.id]);
        ctx.startTextEditing(hitLayer.id, true);
        return;
      }

      if (hitLayer.type === 'path') {
        state.setSelectedIds([hitLayer.id]);
        state.setActiveTool('node');
      }
    },

    cancel(ctx: ToolContext) {
      if (drag?.kind === 'move' && cancelAltDuplicateMove(drag)) {
        reset(ctx);
        return;
      }
      restoreDraftToPaper(ctx, draftOverrides);
      reset(ctx);
    },
  };
}
