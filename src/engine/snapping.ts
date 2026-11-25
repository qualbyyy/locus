import type { BBox, Guide, Point2D } from '../core/types';

export interface SmartGuideLine {
  orientation: 'vertical' | 'horizontal';
  pos: number;
  start: number;
  end: number;
}

export interface SnapOptions {
  snapToGrid: boolean;
  gridSize: number;
  snapToObjects: boolean;
  snapToArtboard: boolean;
  snapToGuides?: boolean;
  manualGuides?: Guide[];
  thresholdWorld: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SmartGuideLine[];
}

interface AxisTarget {
  pos: number;
  spanStart: number;
  spanEnd: number;
  isGrid?: boolean;
}

export function snapPointToGrid(point: Point2D, gridSize: number): Point2D {
  const step = Math.max(1, gridSize);
  return {
    x: Math.round(point.x / step) * step,
    y: Math.round(point.y / step) * step,
  };
}

function findBestAxisSnap(
  anchors: number[],
  targets: AxisTarget[],
  threshold: number
): { delta: number; snappedPos: number; matched: AxisTarget[] } | null {
  let bestDelta = 0;
  let bestAbs = threshold + 1e-6;
  let snappedPos = 0;
  let found = false;

  for (const anchor of anchors) {
    for (const target of targets) {
      const diff = target.pos - anchor;
      const absDiff = Math.abs(diff);
      if (absDiff <= threshold && absDiff < bestAbs) {
        bestAbs = absDiff;
        bestDelta = diff;
        snappedPos = target.pos;
        found = true;
      }
    }
  }

  if (!found) return null;

  const matched = targets.filter(
    (t) => !t.isGrid && Math.abs(t.pos - snappedPos) <= 1e-4
  );
  return { delta: bestDelta, snappedPos, matched };
}

function findGridAxisDelta(
  edges: number[],
  gridSize: number,
  threshold: number
): number | null {
  if (gridSize < 2) return null;
  let bestDelta: number | null = null;
  let bestAbs = threshold + 1e-6;

  for (const edge of edges) {
    const snapped = Math.round(edge / gridSize) * gridSize;
    const diff = snapped - edge;
    const absDiff = Math.abs(diff);
    if (absDiff <= threshold && absDiff < bestAbs) {
      bestAbs = absDiff;
      bestDelta = diff;
    }
  }
  return bestDelta;
}

export function snapBoundsMove(
  movingBox: BBox,
  otherBoxes: BBox[],
  artboard: { x?: number; y?: number; width: number; height: number },
  opts: SnapOptions
): SnapResult {
  const threshold = Math.max(0.5, opts.thresholdWorld);
  const abX = artboard.x ?? 0;
  const abY = artboard.y ?? 0;
  const xTargets: AxisTarget[] = [];
  const yTargets: AxisTarget[] = [];

  if (opts.snapToArtboard) {
    xTargets.push(
      { pos: abX, spanStart: abY, spanEnd: abY + artboard.height },
      { pos: abX + artboard.width / 2, spanStart: abY, spanEnd: abY + artboard.height },
      { pos: abX + artboard.width, spanStart: abY, spanEnd: abY + artboard.height }
    );
    yTargets.push(
      { pos: abY, spanStart: abX, spanEnd: abX + artboard.width },
      { pos: abY + artboard.height / 2, spanStart: abX, spanEnd: abX + artboard.width },
      { pos: abY + artboard.height, spanStart: abX, spanEnd: abX + artboard.width }
    );
  }

  if (opts.snapToObjects) {
    for (const box of otherBoxes) {
      xTargets.push(
        { pos: box.x, spanStart: box.y, spanEnd: box.y + box.height },
        { pos: box.x + box.width / 2, spanStart: box.y, spanEnd: box.y + box.height },
        { pos: box.x + box.width, spanStart: box.y, spanEnd: box.y + box.height }
      );
      yTargets.push(
        { pos: box.y, spanStart: box.x, spanEnd: box.x + box.width },
        { pos: box.y + box.height / 2, spanStart: box.x, spanEnd: box.x + box.width },
        { pos: box.y + box.height, spanStart: box.x, spanEnd: box.x + box.width }
      );
    }
  }

  if (opts.snapToGuides && opts.manualGuides && opts.manualGuides.length > 0) {
    const spanXStart = Math.min(movingBox.x, abX) - 200;
    const spanXEnd = Math.max(movingBox.x + movingBox.width, abX + artboard.width) + 200;
    const spanYStart = Math.min(movingBox.y, abY) - 200;
    const spanYEnd = Math.max(movingBox.y + movingBox.height, abY + artboard.height) + 200;
    for (const guide of opts.manualGuides) {
      if (guide.orientation === 'vertical') {
        xTargets.push({
          pos: guide.position,
          spanStart: spanYStart,
          spanEnd: spanYEnd,
        });
      } else {
        yTargets.push({
          pos: guide.position,
          spanStart: spanXStart,
          spanEnd: spanXEnd,
        });
      }
    }
  }

  const xAnchors = [
    movingBox.x,
    movingBox.x + movingBox.width / 2,
    movingBox.x + movingBox.width,
  ];
  const yAnchors = [
    movingBox.y,
    movingBox.y + movingBox.height / 2,
    movingBox.y + movingBox.height,
  ];

  const snapX = findBestAxisSnap(xAnchors, xTargets, threshold);
  const snapY = findBestAxisSnap(yAnchors, yTargets, threshold);

  let dx = snapX ? snapX.delta : 0;
  let dy = snapY ? snapY.delta : 0;

  if (!snapX && opts.snapToGrid) {
    const gridDx = findGridAxisDelta(
      [movingBox.x, movingBox.x + movingBox.width],
      opts.gridSize,
      threshold
    );
    if (gridDx !== null) dx = gridDx;
  }

  if (!snapY && opts.snapToGrid) {
    const gridDy = findGridAxisDelta(
      [movingBox.y, movingBox.y + movingBox.height],
      opts.gridSize,
      threshold
    );
    if (gridDy !== null) dy = gridDy;
  }

  const snappedY0 = movingBox.y + dy;
  const snappedY1 = snappedY0 + movingBox.height;
  const snappedX0 = movingBox.x + dx;
  const snappedX1 = snappedX0 + movingBox.width;

  const guides: SmartGuideLine[] = [];

  if (snapX && snapX.matched.length > 0) {
    let minStart = snappedY0;
    let maxEnd = snappedY1;
    for (const t of snapX.matched) {
      if (t.spanStart < minStart) minStart = t.spanStart;
      if (t.spanEnd > maxEnd) maxEnd = t.spanEnd;
    }
    guides.push({
      orientation: 'vertical',
      pos: snapX.snappedPos,
      start: minStart,
      end: maxEnd,
    });
  }

  if (snapY && snapY.matched.length > 0) {
    let minStart = snappedX0;
    let maxEnd = snappedX1;
    for (const t of snapY.matched) {
      if (t.spanStart < minStart) minStart = t.spanStart;
      if (t.spanEnd > maxEnd) maxEnd = t.spanEnd;
    }
    guides.push({
      orientation: 'horizontal',
      pos: snapY.snappedPos,
      start: minStart,
      end: maxEnd,
    });
  }

  return { dx, dy, guides };
}
