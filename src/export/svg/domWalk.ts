import paper from 'paper/dist/paper-core';
import { createLayerId } from '../../core/commands/helpers';
import { BUILTIN_FONTS, getProjectFonts } from '../../core/fonts';
import {
  centerSubPathsAtOrigin,
  clamp,
  computeLayerLocalBBox,
  computeSubPathsBBox,
} from '../../core/math';
import { isBlendMode, sanitizeDashArray } from '../../core/paint';
import type {
  AnchorPoint,
  BlendMode,
  FontFamily,
  Layer,
  PathLayer,
  StrokeStyle,
  SubPath,
  TextLayer,
} from '../../core/types';
import { extractPaperPaint } from './colorNormalize';
import { extractInlineStyleProp } from './cssInline';
import {
  readSvgImageMeta,
  type PendingImage,
  type SvgImageMeta,
} from './dataImage';

export interface ImportedItemMeta {
  svgTag?: string;
  svgName?: string;
  nonScalingStroke?: boolean;
  letterSpacing?: number;
  lineDeltaY?: number;
  firstTspanOffsetX?: number;
  firstTspanOffsetY?: number;
  blendMode?: BlendMode;
  svgImage?: SvgImageMeta;
}

export interface PendingImageToken {
  __pendingImageIndex: number;
}

export type CollectedEntry = Layer | PendingImageToken;

export function isPendingImageToken(entry: CollectedEntry): entry is PendingImageToken {
  return '__pendingImageIndex' in entry;
}

interface DecomposedMatrix {
  rotation?: number;
  scaling?: { x: number; y: number };
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

function readSvgTextMeta(node: Element): Partial<ImportedItemMeta> {
  const lsRaw =
    extractInlineStyleProp(node, 'letter-spacing') ??
    node.getAttribute('letter-spacing');
  const parsedLs = lsRaw ? Number.parseFloat(lsRaw) : NaN;

  const tspans = Array.from(node.querySelectorAll('tspan'));
  const firstTspan = tspans[0];
  const hasOwnX = node.getAttribute('x') !== null;
  const hasOwnY = node.getAttribute('y') !== null;

  const firstTspanOffsetX =
    !hasOwnX && firstTspan
      ? Number.parseFloat(firstTspan.getAttribute('x') ?? '0') || 0
      : 0;
  const firstTspanOffsetY =
    !hasOwnY && firstTspan
      ? Number.parseFloat(firstTspan.getAttribute('y') ?? '0') || 0
      : 0;

  let lineDeltaY: number | undefined;
  if (tspans.length >= 2) {
    const y0 = Number.parseFloat(tspans[0].getAttribute('y') ?? '');
    const y1 = Number.parseFloat(tspans[1].getAttribute('y') ?? '');
    if (Number.isFinite(y0) && Number.isFinite(y1) && y1 - y0 > 0) {
      lineDeltaY = y1 - y0;
    } else {
      const dy1 = Number.parseFloat(tspans[1].getAttribute('dy') ?? '');
      if (Number.isFinite(dy1) && dy1 > 0) {
        lineDeltaY = dy1;
      }
    }
  }

  return {
    letterSpacing: Number.isFinite(parsedLs) ? parsedLs : undefined,
    lineDeltaY,
    firstTspanOffsetX: firstTspanOffsetX || undefined,
    firstTspanOffsetY: firstTspanOffsetY || undefined,
  };
}

function readNodeBlendMode(node: SVGElement): BlendMode | undefined {
  const inlineProp = node.style?.mixBlendMode?.trim().toLowerCase();
  if (isBlendMode(inlineProp) && inlineProp !== 'normal') {
    return inlineProp;
  }
  const styleAttr = node.getAttribute('style');
  if (styleAttr) {
    const m = styleAttr.match(/mix-blend-mode\s*:\s*([^;]+)/i);
    const val = m?.[1]?.trim().toLowerCase();
    if (isBlendMode(val) && val !== 'normal') {
      return val;
    }
  }
  const attr = node.getAttribute('mix-blend-mode')?.trim().toLowerCase();
  if (isBlendMode(attr) && attr !== 'normal') {
    return attr;
  }
  return undefined;
}

function extractWorldSubPath(
  path: paper.Path,
  matrix: paper.Matrix
): SubPath | null {
  if (path.segments.length < 2) return null;
  const anchors: AnchorPoint[] = path.segments.map((seg) => {
    const p = matrix.transform(seg.point);
    const absIn = matrix.transform(seg.point.add(seg.handleIn));
    const absOut = matrix.transform(seg.point.add(seg.handleOut));
    const inX = absIn.x - p.x;
    const inY = absIn.y - p.y;
    const outX = absOut.x - p.x;
    const outY = absOut.y - p.y;
    return {
      x: p.x,
      y: p.y,
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

function extractWorldSubPathsFromItem(
  scope: paper.PaperScope,
  item: paper.Item,
  parentMatrix: paper.Matrix,
  includeGroups = false
): SubPath[] {
  if (item instanceof scope.Shape) {
    const path = item.toPath(false);
    const mat = parentMatrix.appended(path.matrix);
    const sp = extractWorldSubPath(path, mat);
    return sp ? [sp] : [];
  }

  if (item instanceof scope.Path) {
    const mat = parentMatrix.appended(item.matrix);
    const sp = extractWorldSubPath(item, mat);
    return sp ? [sp] : [];
  }

  if (item instanceof scope.CompoundPath) {
    const compoundMat = parentMatrix.appended(item.matrix);
    const out: SubPath[] = [];
    for (const child of item.children) {
      if (child instanceof scope.Path) {
        const sp = extractWorldSubPath(child, compoundMat.appended(child.matrix));
        if (sp) out.push(sp);
      }
    }
    return out;
  }

  if (includeGroups && item instanceof scope.Group) {
    const groupMat = parentMatrix.appended(item.matrix);
    const out: SubPath[] = [];
    for (const child of item.children ?? []) {
      out.push(...extractWorldSubPathsFromItem(scope, child, groupMat, true));
    }
    return out;
  }

  return [];
}

function isValidSubPaths(subpaths: SubPath[]): boolean {
  if (subpaths.length === 0) return false;
  const bbox = computeSubPathsBBox(subpaths);
  return bbox.width > 1e-4 || bbox.height > 1e-4;
}

function mapLineCap(raw: string | undefined): StrokeStyle['lineCap'] {
  if (raw === 'butt' || raw === 'round' || raw === 'square') return raw;
  return 'round';
}

function mapLineJoin(raw: string | undefined): StrokeStyle['lineJoin'] {
  if (raw === 'miter' || raw === 'round' || raw === 'bevel') return raw;
  return 'round';
}

function resolveFontFamily(raw: string | undefined): FontFamily {
  if (!raw) return 'Inter';
  const candidates = raw
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);

  const customFonts = getProjectFonts();
  for (const cand of candidates) {
    const customMatch = customFonts.find((f) => f.family.toLowerCase() === cand);
    if (customMatch) return customMatch.family;
    const match = BUILTIN_FONTS.find((f) => f.family.toLowerCase() === cand);
    if (match) return match.family;
  }
  return 'Inter';
}

function resolveFontWeight(raw: string | number | undefined): 400 | 700 {
  if (typeof raw === 'number') {
    return raw >= 600 ? 700 : 400;
  }
  const str = String(raw ?? '').trim().toLowerCase();
  if (str === 'bold' || str === 'bolder') return 700;
  const num = Number.parseFloat(str);
  return Number.isFinite(num) && num >= 600 ? 700 : 400;
}

function decomposePaperMatrix(matrix: paper.Matrix): {
  rotation: number;
  scaleX: number;
  scaleY: number;
} {
  const dec = matrix.decompose() as DecomposedMatrix | null | undefined;
  return {
    rotation:
      typeof dec?.rotation === 'number' && Number.isFinite(dec.rotation)
        ? dec.rotation
        : 0,
    scaleX: dec?.scaling?.x || 1,
    scaleY: dec?.scaling?.y || 1,
  };
}

export function walkSvgWithPaper(
  svgEl: SVGSVGElement,
  addWarning: (msg: string) => void
): { collected: CollectedEntry[]; pendingImages: PendingImage[] } {
  const prevProject = paper.project;
  const scope = new paper.PaperScope();
  scope.settings.applyMatrix = false;
  scope.settings.insertItems = false;
  const project = new scope.Project(undefined as unknown as HTMLCanvasElement);

  const collected: CollectedEntry[] = [];
  const pendingImages: PendingImage[] = [];
  let pathCounter = 0;
  let textCounter = 0;
  let imageCounter = 0;
  let maskCounter = 0;

  try {
    const importOptions: Record<string, unknown> = {
      expandShapes: true,
      insert: false,
      applyMatrix: false,
      onImport(node: SVGElement, item: paper.Item) {
        if (!item) return item;
        const svgTag = node.tagName.toLowerCase();
        const svgName =
          node.getAttribute('inkscape:label') ||
          node.getAttribute('data-name') ||
          node.getAttribute('id') ||
          undefined;
        const meta: ImportedItemMeta = {
          svgTag,
          svgName: svgName?.trim() || undefined,
          nonScalingStroke: node.getAttribute('vector-effect') === 'non-scaling-stroke',
          blendMode: readNodeBlendMode(node),
        };
        if (svgTag === 'text') {
          Object.assign(meta, readSvgTextMeta(node));
        } else if (svgTag === 'image') {
          meta.svgImage = readSvgImageMeta(node);
        }
        item.data = { ...(item.data ?? {}), ...meta };
        return item;
      },
    };
    const imported = (
      project as unknown as {
        importSVG(svg: SVGElement | string, options: Record<string, unknown>): paper.Item;
      }
    ).importSVG(svgEl, importOptions);

    const buildPathLayer = (
      item: paper.Item,
      parentMatrix: paper.Matrix,
      effectiveOpacity: number,
      effectiveBlendMode: BlendMode | undefined,
      effectiveVisible: boolean,
      clipMaskId: string | undefined,
      asMask: boolean,
      inheritedName?: string
    ): PathLayer | null => {
      const worldSubpaths = extractWorldSubPathsFromItem(
        scope,
        item,
        parentMatrix,
        asMask
      );
      if (!isValidSubPaths(worldSubpaths)) {
        return null;
      }

      const meta = (item.data ?? {}) as ImportedItemMeta;
      const worldMatrix = parentMatrix.appended(item.matrix);

      if (asMask) {
        maskCounter += 1;
        const { subpaths, offset } = centerSubPathsAtOrigin(worldSubpaths);
        return {
          id: createLayerId('path'),
          name: meta.svgName || `Маска ${maskCounter}`,
          type: 'path',
          visible: effectiveVisible,
          locked: false,
          x: offset.x,
          y: offset.y,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          subpaths,
          fillRule: item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
          fill: null,
          stroke: null,
          isClipMask: true,
          ...(clipMaskId ? { clipMaskId } : {}),
        };
      }

      pathCounter += 1;
      const { subpaths, offset } = centerSubPathsAtOrigin(worldSubpaths);
      const localBox = computeSubPathsBBox(subpaths);

      const fillInfo =
        meta.svgTag === 'line'
          ? null
          : extractPaperPaint(item.fillColor, worldMatrix, offset, localBox, () =>
              addWarning('Градиенты упрощены до плоской заливки')
            );
      const strokeInfo = extractPaperPaint(
        item.strokeColor,
        worldMatrix,
        offset,
        localBox,
        () => addWarning('Градиенты упрощены до плоской обводки')
      );

      let stroke: StrokeStyle | null = null;
      if (strokeInfo && item.strokeWidth > 0) {
        let strokeScale = 1;
        if (!meta.nonScalingStroke) {
          const sx = Math.hypot(worldMatrix.a, worldMatrix.b);
          const sy = Math.hypot(worldMatrix.c, worldMatrix.d);
          strokeScale = Math.sqrt(sx * sy) || 1;
        }
        const rawDash = sanitizeDashArray(item.dashArray);
        const dashArray = rawDash
          ? rawDash.map((d) => Math.max(0.25, Number((d * strokeScale).toFixed(2))))
          : undefined;
        const dashOffset =
          dashArray &&
          typeof item.dashOffset === 'number' &&
          Number.isFinite(item.dashOffset) &&
          Math.abs(item.dashOffset) > 1e-4
            ? Number((item.dashOffset * strokeScale).toFixed(2))
            : undefined;
        stroke = {
          color: strokeInfo.paint,
          width: Math.max(0.25, Number((item.strokeWidth * strokeScale).toFixed(2))),
          lineCap: mapLineCap(item.strokeCap),
          lineJoin: mapLineJoin(item.strokeJoin),
          ...(dashArray ? { dashArray } : {}),
          ...(dashOffset !== undefined ? { dashOffset } : {}),
        };
      }

      if (!fillInfo && !stroke) {
        pathCounter -= 1;
        return null;
      }

      const paintAlpha =
        fillInfo && strokeInfo
          ? Math.min(1, (fillInfo.alpha + strokeInfo.alpha) / 2)
          : (fillInfo?.alpha ?? strokeInfo?.alpha ?? 1);

      return {
        id: createLayerId('path'),
        name: meta.svgName || inheritedName || `Контур ${pathCounter}`,
        type: 'path',
        visible: effectiveVisible,
        locked: false,
        x: offset.x,
        y: offset.y,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: clamp(effectiveOpacity * paintAlpha, 0, 1),
        ...(effectiveBlendMode ? { blendMode: effectiveBlendMode } : {}),
        subpaths,
        fillRule: item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        fill: fillInfo ? fillInfo.paint : null,
        stroke,
        ...(clipMaskId ? { clipMaskId } : {}),
      };
    };

    const visit = (
      item: paper.Item,
      parentMatrix: paper.Matrix,
      parentOpacity: number,
      parentBlendMode: BlendMode | undefined,
      parentVisible: boolean,
      clipMaskId: string | undefined,
      isRootSvgGroup: boolean,
      targetList: CollectedEntry[],
      parentName?: string
    ): void => {
      const worldMatrix = parentMatrix.appended(item.matrix);
      const effectiveOpacity = clamp(parentOpacity * (item.opacity ?? 1), 0, 1);
      const effectiveVisible = parentVisible && item.visible !== false;
      const itemMeta = (item.data ?? {}) as ImportedItemMeta;
      const effectiveBlendMode = itemMeta.blendMode ?? parentBlendMode;
      const resolvedName = itemMeta.svgName || parentName;

      if (item instanceof scope.Group) {
        const children = item.children ?? [];
        const hasClipMask =
          item.clipped && children.length > 0 && Boolean(children[0].clipMask);

        if (hasClipMask) {
          if (isRootSvgGroup) {
            for (let i = 1; i < children.length; i += 1) {
              visit(
                children[i],
                worldMatrix,
                effectiveOpacity,
                effectiveBlendMode,
                effectiveVisible,
                clipMaskId,
                false,
                targetList
              );
            }
            return;
          }

          const maskLayer = buildPathLayer(
            children[0],
            worldMatrix,
            1,
            undefined,
            effectiveVisible,
            clipMaskId,
            true
          );
          if (maskLayer) {
            const maskedChildren: CollectedEntry[] = [];
            const singleMaskedName = children.length === 2 ? resolvedName : undefined;
            for (let i = 1; i < children.length; i += 1) {
              visit(
                children[i],
                worldMatrix,
                effectiveOpacity,
                effectiveBlendMode,
                effectiveVisible,
                maskLayer.id,
                false,
                maskedChildren,
                singleMaskedName
              );
            }
            if (maskedChildren.length > 0) {
              targetList.push(...maskedChildren, maskLayer);
            }
            return;
          }
        }

        const singleChildName =
          !isRootSvgGroup && children.length === 1 ? resolvedName : undefined;
        for (const child of children) {
          visit(
            child,
            worldMatrix,
            effectiveOpacity,
            effectiveBlendMode,
            effectiveVisible,
            clipMaskId,
            false,
            targetList,
            singleChildName
          );
        }
        return;
      }

      if (
        item instanceof scope.Path ||
        item instanceof scope.CompoundPath ||
        item instanceof scope.Shape
      ) {
        const layer = buildPathLayer(
          item,
          parentMatrix,
          effectiveOpacity,
          effectiveBlendMode,
          effectiveVisible,
          clipMaskId,
          false,
          parentName
        );
        if (layer) {
          targetList.push(layer);
        }
        return;
      }

      if (item instanceof scope.PointText) {
        const content = (item.content ?? '').replace(/\r\n/g, '\n');
        if (!content.trim()) return;

        const meta = (item.data ?? {}) as ImportedItemMeta;
        const rawFontSize = Math.max(4, Number(item.fontSize) || 16);
        const { rotation: rot, scaleX: sx, scaleY: sy } =
          decomposePaperMatrix(worldMatrix);

        let bakedScale = 1;
        let fontSize = rawFontSize;
        let scaleX = sx;
        let scaleY = sy;

        if (sx > 0 && sy > 0 && Math.abs(sx - sy) / Math.max(sx, sy) < 0.02) {
          bakedScale = (sx + sy) / 2;
          fontSize = clamp(Number((rawFontSize * bakedScale).toFixed(2)), 4, 2000);
          scaleX = 1;
          scaleY = 1;
        } else {
          fontSize = clamp(Number(rawFontSize.toFixed(2)), 4, 2000);
        }

        const offsetX = meta.firstTspanOffsetX ?? 0;
        const offsetY = meta.firstTspanOffsetY ?? 0;
        const topPt = worldMatrix.transform(
          new scope.Point(offsetX, offsetY - rawFontSize * 0.85)
        );
        const lineHeight =
          meta.lineDeltaY && meta.lineDeltaY > 0
            ? clamp(Number((meta.lineDeltaY / rawFontSize).toFixed(2)), 0.8, 3)
            : 1.2;
        const fontFamily = resolveFontFamily(item.fontFamily);
        const fontWeight = resolveFontWeight(item.fontWeight);
        const align =
          item.justification === 'center'
            ? 'center'
            : item.justification === 'right'
              ? 'right'
              : 'left';
        const letterSpacing =
          typeof meta.letterSpacing === 'number' && meta.letterSpacing !== 0
            ? Number((meta.letterSpacing * bakedScale).toFixed(2))
            : undefined;

        textCounter += 1;
        const textLayerBase: TextLayer = {
          id: createLayerId('txt'),
          name: meta.svgName || parentName || `Текст ${textCounter}`,
          type: 'text',
          visible: effectiveVisible,
          locked: false,
          x: topPt.x,
          y: topPt.y,
          rotation: Number(rot.toFixed(3)),
          scaleX: Number(scaleX.toFixed(4)),
          scaleY: Number(scaleY.toFixed(4)),
          opacity: effectiveOpacity,
          ...(effectiveBlendMode ? { blendMode: effectiveBlendMode } : {}),
          content,
          fontSize,
          fontFamily,
          fontWeight,
          lineHeight,
          ...(letterSpacing !== undefined ? { letterSpacing } : {}),
          fill: '#1c1b1a',
          align,
          ...(clipMaskId ? { clipMaskId } : {}),
        };
        const textLocalBox = computeLayerLocalBBox(textLayerBase);
        const fillInfo = extractPaperPaint(
          item.fillColor,
          worldMatrix,
          { x: topPt.x, y: topPt.y },
          textLocalBox,
          () => addWarning('Градиенты в тексте упрощены до плоского цвета')
        );
        const textLayer: TextLayer = {
          ...textLayerBase,
          opacity: clamp(effectiveOpacity * (fillInfo?.alpha ?? 1), 0, 1),
          fill: fillInfo?.paint ?? '#1c1b1a',
        };
        targetList.push(textLayer);
        return;
      }

      if (item instanceof scope.Raster) {
        const meta = (item.data ?? {}) as ImportedItemMeta;
        const imgMeta = meta.svgImage;
        if (!imgMeta) return;
        if (!imgMeta.href.startsWith('data:image/')) {
          addWarning('Внешние изображения в SVG пропущены');
          return;
        }
        imageCounter += 1;
        const { rotation, scaleX, scaleY } = decomposePaperMatrix(worldMatrix);
        const idx = pendingImages.length;
        pendingImages.push({
          meta: imgMeta,
          matrix: {
            a: worldMatrix.a,
            b: worldMatrix.b,
            c: worldMatrix.c,
            d: worldMatrix.d,
            tx: worldMatrix.tx,
            ty: worldMatrix.ty,
          },
          rotation,
          scaleX,
          scaleY,
          opacity: effectiveOpacity,
          blendMode: effectiveBlendMode,
          visible: effectiveVisible,
          name: meta.svgName || parentName || `Изображение ${imageCounter}`,
          clipMaskId,
        });
        targetList.push({ __pendingImageIndex: idx });
      }
    };

    if (imported) {
      visit(
        imported,
        new scope.Matrix(),
        1,
        undefined,
        true,
        undefined,
        true,
        collected
      );
    }
  } finally {
    project.remove();
    scope.remove();
    if (prevProject && prevProject !== project) {
      prevProject.activate();
    }
  }

  return { collected, pendingImages };
}
