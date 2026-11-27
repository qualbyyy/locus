import paper from 'paper/dist/paper-core';
import {
  IDENTITY_MATRIX,
  applyMatrixToPoint,
  applyMatrixToVector,
  centerSubPathsAtOrigin,
  computeSubPathsBBox,
  getLayerMatrix,
  multiplyMatrices,
  type Matrix2D,
} from '../core/math';
import { getParentWorldMatrix } from '../core/layerTree';
import { getPrimaryColor, sanitizeDashArray } from '../core/paint';
import type { AnchorPoint, Layer, PathLayer, SubPath } from '../core/types';

export type BooleanOp =
  | 'unite'
  | 'subtract'
  | 'intersect'
  | 'exclude'
  | 'divide';

export interface BooleanResult {
  x: number;
  y: number;
  subpaths: SubPath[];
  fillRule: 'nonzero' | 'evenodd';
}

export function withHeadlessProject<T>(
  fn: (scope: paper.PaperScope) => T
): T {
  const scopes = (
    paper.PaperScope as unknown as {
      _scopes?: Record<string, paper.PaperScope>;
    }
  )?._scopes;
  const fallbackScope = scopes
    ? Object.values(scopes).find((s) => Boolean(s.project))
    : undefined;
  const scope = new paper.PaperScope();
  scope.settings.applyMatrix = false;
  scope.settings.insertItems = false;
  new scope.Project(undefined as unknown as HTMLCanvasElement);
  try {
    return fn(scope);
  } finally {
    scope.remove();
    if (fallbackScope && fallbackScope.project) {
      fallbackScope.activate();
    } else {
      paper.activate();
    }
  }
}

function isCollinearOpposite(
  inX: number,
  inY: number,
  outX: number,
  outY: number
): boolean {
  const lenIn = Math.hypot(inX, inY);
  const lenOut = Math.hypot(outX, outY);
  if (lenIn <= 1e-3 || lenOut <= 1e-3) {
    return false;
  }
  const dot = (inX * outX + inY * outY) / (lenIn * lenOut);
  return dot < -0.995;
}

export function buildWorldSubPath(
  scope: paper.PaperScope,
  layer: Pick<PathLayer, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'>,
  sp: SubPath,
  forceClosed: boolean,
  parentMatrix: Matrix2D = IDENTITY_MATRIX
): paper.Path | null {
  if (sp.anchors.length < 2) return null;
  const worldM = multiplyMatrices(parentMatrix, getLayerMatrix(layer));
  const segments = sp.anchors.map((anchor) => {
    const wPt = applyMatrixToPoint(worldM, { x: anchor.x, y: anchor.y });
    const wIn = applyMatrixToVector(worldM, anchor.handleIn);
    const wOut = applyMatrixToVector(worldM, anchor.handleOut);
    return new scope.Segment(
      new scope.Point(wPt.x, wPt.y),
      new scope.Point(wIn.x, wIn.y),
      new scope.Point(wOut.x, wOut.y)
    );
  });

  return new scope.Path({
    segments,
    closed: forceClosed ? true : sp.closed,
    applyMatrix: false,
    insert: false,
  });
}

export function buildWorldPathItem(
  scope: paper.PaperScope,
  layer: PathLayer,
  forceClosed = true,
  parentMatrix: Matrix2D = IDENTITY_MATRIX
): paper.PathItem | null {
  const paths: paper.Path[] = [];

  for (const sp of layer.subpaths) {
    const path = buildWorldSubPath(scope, layer, sp, forceClosed, parentMatrix);
    if (path) paths.push(path);
  }

  if (paths.length === 0) {
    return null;
  }

  if (paths.length === 1) {
    paths[0].fillRule = layer.fillRule;
    return paths[0];
  }

  const compound = new scope.CompoundPath({
    children: paths,
    fillRule: layer.fillRule,
    applyMatrix: false,
    insert: false,
  });
  if (paths.every((p) => p.closed)) {
    compound.reorient(false, true);
  }
  return compound;
}

export function extractSubPath(path: paper.Path): SubPath | null {
  if (path.segments.length < 2) {
    return null;
  }

  const anchors: AnchorPoint[] = path.segments.map((seg) => {
    const inX = seg.handleIn.x;
    const inY = seg.handleIn.y;
    const outX = seg.handleOut.x;
    const outY = seg.handleOut.y;
    return {
      x: seg.point.x,
      y: seg.point.y,
      handleIn: { x: inX, y: inY },
      handleOut: { x: outX, y: outY },
      smooth: isCollinearOpposite(inX, inY, outX, outY),
    };
  });

  return {
    closed: path.closed,
    anchors,
  };
}

export function extractSubPathsFromItem(
  scope: paper.PaperScope,
  item: paper.PathItem
): SubPath[] {
  if (item instanceof scope.Path) {
    const sp = extractSubPath(item);
    return sp ? [sp] : [];
  }

  if (item instanceof scope.CompoundPath) {
    const out: SubPath[] = [];
    for (const child of item.children) {
      if (child instanceof scope.Path) {
        const sp = extractSubPath(child);
        if (sp) out.push(sp);
      }
    }
    return out;
  }

  return [];
}

export function normalizeResult(
  worldSubpaths: SubPath[],
  fillRule?: 'nonzero' | 'evenodd'
): BooleanResult | null {
  if (worldSubpaths.length === 0) {
    return null;
  }
  const bbox = computeSubPathsBBox(worldSubpaths);
  if (bbox.width <= 1e-4 && bbox.height <= 1e-4) {
    return null;
  }
  const { subpaths, offset } = centerSubPathsAtOrigin(worldSubpaths);
  return {
    x: offset.x,
    y: offset.y,
    subpaths,
    fillRule: fillRule ?? (subpaths.length > 1 ? 'evenodd' : 'nonzero'),
  };
}

function getProbePoint(path: paper.Path): paper.Point {
  try {
    if (path.closed && Math.abs(path.area) > 1e-4 && path.interiorPoint) {
      return path.interiorPoint;
    }
  } catch {
    // Fallback to first segment point
  }
  return path.segments[0].point;
}

function splitPathObjectsIntoIslands(paths: paper.Path[]): paper.Path[][] {
  const valid = paths.filter((p) => p.segments.length >= 2);
  if (valid.length === 0) return [];

  const containers = new Map<number, number[]>();
  const depths = new Array<number>(valid.length).fill(0);

  for (let i = 0; i < valid.length; i++) {
    const pt = getProbePoint(valid[i]);
    const areaI = Math.abs(valid[i].area);
    const enclosing: number[] = [];
    for (let j = 0; j < valid.length; j++) {
      if (i === j || !valid[j].closed) continue;
      const areaJ = Math.abs(valid[j].area);
      if (
        areaJ > areaI + 1e-4 &&
        valid[j].bounds.contains(pt) &&
        valid[j].contains(pt)
      ) {
        enclosing.push(j);
      }
    }
    containers.set(i, enclosing);
    depths[i] = enclosing.length;
  }

  const islandMap = new Map<number, paper.Path[]>();
  for (let i = 0; i < valid.length; i++) {
    if (depths[i] % 2 === 0) {
      islandMap.set(i, [valid[i]]);
    }
  }

  for (let i = 0; i < valid.length; i++) {
    if (depths[i] % 2 === 1) {
      const enclosing = containers.get(i) ?? [];
      const evenEnclosing = enclosing.filter((j) => depths[j] % 2 === 0);
      const pool = evenEnclosing.length > 0 ? evenEnclosing : enclosing;
      let hostIdx = -1;
      let minArea = Infinity;
      for (const j of pool) {
        const a = Math.abs(valid[j].area);
        if (a < minArea) {
          minArea = a;
          hostIdx = j;
        }
      }
      if (hostIdx !== -1 && islandMap.has(hostIdx)) {
        islandMap.get(hostIdx)!.push(valid[i]);
      } else {
        islandMap.set(i, [valid[i]]);
      }
    }
  }

  return Array.from(islandMap.values());
}

const MIN_PIECE_AREA = 1e-3;

export function toPieceItems(
  scope: paper.PaperScope,
  item: paper.PathItem
): paper.PathItem[] {
  if (item instanceof scope.Path) {
    return item.segments.length >= 2 && Math.abs(item.area) > MIN_PIECE_AREA ? [item] : [];
  }

  if (item instanceof scope.CompoundPath) {
    const children = item.children.filter(
      (c): c is paper.Path =>
        c instanceof scope.Path && c.segments.length >= 2 && Math.abs(c.area) > 1e-4
    );
    const islands = splitPathObjectsIntoIslands(children);
    const pieces: paper.PathItem[] = [];
    for (const island of islands) {
      if (island.length === 1) {
        if (Math.abs(island[0].area) > MIN_PIECE_AREA) {
          pieces.push(island[0]);
        }
      } else {
        const cp = new scope.CompoundPath({
          children: island.map((p) => p.clone({ insert: false })),
          fillRule: 'nonzero',
          applyMatrix: false,
          insert: false,
        });
        cp.reorient(false, true);
        if (Math.abs(cp.area) > MIN_PIECE_AREA) {
          pieces.push(cp);
        }
      }
    }
    return pieces;
  }

  return [];
}

function hasFiniteSubPaths(subpaths: SubPath[]): boolean {
  return subpaths.every((sp) =>
    sp.anchors.every(
      (a) =>
        Number.isFinite(a.x) &&
        Number.isFinite(a.y) &&
        Number.isFinite(a.handleIn.x) &&
        Number.isFinite(a.handleIn.y) &&
        Number.isFinite(a.handleOut.x) &&
        Number.isFinite(a.handleOut.y)
    )
  );
}

export function computeBooleanOperation(
  layers: PathLayer[],
  operation: Exclude<BooleanOp, 'divide'>,
  sceneLayers?: Layer[]
): BooleanResult | null {
  if (layers.length < 2) {
    return null;
  }

  return withHeadlessProject((scope) => {
    try {
      const worldItems: paper.PathItem[] = [];
      for (const layer of layers) {
        const parentM = sceneLayers
          ? getParentWorldMatrix(sceneLayers, layer.id)
          : IDENTITY_MATRIX;
        const item = buildWorldPathItem(scope, layer, true, parentM);
        if (!item) {
          return null;
        }
        worldItems.push(item);
      }

      let acc: paper.PathItem = worldItems[0];
      for (let i = 1; i < worldItems.length; i++) {
        const next = worldItems[i];
        if (operation === 'unite') {
          acc = acc.unite(next, { insert: false });
        } else if (operation === 'subtract') {
          acc = acc.subtract(next, { insert: false });
        } else if (operation === 'exclude') {
          acc = acc.exclude(next, { insert: false });
        } else {
          acc = acc.intersect(next, { insert: false });
        }
      }

      const worldSubpaths = extractSubPathsFromItem(scope, acc);
      if (!hasFiniteSubPaths(worldSubpaths)) return null;
      return normalizeResult(worldSubpaths);
    } catch {
      return null;
    }
  });
}

export function uniteBooleanResults(pieces: BooleanResult[]): BooleanResult | null {
  if (pieces.length === 0) return null;
  if (pieces.length === 1) return pieces[0];

  return withHeadlessProject((scope) => {
    const items: paper.PathItem[] = [];
    for (const piece of pieces) {
      const paths: paper.Path[] = [];
      for (const sp of piece.subpaths) {
        const path = buildWorldSubPath(
          scope,
          { x: piece.x, y: piece.y, rotation: 0, scaleX: 1, scaleY: 1 },
          sp,
          true
        );
        if (path) paths.push(path);
      }
      if (paths.length === 0) continue;
      if (paths.length === 1) {
        paths[0].fillRule = piece.fillRule;
        items.push(paths[0]);
      } else {
        const cp = new scope.CompoundPath({
          children: paths,
          fillRule: piece.fillRule,
          applyMatrix: false,
          insert: false,
        });
        if (piece.fillRule === 'evenodd') {
          cp.reorient(false, true);
        }
        items.push(cp);
      }
    }

    if (items.length === 0) return null;
    let acc = items[0];
    for (let i = 1; i < items.length; i += 1) {
      acc = acc.unite(items[i], { insert: false });
    }
    const worldSubpaths = extractSubPathsFromItem(scope, acc);
    return normalizeResult(worldSubpaths);
  });
}

export function computeDivideOperation(
  layers: PathLayer[],
  sceneLayers?: Layer[]
): Array<BooleanResult & { sourceIndex: number }> {
  if (layers.length < 2) {
    return [];
  }

  return withHeadlessProject((scope) => {
    try {
      const worldItems: paper.PathItem[] = [];
      for (const layer of layers) {
        const parentM = sceneLayers
          ? getParentWorldMatrix(sceneLayers, layer.id)
          : IDENTITY_MATRIX;
        const item = buildWorldPathItem(scope, layer, true, parentM);
        if (!item) return [];
        worldItems.push(item);
      }

      let pieces: Array<{ item: paper.PathItem; sourceIndex: number }> =
        toPieceItems(scope, worldItems[0]).map((item) => ({
          item,
          sourceIndex: 0,
        }));

      for (let i = 1; i < worldItems.length; i++) {
        const nextSource = worldItems[i];
        let remB: paper.PathItem = nextSource;
        const nextPieces: Array<{ item: paper.PathItem; sourceIndex: number }> = [];

        for (const piece of pieces) {
          if (!piece.item.bounds.intersects(nextSource.bounds)) {
            nextPieces.push(piece);
            continue;
          }
          const diff = piece.item.subtract(nextSource, { insert: false });
          for (const d of toPieceItems(scope, diff)) {
            nextPieces.push({ item: d, sourceIndex: piece.sourceIndex });
          }

          const inter = piece.item.intersect(nextSource, { insert: false });
          for (const k of toPieceItems(scope, inter)) {
            nextPieces.push({ item: k, sourceIndex: i });
          }

          if (remB.bounds.intersects(piece.item.bounds)) {
            remB = remB.subtract(piece.item, { insert: false });
          }
        }

        for (const r of toPieceItems(scope, remB)) {
          nextPieces.push({ item: r, sourceIndex: i });
        }

        pieces = nextPieces;
      }

      const out: Array<BooleanResult & { sourceIndex: number }> = [];
      for (const piece of pieces) {
        const worldSubpaths = extractSubPathsFromItem(scope, piece.item);
        if (!hasFiniteSubPaths(worldSubpaths)) continue;
        const norm = normalizeResult(worldSubpaths);
        if (norm) {
          out.push({ ...norm, sourceIndex: piece.sourceIndex });
        }
      }
      return out;
    } catch {
      return [];
    }
  });
}

export function computeSplitCompoundPath(layer: PathLayer): BooleanResult[] {
  return withHeadlessProject((scope) => {
    const worldPaths: paper.Path[] = [];
    for (const sp of layer.subpaths) {
      const p = buildWorldSubPath(scope, layer, sp, false);
      if (p) worldPaths.push(p);
    }
    if (worldPaths.length <= 1) {
      return [];
    }

    const islands = splitPathObjectsIntoIslands(worldPaths);
    const out: BooleanResult[] = [];

    if (islands.length >= 2) {
      for (const island of islands) {
        const subpaths = island
          .map(extractSubPath)
          .filter((sp): sp is SubPath => sp !== null);
        const norm = normalizeResult(
          subpaths,
          subpaths.length > 1 ? 'evenodd' : layer.fillRule
        );
        if (norm) out.push(norm);
      }
      return out;
    }

    for (const path of worldPaths) {
      const sp = extractSubPath(path);
      if (!sp) continue;
      const norm = normalizeResult([sp], 'nonzero');
      if (norm) out.push(norm);
    }
    return out;
  });
}

export function computeCombineCompoundPath(
  layers: PathLayer[],
  sceneLayers?: Layer[]
): BooleanResult | null {
  if (layers.length < 2) {
    return null;
  }

  return withHeadlessProject((scope) => {
    const worldSubpaths: SubPath[] = [];
    for (const layer of layers) {
      const parentM = sceneLayers
        ? getParentWorldMatrix(sceneLayers, layer.id)
        : IDENTITY_MATRIX;
      for (const sp of layer.subpaths) {
        const path = buildWorldSubPath(scope, layer, sp, false, parentM);
        if (!path) continue;
        const extracted = extractSubPath(path);
        if (extracted) worldSubpaths.push(extracted);
      }
    }
    return normalizeResult(worldSubpaths, 'evenodd');
  });
}

export function computeOffsetPath(
  layer: PathLayer,
  distance: number,
  join: 'round' | 'miter' | 'bevel' = 'round'
): BooleanResult | null {
  if (Math.abs(distance) < 1e-4) {
    return null;
  }

  return withHeadlessProject((scope) => {
    const item = buildWorldPathItem(scope, layer, false);
    if (!item) return null;

    if (
      item instanceof scope.CompoundPath &&
      layer.fillRule === 'evenodd' &&
      item.children.every((c) => c instanceof scope.Path && c.closed)
    ) {
      item.reorient(false, true);
    }

    const res = item.offset(distance, {
      join,
      miterLimit: 10,
      insert: false,
    });
    const worldSubpaths = extractSubPathsFromItem(scope, res);
    return normalizeResult(
      worldSubpaths,
      worldSubpaths.length > 1 ? 'evenodd' : layer.fillRule
    );
  });
}

export function computeOutlineStroke(layer: PathLayer): BooleanResult | null {
  if (!layer.stroke || layer.stroke.width <= 0) {
    return null;
  }

  const stroke = layer.stroke;
  return withHeadlessProject((scope) => {
    const item = buildWorldPathItem(scope, layer, false);
    if (!item) return null;

    const effectiveWidth =
      stroke.width * ((Math.abs(layer.scaleX) + Math.abs(layer.scaleY)) / 2);
    if (effectiveWidth <= 1e-4) return null;

    const join = stroke.lineJoin ?? 'round';
    const cap = stroke.lineCap ?? 'round';
    item.strokeColor = new scope.Color(getPrimaryColor(stroke.color));
    item.strokeWidth = effectiveWidth;
    item.strokeJoin = join;
    item.strokeCap = cap;
    const dash = sanitizeDashArray(stroke.dashArray);
    if (dash) {
      const strokeScale = (Math.abs(layer.scaleX) + Math.abs(layer.scaleY)) / 2;
      item.dashArray = dash.map((d) => Math.max(0.25, d * strokeScale));
      if (stroke.dashOffset) {
        item.dashOffset = stroke.dashOffset * strokeScale;
      }
    }

    const res = item.outline({
      width: effectiveWidth,
      join,
      cap,
      miterLimit: 10,
      insert: false,
    });
    const worldSubpaths = extractSubPathsFromItem(scope, res);
    return normalizeResult(
      worldSubpaths,
      worldSubpaths.length > 1 ? 'evenodd' : 'nonzero'
    );
  });
}

export function computeSimplifiedPath(
  layer: PathLayer,
  tolerance = 2.5
): BooleanResult | null {
  return withHeadlessProject((scope) => {
    const worldSubpaths: SubPath[] = [];
    for (const sp of layer.subpaths) {
      const path = buildWorldSubPath(scope, layer, sp, false);
      if (!path) continue;
      if (path.segments.length > 2) {
        path.simplify(tolerance);
      }
      const extracted = extractSubPath(path);
      if (extracted) worldSubpaths.push(extracted);
    }
    return normalizeResult(worldSubpaths, layer.fillRule);
  });
}
