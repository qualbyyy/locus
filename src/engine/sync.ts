import { getAsset, getAssetImageElement } from '../core/assets';
import {
  clamp,
  computeLayerLocalBBox,
  getLayerMatrix,
  type LayerTransform,
} from '../core/math';
import type {
  ImageLayer,
  Layer,
  PathLayer,
  Scene,
  SubPath,
  TextLayer,
} from '../core/types';
import { rasterizeLayerLocalWithEffects } from '../export/rasterize';
import {
  colorWithOpacity,
  hasRasterEffects,
  resolveEffectivePathGeometry,
} from './effects';

export function applyLayerMatrixToItem(
  scope: paper.PaperScope,
  item: paper.Item,
  transform: LayerTransform
): void {
  item.applyMatrix = false;
  item.pivot = new scope.Point(0, 0);
  const m = getLayerMatrix(transform);
  item.matrix = new scope.Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty);
}

export function buildPaperPathFromSubPaths(
  scope: paper.PaperScope,
  subpaths: SubPath[],
  fillRule: 'nonzero' | 'evenodd',
  layerId?: string
): paper.PathItem {
  if (subpaths.length === 0) {
    const empty = new scope.Path({ applyMatrix: false });
    empty.fillRule = fillRule;
    if (layerId) {
      empty.data = { layerId, subpathIndex: 0 };
    }
    return empty;
  }

  const paths = subpaths.map((sp, subpathIndex) => {
    const segments = sp.anchors.map(
      (anchor) =>
        new scope.Segment(
          new scope.Point(anchor.x, anchor.y),
          new scope.Point(anchor.handleIn.x, anchor.handleIn.y),
          new scope.Point(anchor.handleOut.x, anchor.handleOut.y)
        )
    );
    const path = new scope.Path({
      segments,
      closed: sp.closed,
      applyMatrix: false,
    });
    if (layerId) {
      path.data = { layerId, subpathIndex };
    }
    return path;
  });

  if (paths.length === 1) {
    const single = paths[0];
    single.fillRule = fillRule;
    return single;
  }

  const compound = new scope.CompoundPath({
    children: paths,
    fillRule,
    applyMatrix: false,
  });
  if (layerId) {
    compound.data = { layerId };
  }
  return compound;
}

function buildPathLayerItem(
  scope: paper.PaperScope,
  layer: PathLayer,
  isActiveMask: boolean,
  outlineMode: boolean
): paper.Item {
  const { subpaths, extrudeFaces } = resolveEffectivePathGeometry(layer);
  const frontItem = buildPaperPathFromSubPaths(
    scope,
    subpaths,
    layer.fillRule,
    layer.id
  );

  if (isActiveMask) {
    frontItem.fillColor = null;
    frontItem.strokeColor = null;
    frontItem.opacity = clamp(layer.opacity, 0, 1);
    frontItem.visible = layer.visible;
    frontItem.data = { ...frontItem.data, layerId: layer.id };
    applyLayerMatrixToItem(scope, frontItem, layer);
    return frontItem;
  }

  if (outlineMode) {
    frontItem.fillColor = null;
    frontItem.strokeColor = new scope.Color('#2563eb');
    frontItem.strokeWidth = 1;
    frontItem.opacity = clamp(layer.opacity, 0, 1);
    frontItem.visible = layer.visible;
    frontItem.data = { ...frontItem.data, layerId: layer.id };
    applyLayerMatrixToItem(scope, frontItem, layer);
    return frontItem;
  }

  frontItem.fillColor = layer.fill ? new scope.Color(layer.fill) : null;
  if (layer.stroke && layer.stroke.width > 0) {
    frontItem.strokeColor = new scope.Color(layer.stroke.color);
    frontItem.strokeWidth = layer.stroke.width;
    frontItem.strokeCap = layer.stroke.lineCap ?? 'round';
    frontItem.strokeJoin = layer.stroke.lineJoin ?? 'round';
  } else {
    frontItem.strokeColor = null;
  }

  let item: paper.Item = frontItem;
  if (extrudeFaces.length > 0) {
    const faceItems = extrudeFaces.map((face) => {
      const fItem = buildPaperPathFromSubPaths(scope, face.subpaths, 'nonzero');
      fItem.fillColor = new scope.Color(face.fill);
      fItem.strokeColor = null;
      return fItem;
    });
    item = new scope.Group({
      children: [...faceItems, frontItem],
      applyMatrix: false,
    });
  }

  item.opacity = clamp(layer.opacity, 0, 1);
  item.visible = layer.visible;
  item.data = { ...item.data, layerId: layer.id };
  applyLayerMatrixToItem(scope, item, layer);
  return item;
}

function buildTextLayerItem(
  scope: paper.PaperScope,
  layer: TextLayer,
  isEditing: boolean
): paper.Group {
  const group = new scope.Group({ applyMatrix: false });
  const lines = (layer.content || '').split('\n');
  const step = layer.fontSize * layer.lineHeight;

  lines.forEach((line, index) => {
    const baselineY = layer.fontSize * 0.85 + index * step;
    const textItem = new scope.PointText({
      content: line,
      point: new scope.Point(0, baselineY),
      fontFamily: layer.fontFamily,
      fontWeight: layer.fontWeight === 700 ? 'bold' : 'normal',
      fontSize: layer.fontSize,
      fillColor: new scope.Color(layer.fill),
      justification: layer.align,
      applyMatrix: false,
    });
    if (Math.abs(layer.letterSpacing ?? 0) > 1e-4) {
      textItem.tracking =
        ((layer.letterSpacing ?? 0) / Math.max(1, layer.fontSize)) * 1000;
    }
    group.addChild(textItem);
  });

  group.opacity = clamp(layer.opacity, 0, 1);
  group.visible = isEditing ? false : layer.visible;
  group.data = { layerId: layer.id };
  applyLayerMatrixToItem(scope, group, layer);
  return group;
}

function buildImageLayerItem(
  scope: paper.PaperScope,
  layer: ImageLayer
): paper.Item {
  const entry = getAsset(layer.assetId);
  if (!entry) {
    const rect = new scope.Path.Rectangle(
      new scope.Rectangle(-layer.width / 2, -layer.height / 2, layer.width, layer.height)
    );
    rect.applyMatrix = false;
    rect.fillColor = new scope.Color('#f0ece3');
    rect.strokeColor = new scope.Color('#dfd9ce');
    rect.strokeWidth = 1;
    rect.opacity = clamp(layer.opacity, 0, 1);
    rect.visible = layer.visible;
    rect.data = { layerId: layer.id };
    applyLayerMatrixToItem(scope, rect, layer);
    return rect;
  }

  const group = new scope.Group({ applyMatrix: false });
  const hitRect = new scope.Path.Rectangle(
    new scope.Rectangle(-layer.width / 2, -layer.height / 2, layer.width, layer.height)
  );
  hitRect.applyMatrix = false;
  hitRect.fillColor = new scope.Color(0, 0, 0, 0.0001);
  group.addChild(hitRect);

  const decodedEl = getAssetImageElement(layer.assetId);
  const raster = decodedEl
    ? new scope.Raster(decodedEl)
    : new scope.Raster(entry.objectUrl);
  raster.applyMatrix = false;
  raster.position = new scope.Point(0, 0);

  const applyRasterScale = (w: number, h: number) => {
    raster.scaling = new scope.Point(
      layer.width / Math.max(1, w),
      layer.height / Math.max(1, h)
    );
  };

  const initialW = decodedEl
    ? decodedEl.naturalWidth || entry.naturalWidth
    : raster.width || entry.naturalWidth;
  const initialH = decodedEl
    ? decodedEl.naturalHeight || entry.naturalHeight
    : raster.height || entry.naturalHeight;
  applyRasterScale(initialW, initialH);

  if (!raster.loaded) {
    raster.onLoad = () => {
      applyRasterScale(
        raster.width || entry.naturalWidth,
        raster.height || entry.naturalHeight
      );
      scope.view?.update();
    };
  }

  group.addChild(raster);
  group.opacity = clamp(layer.opacity, 0, 1);
  group.visible = layer.visible;
  group.data = { layerId: layer.id };
  applyLayerMatrixToItem(scope, group, layer);
  return group;
}

function wrapWithRasterEffects(
  scope: paper.PaperScope,
  layer: Layer,
  item: paper.Item,
  isEditingText: boolean
): paper.Item {
  const eff = layer.effects;
  if (!eff || !hasRasterEffects(eff)) return item;

  const needsRasterize =
    (eff.blur !== undefined && eff.blur > 0.1) ||
    Boolean(eff.dropShadow && eff.outerGlow);

  if (needsRasterize) {
    const rendered = rasterizeLayerLocalWithEffects(layer);
    if (rendered) {
      item.remove();
      const box = computeLayerLocalBBox(layer);
      const hitRect = new scope.Path.Rectangle(
        new scope.Rectangle(box.x, box.y, Math.max(1, box.width), Math.max(1, box.height))
      );
      hitRect.applyMatrix = false;
      hitRect.fillColor = new scope.Color(0, 0, 0, 0.0001);

      const raster = new scope.Raster(rendered.canvas);
      raster.applyMatrix = false;
      raster.position = new scope.Point(rendered.centerX, rendered.centerY);
      if (rendered.scale !== 1) {
        raster.scaling = new scope.Point(1 / rendered.scale, 1 / rendered.scale);
      }

      const group = new scope.Group({
        children: [hitRect, raster],
        applyMatrix: false,
      });
      group.opacity = clamp(layer.opacity, 0, 1);
      group.visible = isEditingText ? false : layer.visible;
      group.data = { layerId: layer.id };
      applyLayerMatrixToItem(scope, group, layer);
      return group;
    }
  }

  if (eff.dropShadow) {
    item.shadowColor = new scope.Color(
      colorWithOpacity(eff.dropShadow.color, eff.dropShadow.opacity)
    );
    item.shadowBlur = eff.dropShadow.blur * 1.8;
    item.shadowOffset = new scope.Point(
      eff.dropShadow.offsetX,
      eff.dropShadow.offsetY
    );
  } else if (eff.outerGlow) {
    item.shadowColor = new scope.Color(
      colorWithOpacity(eff.outerGlow.color, eff.outerGlow.opacity)
    );
    item.shadowBlur = eff.outerGlow.blur * 1.8;
    item.shadowOffset = new scope.Point(0, 0);
  }

  return item;
}

function buildPaperItemForLayer(
  scope: paper.PaperScope,
  layer: Layer,
  maskIds: Set<string>,
  editingTextLayerId?: string | null,
  outlineMode = false
): paper.Item {
  const isActiveMask = maskIds.has(layer.id);
  if (layer.type === 'path') {
    const item = buildPathLayerItem(scope, layer, isActiveMask, outlineMode);
    if (isActiveMask || outlineMode) return item;
    return wrapWithRasterEffects(scope, layer, item, false);
  }
  if (layer.type === 'text') {
    const isEditing = editingTextLayerId === layer.id;
    const item = buildTextLayerItem(scope, layer, isEditing);
    if (outlineMode) {
      for (const child of item.children) {
        if (child instanceof scope.PointText) {
          child.fillColor = null;
          child.strokeColor = new scope.Color('#2563eb');
          child.strokeWidth = 0.75;
        }
      }
      return item;
    }
    return wrapWithRasterEffects(scope, layer, item, isEditing);
  }
  const item = buildImageLayerItem(scope, layer);
  if (outlineMode) {
    const box = new scope.Path.Rectangle(
      new scope.Rectangle(-layer.width / 2, -layer.height / 2, layer.width, layer.height)
    );
    box.applyMatrix = false;
    box.fillColor = null;
    box.strokeColor = new scope.Color('#2563eb');
    box.strokeWidth = 1;
    box.visible = layer.visible;
    box.data = { layerId: layer.id };
    applyLayerMatrixToItem(scope, box, layer);
    item.remove();
    return box;
  }
  return wrapWithRasterEffects(scope, layer, item, false);
}

export function syncSceneToPaper(
  scope: paper.PaperScope,
  sceneLayer: paper.Layer,
  scene: Scene,
  options?: { editingTextLayerId?: string | null; outlineMode?: boolean }
): Map<string, paper.Item> {
  scope.activate();
  sceneLayer.activate();
  sceneLayer.removeChildren();

  const itemMap = new Map<string, paper.Item>();
  const layersById = new Map(scene.layers.map((layer) => [layer.id, layer]));
  const maskIds = new Set<string>();

  for (const layer of scene.layers) {
    if (layer.type === 'path' && layer.isClipMask) {
      maskIds.add(layer.id);
    }
    if (layer.clipMaskId && layersById.get(layer.clipMaskId)?.type === 'path') {
      maskIds.add(layer.clipMaskId);
    }
  }

  let activeClipGroup: paper.Group | null = null;
  let activeClipMaskId: string | null = null;

  for (const layer of scene.layers) {
    const item = buildPaperItemForLayer(
      scope,
      layer,
      maskIds,
      options?.editingTextLayerId,
      Boolean(options?.outlineMode)
    );
    itemMap.set(layer.id, item);

    const maskLayer = layer.clipMaskId ? layersById.get(layer.clipMaskId) : undefined;
    if (maskLayer && maskLayer.type === 'path') {
      if (!activeClipGroup || activeClipMaskId !== maskLayer.id) {
        const clipMaskItem = buildPaperPathFromSubPaths(
          scope,
          maskLayer.subpaths,
          maskLayer.fillRule
        );
        clipMaskItem.data = { isInternalClipMask: true, maskLayerId: maskLayer.id };
        applyLayerMatrixToItem(scope, clipMaskItem, maskLayer);

        activeClipGroup = new scope.Group({
          children: [clipMaskItem],
          clipped: true,
          applyMatrix: false,
        });
        activeClipGroup.data = { isClipGroup: true, maskId: maskLayer.id };
        sceneLayer.addChild(activeClipGroup);
        activeClipMaskId = maskLayer.id;
      }
      activeClipGroup.addChild(item);
    } else {
      activeClipGroup = null;
      activeClipMaskId = null;
      sceneLayer.addChild(item);
    }
  }

  return itemMap;
}
