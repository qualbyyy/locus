import {
  applyMatrixToPoint,
  applyMatrixToVector,
  computeSubPathsBBox,
  multiplyMatrices,
  type Matrix2D,
} from '../../core/math';
import { clonePaint, sanitizeDashArray } from '../../core/paint';
import { hexToRgb } from '../../core/themes';
import type { PathLayer, SelectedNodeRef } from '../../core/types';
import {
  applyLayerMatrixToItem,
  buildPaperPathFromSubPaths,
  toPaperColor,
} from '../sync';
import {
  type FreehandDraftOverlay,
  type PenDraftOverlay,
  type ShapeBuilderOverlay,
  type ShapeDraftOverlay,
  WHITE_HEX,
  applyPaperMatrix,
  drawHandleSquare,
} from './shared';

export function renderNodeOverlay(
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

export function renderPenDraftOverlay(
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
          isClosingHover
            ? new scope.Point(anchors[0].handleIn.x, anchors[0].handleIn.y)
            : new scope.Point(0, 0),
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

export function renderShapeDraftOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  shapeDraft: ShapeDraftOverlay,
  zoom: number,
  accentHex: string
): void {
  const { x, y, subpaths, fill, stroke } = shapeDraft;
  const preview = buildPaperPathFromSubPaths(scope, subpaths, 'nonzero');
  applyLayerMatrixToItem(scope, preview, {
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  });
  const draftBox = computeSubPathsBBox(subpaths);
  const draftMatrix: Matrix2D = { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y };
  preview.fillColor = toPaperColor(scope, clonePaint(fill), draftBox, draftMatrix);
  if (stroke && stroke.width > 0) {
    preview.strokeColor = toPaperColor(
      scope,
      clonePaint(stroke.color),
      draftBox,
      draftMatrix
    );
    preview.strokeWidth = stroke.width;
    preview.dashArray = sanitizeDashArray(stroke.dashArray) ?? [];
    preview.dashOffset = stroke.dashOffset ?? 0;
  } else {
    preview.strokeColor = new scope.Color(accentHex);
    preview.strokeWidth = 1 / zoom;
  }
  overlayLayer.addChild(preview);
}

export function renderShapeBuilderOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  shapeBuilder: ShapeBuilderOverlay,
  zoom: number,
  accentHex: string
): void {
  const { regions, hoveredRegionId, activeRegionIds, trail, mode, scopeMatrix } =
    shapeBuilder;
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
}

export function renderFreehandDraftOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  draft: FreehandDraftOverlay,
  zoom: number,
  accentHex: string
): void {
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
