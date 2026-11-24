import {
  computeCombinedWorldBBox,
  computeLayerLocalBBox,
  localToWorld,
  localVectorToWorld,
} from '../core/math';
import { hexToRgb } from '../core/themes';
import type {
  AnchorPoint,
  Layer,
  PathLayer,
  Point2D,
  Scene,
  SelectedNodeRef,
  StrokeStyle,
  SubPath,
  ToolType,
} from '../core/types';
import type { SmartGuideLine } from './snapping';
import { applyLayerMatrixToItem, buildPaperPathFromSubPaths } from './sync';

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
  fill: string | null;
  stroke: StrokeStyle | null;
}

export interface OverlayRenderState {
  scene: Scene;
  selectedIds: string[];
  selectedNode: SelectedNodeRef | null;
  activeTool: ToolType;
  draftOverrides?: Map<string, Partial<Layer>>;
  marquee?: MarqueeOverlay | null;
  penDraft?: PenDraftOverlay | null;
  shapeDraft?: ShapeDraftOverlay | null;
  hoveredMaskId?: string | null;
  accentColor?: string;
  grid?: { show: boolean; size: number; opacity: number };
  guides?: SmartGuideLine[] | null;
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

function renderGridOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  scene: Scene,
  grid: { show: boolean; size: number; opacity: number },
  zoom: number
): void {
  if (!grid.show || scene.width <= 0 || scene.height <= 0) return;

  let step = Math.max(4, grid.size);
  while (step * zoom < 8) {
    step *= 2;
  }

  const children: paper.Path[] = [];
  for (let x = step; x < scene.width; x += step) {
    children.push(
      new scope.Path.Line(new scope.Point(x, 0), new scope.Point(x, scene.height))
    );
  }
  for (let y = step; y < scene.height; y += step) {
    children.push(
      new scope.Path.Line(new scope.Point(0, y), new scope.Point(scene.width, y))
    );
  }
  if (children.length === 0) return;

  const compound = new scope.CompoundPath({
    children,
    applyMatrix: false,
  });
  compound.strokeColor = getGridLineColor(scope, scene.background, grid.opacity);
  compound.strokeWidth = 1 / zoom;
  overlayLayer.addChild(compound);
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

function renderSelectOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  selectedLayers: Layer[],
  zoom: number,
  accentHex: string
): void {
  if (selectedLayers.length === 0) return;

  const strokeW = 1 / zoom;
  const handleSize = 6.5 / zoom;
  const rotateOffset = 22 / zoom;
  const hasUnlocked = selectedLayers.some((l) => !l.locked);

  if (selectedLayers.length === 1) {
    const layer = selectedLayers[0];
    const box = computeLayerLocalBBox(layer);
    const tl = localToWorld(layer, { x: box.x, y: box.y });
    const tr = localToWorld(layer, { x: box.x + box.width, y: box.y });
    const br = localToWorld(layer, {
      x: box.x + box.width,
      y: box.y + box.height,
    });
    const bl = localToWorld(layer, { x: box.x, y: box.y + box.height });

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
      const rad = (layer.rotation * Math.PI) / 180;
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
        layer.rotation,
        strokeW,
        WHITE_HEX,
        accentHex,
        { selectHandle: h.id }
      );
    }
    return;
  }

  const bbox = computeCombinedWorldBBox(selectedLayers);
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
  selectedNode: SelectedNodeRef | null,
  zoom: number,
  accentHex: string
): void {
  const strokeW = 1 / zoom;
  const anchorSize = 6.5 / zoom;
  const handleRadius = 3.5 / zoom;

  layer.subpaths.forEach((sp, subpathIndex) => {
    const worldSegments = sp.anchors.map((anchor) => {
      const wPt = localToWorld(layer, { x: anchor.x, y: anchor.y });
      const wIn = localVectorToWorld(layer, anchor.handleIn);
      const wOut = localVectorToWorld(layer, anchor.handleOut);
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
      const wPt = localToWorld(layer, { x: anchor.x, y: anchor.y });
      const wIn = localVectorToWorld(layer, anchor.handleIn);
      const wOut = localVectorToWorld(layer, anchor.handleOut);
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

  const selectedSet = new Set(state.selectedIds);
  const selectedLayers = state.scene.layers
    .filter((l) => selectedSet.has(l.id))
    .map((l) => applyDraftLayer(l, state.draftOverrides));

  const layersById = new Map(state.scene.layers.map((l) => [l.id, l]));
  const activeMaskIds = new Set<string>();
  for (const layer of state.scene.layers) {
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
    const outline = buildPaperPathFromSubPaths(scope, mask.subpaths, mask.fillRule);
    applyLayerMatrixToItem(scope, outline, mask);
    outline.fillColor = null;
    outline.strokeColor = new scope.Color(accentHex);
    outline.strokeWidth = 1 / zoom;
    if (!selectedSet.has(maskId)) {
      outline.dashArray = [4 / zoom, 3 / zoom];
    }
    overlayLayer.addChild(outline);
  }

  if (state.activeTool === 'select') {
    renderSelectOverlay(scope, overlayLayer, selectedLayers, zoom, accentHex);
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
      renderNodeOverlay(
        scope,
        overlayLayer,
        nodeTarget,
        state.selectedNode,
        zoom,
        accentHex
      );
    } else if (nodeTarget) {
      renderSelectOverlay(scope, overlayLayer, [nodeTarget], zoom, accentHex);
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
    preview.fillColor = fill ? new scope.Color(fill) : null;
    if (stroke && stroke.width > 0) {
      preview.strokeColor = new scope.Color(stroke.color);
      preview.strokeWidth = stroke.width;
    } else {
      preview.strokeColor = new scope.Color(accentHex);
      preview.strokeWidth = 1 / zoom;
    }
    overlayLayer.addChild(preview);
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
