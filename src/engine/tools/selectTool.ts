import { getActiveArtboard, findArtboardAtPoint } from '../../core/artboards';
import {
  deleteGuide,
  duplicateLayers,
  updateGuide,
  updateLayers,
} from '../../core/commands';
import {
  findLayerById,
  findLayerPath,
  flattenLayers,
  getLayerWorldMatrix,
  getParentGroupId,
  getParentWorldMatrix,
  getScopeLayers,
  getScopeWorldMatrix,
  mapLayerTree,
} from '../../core/layerTree';
import {
  applyMatrixToPoint,
  applyMatrixToVector,
  clamp,
  computeLayerBBoxWithMatrix,
  computeLayerLocalBBox,
  computeSubPathsBBox,
  degToRad,
  getLayerMatrix,
  invertMatrix,
  localToWorld,
  localVectorToWorld,
  multiplyMatrices,
  radToDeg,
  snapVector45,
  type Matrix2D,
} from '../../core/math';
import {
  clonePaint,
  isGradientPaint,
  localPointToNormalized,
  normalizeGradientStops,
  resolveGradientEndpoints,
} from '../../core/paint';
import { useSettingsStore } from '../../core/settings';
import { useEditorStore } from '../../core/store';
import type {
  BBox,
  GradientPaint,
  Guide,
  Layer,
  PathLayer,
  Point2D,
  Scene,
  TextLayer,
} from '../../core/types';
import { resolveEffectivePathGeometry } from '../effects';
import {
  computeTextOnPathCaretAndAnchors,
  computeTextOnPathLocalBBox,
  projectPointToTextPathOffset,
  resolveHostPathLayer,
} from '../textOnPath';
import {
  resolveEditableGradient,
  type GradientHandleData,
  type MarqueeOverlay,
  type SelectHandleId,
  type TextPathHandleId,
} from '../overlay';
import { snapBoundsMove, type SmartGuideLine } from '../snapping';
import {
  applyLayerMatrixToItem,
  applyPathStyleToPaperItem,
  buildTextLayerItem,
  toPaperColor,
} from '../sync';
import type { CanvasToolController, ToolContext, ToolPointerEvent } from './types';

type DragMode =
  | {
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
  | {
      kind: 'rotate';
      pivotScope: Point2D;
      startAngle: number;
      invScopeM: Matrix2D;
      initialLayers: Map<string, Layer>;
      hasMoved: boolean;
    }
  | {
      kind: 'resize-single';
      handle: SelectHandleId;
      layer: Layer;
      localBox: BBox;
      anchorLocal: Point2D;
      anchorScope: Point2D;
      spanLocal: Point2D;
      moveX: -1 | 0 | 1;
      moveY: -1 | 0 | 1;
      invScopeM: Matrix2D;
      hasMoved: boolean;
    }
  | {
      kind: 'resize-multi';
      handle: SelectHandleId;
      anchorScope: Point2D;
      spanScope: Point2D;
      moveX: -1 | 0 | 1;
      moveY: -1 | 0 | 1;
      invScopeM: Matrix2D;
      initialLayers: Map<string, Layer>;
      hasMoved: boolean;
    }
  | {
      kind: 'gradient-handle';
      layer: Layer;
      invWorldM: Matrix2D;
      target: 'fill' | 'stroke';
      handleKind: 'start' | 'end' | 'stop';
      stopIndex?: number;
      initialGradient: GradientPaint;
      localBox: BBox;
      hasMoved: boolean;
    }
  | {
      kind: 'text-path-handle';
      layer: TextLayer;
      hostPath: PathLayer;
      handleKind: TextPathHandleId;
      invTextWorldM: Matrix2D;
      grabDelta: number;
      hasMoved: boolean;
    }
  | {
      kind: 'marquee';
      additive: boolean;
      rect: MarqueeOverlay;
    }
  | {
      kind: 'move-guide';
      guideId: string;
      orientation: 'horizontal' | 'vertical';
      position: number;
    };

const MIN_SCALE = 0.02;

function getGradientHandleHit(
  ctx: ToolContext,
  point: Point2D
): GradientHandleData | null {
  const tolerance = 10 / Math.max(0.05, ctx.scope.view.zoom);
  const children = ctx.overlayLayer.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    const handle = child.data?.gradientHandle as GradientHandleData | undefined;
    if (!handle) continue;
    const dist = Math.hypot(point.x - child.position.x, point.y - child.position.y);
    if (dist <= tolerance) {
      return handle;
    }
  }
  return null;
}

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

export function getTextPathHandleHit(
  ctx: ToolContext,
  point: Point2D
): TextPathHandleId | null {
  const tolerance = 10 / Math.max(0.05, ctx.scope.view.zoom);
  const children = ctx.overlayLayer.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    const handle = child.data?.textPathHandle as TextPathHandleId | undefined;
    if (!handle) continue;
    const dist = Math.hypot(point.x - child.position.x, point.y - child.position.y);
    if (dist <= tolerance) {
      return handle;
    }
  }
  return null;
}

export interface TextPathHandleDragState {
  layer: TextLayer;
  hostPath: PathLayer;
  handleKind: TextPathHandleId;
  invTextWorldM: Matrix2D;
  grabDelta: number;
  hasMoved: boolean;
}

export function beginTextPathHandleDrag(
  sceneLayers: Layer[],
  targetLayer: TextLayer,
  handleKind: TextPathHandleId,
  point: Point2D
): TextPathHandleDragState | null {
  if (!targetLayer.pathId) return null;
  const hostPath = resolveHostPathLayer(sceneLayers, targetLayer.pathId);
  if (!hostPath) return null;

  const worldM = getLayerWorldMatrix(sceneLayers, targetLayer.id);
  const invTextWorldM = invertMatrix(worldM);
  const localPt = applyMatrixToPoint(invTextWorldM, point);
  let grabDelta = 0;

  if (handleKind === 'baseline') {
    const info = computeTextOnPathCaretAndAnchors(
      targetLayer,
      hostPath,
      sceneLayers
    );
    const proj = projectPointToTextPathOffset(
      targetLayer,
      hostPath,
      localPt,
      sceneLayers
    );
    if (info && proj) {
      grabDelta = proj.signedNormalDist - (targetLayer.pathBaselineOffset ?? 0);
    }
  }

  return {
    layer: targetLayer,
    hostPath,
    handleKind,
    invTextWorldM,
    grabDelta,
    hasMoved: false,
  };
}

export function computeTextPathHandlePatch(
  dragState: TextPathHandleDragState,
  point: Point2D,
  sceneLayers: Layer[]
): Partial<TextLayer> | null {
  const localPt = applyMatrixToPoint(dragState.invTextWorldM, point);
  const proj = projectPointToTextPathOffset(
    dragState.layer,
    dragState.hostPath,
    localPt,
    sceneLayers
  );
  if (!proj) return null;

  dragState.hasMoved = true;
  if (dragState.handleKind === 'offset') {
    return {
      pathOffset: proj.pathOffset,
      ...(proj.align !== dragState.layer.align ? { align: proj.align } : {}),
    };
  }
  const nextBaseline = clamp(
    Math.round(proj.signedNormalDist - dragState.grabDelta),
    -200,
    200
  );
  return { pathBaselineOffset: nextBaseline };
}

export function rebuildTextLayerItemInPlace(
  ctx: ToolContext,
  textLayer: TextLayer,
  effectiveLayers: Layer[]
): void {
  const item = ctx.getItemMap().get(textLayer.id);
  if (!item || item.children.some((c) => c instanceof ctx.scope.Raster)) {
    return;
  }
  const rebuilt = buildTextLayerItem(ctx.scope, textLayer, false, effectiveLayers);
  ctx.scope.activate();
  item.removeChildren();
  item.addChildren(rebuilt.removeChildren());
  rebuilt.remove();
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

function resolveScopedHitLayer(
  layers: Layer[],
  rawId: string,
  editingGroupId: string | null,
  predicate?: (layer: Layer) => boolean,
  opts?: { includeLocked?: boolean; deep?: boolean }
): Layer | null {
  const includeLocked = Boolean(opts?.includeLocked);
  const path = findLayerPath(layers, rawId);
  if (!path || path.length === 0) return null;
  if (path.some((l) => !l.visible)) return null;

  if (opts?.deep) {
    if (!includeLocked && path.some((l) => l.locked)) return null;
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const candidate = path[i];
      if (!predicate || predicate(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  let target: Layer | null = null;
  if (!editingGroupId) {
    target = path[0];
  } else {
    const idx = path.findIndex((l) => l.id === editingGroupId);
    if (idx === -1 || idx + 1 >= path.length) return null;
    target = path[idx + 1];
  }

  if (
    target &&
    target.visible &&
    (includeLocked || !target.locked) &&
    (!predicate || predicate(target))
  ) {
    return target;
  }
  return null;
}

export function findTopLayerAtPoint(
  ctx: ToolContext,
  point: Point2D,
  predicate?: (layer: Layer) => boolean,
  opts?: { includeLocked?: boolean; deep?: boolean }
): Layer | null {
  const includeLocked = Boolean(opts?.includeLocked);
  const state = useEditorStore.getState();
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
      const scoped = resolveScopedHitLayer(
        state.scene.layers,
        id,
        state.editingGroupId,
        predicate,
        opts
      );
      if (scoped) {
        return scoped;
      }
    }
  }

  const fallbackPool = opts?.deep
    ? flattenLayers(state.scene.layers)
    : getScopeLayers(state.scene.layers, state.editingGroupId);

  for (let i = fallbackPool.length - 1; i >= 0; i--) {
    const layer = fallbackPool[i];
    if (!layer.visible || (!includeLocked && layer.locked)) continue;
    if (predicate && !predicate(layer)) continue;
    if (layer.type === 'path' || layer.type === 'group') continue;

    const worldM = getLayerWorldMatrix(state.scene.layers, layer.id);
    const localPt = applyMatrixToPoint(invertMatrix(worldM), point);
    const box = resolveSelectLocalBBox(layer, state.scene.layers);
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

function resolveSelectLocalBBox(layer: Layer, sceneLayers: Layer[]): BBox {
  if (layer.type === 'text' && layer.pathId) {
    const hostPath = resolveHostPathLayer(sceneLayers, layer.pathId);
    if (hostPath) {
      return computeTextOnPathLocalBBox(layer, hostPath, sceneLayers);
    }
  }
  return computeLayerLocalBBox(layer);
}

function resolveSelectWorldBBox(
  layer: Layer,
  parentM: Matrix2D,
  sceneLayers: Layer[]
): BBox {
  if (layer.type === 'text' && layer.pathId) {
    const hostPath = resolveHostPathLayer(sceneLayers, layer.pathId);
    if (hostPath) {
      const localBox = computeTextOnPathLocalBBox(layer, hostPath, sceneLayers);
      const worldM = multiplyMatrices(parentM, getLayerMatrix(layer));
      const corners = [
        applyMatrixToPoint(worldM, { x: localBox.x, y: localBox.y }),
        applyMatrixToPoint(worldM, { x: localBox.x + localBox.width, y: localBox.y }),
        applyMatrixToPoint(worldM, {
          x: localBox.x + localBox.width,
          y: localBox.y + localBox.height,
        }),
        applyMatrixToPoint(worldM, { x: localBox.x, y: localBox.y + localBox.height }),
      ];
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return {
        x: minX,
        y: minY,
        width: Math.max(...xs) - minX,
        height: Math.max(...ys) - minY,
      };
    }
  }
  return computeLayerBBoxWithMatrix(layer, parentM);
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

function combineLayerWorldBBoxes(sceneLayers: Layer[], layers: Layer[]): BBox {
  if (layers.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    const parentM = getParentWorldMatrix(sceneLayers, layer.id);
    const b = resolveSelectWorldBBox(layer, parentM, sceneLayers);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return minX === Infinity
    ? { x: 0, y: 0, width: 0, height: 0 }
    : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
      const base = findLayerById(layers, layerId);
      const item = itemMap.get(layerId);
      if (!base || !item) continue;
      const merged = { ...base, ...patch } as Layer;
      applyLayerMatrixToItem(ctx.scope, item, merged);

      if (
        merged.type === 'path' &&
        ('fill' in patch ||
          'stroke' in patch ||
          isGradientPaint(merged.fill) ||
          isGradientPaint(merged.stroke?.color))
      ) {
        applyPathStyleToPaperItem(ctx.scope, item, merged as PathLayer);
      } else if (
        merged.type === 'text' &&
        merged.pathId &&
        ('pathOffset' in patch ||
          'pathBaselineOffset' in patch ||
          'align' in patch ||
          'pathFlip' in patch)
      ) {
        rebuildTextLayerItemInPlace(ctx, merged as TextLayer, layers);
      } else if (
        merged.type === 'text' &&
        ('fill' in patch || isGradientPaint(merged.fill))
      ) {
        const localBox = resolveSelectLocalBBox(merged, layers);
        for (const child of item.children) {
          if (child instanceof ctx.scope.PointText) {
            const m = child.matrix;
            child.fillColor = toPaperColor(ctx.scope, merged.fill, localBox, {
              a: m.a,
              b: m.b,
              c: m.c,
              d: m.d,
              tx: m.tx,
              ty: m.ty,
            });
          }
        }
      }

      const parentItem = item.parent;
      if (parentItem) {
        for (const sibling of parentItem.children) {
          if (sibling.data?.isClipGroup && sibling.data?.maskId === layerId) {
            const clipMaskItem = sibling.children[0];
            if (clipMaskItem) {
              applyLayerMatrixToItem(ctx.scope, clipMaskItem, merged);
            }
          }
        }
      }
    }

    // Live-update any curved text attached to overridden path/group layers
    const attachedTexts = flattenLayers(layers).filter(
      (l): l is TextLayer =>
        l.type === 'text' &&
        Boolean(l.pathId) &&
        l.visible &&
        !overrides.has(l.id) &&
        (overrides.has(l.pathId!) ||
          findLayerPath(layers, l.pathId!)?.some((p) => overrides.has(p.id)) === true)
    );
    if (attachedTexts.length > 0) {
      const effectiveLayers = mapLayerTree(layers, (n) => {
        const p = overrides.get(n.id);
        return p ? ({ ...n, ...p } as Layer) : n;
      });
      for (const txt of attachedTexts) {
        rebuildTextLayerItemInPlace(ctx, txt, effectiveLayers);
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
        const textPathHit = getTextPathHandleHit(ctx, event.point);
        if (textPathHit) {
          const targetLayer = unlockedSelected[0];
          const hostPath =
            targetLayer.type === 'text' && targetLayer.pathId
              ? resolveHostPathLayer(state.scene.layers, targetLayer.pathId)
              : null;
          if (targetLayer.type === 'text' && hostPath) {
            const worldM = getLayerWorldMatrix(state.scene.layers, targetLayer.id);
            const invTextWorldM = invertMatrix(worldM);
            const localPt = applyMatrixToPoint(invTextWorldM, event.point);
            let grabDelta = 0;
            if (textPathHit === 'baseline') {
              const info = computeTextOnPathCaretAndAnchors(
                targetLayer,
                hostPath,
                state.scene.layers
              );
              const proj = projectPointToTextPathOffset(
                targetLayer,
                hostPath,
                localPt,
                state.scene.layers
              );
              if (info && proj) {
                grabDelta = proj.signedNormalDist - (targetLayer.pathBaselineOffset ?? 0);
              }
            }
            drag = {
              kind: 'text-path-handle',
              layer: targetLayer,
              hostPath,
              handleKind: textPathHit,
              invTextWorldM,
              grabDelta,
              hasMoved: false,
            };
            return;
          }
        }

        const gradHit = getGradientHandleHit(ctx, event.point);
        if (gradHit) {
          const targetLayer = unlockedSelected[0];
          const resolved = resolveEditableGradient(
            targetLayer,
            gradHit.target
          );
          if (resolved && resolved.target === gradHit.target) {
            const localBox =
              targetLayer.type === 'path'
                ? computeSubPathsBBox(
                    resolveEffectivePathGeometry(targetLayer).subpaths
                  )
                : resolveSelectLocalBBox(targetLayer, state.scene.layers);
            const worldM = getLayerWorldMatrix(state.scene.layers, targetLayer.id);
            drag = {
              kind: 'gradient-handle',
              layer: targetLayer,
              invWorldM: invertMatrix(worldM),
              target: gradHit.target,
              handleKind: gradHit.kind,
              stopIndex: gradHit.stopIndex,
              initialGradient: clonePaint(resolved.gradient),
              localBox,
              hasMoved: false,
            };
            return;
          }
        }
      }

      const hitHandle =
        unlockedSelected.length > 0 ? getSelectHandleHit(ctx, event.point) : null;

      if (hitHandle) {
        const scopeM = getScopeWorldMatrix(state.scene.layers, state.editingGroupId);
        const invScopeM = invertMatrix(scopeM);
        const ptScope = applyMatrixToPoint(invScopeM, event.point);

        if (hitHandle === 'rotate') {
          const pivotScope =
            selectedLayers.length === 1
              ? (() => {
                  const only = selectedLayers[0];
                  if (only.type === 'text' && only.pathId) {
                    const b = resolveSelectLocalBBox(only, state.scene.layers);
                    return localToWorld(only, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
                  }
                  return { x: only.x, y: only.y };
                })()
              : (() => {
                  const box = combineLayerWorldBBoxes(state.scene.layers, selectedLayers);
                  return {
                    x: box.x + box.width / 2,
                    y: box.y + box.height / 2,
                  };
                })();
          const initialLayers = new Map(unlockedSelected.map((l) => [l.id, l]));
          drag = {
            kind: 'rotate',
            pivotScope,
            startAngle: Math.atan2(
              ptScope.y - pivotScope.y,
              ptScope.x - pivotScope.x
            ),
            invScopeM,
            initialLayers,
            hasMoved: false,
          };
          return;
        }

        const { moveX, moveY } = getHandleDirection(hitHandle);
        if (unlockedSelected.length === 1 && selectedLayers.length === 1) {
          const layer = unlockedSelected[0];
          const localBox = resolveSelectLocalBBox(layer, state.scene.layers);
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
            anchorScope: localToWorld(layer, anchorLocal),
            spanLocal: {
              x: handleLocal.x - anchorLocal.x,
              y: handleLocal.y - anchorLocal.y,
            },
            moveX,
            moveY,
            invScopeM,
            hasMoved: false,
          };
          return;
        }

        const initialScopeBBox = combineLayerWorldBBoxes(state.scene.layers, selectedLayers);
        const bx0 = initialScopeBBox.x;
        const bx1 = initialScopeBBox.x + initialScopeBBox.width;
        const by0 = initialScopeBBox.y;
        const by1 = initialScopeBBox.y + initialScopeBBox.height;

        const anchorScope: Point2D = {
          x: moveX === -1 ? bx1 : moveX === 1 ? bx0 : (bx0 + bx1) / 2,
          y: moveY === -1 ? by1 : moveY === 1 ? by0 : (by0 + by1) / 2,
        };
        const handleScope: Point2D = {
          x: moveX === -1 ? bx0 : moveX === 1 ? bx1 : (bx0 + bx1) / 2,
          y: moveY === -1 ? by0 : moveY === 1 ? by1 : (by0 + by1) / 2,
        };

        drag = {
          kind: 'resize-multi',
          handle: hitHandle,
          anchorScope,
          spanScope: {
            x: handleScope.x - anchorScope.x,
            y: handleScope.y - anchorScope.y,
          },
          moveX,
          moveY,
          invScopeM,
          initialLayers: new Map(unlockedSelected.map((l) => [l.id, l])),
          hasMoved: false,
        };
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
        const scopeM = getScopeWorldMatrix(state.scene.layers, state.editingGroupId);
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
            const textTarget = moveTargets[0];
            const hostPath = resolveHostPathLayer(state.scene.layers, textTarget.pathId);
            if (hostPath) {
              drag = {
                kind: 'text-path-handle',
                layer: textTarget,
                hostPath,
                handleKind: 'offset',
                invTextWorldM: invertMatrix(
                  getLayerWorldMatrix(state.scene.layers, textTarget.id)
                ),
                grabDelta: 0,
                hasMoved: false,
              };
              return;
            }
          }

          const moveTargetIds = new Set(moveTargets.map((l) => l.id));
          const otherWorldBoxes = scopeLayers
            .filter((l) => l.visible && !moveTargetIds.has(l.id))
            .map((l) => resolveSelectWorldBBox(l, scopeM, state.scene.layers));
          drag = {
            kind: 'move',
            initialLayers: new Map(moveTargets.map((l) => [l.id, l])),
            initialWorldBBox: combineLayerWorldBBoxes(state.scene.layers, moveTargets),
            otherWorldBoxes,
            invScopeM: invertMatrix(scopeM),
            hasMoved: false,
          };
        }
        return;
      }

      const guideSettings = useSettingsStore.getState().settings;
      if (
        guideSettings.showGuides &&
        state.scene.guides &&
        state.scene.guides.length > 0 &&
        !event.shiftKey
      ) {
        const tol = 6 / Math.max(0.05, ctx.scope.view.zoom);
        let bestGuide: Guide | null = null;
        let bestDist = tol;
        for (const g of state.scene.guides) {
          const dist =
            g.orientation === 'vertical'
              ? Math.abs(event.point.x - g.position)
              : Math.abs(event.point.y - g.position);
          if (dist <= bestDist) {
            bestDist = dist;
            bestGuide = g;
          }
        }
        if (bestGuide) {
          drag = {
            kind: 'move-guide',
            guideId: bestGuide.id,
            orientation: bestGuide.orientation,
            position: bestGuide.position,
          };
          ctx.redrawOverlay({
            draggingGuide: {
              id: bestGuide.id,
              orientation: bestGuide.orientation,
              position: bestGuide.position,
            },
          });
          ctx.scope.view.update();
          return;
        }
      }

      const clickedAb = findArtboardAtPoint(state.scene, event.point);
      if (clickedAb && clickedAb.id !== state.activeArtboardId) {
        state.setActiveArtboardId(clickedAb.id);
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

      if (drag.kind === 'text-path-handle') {
        const state = useEditorStore.getState();
        const localPt = applyMatrixToPoint(drag.invTextWorldM, event.point);
        const proj = projectPointToTextPathOffset(
          drag.layer,
          drag.hostPath,
          localPt,
          state.scene.layers
        );
        if (!proj) return;

        drag.hasMoved = true;
        const nextOverrides = new Map<string, Partial<Layer>>();
        if (drag.handleKind === 'offset') {
          nextOverrides.set(drag.layer.id, {
            pathOffset: proj.pathOffset,
            ...(proj.align !== drag.layer.align ? { align: proj.align } : {}),
          });
        } else {
          const nextBaseline = clamp(
            Math.round(proj.signedNormalDist - drag.grabDelta),
            -200,
            200
          );
          nextOverrides.set(drag.layer.id, {
            pathBaselineOffset: nextBaseline,
          });
        }
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'gradient-handle') {
        const localPt = applyMatrixToPoint(drag.invWorldM, event.point);
        const nextGrad = clonePaint(drag.initialGradient);
        const { origin, destination } = resolveGradientEndpoints(
          drag.initialGradient,
          drag.localBox
        );

        if (drag.handleKind === 'start' || drag.handleKind === 'end') {
          let targetLocal = localPt;
          if (event.shiftKey) {
            const anchorLocal =
              drag.handleKind === 'start' ? destination : origin;
            const snapped = snapVector45({
              x: localPt.x - anchorLocal.x,
              y: localPt.y - anchorLocal.y,
            });
            targetLocal = {
              x: anchorLocal.x + snapped.x,
              y: anchorLocal.y + snapped.y,
            };
          }
          const norm = localPointToNormalized(targetLocal, drag.localBox);
          if (drag.handleKind === 'start') {
            nextGrad.start = norm;
          } else {
            nextGrad.end = norm;
          }
        } else if (drag.stopIndex !== undefined) {
          const vx = destination.x - origin.x;
          const vy = destination.y - origin.y;
          const lenSq = vx * vx + vy * vy;
          const rawT =
            lenSq > 1e-6
              ? ((localPt.x - origin.x) * vx + (localPt.y - origin.y) * vy) /
                lenSq
              : 0.5;
          const stop = nextGrad.stops[drag.stopIndex];
          if (stop) {
            stop.offset = clamp(rawT, 0, 1);
          }
        }

        drag.hasMoved = true;
        const nextOverrides = new Map<string, Partial<Layer>>();
        if (
          drag.target === 'stroke' &&
          drag.layer.type === 'path' &&
          drag.layer.stroke
        ) {
          nextOverrides.set(drag.layer.id, {
            stroke: {
              ...drag.layer.stroke,
              color: nextGrad,
            },
          });
        } else {
          nextOverrides.set(drag.layer.id, {
            fill: nextGrad,
          });
        }
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'move-guide') {
        const pos = drag.orientation === 'vertical' ? event.point.x : event.point.y;
        drag.position = pos;
        ctx.redrawOverlay({
          draggingGuide: {
            id: drag.guideId,
            orientation: drag.orientation,
            position: pos,
          },
        });
        ctx.scope.view.update();
        return;
      }

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
          useEditorStore.temporal.getState().pause();
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
            draftOverrides = nextOverrides;
            ctx.redrawOverlay({ guides });
            ctx.scope.view.update();
            return;
          }
          useEditorStore.temporal.getState().resume();
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
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides, guides);
        return;
      }

      if (drag.kind === 'rotate') {
        const ptScope = applyMatrixToPoint(drag.invScopeM, event.point);
        const curAngle = Math.atan2(
          ptScope.y - drag.pivotScope.y,
          ptScope.x - drag.pivotScope.x
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
          if (
            initial.type === 'text' &&
            initial.pathId &&
            drag.initialLayers.has(initial.pathId)
          ) {
            continue;
          }
          const rx = initial.x - drag.pivotScope.x;
          const ry = initial.y - drag.pivotScope.y;
          nextOverrides.set(id, {
            x: drag.pivotScope.x + rx * cos - ry * sin,
            y: drag.pivotScope.y + rx * sin + ry * cos,
            rotation: initial.rotation + deltaDeg,
          });
        }
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'resize-single') {
        const ptScope = applyMatrixToPoint(drag.invScopeM, event.point);
        const dx = ptScope.x - drag.anchorScope.x;
        const dy = ptScope.y - drag.anchorScope.y;
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
          x: drag.anchorScope.x - anchorOffset.x,
          y: drag.anchorScope.y - anchorOffset.y,
        });
        draftOverrides = nextOverrides;
        applyDraftToPaper(ctx, nextOverrides);
        return;
      }

      if (drag.kind === 'resize-multi') {
        const ptScope = applyMatrixToPoint(drag.invScopeM, event.point);
        let kx =
          drag.moveX !== 0 && Math.abs(drag.spanScope.x) > 1e-6
            ? (ptScope.x - drag.anchorScope.x) / drag.spanScope.x
            : 1;
        let ky =
          drag.moveY !== 0 && Math.abs(drag.spanScope.y) > 1e-6
            ? (ptScope.y - drag.anchorScope.y) / drag.spanScope.y
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
          if (
            initial.type === 'text' &&
            initial.pathId &&
            drag.initialLayers.has(initial.pathId)
          ) {
            continue;
          }
          nextOverrides.set(id, {
            x: drag.anchorScope.x + (initial.x - drag.anchorScope.x) * kx,
            y: drag.anchorScope.y + (initial.y - drag.anchorScope.y) * ky,
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

      if (drag.kind === 'move-guide') {
        const { guideId, orientation, position } = drag;
        const viewPt = ctx.scope.view.projectToView(
          new ctx.scope.Point(_event.point.x, _event.point.y)
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
        return;
      }

      if (drag.kind === 'marquee') {
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
                bboxIntersects(resolveSelectWorldBBox(layer, scopeM, state.scene.layers), rect)
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

      if (drag.kind === 'move' && drag.altDuplicateBase) {
        const { scene, selectedIds, sourceIds, lastDelta } = drag.altDuplicateBase;
        drag.altDuplicateBase = undefined;
        reset(ctx);
        useEditorStore.setState({ scene, selectedIds });
        useEditorStore.temporal.getState().resume();
        duplicateLayers(sourceIds, lastDelta.x, lastDelta.y);
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
          if (sortStopsTarget === 'fill' && 'fill' in next && isGradientPaint(next.fill)) {
            return {
              ...next,
              fill: {
                ...next.fill,
                stops: normalizeGradientStops(next.fill.stops),
              },
            } as Layer;
          }
          if (
            sortStopsTarget === 'stroke' &&
            next.type === 'path' &&
            next.stroke &&
            isGradientPaint(next.stroke.color)
          ) {
            return {
              ...next,
              stroke: {
                ...next.stroke,
                color: {
                  ...next.stroke.color,
                  stops: normalizeGradientStops(next.stroke.color.stops),
                },
              },
            };
          }
          return next;
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
      if (drag?.kind === 'move' && drag.altDuplicateBase) {
        const { scene, selectedIds } = drag.altDuplicateBase;
        drag.altDuplicateBase = undefined;
        useEditorStore.setState({ scene, selectedIds });
        useEditorStore.temporal.getState().resume();
      }
      reset(ctx);
    },
  };
}
