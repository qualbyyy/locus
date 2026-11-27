import { applyShapeBuilderOperation } from '../../core/commands';
import { getScopeLayers, getScopeWorldMatrix } from '../../core/layerTree';
import { IDENTITY_MATRIX, applyMatrixToPoint, invertMatrix, type Matrix2D } from '../../core/math';
import { useEditorStore } from '../../core/store';
import type { PathLayer, Point2D, Scene } from '../../core/types';
import {
  applyShapeBuilderRegions,
  computeShapeBuilderRegions,
  hitTestShapeBuilderRegions,
  type ShapeBuilderRegion,
} from '../shapeBuilder';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

interface RegionCache {
  scene: Scene;
  editingGroupId: string | null;
  selectedKey: string;
  sourceLayerIds: string[];
  scopeMatrix: Matrix2D;
  invScopeMatrix: Matrix2D;
  regions: ShapeBuilderRegion[];
}

export function createShapeBuilderTool(): CanvasToolController {
  let cache: RegionCache | null = null;
  let hoveredRegionId: string | null = null;
  let isDragging = false;
  let dragMode: 'merge' | 'erase' = 'merge';
  let activeRegionIds: string[] = [];
  let trail: Point2D[] = [];
  let lastWorldPt: Point2D | null = null;

  const ensureRegions = (): RegionCache => {
    const state = useEditorStore.getState();
    const selectedKey = state.selectedIds.join(',');
    if (
      cache &&
      cache.scene === state.scene &&
      cache.editingGroupId === state.editingGroupId &&
      cache.selectedKey === selectedKey
    ) {
      return cache;
    }

    const scopeLayers = getScopeLayers(state.scene.layers, state.editingGroupId);
    const scopePaths = scopeLayers.filter(
      (l): l is PathLayer => l.type === 'path' && l.visible && !l.locked
    );
    const selectedSet = new Set(state.selectedIds);
    const selectedPaths = scopePaths.filter((l) => selectedSet.has(l.id));

    let targets: PathLayer[] = [];
    if (selectedPaths.length >= 2) {
      targets = selectedPaths.slice(-16);
    } else if (scopePaths.length >= 2) {
      targets = scopePaths.slice(-16);
    } else if (selectedPaths.length === 1 && selectedPaths[0].subpaths.length > 1) {
      targets = [selectedPaths[0]];
    } else if (scopePaths.length === 1 && scopePaths[0].subpaths.length > 1) {
      targets = [scopePaths[0]];
    }

    const scopeMatrix = getScopeWorldMatrix(state.scene.layers, state.editingGroupId);
    const invScopeMatrix = invertMatrix(scopeMatrix);
    const regions = computeShapeBuilderRegions(targets);

    cache = {
      scene: state.scene,
      editingGroupId: state.editingGroupId,
      selectedKey,
      sourceLayerIds: targets.map((t) => t.id),
      scopeMatrix,
      invScopeMatrix,
      regions,
    };
    return cache;
  };

  const syncOverlay = (ctx: ToolContext, current: RegionCache | null, mode: 'merge' | 'erase') => {
    ctx.redrawOverlay({
      shapeBuilder:
        current && current.regions.length > 0
          ? {
              regions: current.regions,
              hoveredRegionId,
              activeRegionIds,
              trail,
              mode,
              scopeMatrix: current.scopeMatrix,
            }
          : null,
    });
    ctx.scope.view.update();
  };

  let lastMode: 'merge' | 'erase' = 'merge';

  const reset = (ctx?: ToolContext) => {
    cache = null;
    isDragging = false;
    dragMode = 'merge';
    hoveredRegionId = null;
    activeRegionIds = [];
    trail = [];
    lastWorldPt = null;
    if (ctx) {
      ctx.redrawOverlay({ shapeBuilder: null });
      ctx.scope.view.update();
    }
  };

  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      const current = ensureRegions();
      if (current.regions.length === 0) {
        syncOverlay(ctx, null, 'merge');
        return;
      }

      isDragging = true;
      dragMode = event.altKey ? 'erase' : 'merge';
      activeRegionIds = [];
      trail = [event.point];
      lastWorldPt = event.point;

      const scopePt = applyMatrixToPoint(current.invScopeMatrix, event.point);
      const hitId = hitTestShapeBuilderRegions(ctx.scope, current.regions, scopePt);
      if (hitId) {
        activeRegionIds.push(hitId);
        hoveredRegionId = hitId;
      }
      syncOverlay(ctx, current, dragMode);
    },

    onMouseDrag(event: ToolPointerEvent, ctx: ToolContext) {
      if (!isDragging) return;
      const current = ensureRegions();
      dragMode = event.altKey ? 'erase' : 'merge';

      const prev = lastWorldPt ?? event.point;
      const dist = Math.hypot(event.point.x - prev.x, event.point.y - prev.y);
      const stepDist = 6 / Math.max(0.05, ctx.scope.view.zoom);
      const steps = Math.max(1, Math.min(48, Math.ceil(dist / stepDist)));

      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const sampleWorld = {
          x: prev.x + (event.point.x - prev.x) * t,
          y: prev.y + (event.point.y - prev.y) * t,
        };
        const sampleScope = applyMatrixToPoint(current.invScopeMatrix, sampleWorld);
        const hitId = hitTestShapeBuilderRegions(ctx.scope, current.regions, sampleScope);
        if (hitId) {
          hoveredRegionId = hitId;
          if (!activeRegionIds.includes(hitId)) {
            activeRegionIds = [...activeRegionIds, hitId];
          }
        }
      }

      if (dist >= 2 / Math.max(0.05, ctx.scope.view.zoom)) {
        trail = [...trail, event.point];
        lastWorldPt = event.point;
      }
      syncOverlay(ctx, current, dragMode);
    },

    onMouseMove(event: ToolPointerEvent, ctx: ToolContext) {
      if (isDragging) return;
      const hadRegions = Boolean(cache && cache.regions.length > 0);
      const current = ensureRegions();
      const mode: 'merge' | 'erase' = event.altKey ? 'erase' : 'merge';
      const scopePt = applyMatrixToPoint(current.invScopeMatrix, event.point);
      const nextHover =
        current.regions.length > 0
          ? hitTestShapeBuilderRegions(ctx.scope, current.regions, scopePt)
          : null;
      if (nextHover !== hoveredRegionId || mode !== lastMode || (!hadRegions && current.regions.length > 0)) {
        hoveredRegionId = nextHover;
        lastMode = mode;
        syncOverlay(ctx, current, mode);
      } else if (current.regions.length === 0) {
        ctx.redrawOverlay({ shapeBuilder: null });
      }
    },

    onMouseUp(event: ToolPointerEvent, ctx: ToolContext) {
      if (!isDragging) return;
      const current = ensureRegions();
      const touched = [...activeRegionIds];
      const mode = dragMode;
      const sourceIds = [...current.sourceLayerIds];

      isDragging = false;
      activeRegionIds = [];
      trail = [];
      lastWorldPt = null;

      if (touched.length > 0 && current.regions.length > 0) {
        const pieces = applyShapeBuilderRegions(current.regions, touched, mode);
        cache = null;
        applyShapeBuilderOperation(sourceIds, pieces);
      }

      const refreshed = ensureRegions();
      const scopePt = applyMatrixToPoint(refreshed.invScopeMatrix, event.point);
      hoveredRegionId =
        refreshed.regions.length > 0
          ? hitTestShapeBuilderRegions(ctx.scope, refreshed.regions, scopePt)
          : null;
      syncOverlay(ctx, refreshed, event.altKey ? 'erase' : 'merge');
    },

    finish(ctx: ToolContext): boolean {
      const had = isDragging;
      reset(ctx);
      return had;
    },

    cancel(ctx: ToolContext) {
      reset(ctx);
      void IDENTITY_MATRIX;
    },
  };
}
