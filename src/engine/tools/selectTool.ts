import { updateLayers } from '../../core/commands';
import {
  computeCombinedWorldBBox,
  computeLayerLocalBBox,
  computeLayerWorldBBox,
  degToRad,
  localToWorld,
  localVectorToWorld,
  radToDeg,
  snapVector45,
  worldToLocal,
} from '../../core/math';
import { useSettingsStore } from '../../core/settings';
import { useEditorStore } from '../../core/store';
import type { BBox, Layer, Point2D } from '../../core/types';
import type { MarqueeOverlay, SelectHandleId } from '../overlay';
import { snapBoundsMove, type SmartGuideLine } from '../snapping';
import { applyLayerMatrixToItem } from '../sync';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

type DragMode =
  | {
      kind: 'move';
      initialLayers: Map<string, Layer>;
      initialBBox: BBox;
      otherBoxes: BBox[];
      hasMoved: boolean;
    }
  | {
      kind: 'rotate';
      pivot: Point2D;
      startAngle: number;
      initialLayers: Map<string, Layer>;
      hasMoved: boolean;
    }
  | {
      kind: 'resize-single';
      handle: SelectHandleId;
      layer: Layer;
      localBox: BBox;
      anchorLocal: Point2D;
      anchorWorld: Point2D;
      spanLocal: Point2D;
      moveX: -1 | 0 | 1;
      moveY: -1 | 0 | 1;
      hasMoved: boolean;
    }
  | {
      kind: 'resize-multi';
      handle: SelectHandleId;
      initialBBox: BBox;
      anchorWorld: Point2D;
      spanWorld: Point2D;
      moveX: -1 | 0 | 1;
      moveY: -1 | 0 | 1;
      initialLayers: Map<string, Layer>;
      hasMoved: boolean;
    }
  | {
      kind: 'marquee';
      additive: boolean;
      rect: MarqueeOverlay;
    };

const MIN_SCALE = 0.02;

function getSelectHandleHit(
  ctx: ToolContext,
  point: Point2D
): SelectHandleId | null {
  const tolerance = 8 / Math.max(0.05, ctx.scope.view.zoom);
  const children = ctx.overlayLayer.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    const handle = child.data?.selectHandle as SelectHandleId | undefined;
    if (!handle) continue;
    const dist = Math.hypot(point.x - child.position.x, point.y - child.position.y);
    if (dist <= tolerance) {
      return handle;
    }
  }
  return null;
}

function extractLayerIdFromHit(
  item: paper.Item | null | undefined,
  sceneLayer: paper.Layer
): string | null {
  let cur: paper.Item | null | undefined = item;
  while (cur && cur !== sceneLayer) {
    if (typeof cur.data?.layerId === 'string') {
      return cur.data.layerId;
    }
    cur = cur.parent;
  }
  return null;
}

export function findTopLayerAtPoint(
  ctx: ToolContext,
  point: Point2D,
  predicate?: (layer: Layer) => boolean,
  opts?: { includeLocked?: boolean }
): Layer | null {
  const includeLocked = Boolean(opts?.includeLocked);
  const state = useEditorStore.getState();
  const layersById = new Map(state.scene.layers.map((l) => [l.id, l]));
  const tolerance = 6 / Math.max(0.05, ctx.scope.view.zoom);

  const hit = ctx.sceneLayer.hitTest(new ctx.scope.Point(point.x, point.y), {
    fill: true,
    stroke: true,
    curves: true,
    tolerance,
  });

  if (hit) {
    const id = extractLayerIdFromHit(hit.item, ctx.sceneLayer);
    if (id) {
      const layer = layersById.get(id);
      if (
        layer &&
        layer.visible &&
        (includeLocked || !layer.locked) &&
        (!predicate || predicate(layer))
      ) {
        return layer;
      }
    }
  }

  for (let i = state.scene.layers.length - 1; i >= 0; i--) {
    const layer = state.scene.layers[i];
    if (!layer.visible || (!includeLocked && layer.locked)) continue;
    if (predicate && !predicate(layer)) continue;
    if (layer.type === 'path') continue;

    const localPt = worldToLocal(layer, point);
    const box = computeLayerLocalBBox(layer);
    if (
      localPt.x >= box.x &&
      localPt.x <= box.x + box.width &&
      localPt.y >= box.y &&
      localPt.y <= box.y + box.height
    ) {
      return layer;
    }
  }

  return null;
}

function getHandleDirection(handle: SelectHandleId): {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
} {
  const moveX: -1 | 0 | 1 =
    handle === 'nw' || handle === 'w' || handle === 'sw'
      ? -1
      : handle === 'ne' || handle === 'e' || handle === 'se'
        ? 1
        : 0;
  const moveY: -1 | 0 | 1 =
    handle === 'nw' || handle === 'n' || handle === 'ne'
      ? -1
      : handle === 'sw' || handle === 's' || handle === 'se'
        ? 1
        : 0;
  return { moveX, moveY };
}

function clampScaleKeepSign(value: number): number {
  if (Math.abs(value) >= MIN_SCALE) return value;
  return value < 0 ? -MIN_SCALE : MIN_SCALE;
}

function bboxIntersects(a: BBox, b: BBox): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

export function createSelectTool(): CanvasToolController {
  let drag: DragMode | null = null;
  let draftOverrides = new Map<string, Partial<Layer>>();
  let lastHoveredMaskId: string | null = null;

  const applyDraftToPaper = (
    ctx: ToolContext,
    overrides: Map<string, Partial<Layer>>,
    guides: SmartGuideLine[] | null = null
  ) => {
    const itemMap = ctx.getItemMap();
    const layers = useEditorStore.getState().scene.layers;

    for (const [layerId, patch] of overrides.entries()) {
      const base = layers.find((l) => l.id === layerId);
      const item = itemMap.get(layerId);
      if (!base || !item) continue;
      const merged = { ...base, ...patch };
      applyLayerMatrixToItem(ctx.scope, item, merged);

      for (const sceneChild of ctx.sceneLayer.children) {
        if (sceneChild.data?.isClipGroup && sceneChild.data?.maskId === layerId) {
          const clipMaskItem = sceneChild.children[0];
          if (clipMaskItem) {
            applyLayerMatrixToItem(ctx.scope, clipMaskItem, merged);
          }
        }
      }
    }

    ctx.redrawOverlay({ draftOverrides: overrides, marquee: null, guides });
    ctx.scope.view.update();
  };

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
      });
      ctx.scope.view.update();
    }
  };

  return {
    onMouseDown(event: ToolPointerEvent, ctx: ToolContext) {
      const state = useEditorStore.getState();
      const selectedSet = new Set(state.selectedIds);
      const selectedLayers = state.scene.layers.filter((l) => selectedSet.has(l.id));
      const unlockedSelected = selectedLayers.filter((l) => !l.locked);

      const hitHandle =
        unlockedSelected.length > 0 ? getSelectHandleHit(ctx, event.point) : null;

      if (hitHandle) {
        if (hitHandle === 'rotate') {
          const pivot =
            selectedLayers.length === 1
              ? { x: selectedLayers[0].x, y: selectedLayers[0].y }
              : (() => {
                  const box = computeCombinedWorldBBox(selectedLayers);
                  return {
                    x: box.x + box.width / 2,
                    y: box.y + box.height / 2,
                  };
                })();
          const initialLayers = new Map(unlockedSelected.map((l) => [l.id, l]));
          drag = {
            kind: 'rotate',
            pivot,
            startAngle: Math.atan2(
              event.point.y - pivot.y,
              event.point.x - pivot.x
            ),
            initialLayers,
            hasMoved: false,
          };
          return;
        }

        const { moveX, moveY } = getHandleDirection(hitHandle);
        if (unlockedSelected.length === 1 && selectedLayers.length === 1) {
          const layer = unlockedSelected[0];
          const localBox = computeLayerLocalBBox(layer);
          const x0 = localBox.x;
          const x1 = localBox.x + localBox.width;
          const y0 = localBox.y;
          const y1 = localBox.y + localBox.height;

          const anchorLocal: Point2D = {
            x: moveX === -1 ? x1 : moveX === 1 ? x0 : (x0 + x1) / 2,
            y: moveY === -1 ? y1 : moveY === 1 ? y0 : (y0 + y1) / 2,
          };
          const handleLocal: Point2D = {
            x: moveX === -1 ? x0 : moveX === 1 ? x1 : (x0 + x1) / 2,
            y: moveY === -1 ? y0 : moveY === 1 ? y1 : (y0 + y1) / 2,
          };

          drag = {
            kind: 'resize-single',
            handle: hitHandle,
            layer,
            localBox,
            anchorLocal,
            anchorWorld: localToWorld(layer, anchorLocal),
            spanLocal: {
              x: handleLocal.x - anchorLocal.x,
              y: handleLocal.y - anchorLocal.y,
            },
            moveX,
            moveY,
            hasMoved: false,
          };
          return;
        }

        const initialBBox = computeCombinedWorldBBox(selectedLayers);
        const bx0 = initialBBox.x;
        const bx1 = initialBBox.x + initialBBox.width;
        const by0 = initialBBox.y;
        const by1 = initialBBox.y + initialBBox.height;

        const anchorWorld: Point2D = {
          x: moveX === -1 ? bx1 : moveX === 1 ? bx0 : (bx0 + bx1) / 2,
          y: moveY === -1 ? by1 : moveY === 1 ? by0 : (by0 + by1) / 2,
        };
        const handleWorld: Point2D = {
          x: moveX === -1 ? bx0 : moveX === 1 ? bx1 : (bx0 + bx1) / 2,
          y: moveY === -1 ? by0 : moveY === 1 ? by1 : (by0 + by1) / 2,
        };

        drag = {
          kind: 'resize-multi',
          handle: hitHandle,
          initialBBox,
          anchorWorld,
          spanWorld: {
            x: handleWorld.x - anchorWorld.x,
            y: handleWorld.y - anchorWorld.y,
          },
          moveX,
          moveY,
          initialLayers: new Map(unlockedSelected.map((l) => [l.id, l])),
          hasMoved: false,
        };
        return;
      }

      const hitLayer = findTopLayerAtPoint(ctx, event.point);
      if (hitLayer) {
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
        const moveTargets = state.scene.layers.filter(
          (l) => activeSet.has(l.id) && !l.locked
        );
        if (moveTargets.length > 0 && activeSet.has(hitLayer.id)) {
          const moveTargetIds = new Set(moveTargets.map((l) => l.id));
          const otherBoxes = state.scene.layers
            .filter((l) => l.visible && !moveTargetIds.has(l.id))
            .map((l) => computeLayerWorldBBox(l));
          drag = {
            kind: 'move',
            initialLayers: new Map(moveTargets.map((l) => [l.id, l])),
            initialBBox: computeCombinedWorldBBox(moveTargets),
            otherBoxes,
            hasMoved: false,
          };
        }
        return;
      }

      if (!event.shiftKey && state.selectedIds.length > 0) {
        state.setSelectedIds([]);
      }

      drag = {
        kind: 'marquee',
        additive: event.shiftKey,
        rect: {
          x: event.point.x,
          y: event.point.y,
          width: 0,
          height: 0,
        },
      };
    },

    onMouseDrag(event: ToolPointerEvent, ctx: ToolContext) {
      if (!drag) return;

      if (drag.kind === 'marquee') {
        const x = Math.min(event.startPoint.x, event.point.x);
        const y = Math.min(event.startPoint.y, event.point.y);
        const width = Math.abs(event.point.x - event.startPoint.x);
        const height = Math.abs(event.point.y - event.startPoint.y);
        drag.rect = { x, y, width, height };
        ctx.redrawOverlay({ marquee: drag.rect });
        ctx.scope.view.update();
        return;
      }

      if (drag.kind === 'move') {
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
          !event.altKey &&
          (settings.snapToGrid || settings.snapToObjects || settings.snapToArtboard);
        if (canSnap) {
          const scene = useEditorStore.getState().scene;
          const movingBox: BBox = {
            x: drag.initialBBox.x + dx,
            y: drag.initialBBox.y + dy,
            width: drag.initialBBox.width,
            height: drag.initialBBox.height,
          };
          const snap = snapBoundsMove(
            movingBox,
            drag.otherBoxes,
            { width: scene.width, height: scene.height },
            {
              snapToGrid: settings.snapToGrid,
              gridSize: settings.gridSize,
              snapToObjects: settings.snapToObjects,
              snapToArtboard: settings.snapToArtboard,
              thresholdWorld:
                settings.snapThreshold / Math.max(0.05, ctx.scope.view.zoom),
            }
          );
          dx += snap.dx;
          dy += snap.dy;
          guides = snap.guides.length > 0 ? snap.guides : null;
        }

        if (Math.hypot(dx, dy) > 0.25) {
          drag.hasMoved = true;
        }

        const nextOverrides = new Map<string, Partial<Layer>>();
        for (const [id, initial] of drag.initialLayers.entries()) {
          nextOverrides.set(id, {
            x: initial.x + dx,
            y: initial.y + dy,
          });
        }
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides, guides);
        return;
      }

      if (drag.kind === 'rotate') {
        const curAngle = Math.atan2(
          event.point.y - drag.pivot.y,
          event.point.x - drag.pivot.x
        );
        let deltaDeg = radToDeg(curAngle - drag.startAngle);

        if (event.shiftKey) {
          if (drag.initialLayers.size === 1) {
            const only = Array.from(drag.initialLayers.values())[0];
            const snappedTotal = Math.round((only.rotation + deltaDeg) / 15) * 15;
            deltaDeg = snappedTotal - only.rotation;
          } else {
            deltaDeg = Math.round(deltaDeg / 15) * 15;
          }
        }

        if (Math.abs(deltaDeg) > 0.1) {
          drag.hasMoved = true;
        }

        const rad = degToRad(deltaDeg);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const nextOverrides = new Map<string, Partial<Layer>>();

        for (const [id, initial] of drag.initialLayers.entries()) {
          const rx = initial.x - drag.pivot.x;
          const ry = initial.y - drag.pivot.y;
          nextOverrides.set(id, {
            x: drag.pivot.x + rx * cos - ry * sin,
            y: drag.pivot.y + rx * sin + ry * cos,
            rotation: initial.rotation + deltaDeg,
          });
        }
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'resize-single') {
        const dx = event.point.x - drag.anchorWorld.x;
        const dy = event.point.y - drag.anchorWorld.y;
        const rad = degToRad(drag.layer.rotation);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rotDx = dx * cos + dy * sin;
        const rotDy = -dx * sin + dy * cos;

        let nextScaleX =
          drag.moveX !== 0 && Math.abs(drag.spanLocal.x) > 1e-6
            ? rotDx / drag.spanLocal.x
            : drag.layer.scaleX;
        let nextScaleY =
          drag.moveY !== 0 && Math.abs(drag.spanLocal.y) > 1e-6
            ? rotDy / drag.spanLocal.y
            : drag.layer.scaleY;

        nextScaleX = clampScaleKeepSign(nextScaleX);
        nextScaleY = clampScaleKeepSign(nextScaleY);

        if (event.shiftKey) {
          const kx = nextScaleX / drag.layer.scaleX;
          const ky = nextScaleY / drag.layer.scaleY;
          let factor = 1;
          if (drag.moveX !== 0 && drag.moveY !== 0) {
            factor = Math.abs(kx) >= Math.abs(ky) ? kx : ky;
          } else if (drag.moveX !== 0) {
            factor = kx;
          } else if (drag.moveY !== 0) {
            factor = ky;
          }
          nextScaleX = clampScaleKeepSign(drag.layer.scaleX * factor);
          nextScaleY = clampScaleKeepSign(drag.layer.scaleY * factor);
        }

        const anchorOffset = localVectorToWorld(
          {
            rotation: drag.layer.rotation,
            scaleX: nextScaleX,
            scaleY: nextScaleY,
          },
          drag.anchorLocal
        );

        drag.hasMoved = true;
        const nextOverrides = new Map<string, Partial<Layer>>();
        nextOverrides.set(drag.layer.id, {
          scaleX: nextScaleX,
          scaleY: nextScaleY,
          x: drag.anchorWorld.x - anchorOffset.x,
          y: drag.anchorWorld.y - anchorOffset.y,
        });
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'resize-multi') {
        let kx =
          drag.moveX !== 0 && Math.abs(drag.spanWorld.x) > 1e-6
            ? (event.point.x - drag.anchorWorld.x) / drag.spanWorld.x
            : 1;
        let ky =
          drag.moveY !== 0 && Math.abs(drag.spanWorld.y) > 1e-6
            ? (event.point.y - drag.anchorWorld.y) / drag.spanWorld.y
            : 1;

        if (Math.abs(kx) < MIN_SCALE) kx = kx < 0 ? -MIN_SCALE : MIN_SCALE;
        if (Math.abs(ky) < MIN_SCALE) ky = ky < 0 ? -MIN_SCALE : MIN_SCALE;

        if (event.shiftKey) {
          const factor =
            drag.moveX !== 0 && drag.moveY !== 0
              ? Math.abs(kx) >= Math.abs(ky)
                ? kx
                : ky
              : drag.moveX !== 0
                ? kx
                : ky;
          kx = factor;
          ky = factor;
        }

        drag.hasMoved = true;
        const nextOverrides = new Map<string, Partial<Layer>>();
        for (const [id, initial] of drag.initialLayers.entries()) {
          nextOverrides.set(id, {
            x: drag.anchorWorld.x + (initial.x - drag.anchorWorld.x) * kx,
            y: drag.anchorWorld.y + (initial.y - drag.anchorWorld.y) * ky,
            scaleX: clampScaleKeepSign(initial.scaleX * kx),
            scaleY: clampScaleKeepSign(initial.scaleY * ky),
          });
        }
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

    onMouseUp(_event: ToolPointerEvent, ctx: ToolContext) {
      if (!drag) return;

      if (drag.kind === 'marquee') {
        const rect = drag.rect;
        const additive = drag.additive;
        reset(ctx);

        if (rect && (rect.width > 2 || rect.height > 2)) {
          const state = useEditorStore.getState();
          const hitIds = state.scene.layers
            .filter(
              (layer) =>
                layer.visible &&
                !layer.locked &&
                bboxIntersects(computeLayerWorldBBox(layer), rect)
            )
            .map((layer) => layer.id);

          if (additive) {
            const merged = new Set([...state.selectedIds, ...hitIds]);
            state.setSelectedIds(Array.from(merged));
          } else {
            state.setSelectedIds(hitIds);
          }
        }
        return;
      }

      const shouldCommit = drag.hasMoved && draftOverrides.size > 0;
      const committedOverrides = new Map(draftOverrides);
      reset(ctx);

      if (shouldCommit) {
        updateLayers(Array.from(committedOverrides.keys()), (layer) => {
          const patch = committedOverrides.get(layer.id);
          return patch ? ({ ...layer, ...patch } as Layer) : layer;
        });
      }
    },

    onDoubleClick(event: ToolPointerEvent, ctx: ToolContext) {
      const hitLayer = findTopLayerAtPoint(
        ctx,
        event.point,
        (layer) => layer.type === 'text' || layer.type === 'path'
      );
      if (hitLayer && hitLayer.type === 'text') {
        useEditorStore.getState().setSelectedIds([hitLayer.id]);
        ctx.startTextEditing(hitLayer.id, true);
        return;
      }
      if (hitLayer && hitLayer.type === 'path') {
        const state = useEditorStore.getState();
        state.setSelectedIds([hitLayer.id]);
        state.setActiveTool('node');
      }
    },

    cancel(ctx: ToolContext) {
      reset(ctx);
    },
  };
}
