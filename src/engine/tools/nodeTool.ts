import {
  insertAnchorOnSegment,
  toggleAnchorSmooth,
  updatePathSubpaths,
} from '../../core/commands';
import {
  cloneSubPaths,
  localToWorld,
  snapVector45,
  worldToLocal,
  worldVectorToLocal,
} from '../../core/math';
import { useEditorStore } from '../../core/store';
import type { PathLayer, Point2D, SubPath } from '../../core/types';
import { findTopLayerAtPoint } from './selectTool';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

type NodeHitKind = 'anchor' | 'handleIn' | 'handleOut';

interface NodeHitTarget {
  kind: NodeHitKind;
  layerId: string;
  subpathIndex: number;
  anchorIndex: number;
}

type NodeDragState =
  | {
      kind: 'anchor';
      layer: PathLayer;
      subpathIndex: number;
      anchorIndex: number;
      initialAnchorWorld: Point2D;
      draftSubpaths: SubPath[];
      hasMoved: boolean;
    }
  | {
      kind: 'handleIn' | 'handleOut';
      layer: PathLayer;
      subpathIndex: number;
      anchorIndex: number;
      anchorWorld: Point2D;
      initialOppositeLength: number;
      draftSubpaths: SubPath[];
      hasMoved: boolean;
    };

function findNodeHitInOverlay(
  ctx: ToolContext,
  point: Point2D
): NodeHitTarget | null {
  const tolerance = 8 / Math.max(0.05, ctx.scope.view.zoom);
  const children = ctx.overlayLayer.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    const kind = child.data?.nodeHit as NodeHitKind | undefined;
    if (!kind) continue;
    const dist = Math.hypot(point.x - child.position.x, point.y - child.position.y);
    if (dist <= tolerance) {
      return {
        kind,
        layerId: String(child.data.layerId),
        subpathIndex: Number(child.data.subpathIndex),
        anchorIndex: Number(child.data.anchorIndex),
      };
    }
  }
  return null;
}

function getActiveEditablePathLayer(): PathLayer | null {
  const state = useEditorStore.getState();
  const selectedSet = new Set(state.selectedIds);
  const candidates = state.scene.layers.filter(
    (l): l is PathLayer =>
      l.type === 'path' && selectedSet.has(l.id) && l.visible && !l.locked
  );
  if (candidates.length === 0) return null;
  if (state.selectedNode) {
    const preferred = candidates.find(
      (l) => l.id === state.selectedNode?.layerId
    );
    if (preferred) return preferred;
  }
  return candidates[0];
}

function applyDraftSubpathsToPaperItem(
  ctx: ToolContext,
  layerId: string,
  subpaths: SubPath[]
): void {
  const item = ctx.getItemMap().get(layerId);
  if (!item) return;

  const updateSinglePath = (path: paper.Path, sp: SubPath | undefined) => {
    if (!sp) return;
    sp.anchors.forEach((anchor, idx) => {
      const seg = path.segments[idx];
      if (!seg) return;
      seg.point = new ctx.scope.Point(anchor.x, anchor.y);
      seg.handleIn = new ctx.scope.Point(anchor.handleIn.x, anchor.handleIn.y);
      seg.handleOut = new ctx.scope.Point(anchor.handleOut.x, anchor.handleOut.y);
    });
  };

  if (item.className === 'CompoundPath') {
    const compound = item as paper.CompoundPath;
    subpaths.forEach((sp, spIdx) => {
      const child = compound.children[spIdx];
      if (child && child.className === 'Path') {
        updateSinglePath(child as paper.Path, sp);
      }
    });
  } else if (item.className === 'Path') {
    updateSinglePath(item as paper.Path, subpaths[0]);
  }
}

export function createNodeTool(): CanvasToolController {
  let drag: NodeDragState | null = null;

  const reset = (ctx?: ToolContext) => {
    drag = null;
    if (ctx) {
      ctx.redrawOverlay({ draftOverrides: undefined });
      ctx.scope.view.update();
    }
  };

  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      const state = useEditorStore.getState();
      const targetLayer = getActiveEditablePathLayer();

      if (targetLayer) {
        const hitNode = findNodeHitInOverlay(ctx, event.point);
        if (hitNode && hitNode.layerId === targetLayer.id) {
          const sp = targetLayer.subpaths[hitNode.subpathIndex];
          const anchor = sp?.anchors[hitNode.anchorIndex];
          if (sp && anchor) {
            if (hitNode.kind === 'anchor' && event.detail >= 2) {
              toggleAnchorSmooth(
                targetLayer.id,
                hitNode.subpathIndex,
                hitNode.anchorIndex
              );
              drag = null;
              return;
            }

            state.setSelectedNode({
              layerId: targetLayer.id,
              subpathIndex: hitNode.subpathIndex,
              anchorIndex: hitNode.anchorIndex,
            });

            const anchorWorld = localToWorld(targetLayer, {
              x: anchor.x,
              y: anchor.y,
            });

            if (hitNode.kind === 'anchor') {
              drag = {
                kind: 'anchor',
                layer: targetLayer,
                subpathIndex: hitNode.subpathIndex,
                anchorIndex: hitNode.anchorIndex,
                initialAnchorWorld: anchorWorld,
                draftSubpaths: cloneSubPaths(targetLayer.subpaths),
                hasMoved: false,
              };
              return;
            }

            const opposite =
              hitNode.kind === 'handleIn' ? anchor.handleOut : anchor.handleIn;
            drag = {
              kind: hitNode.kind,
              layer: targetLayer,
              subpathIndex: hitNode.subpathIndex,
              anchorIndex: hitNode.anchorIndex,
              anchorWorld,
              initialOppositeLength: Math.hypot(opposite.x, opposite.y),
              draftSubpaths: cloneSubPaths(targetLayer.subpaths),
              hasMoved: false,
            };
            return;
          }
        }

        const paperItem = ctx.getItemMap().get(targetLayer.id);
        if (paperItem) {
          const tolerance = 6 / Math.max(0.05, ctx.scope.view.zoom);
          const curveHit = paperItem.hitTest(
            new ctx.scope.Point(event.point.x, event.point.y),
            { curves: true, tolerance }
          );

          if (curveHit?.type === 'curve' && curveHit.location) {
            const subpathIndex = Number(curveHit.item.data?.subpathIndex ?? 0);
            const segmentIndex = curveHit.location.index;
            const t = curveHit.location.time;
            const inserted = insertAnchorOnSegment(
              targetLayer.id,
              subpathIndex,
              segmentIndex,
              t
            );

            if (inserted) {
              const updatedLayer = useEditorStore
                .getState()
                .scene.layers.find((l): l is PathLayer => l.id === targetLayer.id);
              const insertedAnchor =
                updatedLayer?.subpaths[inserted.subpathIndex]?.anchors[
                  inserted.anchorIndex
                ];
              if (updatedLayer && insertedAnchor) {
                drag = {
                  kind: 'anchor',
                  layer: updatedLayer,
                  subpathIndex: inserted.subpathIndex,
                  anchorIndex: inserted.anchorIndex,
                  initialAnchorWorld: localToWorld(updatedLayer, {
                    x: insertedAnchor.x,
                    y: insertedAnchor.y,
                  }),
                  draftSubpaths: cloneSubPaths(updatedLayer.subpaths),
                  hasMoved: false,
                };
              }
              return;
            }
          }
        }
      }

      const otherPath = findTopLayerAtPoint(
        ctx,
        event.point,
        (l) => l.type === 'path'
      );
      if (otherPath) {
        state.setSelectedIds([otherPath.id]);
        state.setSelectedNode(null);
        return;
      }

      state.setSelectedNode(null);
      if (!event.shiftKey && state.selectedIds.length > 0) {
        state.setSelectedIds([]);
      }
    },

    onMouseDrag(event: ToolPointerEvent, ctx: ToolContext) {
      if (!drag) return;

      const sp = drag.draftSubpaths[drag.subpathIndex];
      const anchor = sp?.anchors[drag.anchorIndex];
      if (!sp || !anchor) return;

      if (drag.kind === 'anchor') {
        let delta: Point2D = {
          x: event.point.x - event.startPoint.x,
          y: event.point.y - event.startPoint.y,
        };
        if (event.shiftKey) {
          delta = snapVector45(delta);
        }
        if (Math.hypot(delta.x, delta.y) > 0.1) {
          drag.hasMoved = true;
        }

        const targetWorld: Point2D = {
          x: drag.initialAnchorWorld.x + delta.x,
          y: drag.initialAnchorWorld.y + delta.y,
        };
        const localPt = worldToLocal(drag.layer, targetWorld);
        anchor.x = localPt.x;
        anchor.y = localPt.y;
      } else {
        let vecWorld: Point2D = {
          x: event.point.x - drag.anchorWorld.x,
          y: event.point.y - drag.anchorWorld.y,
        };
        if (event.shiftKey) {
          vecWorld = snapVector45(vecWorld);
        }
        drag.hasMoved = true;

        const localVec = worldVectorToLocal(drag.layer, vecWorld);
        if (drag.kind === 'handleIn') {
          anchor.handleIn = { x: localVec.x, y: localVec.y };
        } else {
          anchor.handleOut = { x: localVec.x, y: localVec.y };
        }

        if (event.altKey) {
          anchor.smooth = false;
        } else if (anchor.smooth) {
          const len = Math.hypot(localVec.x, localVec.y);
          if (len > 1e-6) {
            const oppLen =
              drag.initialOppositeLength > 1e-4 ? drag.initialOppositeLength : len;
            const oppVec = {
              x: -(localVec.x / len) * oppLen,
              y: -(localVec.y / len) * oppLen,
            };
            if (drag.kind === 'handleIn') {
              anchor.handleOut = oppVec;
            } else {
              anchor.handleIn = oppVec;
            }
          }
        }
      }

      applyDraftSubpathsToPaperItem(ctx, drag.layer.id, drag.draftSubpaths);
      const draftOverrides = new Map([[drag.layer.id, { subpaths: drag.draftSubpaths }]]);
      ctx.redrawOverlay({ draftOverrides });
      ctx.scope.view.update();
    },

    onMouseMove() {},

    onMouseUp(_event: ToolPointerEvent, ctx: ToolContext) {
      if (!drag) return;
      const shouldCommit = drag.hasMoved;
      const layerId = drag.layer.id;
      const committedSubpaths = drag.draftSubpaths;
      reset(ctx);

      if (shouldCommit) {
        updatePathSubpaths(layerId, committedSubpaths);
      }
    },

    cancel(ctx: ToolContext) {
      reset(ctx);
    },
  };
}
