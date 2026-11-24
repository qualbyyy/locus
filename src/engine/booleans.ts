import paper from 'paper/dist/paper-core';
import {
  centerSubPathsAtOrigin,
  computeSubPathsBBox,
  localToWorld,
  localVectorToWorld,
} from '../core/math';
import type { AnchorPoint, PathLayer, SubPath } from '../core/types';

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

function withHeadlessProject<T>(
  fn: (scope: paper.PaperScope) => T
): T {
  const scope = new paper.PaperScope();
  scope.settings.applyMatrix = false;
  scope.settings.insertItems = false;
  const project = new scope.Project(undefined as unknown as HTMLCanvasElement);
  try {
    return fn(scope);
  } finally {
    project.remove();
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

function buildWorldSubPath(
  scope: paper.PaperScope,
  layer: PathLayer,
  sp: SubPath,
  forceClosed: boolean
): paper.Path | null {
  if (sp.anchors.length < 2) return null;
  const segments = sp.anchors.map((anchor) => {
    const wPt = localToWorld(layer, { x: anchor.x, y: anchor.y });
    const wIn = localVectorToWorld(layer, anchor.handleIn);
    const wOut = localVectorToWorld(layer, anchor.handleOut);
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

function buildWorldPathItem(
  scope: paper.PaperScope,
  layer: PathLayer,
  forceClosed = true
): paper.PathItem | null {
  const paths: paper.Path[] = [];

  for (const sp of layer.subpaths) {
    const path = buildWorldSubPath(scope, layer, sp, forceClosed);
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
  if (forceClosed && layer.fillRule === 'evenodd') {
    compound.reorient(false, true);
  }
  return compound;
}

function extractSubPath(path: paper.Path): SubPath | null {
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

function extractSubPathsFromItem(
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

function normalizeResult(
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

function toPieceItems(
  scope: paper.PaperScope,
  item: paper.PathItem
): paper.PathItem[] {
  if (item instanceof scope.Path) {
    return item.segments.length >= 2 && Math.abs(item.area) > 1 ? [item] : [];
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
        if (Math.abs(island[0].area) > 1) {
          pieces.push(island[0]);
        }
      } else {
        const cp = new scope.CompoundPath({
          children: island.map((p) => p.clone({ insert: false })),
          fillRule: 'nonzero',
          applyMatrix: false,
          insert: false,
        });
        if (Math.abs(cp.area) > 1) {
          pieces.push(cp);
        }
      }
    }
    return pieces;
  }

  return [];
}

export function computeBooleanOperation(
  layers: PathLayer[],
  operation: Exclude<BooleanOp, 'divide'>
): BooleanResult | null {
  if (layers.length < 2) {
    return null;
  }

  return withHeadlessProject((scope) => {
    const worldItems: paper.PathItem[] = [];
    for (const layer of layers) {
      const item = buildWorldPathItem(scope, layer, true);
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
    return normalizeResult(worldSubpaths);
  });
}

export function computeDivideOperation(
  layers: PathLayer[]
): Array<BooleanResult & { sourceIndex: number }> {
  if (layers.length < 2) {
    return [];
  }

  return withHeadlessProject((scope) => {
    const worldItems: paper.PathItem[] = [];
    for (const layer of layers) {
      const item = buildWorldPathItem(scope, layer, true);
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
        const diff = piece.item.subtract(nextSource, { insert: false });
        for (const d of toPieceItems(scope, diff)) {
          nextPieces.push({ item: d, sourceIndex: piece.sourceIndex });
        }

        const inter = piece.item.intersect(nextSource, { insert: false });
        for (const k of toPieceItems(scope, inter)) {
          nextPieces.push({ item: k, sourceIndex: i });
        }

        remB = remB.subtract(piece.item, { insert: false });
      }

      for (const r of toPieceItems(scope, remB)) {
        nextPieces.push({ item: r, sourceIndex: i });
      }

      pieces = nextPieces;
    }

    const out: Array<BooleanResult & { sourceIndex: number }> = [];
    for (const piece of pieces) {
      const worldSubpaths = extractSubPathsFromItem(scope, piece.item);
      const norm = normalizeResult(worldSubpaths);
      if (norm) {
        out.push({ ...norm, sourceIndex: piece.sourceIndex });
      }
    }
    return out;
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
  layers: PathLayer[]
): BooleanResult | null {
  if (layers.length < 2) {
    return null;
  }

  return withHeadlessProject((scope) => {
    const worldSubpaths: SubPath[] = [];
    for (const layer of layers) {
      for (const sp of layer.subpaths) {
        const path = buildWorldSubPath(scope, layer, sp, false);
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
    item.strokeColor = new scope.Color(stroke.color);
    item.strokeWidth = effectiveWidth;
    item.strokeJoin = join;
    item.strokeCap = cap;

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
