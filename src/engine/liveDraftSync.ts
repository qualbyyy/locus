import {
  findLayerById,
  findLayerPath,
  flattenLayers,
  mapLayerTree,
} from '../core/layerTree';
import { isGradientPaint } from '../core/paint';
import { useEditorStore } from '../core/store';
import type { Layer, PathLayer, TextLayer } from '../core/types';
import { resolveLayerLocalBBox } from './geometryBounds';
import type { SmartGuideLine } from './snapping';
import {
  applyLayerMatrixToItem,
  applyPathStyleToPaperItem,
  buildTextLayerItem,
  toPaperColor,
} from './sync';
import type { ToolContext } from './tools/types';

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

export function applyDraftToPaper(
  ctx: ToolContext,
  overrides: Map<string, Partial<Layer>>,
  guides: SmartGuideLine[] | null = null
): void {
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
      ('fill' in patch ||
        'stroke' in patch ||
        isGradientPaint(merged.fill) ||
        isGradientPaint(merged.stroke?.color))
    ) {
      const localBox = resolveLayerLocalBBox(merged, layers);
      for (const child of item.children) {
        if (child instanceof ctx.scope.PointText) {
          const m = child.matrix;
          const childM = { a: m.a, b: m.b, c: m.c, d: m.d, tx: m.tx, ty: m.ty };
          if (child.data?.textPass === 'stroke') {
            if (merged.stroke) {
              child.strokeColor = toPaperColor(ctx.scope, merged.stroke.color, localBox, childM);
            }
          } else {
            child.fillColor = toPaperColor(ctx.scope, merged.fill, localBox, childM);
          }
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

  // Синхронизируем текст на кривой при перетаскивании опорного контура или его группы
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
}

export function restoreDraftToPaper(
  ctx: ToolContext,
  draftOverrides: Map<string, Partial<Layer>>
): void {
  if (draftOverrides.size === 0) return;
  const restore = new Map<string, Partial<Layer>>();
  const layers = useEditorStore.getState().scene.layers;
  for (const id of draftOverrides.keys()) {
    const orig = findLayerById(layers, id);
    if (orig) restore.set(id, orig);
  }
  if (restore.size > 0) {
    applyDraftToPaper(ctx, restore);
  }
}
