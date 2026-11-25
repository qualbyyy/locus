import { getAsset, getAssetImageElement } from '../core/assets';
import { findLayerPath } from '../core/layerTree';
import {
  clamp,
  computeLayerLocalBBox,
  computeSubPathsBBox,
  getLayerMatrix,
  type LayerTransform,
} from '../core/math';
import {
  normalizeGradientStops,
  resolveGradientEndpoints,
  sanitizeDashArray,
} from '../core/paint';
import type {
  BBox,
  GroupLayer,
  ImageLayer,
  Layer,
  Paint,
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
import {
  computeTextOnPathLocalBBox,
  computeTextOnPathPlacements,
  resolveHostPathLayer,
} from './textOnPath';

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

export function toPaperColor(
  scope: paper.PaperScope,
  paint: Paint | null | undefined,
  box: BBox
): paper.Color | null {
  if (!paint) return null;
  if (typeof paint === 'string') {
    return new scope.Color(paint);
  }
  const stops = normalizeGradientStops(paint.stops).map((s) => {
    const c = new scope.Color(s.color);
    if (s.opacity !== undefined) {
      c.alpha = clamp(s.opacity, 0, 1);
    }
    return new scope.GradientStop(c, s.offset);
  });
  const { origin, destination } = resolveGradientEndpoints(paint, box);
  const gradient = new scope.Gradient();
  gradient.stops = stops;
  gradient.radial = paint.kind === 'radial';
  return new scope.Color(
    gradient,
    new scope.Point(origin.x, origin.y),
    new scope.Point(destination.x, destination.y)
  );
}

export function applyPathStyleToPaperItem(
  scope: paper.PaperScope,
  item: paper.Item,
  layer: PathLayer,
  box?: BBox
): void {
  const target =
    item instanceof scope.Group && item.children.length > 0
      ? item.children[item.children.length - 1]
      : item;
  const resolvedBox =
    box ?? computeSubPathsBBox(resolveEffectivePathGeometry(layer).subpaths);

  target.fillColor = toPaperColor(scope, layer.fill, resolvedBox);
  if (layer.stroke && layer.stroke.width > 0) {
    target.strokeColor = toPaperColor(scope, layer.stroke.color, resolvedBox);
    target.strokeWidth = layer.stroke.width;
    target.strokeCap = layer.stroke.lineCap ?? 'round';
    target.strokeJoin = layer.stroke.lineJoin ?? 'round';
    target.dashArray = sanitizeDashArray(layer.stroke.dashArray) ?? [];
    target.dashOffset = layer.stroke.dashOffset ?? 0;
  } else {
    target.strokeColor = null;
    target.dashArray = [];
    target.dashOffset = 0;
  }
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

  const localBox = computeSubPathsBBox(subpaths);
  applyPathStyleToPaperItem(scope, frontItem, layer, localBox);

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
  item.blendMode = layer.blendMode ?? 'normal';
  item.visible = layer.visible;
  item.data = { ...item.data, layerId: layer.id };
  applyLayerMatrixToItem(scope, item, layer);
  return item;
}

function buildTextLayerItem(
  scope: paper.PaperScope,
  layer: TextLayer,
  isEditing: boolean,
  sceneLayers: Layer[]
): paper.Group {
  const group = new scope.Group({ applyMatrix: false });
  const hostPath = resolveHostPathLayer(sceneLayers, layer.pathId);

  if (hostPath) {
    const localBox = computeTextOnPathLocalBBox(layer, hostPath, sceneLayers);
    const fillColor = toPaperColor(scope, layer.fill, localBox);
    const placements = computeTextOnPathPlacements(
      layer,
      hostPath,
      undefined,
      sceneLayers
    );

    for (const p of placements) {
      const charItem = new scope.PointText({
        content: p.char,
        point: new scope.Point(0, 0),
        fontFamily: layer.fontFamily,
        fontWeight: layer.fontWeight === 700 ? 'bold' : 'normal',
        fontSize: layer.fontSize,
        fillColor,
        justification: 'center',
        applyMatrix: false,
      });
      charItem.position = new scope.Point(p.x, p.y);
      charItem.rotation = p.angleDeg;
      group.addChild(charItem);
    }

    group.opacity = clamp(layer.opacity, 0, 1);
    group.blendMode = layer.blendMode ?? 'normal';
    group.visible = isEditing ? false : layer.visible;
    group.data = { layerId: layer.id };
    applyLayerMatrixToItem(scope, group, layer);
    return group;
  }

  const lines = (layer.content || '').split('\n');
  const step = layer.fontSize * layer.lineHeight;
  const localBox = computeLayerLocalBBox(layer);
  const fillColor = toPaperColor(scope, layer.fill, localBox);

  lines.forEach((line, index) => {
    const baselineY = layer.fontSize * 0.85 + index * step;
    const textItem = new scope.PointText({
      content: line,
      point: new scope.Point(0, baselineY),
      fontFamily: layer.fontFamily,
      fontWeight: layer.fontWeight === 700 ? 'bold' : 'normal',
      fontSize: layer.fontSize,
      fillColor,
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
  group.blendMode = layer.blendMode ?? 'normal';
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
  group.blendMode = layer.blendMode ?? 'normal';
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
      group.blendMode = layer.blendMode ?? 'normal';
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

function buildGroupLayerItem(
  scope: paper.PaperScope,
  layer: GroupLayer,
  itemMap: Map<string, paper.Item>,
  options: {
    editingTextLayerId?: string | null;
    outlineMode?: boolean;
    editingGroupId?: string | null;
  },
  insideActiveGroup: boolean,
  editingAncestorIds: Set<string>,
  dimmed: boolean,
  sceneLayers: Layer[]
): paper.Item {
  const group = new scope.Group({ applyMatrix: false });
  syncLayerListToContainer(
    scope,
    group,
    layer.children,
    itemMap,
    options,
    insideActiveGroup || layer.id === options.editingGroupId,
    editingAncestorIds,
    sceneLayers
  );
  group.opacity = clamp(layer.opacity, 0, 1) * (dimmed ? 0.35 : 1);
  group.blendMode = layer.blendMode ?? 'normal';
  group.visible = layer.visible;
  group.data = { layerId: layer.id };
  applyLayerMatrixToItem(scope, group, layer);
  return options.outlineMode
    ? group
    : wrapWithRasterEffects(scope, layer, group, false);
}

function buildPaperItemForLayer(
  scope: paper.PaperScope,
  layer: Layer,
  maskIds: Set<string>,
  itemMap: Map<string, paper.Item>,
  options: {
    editingTextLayerId?: string | null;
    outlineMode?: boolean;
    editingGroupId?: string | null;
  },
  insideActiveGroup: boolean,
  editingAncestorIds: Set<string>,
  sceneLayers: Layer[]
): paper.Item {
  const dimmed =
    editingAncestorIds.size > 0 &&
    !insideActiveGroup &&
    !editingAncestorIds.has(layer.id);

  if (layer.type === 'group') {
    return buildGroupLayerItem(
      scope,
      layer,
      itemMap,
      options,
      insideActiveGroup,
      editingAncestorIds,
      dimmed,
      sceneLayers
    );
  }

  const outlineMode = Boolean(options.outlineMode);
  const editingTextLayerId = options.editingTextLayerId;
  const isActiveMask = maskIds.has(layer.id);
  let item: paper.Item;

  if (layer.type === 'path') {
    const built = buildPathLayerItem(scope, layer, isActiveMask, outlineMode);
    item =
      isActiveMask || outlineMode
        ? built
        : wrapWithRasterEffects(scope, layer, built, false);
  } else if (layer.type === 'text') {
    const isEditing = editingTextLayerId === layer.id;
    const built = buildTextLayerItem(scope, layer, isEditing, sceneLayers);
    if (outlineMode) {
      for (const child of built.children) {
        if (child instanceof scope.PointText) {
          child.fillColor = null;
          child.strokeColor = new scope.Color('#2563eb');
          child.strokeWidth = 0.75;
        }
      }
      item = built;
    } else {
      item = wrapWithRasterEffects(scope, layer, built, isEditing);
    }
  } else {
    const built = buildImageLayerItem(scope, layer);
    if (outlineMode) {
      const box = new scope.Path.Rectangle(
        new scope.Rectangle(
          -layer.width / 2,
          -layer.height / 2,
          layer.width,
          layer.height
        )
      );
      box.applyMatrix = false;
      box.fillColor = null;
      box.strokeColor = new scope.Color('#2563eb');
      box.strokeWidth = 1;
      box.visible = layer.visible;
      box.data = { layerId: layer.id };
      applyLayerMatrixToItem(scope, box, layer);
      built.remove();
      item = box;
    } else {
      item = wrapWithRasterEffects(scope, layer, built, false);
    }
  }

  if (dimmed) {
    item.opacity *= 0.35;
  }
  return item;
}

function syncLayerListToContainer(
  scope: paper.PaperScope,
  container: paper.Layer | paper.Group,
  layers: Layer[],
  itemMap: Map<string, paper.Item>,
  options: {
    editingTextLayerId?: string | null;
    outlineMode?: boolean;
    editingGroupId?: string | null;
  },
  insideActiveGroup: boolean,
  editingAncestorIds: Set<string>,
  sceneLayers: Layer[]
): void {
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  const maskIds = new Set<string>();

  for (const layer of layers) {
    if (layer.type === 'path' && layer.isClipMask) {
      maskIds.add(layer.id);
    }
    if (layer.clipMaskId && layersById.get(layer.clipMaskId)?.type === 'path') {
      maskIds.add(layer.clipMaskId);
    }
  }

  let activeClipGroup: paper.Group | null = null;
  let activeClipMaskId: string | null = null;

  for (const layer of layers) {
    const item = buildPaperItemForLayer(
      scope,
      layer,
      maskIds,
      itemMap,
      options,
      insideActiveGroup,
      editingAncestorIds,
      sceneLayers
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
        container.addChild(activeClipGroup);
        activeClipMaskId = maskLayer.id;
      }
      activeClipGroup.addChild(item);
    } else {
      activeClipGroup = null;
      activeClipMaskId = null;
      container.addChild(item);
    }
  }
}

export function syncSceneToPaper(
  scope: paper.PaperScope,
  sceneLayer: paper.Layer,
  scene: Scene,
  options?: {
    editingTextLayerId?: string | null;
    outlineMode?: boolean;
    editingGroupId?: string | null;
  }
): Map<string, paper.Item> {
  scope.activate();
  sceneLayer.activate();
  sceneLayer.removeChildren();

  const itemMap = new Map<string, paper.Item>();
  const editingPath = options?.editingGroupId
    ? findLayerPath(scene.layers, options.editingGroupId)
    : null;
  const editingAncestorIds = new Set(
    editingPath ? editingPath.map((l) => l.id) : []
  );

  syncLayerListToContainer(
    scope,
    sceneLayer,
    scene.layers,
    itemMap,
    options ?? {},
    false,
    editingAncestorIds,
    scene.layers
  );

  return itemMap;
}
