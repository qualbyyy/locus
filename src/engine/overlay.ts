import { getSceneArtboards } from '../core/artboards';
import {
  findLayerById,
  findLayerPath,
  flattenLayers,
} from '../core/layerTree';
import {
  IDENTITY_MATRIX,
  applyMatrixToPoint,
  applyMatrixToVector,
  clamp,
  computeLayerBBoxWithMatrix,
  computeLayerLocalBBox,
  computeSubPathsBBox,
  decomposeMatrix,
  getLayerMatrix,
  multiplyMatrices,
  type Matrix2D,
} from '../core/math';
import {
  clonePaint,
  isGradientPaint,
  normalizeGradientStops,
  resolveGradientEndpoints,
  sanitizeDashArray,
} from '../core/paint';
import { hexToRgb } from '../core/themes';
import type {
  AnchorPoint,
  GradientPaint,
  Layer,
  Paint,
  PathLayer,
  Point2D,
  Scene,
  SelectedNodeRef,
  StrokeStyle,
  SubPath,
  ToolType,
} from '../core/types';
import { resolveEffectivePathGeometry } from './effects';
import type { SmartGuideLine } from './snapping';
import {
  applyLayerMatrixToItem,
  buildPaperPathFromSubPaths,
  toPaperColor,
} from './sync';
import {
  computeTextOnPathLocalBBox,
  resolveHostPathLayer,
} from './textOnPath';

export type SelectHandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rotate';

export interface MarqueeOverlay {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PenDraftOverlay {
  anchors: AnchorPoint[];
  hoverPoint: Point2D | null;
  isClosingHover: boolean;
}

export interface ShapeDraftOverlay {
  x: number;
  y: number;
  subpaths: SubPath[];
  fill: Paint | null;
  stroke: StrokeStyle | null;
}

export interface ShapeBuilderOverlay {
  regions: Array<{
    id: string;
    x: number;
    y: number;
    subpaths: SubPath[];
    fillRule: 'nonzero' | 'evenodd';
  }>;
  hoveredRegionId: string | null;
  activeRegionIds: string[];
  trail: Point2D[];
  mode: 'merge' | 'erase';
  scopeMatrix: Matrix2D;
}

export interface FreehandDraftOverlay {
  points: Point2D[];
  closedHover?: boolean;
  mode: 'pencil' | 'knife';
}

export interface GradientHandleData {
  target: 'fill' | 'stroke';
  kind: 'start' | 'end' | 'stop';
  stopIndex?: number;
}

export interface OverlayRenderState {
  scene: Scene;
  selectedIds: string[];
  selectedNode: SelectedNodeRef | null;
  editingGroupId?: string | null;
  activeArtboardId?: string | null;
  activeTool: ToolType;
  activeGradientTarget?: 'fill' | 'stroke';
  draftOverrides?: Map<string, Partial<Layer>>;
  marquee?: MarqueeOverlay | null;
  penDraft?: PenDraftOverlay | null;
  shapeDraft?: ShapeDraftOverlay | null;
  shapeBuilder?: ShapeBuilderOverlay | null;
  freehandDraft?: FreehandDraftOverlay | null;
  hoveredMaskId?: string | null;
  accentColor?: string;
  grid?: { show: boolean; size: number; opacity: number };
  guides?: SmartGuideLine[] | null;
  showGuides?: boolean;
  draggingGuide?: {
    id?: string;
    orientation: 'horizontal' | 'vertical';
    position: number;
  } | null;
}

export function resolveEditableGradient(
  layer: Layer,
  preferred: 'fill' | 'stroke' = 'fill'
): { target: 'fill' | 'stroke'; gradient: GradientPaint } | null {
  if (layer.type === 'path') {
    if (preferred === 'stroke' && isGradientPaint(layer.stroke?.color)) {
      return { target: 'stroke', gradient: layer.stroke.color };
    }
    if (isGradientPaint(layer.fill)) {
      return { target: 'fill', gradient: layer.fill };
    }
    if (isGradientPaint(layer.stroke?.color)) {
      return { target: 'stroke', gradient: layer.stroke.color };
    }
    return null;
  }
  if (layer.type === 'text' && isGradientPaint(layer.fill)) {
    return { target: 'fill', gradient: layer.fill };
  }
  return null;
}

const DEFAULT_ACCENT_HEX = '#da7756';
const WHITE_HEX = '#ffffff';

function getGridLineColor(
  scope: paper.PaperScope,
  backgroundHex: string,
  opacity: number
): paper.Color {
  const rgb = hexToRgb(backgroundHex);
  const lum = rgb ? 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b : 255;
  const channel = lum > 128 ? 28 / 255 : 1;
  return new scope.Color(channel, channel, channel, opacity);
}

function applyPaperMatrix(
  scope: paper.PaperScope,
  item: paper.Item,
  m: Matrix2D
): void {
  item.applyMatrix = false;
  item.pivot = new scope.Point(0, 0);
  item.matrix = new scope.Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty);
}

function getDraftMatrices(
  scene: Scene,
  layerId: string,
  draftOverrides?: Map<string, Partial<Layer>>
): { worldM: Matrix2D; parentM: Matrix2D } {
  const path = findLayerPath(scene.layers, layerId);
  if (!path || path.length === 0) {
    return { worldM: IDENTITY_MATRIX, parentM: IDENTITY_MATRIX };
  }
  let parentM = IDENTITY_MATRIX;
  for (let i = 0; i < path.length - 1; i += 1) {
    parentM = multiplyMatrices(
      parentM,
      getLayerMatrix(applyDraftLayer(path[i], draftOverrides))
    );
  }
  const target = applyDraftLayer(path[path.length - 1], draftOverrides);
  const worldM = multiplyMatrices(parentM, getLayerMatrix(target));
  return { worldM, parentM };
}

function renderGridOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  scene: Scene,
  grid: { show: boolean; size: number; opacity: number },
  zoom: number
): void {
  if (!grid.show) return;

  let step = Math.max(4, grid.size);
  while (step * zoom < 8) {
    step *= 2;
  }

  for (const ab of getSceneArtboards(scene)) {
    if (ab.width <= 0 || ab.height <= 0) continue;
    const children: paper.Path[] = [];
    for (let x = step; x < ab.width; x += step) {
      children.push(
        new scope.Path.Line(
          new scope.Point(ab.x + x, ab.y),
          new scope.Point(ab.x + x, ab.y + ab.height)
        )
      );
    }
    for (let y = step; y < ab.height; y += step) {
      children.push(
        new scope.Path.Line(
          new scope.Point(ab.x, ab.y + y),
          new scope.Point(ab.x + ab.width, ab.y + y)
        )
      );
    }
    if (children.length === 0) continue;

    const compound = new scope.CompoundPath({
      children,
      applyMatrix: false,
    });
    compound.strokeColor = getGridLineColor(scope, ab.background, grid.opacity);
    compound.strokeWidth = 1 / zoom;
    overlayLayer.addChild(compound);
  }
}

function renderSmartGuidesOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  guides: SmartGuideLine[],
  accentHex: string,
  zoom: number
): void {
  const strokeW = 1 / zoom;
  for (const guide of guides) {
    const p1 =
      guide.orientation === 'vertical'
        ? new scope.Point(guide.pos, guide.start)
        : new scope.Point(guide.start, guide.pos);
    const p2 =
      guide.orientation === 'vertical'
        ? new scope.Point(guide.pos, guide.end)
        : new scope.Point(guide.end, guide.pos);
    const line = new scope.Path.Line(p1, p2);
    line.strokeColor = new scope.Color(accentHex);
    line.strokeWidth = strokeW;
    overlayLayer.addChild(line);
  }
}

const MANUAL_GUIDE_HEX = '#0ea5e9';

function renderManualGuidesOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  state: OverlayRenderState,
  zoom: number
): void {
  if (state.showGuides === false) return;
  const saved = state.scene.guides ?? [];
  const dragging = state.draggingGuide ?? null;
  if (saved.length === 0 && !dragging) return;

  const pad = 4000 / zoom;
  const vb = scope.view.bounds;
  const left = (vb?.left ?? -2000) - pad;
  const right = (vb?.right ?? 2000) + pad;
  const top = (vb?.top ?? -2000) - pad;
  const bottom = (vb?.bottom ?? 2000) + pad;

  const drawGuide = (
    orientation: 'horizontal' | 'vertical',
    position: number,
    isPreview: boolean
  ) => {
    const p1 =
      orientation === 'vertical'
        ? new scope.Point(position, top)
        : new scope.Point(left, position);
    const p2 =
      orientation === 'vertical'
        ? new scope.Point(position, bottom)
        : new scope.Point(right, position);
    const line = new scope.Path.Line(p1, p2);
    line.strokeColor = new scope.Color(MANUAL_GUIDE_HEX);
    line.strokeWidth = (isPreview ? 1.5 : 1) / zoom;
    line.opacity = isPreview ? 0.95 : 0.85;
    if (isPreview) {
      line.dashArray = [4 / zoom, 3 / zoom];
    }
    overlayLayer.addChild(line);
  };

  for (const guide of saved) {
    if (dragging?.id && dragging.id === guide.id) continue;
    drawGuide(guide.orientation, guide.position, false);
  }
  if (dragging) {
    drawGuide(dragging.orientation, dragging.position, true);
  }
}

function applyDraftLayer(
  layer: Layer,
  draftOverrides?: Map<string, Partial<Layer>>
): Layer {
  const override = draftOverrides?.get(layer.id);
  if (!override) return layer;
  return { ...layer, ...override } as Layer;
}

function drawHandleSquare(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  center: Point2D,
  size: number,
  rotationDeg: number,
  strokeWidth: number,
  fillHex: string,
  accentHex: string,
  data: Record<string, unknown>
): void {
  const half = size / 2;
  const square = new scope.Path.Rectangle(
    new scope.Rectangle(-half, -half, size, size)
  );
  square.applyMatrix = false;
  square.position = new scope.Point(center.x, center.y);
  square.rotation = rotationDeg;
  square.fillColor = new scope.Color(fillHex);
  square.strokeColor = new scope.Color(accentHex);
  square.strokeWidth = strokeWidth;
  square.data = data;
  overlayLayer.addChild(square);
}

function resolveOverlayLocalBBox(layer: Layer, sceneLayers: Layer[]) {
  if (layer.type === 'text' && layer.pathId) {
    const hostPath = resolveHostPathLayer(sceneLayers, layer.pathId);
    if (hostPath) {
      return computeTextOnPathLocalBBox(layer, hostPath, sceneLayers);
    }
  }
  return computeLayerLocalBBox(layer);
}

function resolveOverlayWorldBBox(
  layer: Layer,
  parentM: Matrix2D,
  sceneLayers: Layer[]
) {
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

function renderGradientOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  layer: Layer,
  sceneLayers: Layer[],
  worldM: Matrix2D,
  target: 'fill' | 'stroke',
  gradient: GradientPaint,
  zoom: number,
  accentHex: string
): void {
  const localBox =
    layer.type === 'path'
      ? computeSubPathsBBox(resolveEffectivePathGeometry(layer).subpaths)
      : resolveOverlayLocalBBox(layer, sceneLayers);
  const { origin, destination, radius } = resolveGradientEndpoints(gradient, localBox);
  const originW = applyMatrixToPoint(worldM, origin);
  const destW = applyMatrixToPoint(worldM, destination);
  const strokeW = 1 / zoom;

  if (gradient.kind === 'radial') {
    const circle = new scope.Path.Circle(
      new scope.Point(origin.x, origin.y),
      radius
    );
    applyPaperMatrix(scope, circle, worldM);
    circle.fillColor = null;
    circle.strokeColor = new scope.Color(accentHex);
    circle.strokeWidth = strokeW;
    circle.dashArray = [4 / zoom, 3 / zoom];
    overlayLayer.addChild(circle);
  }

  const lineHalo = new scope.Path.Line(
    new scope.Point(originW.x, originW.y),
    new scope.Point(destW.x, destW.y)
  );
  lineHalo.strokeColor = new scope.Color(WHITE_HEX);
  lineHalo.strokeWidth = 2.5 / zoom;
  overlayLayer.addChild(lineHalo);

  const line = new scope.Path.Line(
    new scope.Point(originW.x, originW.y),
    new scope.Point(destW.x, destW.y)
  );
  line.strokeColor = new scope.Color(accentHex);
  line.strokeWidth = 1.2 / zoom;
  overlayLayer.addChild(line);

  const stops = gradient.stops.length >= 2
    ? gradient.stops
    : normalizeGradientStops(gradient.stops);

  for (let i = 1; i < stops.length - 1; i += 1) {
    const stop = stops[i];
    const t = clamp(stop.offset, 0, 1);
    const pt = {
      x: originW.x + (destW.x - originW.x) * t,
      y: originW.y + (destW.y - originW.y) * t,
    };
    const dot = new scope.Path.Circle(new scope.Point(pt.x, pt.y), 4.5 / zoom);
    dot.fillColor = new scope.Color(stop.color);
    dot.strokeColor = new scope.Color(WHITE_HEX);
    dot.strokeWidth = 1.5 / zoom;
    dot.data = {
      gradientHandle: {
        target,
        kind: 'stop',
        stopIndex: i,
      } satisfies GradientHandleData,
    };
    overlayLayer.addChild(dot);
  }

  const endpoints: Array<{
    kind: 'start' | 'end';
    pt: Point2D;
    color: string;
  }> = [
    { kind: 'start', pt: originW, color: stops[0]?.color ?? '#da7756' },
    {
      kind: 'end',
      pt: destW,
      color: stops[stops.length - 1]?.color ?? '#2563eb',
    },
  ];

  for (const ep of endpoints) {
    const ring = new scope.Path.Circle(
      new scope.Point(ep.pt.x, ep.pt.y),
      6.8 / zoom
    );
    ring.fillColor = null;
    ring.strokeColor = new scope.Color(accentHex);
    ring.strokeWidth = strokeW;
    overlayLayer.addChild(ring);

    const handle = new scope.Path.Circle(
      new scope.Point(ep.pt.x, ep.pt.y),
      5.5 / zoom
    );
    handle.fillColor = new scope.Color(ep.color);
    handle.strokeColor = new scope.Color(WHITE_HEX);
    handle.strokeWidth = 1.8 / zoom;
    handle.data = {
      gradientHandle: {
        target,
        kind: ep.kind,
      } satisfies GradientHandleData,
    };
    overlayLayer.addChild(handle);
  }
}

function renderSelectOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  scene: Scene,
  selectedLayers: Layer[],
  draftOverrides: Map<string, Partial<Layer>> | undefined,
  zoom: number,
  accentHex: string,
  activeGradientTarget: 'fill' | 'stroke' = 'fill'
): void {
  if (selectedLayers.length === 0) return;

  const strokeW = 1 / zoom;
  const handleSize = 6.5 / zoom;
  const rotateOffset = 22 / zoom;
  const hasUnlocked = selectedLayers.some((l) => !l.locked);

  if (selectedLayers.length === 1) {
    const layer = selectedLayers[0];
    const { worldM } = getDraftMatrices(scene, layer.id, draftOverrides);
    const box = resolveOverlayLocalBBox(layer, scene.layers);
    const tl = applyMatrixToPoint(worldM, { x: box.x, y: box.y });
    const tr = applyMatrixToPoint(worldM, { x: box.x + box.width, y: box.y });
    const br = applyMatrixToPoint(worldM, {
      x: box.x + box.width,
      y: box.y + box.height,
    });
    const bl = applyMatrixToPoint(worldM, { x: box.x, y: box.y + box.height });
    const rotDeg = decomposeMatrix(worldM).rotation;

    const outline = new scope.Path({
      segments: [tl, tr, br, bl].map((p) => new scope.Point(p.x, p.y)),
      closed: true,
      applyMatrix: false,
    });
    outline.strokeColor = new scope.Color(accentHex);
    outline.strokeWidth = strokeW;
    overlayLayer.addChild(outline);

    if (layer.locked) return;

    const tm = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
    const rm = { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 };
    const bm = { x: (br.x + bl.x) / 2, y: (br.y + bl.y) / 2 };
    const lm = { x: (bl.x + tl.x) / 2, y: (bl.y + tl.y) / 2 };
    const center = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };

    let upX = tm.x - center.x;
    let upY = tm.y - center.y;
    const upLen = Math.hypot(upX, upY);
    if (upLen > 1e-6) {
      upX /= upLen;
      upY /= upLen;
    } else {
      const rad = (rotDeg * Math.PI) / 180;
      upX = Math.sin(rad);
      upY = -Math.cos(rad);
    }

    const rotPt = {
      x: tm.x + upX * rotateOffset,
      y: tm.y + upY * rotateOffset,
    };

    const stem = new scope.Path.Line(
      new scope.Point(tm.x, tm.y),
      new scope.Point(rotPt.x, rotPt.y)
    );
    stem.strokeColor = new scope.Color(accentHex);
    stem.strokeWidth = strokeW;
    overlayLayer.addChild(stem);

    const rotHandle = new scope.Path.Circle(
      new scope.Point(rotPt.x, rotPt.y),
      4 / zoom
    );
    rotHandle.fillColor = new scope.Color(WHITE_HEX);
    rotHandle.strokeColor = new scope.Color(accentHex);
    rotHandle.strokeWidth = strokeW;
    rotHandle.data = { selectHandle: 'rotate' satisfies SelectHandleId };
    overlayLayer.addChild(rotHandle);

    const handles: Array<{ id: SelectHandleId; pt: Point2D }> = [
      { id: 'nw', pt: tl },
      { id: 'n', pt: tm },
      { id: 'ne', pt: tr },
      { id: 'e', pt: rm },
      { id: 'se', pt: br },
      { id: 's', pt: bm },
      { id: 'sw', pt: bl },
      { id: 'w', pt: lm },
    ];

    for (const h of handles) {
      drawHandleSquare(
        scope,
        overlayLayer,
        h.pt,
        handleSize,
        rotDeg,
        strokeW,
        WHITE_HEX,
        accentHex,
        { selectHandle: h.id }
      );
    }

    const activeGrad = resolveEditableGradient(layer, activeGradientTarget);
    if (activeGrad) {
      renderGradientOverlay(
        scope,
        overlayLayer,
        layer,
        scene.layers,
        worldM,
        activeGrad.target,
        activeGrad.gradient,
        zoom,
        accentHex
      );
    }

    if (layer.type === 'text' && layer.pathId) {
      const hostPath = resolveHostPathLayer(scene.layers, layer.pathId);
      if (hostPath) {
        const hostM = getDraftMatrices(scene, hostPath.id, draftOverrides).worldM;
        const hostItem = buildPaperPathFromSubPaths(
          scope,
          resolveEffectivePathGeometry(hostPath).subpaths,
          hostPath.fillRule
        );
        applyPaperMatrix(scope, hostItem, hostM);
        hostItem.fillColor = null;
        hostItem.strokeColor = new scope.Color(accentHex);
        hostItem.strokeWidth = 1 / zoom;
        hostItem.dashArray = [4 / zoom, 3 / zoom];
        overlayLayer.addChild(hostItem);
      }
    }
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of selectedLayers) {
    const { parentM } = getDraftMatrices(scene, layer.id, draftOverrides);
    const b = resolveOverlayWorldBBox(layer, parentM, scene.layers);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  const bbox =
    minX === Infinity
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const tl = { x: bbox.x, y: bbox.y };
  const tr = { x: bbox.x + bbox.width, y: bbox.y };
  const br = { x: bbox.x + bbox.width, y: bbox.y + bbox.height };
  const bl = { x: bbox.x, y: bbox.y + bbox.height };
  const tm = { x: bbox.x + bbox.width / 2, y: bbox.y };
  const rm = { x: bbox.x + bbox.width, y: bbox.y + bbox.height / 2 };
  const bm = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height };
  const lm = { x: bbox.x, y: bbox.y + bbox.height / 2 };

  const rect = new scope.Path.Rectangle(
    new scope.Rectangle(bbox.x, bbox.y, bbox.width, bbox.height)
  );
  rect.strokeColor = new scope.Color(accentHex);
  rect.strokeWidth = strokeW;
  overlayLayer.addChild(rect);

  if (!hasUnlocked) return;

  const rotPt = { x: tm.x, y: tm.y - rotateOffset };
  const stem = new scope.Path.Line(
    new scope.Point(tm.x, tm.y),
    new scope.Point(rotPt.x, rotPt.y)
  );
  stem.strokeColor = new scope.Color(accentHex);
  stem.strokeWidth = strokeW;
  overlayLayer.addChild(stem);

  const rotHandle = new scope.Path.Circle(
    new scope.Point(rotPt.x, rotPt.y),
    4 / zoom
  );
  rotHandle.fillColor = new scope.Color(WHITE_HEX);
  rotHandle.strokeColor = new scope.Color(accentHex);
  rotHandle.strokeWidth = strokeW;
  rotHandle.data = { selectHandle: 'rotate' satisfies SelectHandleId };
  overlayLayer.addChild(rotHandle);

  const handles: Array<{ id: SelectHandleId; pt: Point2D }> = [
    { id: 'nw', pt: tl },
    { id: 'n', pt: tm },
    { id: 'ne', pt: tr },
    { id: 'e', pt: rm },
    { id: 'se', pt: br },
    { id: 's', pt: bm },
    { id: 'sw', pt: bl },
    { id: 'w', pt: lm },
  ];

  for (const h of handles) {
    drawHandleSquare(
      scope,
      overlayLayer,
      h.pt,
      handleSize,
      0,
      strokeW,
      WHITE_HEX,
      accentHex,
      { selectHandle: h.id }
    );
  }
}

function renderNodeOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  layer: PathLayer,
  worldM: Matrix2D,
  selectedNode: SelectedNodeRef | null,
  zoom: number,
  accentHex: string
): void {
  const strokeW = 1 / zoom;
  const anchorSize = 6.5 / zoom;
  const handleRadius = 3.5 / zoom;

  layer.subpaths.forEach((sp, subpathIndex) => {
    const worldSegments = sp.anchors.map((anchor) => {
      const wPt = applyMatrixToPoint(worldM, { x: anchor.x, y: anchor.y });
      const wIn = applyMatrixToVector(worldM, anchor.handleIn);
      const wOut = applyMatrixToVector(worldM, anchor.handleOut);
      return new scope.Segment(
        new scope.Point(wPt.x, wPt.y),
        new scope.Point(wIn.x, wIn.y),
        new scope.Point(wOut.x, wOut.y)
      );
    });

    const outline = new scope.Path({
      segments: worldSegments,
      closed: sp.closed,
      applyMatrix: false,
    });
    outline.strokeColor = new scope.Color(accentHex);
    outline.strokeWidth = strokeW;
    overlayLayer.addChild(outline);

    sp.anchors.forEach((anchor, anchorIndex) => {
      const wPt = applyMatrixToPoint(worldM, { x: anchor.x, y: anchor.y });
      const wIn = applyMatrixToVector(worldM, anchor.handleIn);
      const wOut = applyMatrixToVector(worldM, anchor.handleOut);
      const isSelected =
        selectedNode?.layerId === layer.id &&
        selectedNode.subpathIndex === subpathIndex &&
        selectedNode.anchorIndex === anchorIndex;

      const showIn =
        isSelected || Math.hypot(anchor.handleIn.x, anchor.handleIn.y) > 0.5;
      const showOut =
        isSelected || Math.hypot(anchor.handleOut.x, anchor.handleOut.y) > 0.5;

      if (showIn && Math.hypot(wIn.x, wIn.y) > 1e-4) {
        const pIn = { x: wPt.x + wIn.x, y: wPt.y + wIn.y };
        const line = new scope.Path.Line(
          new scope.Point(wPt.x, wPt.y),
          new scope.Point(pIn.x, pIn.y)
        );
        line.strokeColor = new scope.Color(accentHex);
        line.strokeWidth = strokeW;
        overlayLayer.addChild(line);

        const dot = new scope.Path.Circle(
          new scope.Point(pIn.x, pIn.y),
          handleRadius
        );
        dot.fillColor = new scope.Color(WHITE_HEX);
        dot.strokeColor = new scope.Color(accentHex);
        dot.strokeWidth = strokeW;
        dot.data = {
          nodeHit: 'handleIn',
          layerId: layer.id,
          subpathIndex,
          anchorIndex,
        };
        overlayLayer.addChild(dot);
      }

      if (showOut && Math.hypot(wOut.x, wOut.y) > 1e-4) {
        const pOut = { x: wPt.x + wOut.x, y: wPt.y + wOut.y };
        const line = new scope.Path.Line(
          new scope.Point(wPt.x, wPt.y),
          new scope.Point(pOut.x, pOut.y)
        );
        line.strokeColor = new scope.Color(accentHex);
        line.strokeWidth = strokeW;
        overlayLayer.addChild(line);

        const dot = new scope.Path.Circle(
          new scope.Point(pOut.x, pOut.y),
          handleRadius
        );
        dot.fillColor = new scope.Color(WHITE_HEX);
        dot.strokeColor = new scope.Color(accentHex);
        dot.strokeWidth = strokeW;
        dot.data = {
          nodeHit: 'handleOut',
          layerId: layer.id,
          subpathIndex,
          anchorIndex,
        };
        overlayLayer.addChild(dot);
      }

      drawHandleSquare(
        scope,
        overlayLayer,
        wPt,
        anchorSize,
        0,
        strokeW,
        isSelected ? accentHex : WHITE_HEX,
        accentHex,
        {
          nodeHit: 'anchor',
          layerId: layer.id,
          subpathIndex,
          anchorIndex,
        }
      );
    });
  });
}

function renderPenDraftOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  penDraft: PenDraftOverlay,
  zoom: number,
  accentHex: string
): void {
  const { anchors, hoverPoint, isClosingHover } = penDraft;
  if (anchors.length === 0) return;

  const strokeW = 1 / zoom;
  const anchorSize = 6.5 / zoom;
  const handleRadius = 3.5 / zoom;

  const path = new scope.Path({
    segments: anchors.map(
      (a) =>
        new scope.Segment(
          new scope.Point(a.x, a.y),
          new scope.Point(a.handleIn.x, a.handleIn.y),
          new scope.Point(a.handleOut.x, a.handleOut.y)
        )
    ),
    closed: false,
    applyMatrix: false,
  });
  path.strokeColor = new scope.Color(accentHex);
  path.strokeWidth = strokeW;
  overlayLayer.addChild(path);

  if (hoverPoint) {
    const last = anchors[anchors.length - 1];
    const target = isClosingHover && anchors.length >= 2 ? anchors[0] : hoverPoint;
    const preview = new scope.Path({
      segments: [
        new scope.Segment(
          new scope.Point(last.x, last.y),
          new scope.Point(0, 0),
          new scope.Point(last.handleOut.x, last.handleOut.y)
        ),
        new scope.Segment(
          new scope.Point(target.x, target.y),
          isClosingHover ? new scope.Point(anchors[0].handleIn.x, anchors[0].handleIn.y) : new scope.Point(0, 0),
          new scope.Point(0, 0)
        ),
      ],
      applyMatrix: false,
    });
    preview.strokeColor = new scope.Color(accentHex);
    preview.strokeWidth = strokeW;
    preview.dashArray = [4 / zoom, 4 / zoom];
    overlayLayer.addChild(preview);
  }

  anchors.forEach((anchor, index) => {
    const isLast = index === anchors.length - 1;
    if (isLast) {
      if (Math.hypot(anchor.handleIn.x, anchor.handleIn.y) > 0.5) {
        const pIn = { x: anchor.x + anchor.handleIn.x, y: anchor.y + anchor.handleIn.y };
        const lIn = new scope.Path.Line(
          new scope.Point(anchor.x, anchor.y),
          new scope.Point(pIn.x, pIn.y)
        );
        lIn.strokeColor = new scope.Color(accentHex);
        lIn.strokeWidth = strokeW;
        overlayLayer.addChild(lIn);

        const dIn = new scope.Path.Circle(new scope.Point(pIn.x, pIn.y), handleRadius);
        dIn.fillColor = new scope.Color(WHITE_HEX);
        dIn.strokeColor = new scope.Color(accentHex);
        dIn.strokeWidth = strokeW;
        overlayLayer.addChild(dIn);
      }
      if (Math.hypot(anchor.handleOut.x, anchor.handleOut.y) > 0.5) {
        const pOut = { x: anchor.x + anchor.handleOut.x, y: anchor.y + anchor.handleOut.y };
        const lOut = new scope.Path.Line(
          new scope.Point(anchor.x, anchor.y),
          new scope.Point(pOut.x, pOut.y)
        );
        lOut.strokeColor = new scope.Color(accentHex);
        lOut.strokeWidth = strokeW;
        overlayLayer.addChild(lOut);

        const dOut = new scope.Path.Circle(new scope.Point(pOut.x, pOut.y), handleRadius);
        dOut.fillColor = new scope.Color(WHITE_HEX);
        dOut.strokeColor = new scope.Color(accentHex);
        dOut.strokeWidth = strokeW;
        overlayLayer.addChild(dOut);
      }
    }

    drawHandleSquare(
      scope,
      overlayLayer,
      { x: anchor.x, y: anchor.y },
      anchorSize,
      0,
      strokeW,
      isLast ? accentHex : WHITE_HEX,
      accentHex,
      {}
    );
  });

  if (isClosingHover && anchors.length >= 2) {
    const ring = new scope.Path.Circle(
      new scope.Point(anchors[0].x, anchors[0].y),
      6.5 / zoom
    );
    ring.strokeColor = new scope.Color(accentHex);
    ring.strokeWidth = 1.5 / zoom;
    overlayLayer.addChild(ring);
  }
}

export function renderOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  state: OverlayRenderState
): void {
  scope.activate();
  overlayLayer.activate();
  overlayLayer.removeChildren();

  const zoom = Math.max(0.05, scope.view.zoom);
  const accentHex = state.accentColor || DEFAULT_ACCENT_HEX;

  if (state.grid) {
    renderGridOverlay(scope, overlayLayer, state.scene, state.grid, zoom);
  }
  renderManualGuidesOverlay(scope, overlayLayer, state, zoom);

  const allLayers = flattenLayers(state.scene.layers);
  const selectedSet = new Set(state.selectedIds);
  const selectedLayers = state.selectedIds
    .map((id) => findLayerById(state.scene.layers, id))
    .filter((l): l is Layer => l !== null)
    .map((l) => applyDraftLayer(l, state.draftOverrides));

  const layersById = new Map(allLayers.map((l) => [l.id, l]));
  const activeMaskIds = new Set<string>();
  for (const layer of allLayers) {
    if (layer.type === 'path' && layer.isClipMask) {
      activeMaskIds.add(layer.id);
    }
    if (layer.clipMaskId && layersById.get(layer.clipMaskId)?.type === 'path') {
      activeMaskIds.add(layer.clipMaskId);
    }
  }

  for (const maskId of activeMaskIds) {
    if (!selectedSet.has(maskId) && state.hoveredMaskId !== maskId) {
      continue;
    }
    const rawMask = layersById.get(maskId);
    if (!rawMask || rawMask.type !== 'path') continue;
    const mask = applyDraftLayer(rawMask, state.draftOverrides) as PathLayer;
    const { worldM } = getDraftMatrices(state.scene, mask.id, state.draftOverrides);
    const outline = buildPaperPathFromSubPaths(scope, mask.subpaths, mask.fillRule);
    applyPaperMatrix(scope, outline, worldM);
    outline.fillColor = null;
    outline.strokeColor = new scope.Color(accentHex);
    outline.strokeWidth = 1 / zoom;
    if (!selectedSet.has(maskId)) {
      outline.dashArray = [4 / zoom, 3 / zoom];
    }
    overlayLayer.addChild(outline);
  }

  if (state.activeTool === 'select') {
    renderSelectOverlay(
      scope,
      overlayLayer,
      state.scene,
      selectedLayers,
      state.draftOverrides,
      zoom,
      accentHex,
      state.activeGradientTarget ?? 'fill'
    );
  } else if (state.activeTool === 'node') {
    const nodeTarget =
      (state.selectedNode
        ? selectedLayers.find(
            (l): l is PathLayer =>
              l.type === 'path' && l.id === state.selectedNode?.layerId
          )
        : undefined) ??
      selectedLayers.find((l): l is PathLayer => l.type === 'path');

    if (nodeTarget && !nodeTarget.locked) {
      const { worldM } = getDraftMatrices(
        state.scene,
        nodeTarget.id,
        state.draftOverrides
      );
      renderNodeOverlay(
        scope,
        overlayLayer,
        nodeTarget,
        worldM,
        state.selectedNode,
        zoom,
        accentHex
      );
    } else if (nodeTarget) {
      renderSelectOverlay(
        scope,
        overlayLayer,
        state.scene,
        [nodeTarget],
        state.draftOverrides,
        zoom,
        accentHex
      );
    }
  } else if (state.activeTool === 'pen' && state.penDraft) {
    renderPenDraftOverlay(scope, overlayLayer, state.penDraft, zoom, accentHex);
  } else if (state.activeTool === 'blob' && state.shapeDraft) {
    const { x, y, subpaths, fill, stroke } = state.shapeDraft;
    const preview = buildPaperPathFromSubPaths(scope, subpaths, 'nonzero');
    applyLayerMatrixToItem(scope, preview, {
      x,
      y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    });
    const draftBox = computeSubPathsBBox(subpaths);
    preview.fillColor = toPaperColor(scope, clonePaint(fill), draftBox);
    if (stroke && stroke.width > 0) {
      preview.strokeColor = toPaperColor(scope, clonePaint(stroke.color), draftBox);
      preview.strokeWidth = stroke.width;
      preview.dashArray = sanitizeDashArray(stroke.dashArray) ?? [];
      preview.dashOffset = stroke.dashOffset ?? 0;
    } else {
      preview.strokeColor = new scope.Color(accentHex);
      preview.strokeWidth = 1 / zoom;
    }
    overlayLayer.addChild(preview);
  } else if (state.activeTool === 'shapeBuilder' && state.shapeBuilder) {
    const { regions, hoveredRegionId, activeRegionIds, trail, mode, scopeMatrix } =
      state.shapeBuilder;
    const activeSet = new Set(activeRegionIds);
    const rgb = hexToRgb(mode === 'erase' ? '#dc2626' : accentHex) ?? {
      r: 218,
      g: 119,
      b: 86,
    };
    const strokeHex = mode === 'erase' ? '#dc2626' : accentHex;

    for (const region of regions) {
      const isSelected = activeSet.has(region.id);
      const isHovered = hoveredRegionId === region.id;
      const item = buildPaperPathFromSubPaths(
        scope,
        region.subpaths,
        region.fillRule
      );
      const regionM = multiplyMatrices(scopeMatrix, {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        tx: region.x,
        ty: region.y,
      });
      applyPaperMatrix(scope, item, regionM);
      item.strokeColor = new scope.Color(
        isSelected || isHovered ? strokeHex : accentHex
      );
      item.strokeWidth = (isSelected || isHovered ? 1.5 : 0.9) / zoom;
      if (!isSelected && !isHovered) {
        item.dashArray = [3 / zoom, 3 / zoom];
        item.opacity = 0.55;
      }
      if (isSelected) {
        item.fillColor = new scope.Color(rgb.r / 255, rgb.g / 255, rgb.b / 255, 0.3);
      } else if (isHovered) {
        item.fillColor = new scope.Color(rgb.r / 255, rgb.g / 255, rgb.b / 255, 0.16);
      } else {
        item.fillColor = null;
      }
      overlayLayer.addChild(item);
    }

    if (trail.length >= 2) {
      const trailPath = new scope.Path({
        segments: trail.map((p) => new scope.Point(p.x, p.y)),
        closed: false,
        applyMatrix: false,
      });
      trailPath.strokeColor = new scope.Color(strokeHex);
      trailPath.strokeWidth = 2 / zoom;
      trailPath.dashArray = [4 / zoom, 3 / zoom];
      overlayLayer.addChild(trailPath);
    }
  } else if (
    (state.activeTool === 'pencil' || state.activeTool === 'knife') &&
    state.freehandDraft &&
    state.freehandDraft.points.length >= 2
  ) {
    const draft = state.freehandDraft;
    const isKnife = draft.mode === 'knife';
    const path = new scope.Path({
      segments: draft.points.map((p) => new scope.Point(p.x, p.y)),
      closed: false,
      applyMatrix: false,
    });
    path.strokeColor = new scope.Color(isKnife ? '#dc2626' : accentHex);
    path.strokeWidth = 1.6 / zoom;
    path.strokeCap = 'round';
    path.strokeJoin = 'round';
    if (isKnife) {
      path.dashArray = [5 / zoom, 4 / zoom];
    }
    overlayLayer.addChild(path);

    if (!isKnife && draft.closedHover) {
      const ring = new scope.Path.Circle(
        new scope.Point(draft.points[0].x, draft.points[0].y),
        6 / zoom
      );
      ring.strokeColor = new scope.Color(accentHex);
      ring.strokeWidth = 1.5 / zoom;
      overlayLayer.addChild(ring);
    }
  }

  if (state.guides && state.guides.length > 0) {
    renderSmartGuidesOverlay(scope, overlayLayer, state.guides, accentHex, zoom);
  }

  if (state.marquee) {
    const { x, y, width, height } = state.marquee;
    const marqueeRect = new scope.Path.Rectangle(
      new scope.Rectangle(x, y, width, height)
    );
    marqueeRect.strokeColor = new scope.Color(accentHex);
    marqueeRect.strokeWidth = 1 / zoom;
    const rgb = hexToRgb(accentHex) ?? { r: 218, g: 119, b: 86 };
    marqueeRect.fillColor = new scope.Color(
      rgb.r / 255,
      rgb.g / 255,
      rgb.b / 255,
      0.08
    );
    overlayLayer.addChild(marqueeRect);
  }
}
