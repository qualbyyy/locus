import {
  createTextLayer,
  createTextOnPathFromShape,
  updateLayers,
} from '../../core/commands';
import {
  findLayerById,
  findLayerPath,
  getScopeLayers,
  getScopeWorldMatrix,
} from '../../core/layerTree';
import { applyMatrixToPoint, invertMatrix } from '../../core/math';
import { useEditorStore } from '../../core/store';
import type { Layer, TextLayer } from '../../core/types';
import {
  beginTextPathHandleDrag,
  computeTextPathHandlePatch,
  findTopLayerAtPoint,
  getTextPathHandleHit,
  rebuildTextLayerItemInPlace,
  type TextPathHandleDragState,
} from './selectTool';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

function resolvePathHitCandidate(
  layerId: string,
  state: ReturnType<typeof useEditorStore.getState>,
  scopeLayers: Layer[] | null
): string | null {
  if (scopeLayers && !findLayerById(scopeLayers, layerId)) {
    return null;
  }
  const chain = findLayerPath(state.scene.layers, layerId);
  if (!chain || chain.length === 0) return null;
  if (chain.some((node) => !node.visible || node.locked)) return null;

  const target = chain[chain.length - 1];
  if (
    target.type === 'path' &&
    target.subpaths.some((sp) => sp.anchors.length >= 2)
  ) {
    return target.id;
  }
  return null;
}

function findHitPathLayerId(
  ctx: ToolContext,
  point: { x: number; y: number },
  allowFill: boolean
): string | null {
  const scopePt = new ctx.scope.Point(point.x, point.y);
  const tolerance = (allowFill ? 14 : 10) / Math.max(0.05, ctx.scope.view.zoom);
  const hits = ctx.sceneLayer.hitTestAll(scopePt, {
    curves: true,
    stroke: true,
    fill: allowFill,
    tolerance,
  });

  const state = useEditorStore.getState();
  const scopeLayers = state.editingGroupId
    ? getScopeLayers(state.scene.layers, state.editingGroupId)
    : null;
  const seen = new Set<string>();

  if (hits && hits.length > 0) {
    for (const hit of hits) {
      let cur: paper.Item | null | undefined = hit.item;
      let layerId: string | null = null;
      while (cur && cur !== ctx.sceneLayer) {
        if (typeof cur.data?.layerId === 'string') {
          layerId = cur.data.layerId;
          break;
        }
        cur = cur.parent;
      }
      if (!layerId || seen.has(layerId)) continue;
      seen.add(layerId);

      const resolved = resolvePathHitCandidate(layerId, state, scopeLayers);
      if (resolved) return resolved;
    }
  }

  // In path text mode, allow clicking inside unfilled closed shapes (e.g. guide circles with fill: null)
  if (allowFill) {
    const checkItems = (container: paper.Item): string | null => {
      const children = container.children ?? [];
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i];
        if (!child.visible) continue;
        if (
          (child instanceof ctx.scope.Path || child instanceof ctx.scope.CompoundPath) &&
          child.closed &&
          typeof child.data?.layerId === 'string' &&
          child.contains(scopePt)
        ) {
          const resolved = resolvePathHitCandidate(child.data.layerId, state, scopeLayers);
          if (resolved) return resolved;
        }
        if (child.children && child.children.length > 0) {
          const nested = checkItems(child);
          if (nested) return nested;
        }
      }
      return null;
    };
    return checkItems(ctx.sceneLayer);
  }
  return null;
}

export function createTextTool(): CanvasToolController {
  let lastHoveredPathId: string | null = null;
  let handleDrag: TextPathHandleDragState | null = null;
  let handleDraftPatch: Partial<TextLayer> | null = null;

  const updateHover = (hoveredTextPathId: string | null, ctx: ToolContext) => {
    if (hoveredTextPathId === lastHoveredPathId) return;
    lastHoveredPathId = hoveredTextPathId;
    ctx.redrawOverlay({ hoveredTextPathId });
    ctx.scope.view.update();
  };

  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      const state = useEditorStore.getState();
      if (state.selectedIds.length === 1) {
        const selected = findLayerById(state.scene.layers, state.selectedIds[0]);
        if (selected?.type === 'text' && selected.pathId && !selected.locked) {
          const hitHandle = getTextPathHandleHit(ctx, event.point);
          if (hitHandle) {
            const started = beginTextPathHandleDrag(
              state.scene.layers,
              selected,
              hitHandle,
              event.point
            );
            if (started) {
              handleDrag = started;
              handleDraftPatch = null;
              return;
            }
          }
        }
      }

      updateHover(null, ctx);
      const hitText = findTopLayerAtPoint(
        ctx,
        event.point,
        (layer) => layer.type === 'text'
      );

      if (hitText && hitText.type === 'text') {
        useEditorStore.getState().setSelectedIds([hitText.id]);
        ctx.startTextEditing(hitText.id, false);
        return;
      }

      const isPathMode = state.textToolMode === 'path';
      const hitPathId = findHitPathLayerId(ctx, event.point, isPathMode);
      if (hitPathId) {
        const created = createTextOnPathFromShape(hitPathId, {
          content: 'Текст по контуру',
        });
        if (created) {
          ctx.startTextEditing(created.id, true);
          return;
        }
      }

      const invScope = invertMatrix(
        getScopeWorldMatrix(state.scene.layers, state.editingGroupId)
      );
      const localPt = applyMatrixToPoint(invScope, event.point);

      const created = createTextLayer({
        x: Math.round(localPt.x),
        y: Math.round(localPt.y),
        parentGroupId: state.editingGroupId,
      });
      ctx.startTextEditing(created.id, true);
    },

    onMouseDrag(event: ToolPointerEvent, ctx: ToolContext) {
      if (!handleDrag) return;
      const state = useEditorStore.getState();
      const patch = computeTextPathHandlePatch(
        handleDrag,
        event.point,
        state.scene.layers
      );
      if (!patch) return;
      handleDraftPatch = patch;
      const merged: TextLayer = { ...handleDrag.layer, ...patch };
      rebuildTextLayerItemInPlace(ctx, merged, state.scene.layers);
      ctx.redrawOverlay({
        draftOverrides: new Map([[handleDrag.layer.id, patch]]),
      });
      ctx.scope.view.update();
    },

    onMouseMove(event: ToolPointerEvent, ctx: ToolContext) {
      if (handleDrag) return;
      const hitText = findTopLayerAtPoint(
        ctx,
        event.point,
        (layer) => layer.type === 'text'
      );
      if (hitText) {
        updateHover(null, ctx);
        return;
      }
      const isPathMode = useEditorStore.getState().textToolMode === 'path';
      updateHover(findHitPathLayerId(ctx, event.point, isPathMode), ctx);
    },

    onMouseUp(_event: ToolPointerEvent, ctx: ToolContext) {
      if (!handleDrag) return;
      const committed = handleDrag.hasMoved ? handleDraftPatch : null;
      const targetId = handleDrag.layer.id;
      handleDrag = null;
      handleDraftPatch = null;
      ctx.redrawOverlay({ draftOverrides: undefined });
      ctx.scope.view.update();
      if (committed) {
        updateLayers([targetId], committed);
      }
    },

    onDoubleClick(event: ToolPointerEvent, ctx: ToolContext) {
      const hitText = findTopLayerAtPoint(
        ctx,
        event.point,
        (layer) => layer.type === 'text'
      );
      if (hitText && hitText.type === 'text') {
        useEditorStore.getState().setSelectedIds([hitText.id]);
        ctx.startTextEditing(hitText.id, true);
      }
    },

    cancel(ctx: ToolContext) {
      handleDrag = null;
      handleDraftPatch = null;
      updateHover(null, ctx);
    },
  };
}
