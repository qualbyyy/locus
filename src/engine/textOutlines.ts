import * as fontkitModule from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';
import paper from 'paper/dist/paper-core';
import { loadFontBytes } from '../core/fonts';
import { centerSubPathsAtOrigin, localToWorld } from '../core/math';
import type { Point2D, SubPath, TextLayer } from '../core/types';

interface FontkitPathCommand {
  command:
    | 'moveTo'
    | 'lineTo'
    | 'quadraticCurveTo'
    | 'bezierCurveTo'
    | 'closePath';
  args: number[];
}

export interface TextOutlinesResult {
  x: number;
  y: number;
  subpaths: SubPath[];
  fillRule: 'evenodd';
}

const fontObjectCache = new Map<string, Font>();

export function createFontkitFont(bytes: Uint8Array): Font {
  const mod = fontkitModule as unknown as {
    create?: (buf: Uint8Array) => Font;
    default?: { create: (buf: Uint8Array) => Font };
  };
  const fn = mod.create ?? mod.default?.create;
  if (!fn) {
    throw new Error('fontkit.create недоступен');
  }
  return fn(bytes);
}

async function getLoadedFont(
  family: TextLayer['fontFamily'],
  weight: TextLayer['fontWeight']
): Promise<Font> {
  const key = `${family}:${weight}`;
  const cached = fontObjectCache.get(key);
  if (cached) {
    return cached;
  }
  const bytes = await loadFontBytes(family, weight);
  const font = createFontkitFont(bytes);
  fontObjectCache.set(key, font);
  return font;
}

function isCollinearOpposite(hIn: Point2D, hOut: Point2D): boolean {
  const lenIn = Math.hypot(hIn.x, hIn.y);
  const lenOut = Math.hypot(hOut.x, hOut.y);
  if (lenIn <= 1e-3 || lenOut <= 1e-3) {
    return false;
  }
  const dot = (hIn.x * hOut.x + hIn.y * hOut.y) / (lenIn * lenOut);
  return dot < -0.995;
}

function extractPathSubPath(path: paper.Path): SubPath | null {
  if (path.segments.length < 2) {
    return null;
  }
  return {
    closed: path.closed,
    anchors: path.segments.map((seg) => {
      const hIn = { x: seg.handleIn.x, y: seg.handleIn.y };
      const hOut = { x: seg.handleOut.x, y: seg.handleOut.y };
      return {
        x: seg.point.x,
        y: seg.point.y,
        handleIn: hIn,
        handleOut: hOut,
        smooth: isCollinearOpposite(hIn, hOut),
      };
    }),
  };
}

function resolveGlyphOverlaps(
  scope: paper.PaperScope,
  glyphSubpaths: SubPath[]
): SubPath[] {
  if (glyphSubpaths.length === 0) return [];

  const paths = glyphSubpaths
    .filter((sp) => sp.anchors.length >= 2)
    .map(
      (sp) =>
        new scope.Path({
          segments: sp.anchors.map(
            (a) =>
              new scope.Segment(
                new scope.Point(a.x, a.y),
                new scope.Point(a.handleIn.x, a.handleIn.y),
                new scope.Point(a.handleOut.x, a.handleOut.y)
              )
          ),
          closed: sp.closed,
          applyMatrix: false,
          insert: false,
        })
    );

  if (paths.length === 0) return [];

  const item: paper.PathItem =
    paths.length === 1
      ? paths[0]
      : new scope.CompoundPath({
          children: paths,
          fillRule: 'nonzero',
          applyMatrix: false,
          insert: false,
        });
  item.fillRule = 'nonzero';

  const resolved = item.unite(item, { insert: false });
  const extracted: SubPath[] = [];

  if (resolved instanceof scope.Path) {
    const sp = extractPathSubPath(resolved);
    if (sp) extracted.push(sp);
  } else if (resolved instanceof scope.CompoundPath) {
    for (const child of resolved.children) {
      if (child instanceof scope.Path) {
        const sp = extractPathSubPath(child);
        if (sp) extracted.push(sp);
      }
    }
  }

  return extracted.length > 0 ? extracted : glyphSubpaths;
}

export async function convertTextLayerToOutlines(
  layer: TextLayer
): Promise<TextOutlinesResult | null> {
  const font = await getLoadedFont(layer.fontFamily, layer.fontWeight);
  const k = layer.fontSize / Math.max(1, font.unitsPerEm);
  const tracking = layer.letterSpacing ?? 0;
  const step = layer.fontSize * layer.lineHeight;
  const lines = (layer.content || '').split('\n');
  const worldSubpaths: SubPath[] = [];

  const scope = new paper.PaperScope();
  scope.settings.applyMatrix = false;
  scope.settings.insertItems = false;
  const project = new scope.Project(undefined as unknown as HTMLCanvasElement);

  try {
    lines.forEach((line, lineIdx) => {
      if (!line.length) return;
      const run = font.layout(line);
      const count = run.glyphs.length;
      if (count === 0) return;

      const lineWidth =
        run.positions.reduce((sum, pos) => sum + pos.xAdvance * k, 0) +
        Math.max(0, count - 1) * tracking;

      let penX =
        layer.align === 'center'
          ? -lineWidth / 2
          : layer.align === 'right'
            ? -lineWidth
            : 0;
      const baselineY = layer.fontSize * 0.85 + lineIdx * step;

      for (let j = 0; j < count; j++) {
        const glyph = run.glyphs[j];
        const pos = run.positions[j];
        const originX = penX + pos.xOffset * k;
        const originY = baselineY - pos.yOffset * k;

        const toWorld = (gx: number, gy: number): Point2D =>
          localToWorld(layer, {
            x: originX + gx * k,
            y: originY - gy * k,
          });

        const rawCommands =
          (glyph.path as unknown as { commands?: FontkitPathCommand[] })
            ?.commands ?? [];

        const glyphSubpaths: SubPath[] = [];
        let curSubpath: SubPath | null = null;

        const finalizeSubpath = () => {
          if (!curSubpath) return;
          const anchors = curSubpath.anchors;
          if (anchors.length >= 2) {
            if (curSubpath.closed) {
              const first = anchors[0];
              const last = anchors[anchors.length - 1];
              if (Math.hypot(last.x - first.x, last.y - first.y) <= 1e-4) {
                first.handleIn = { x: last.handleIn.x, y: last.handleIn.y };
                anchors.pop();
              }
            }
            if (anchors.length >= 2) {
              for (const anchor of anchors) {
                anchor.smooth = isCollinearOpposite(
                  anchor.handleIn,
                  anchor.handleOut
                );
              }
              glyphSubpaths.push(curSubpath);
            }
          }
          curSubpath = null;
        };

        for (const cmd of rawCommands) {
          const { command, args } = cmd;
          if (command === 'moveTo') {
            finalizeSubpath();
            const pt = toWorld(args[0], args[1]);
            curSubpath = {
              closed: false,
              anchors: [
                {
                  x: pt.x,
                  y: pt.y,
                  handleIn: { x: 0, y: 0 },
                  handleOut: { x: 0, y: 0 },
                  smooth: false,
                },
              ],
            };
          } else if (command === 'lineTo' && curSubpath) {
            const pt = toWorld(args[0], args[1]);
            curSubpath.anchors.push({
              x: pt.x,
              y: pt.y,
              handleIn: { x: 0, y: 0 },
              handleOut: { x: 0, y: 0 },
              smooth: false,
            });
          } else if (command === 'quadraticCurveTo' && curSubpath) {
            const anchors = curSubpath.anchors;
            const prev = anchors[anchors.length - 1];
            const qWorld = toWorld(args[0], args[1]);
            const p2World = toWorld(args[2], args[3]);
            prev.handleOut = {
              x: (2 / 3) * (qWorld.x - prev.x),
              y: (2 / 3) * (qWorld.y - prev.y),
            };
            anchors.push({
              x: p2World.x,
              y: p2World.y,
              handleIn: {
                x: (2 / 3) * (qWorld.x - p2World.x),
                y: (2 / 3) * (qWorld.y - p2World.y),
              },
              handleOut: { x: 0, y: 0 },
              smooth: false,
            });
          } else if (command === 'bezierCurveTo' && curSubpath) {
            const anchors = curSubpath.anchors;
            const prev = anchors[anchors.length - 1];
            const c1World = toWorld(args[0], args[1]);
            const c2World = toWorld(args[2], args[3]);
            const p3World = toWorld(args[4], args[5]);
            prev.handleOut = {
              x: c1World.x - prev.x,
              y: c1World.y - prev.y,
            };
            anchors.push({
              x: p3World.x,
              y: p3World.y,
              handleIn: {
                x: c2World.x - p3World.x,
                y: c2World.y - p3World.y,
              },
              handleOut: { x: 0, y: 0 },
              smooth: false,
            });
          } else if (command === 'closePath' && curSubpath) {
            curSubpath.closed = true;
            finalizeSubpath();
          }
        }

        finalizeSubpath();
        if (glyphSubpaths.length > 0) {
          worldSubpaths.push(...resolveGlyphOverlaps(scope, glyphSubpaths));
        }
        penX += pos.xAdvance * k + tracking;
      }
    });
  } finally {
    project.remove();
  }

  if (worldSubpaths.length === 0) {
    return null;
  }

  const { subpaths, offset } = centerSubPathsAtOrigin(worldSubpaths);
  return {
    x: offset.x,
    y: offset.y,
    subpaths,
    fillRule: 'evenodd',
  };
}
