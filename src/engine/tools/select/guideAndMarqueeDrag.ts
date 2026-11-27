import { deleteGuide, updateGuide } from '../../../core/commands';
import { getScopeLayers, getScopeWorldMatrix } from '../../../core/layerTree';
import { useSettingsStore } from '../../../core/settings';
import { useEditorStore } from '../../../core/store';
import type { Guide, Point2D, Scene } from '../../../core/types';
import { bboxIntersects, resolveLayerWorldBBox } from '../../geometryBounds';
import type { MarqueeOverlay } from '../../overlay/shared';
import type { ToolContext, ToolPointerEvent } from '../types';

export interface MarqueeDragMode {
  kind: 'marquee';
  additive: boolean;
  rect: MarqueeOverlay;
}

export interface MoveGuideDragMode {
  kind: 'move-guide';
  guideId: string;
  orientation: 'horizontal' | 'vertical';
  position: number;
}

export function tryStartGuideDrag(
  ctx: ToolContext,
  scene: Scene,
  event: ToolPointerEvent
): MoveGuideDragMode | null {
  const guideSettings = useSettingsStore.getState().settings;
  if (
    !guideSettings.showGuides ||
    !scene.guides ||
    scene.guides.length === 0 ||
    event.shiftKey
  ) {
    return null;
  }

  const tol = 6 / Math.max(0.05, ctx.scope.view.zoom);
  let bestGuide: Guide | null = null;
  let bestDist = tol;
  for (const g of scene.guides) {
    const dist =
      g.orientation === 'vertical'
        ? Math.abs(event.point.x - g.position)
        : Math.abs(event.point.y - g.position);
    if (dist <= bestDist) {
      bestDist = dist;
      bestGuide = g;
    }
  }
  if (!bestGuide) return null;

  ctx.redrawOverlay({
    draggingGuide: {
      id: bestGuide.id,
      orientation: bestGuide.orientation,
      position: bestGuide.position,
    },
  });
  ctx.scope.view.update();
  return {
    kind: 'move-guide',
    guideId: bestGuide.id,
    orientation: bestGuide.orientation,
    position: bestGuide.position,
  };
}

export function startMarqueeDrag(event: ToolPointerEvent): MarqueeDragMode {
  return {
    kind: 'marquee',
    additive: event.shiftKey,
    rect: {
      x: event.point.x,
      y: event.point.y,
      width: 0,
      height: 0,
    },
  };
}

export function updateGuideDrag(
  drag: MoveGuideDragMode,
  point: Point2D,
  ctx: ToolContext
): void {
  const pos = drag.orientation === 'vertical' ? point.x : point.y;
  drag.position = pos;
  ctx.redrawOverlay({
    draggingGuide: {
      id: drag.guideId,
      orientation: drag.orientation,
      position: pos,
    },
  });
  ctx.scope.view.update();
}

export function updateMarqueeDrag(
  drag: MarqueeDragMode,
  event: ToolPointerEvent,
  ctx: ToolContext
): void {
  const x = Math.min(event.startPoint.x, event.point.x);
  const y = Math.min(event.startPoint.y, event.point.y);
  const width = Math.abs(event.point.x - event.startPoint.x);
  const height = Math.abs(event.point.y - event.startPoint.y);
  drag.rect = { x, y, width, height };
  ctx.redrawOverlay({ marquee: drag.rect });
  ctx.scope.view.update();
}

export function finishGuideDrag(
  drag: MoveGuideDragMode,
  point: Point2D,
  reset: (ctx?: ToolContext) => void,
  ctx: ToolContext
): void {
  const { guideId, orientation, position } = drag;
  const viewPt = ctx.scope.view.projectToView(
    new ctx.scope.Point(point.x, point.y)
  );
  const viewSize = ctx.scope.view.viewSize;
  const showRulers = useSettingsStore.getState().settings.showRulers;
  const outOfView =
    orientation === 'vertical'
      ? viewPt.x < (showRulers ? 20 : 0) || viewPt.x > viewSize.width
      : viewPt.y < (showRulers ? 20 : 0) || viewPt.y > viewSize.height;
  reset(ctx);
  if (outOfView) {
    deleteGuide(guideId);
  } else {
    updateGuide(guideId, Math.round(position));
  }
}

export function finishMarqueeDrag(
  drag: MarqueeDragMode,
  reset: (ctx?: ToolContext) => void,
  ctx: ToolContext
): void {
  const rect = drag.rect;
  const additive = drag.additive;
  reset(ctx);

  if (rect && (rect.width > 2 || rect.height > 2)) {
    const state = useEditorStore.getState();
    const scopeLayers = getScopeLayers(state.scene.layers, state.editingGroupId);
    const scopeM = getScopeWorldMatrix(state.scene.layers, state.editingGroupId);
    const hitIds = scopeLayers
      .filter(
        (layer) =>
          layer.visible &&
          !layer.locked &&
          bboxIntersects(resolveLayerWorldBBox(layer, scopeM, state.scene.layers), rect)
      )
      .map((layer) => layer.id);

    if (additive) {
      const merged = new Set([...state.selectedIds, ...hitIds]);
      state.setSelectedIds(Array.from(merged));
    } else {
      state.setSelectedIds(hitIds);
    }
  }
}
