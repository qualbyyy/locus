import { extractArtboardScene, getActiveArtboard } from '../core/artboards';
import { assetToDataUrl, bytesToDataUrl } from '../core/assets';
import { extractSelectionScene } from './selectionScene';
import { getProjectFontBytes } from '../core/fonts';
import { flattenLayers } from '../core/layerTree';
import {
  clamp,
  computeLayerLocalBBox,
  computeSubPathsBBox,
} from '../core/math';
import {
  isGradientPaint,
  normalizeGradientStops,
  resolveGradientEndpoints,
  sanitizeDashArray,
} from '../core/paint';
import type {
  GradientPaint,
  GroupLayer,
  Layer,
  PathLayer,
  Scene,
  TextLayer,
} from '../core/types';
import {
  colorWithOpacity,
  hasActiveColorAdjust,
  hasRasterEffects,
  resolveEffectivePathGeometry,
} from '../engine/effects';
import {
  buildOffsetPathSubPath,
  computeTextOnPathLocalBBox,
  createTextCharMeasurer,
  pickPrimaryHostSubPath,
  resolveHostPathLayer,
  resolvePathMatrixRelativeToText,
  resolveTextPathTracking,
} from '../engine/textOnPath';
import {
  buildSvgPathData,
  colorToCssRgb,
  escapeXml,
  formatNumber,
  layerMatrixAttr,
  type MappedPoint,
} from './pathData';
import { applyMatrixToPoint, type Matrix2D } from '../core/math';

export interface SvgExportOptions {
  /** Включать фон артборда (по умолчанию `true`). */
  includeBackground?: boolean;
  /** ID конкретного артборда для экспорта (по умолчанию текущий документ целиком). */
  artboardId?: string;
  /** Экспортировать только указанные слои с пересчитанным viewBox. */
  layerIds?: string[];
  /** Отступ вокруг границ выделения в px. */
  padding?: number;
}

const toLocal = (pt: { x: number; y: number }): MappedPoint => ({
  x: pt.x,
  y: pt.y,
  lx: pt.x,
  ly: pt.y,
});

/** Идентификатор слоя, безопасный для `id`/`url(#...)` в SVG. */
export function safeSvgId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `x${cleaned}`;
}

function textAnchor(align: TextLayer['align']): string {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

/** Единая метрика строк: baselineY(i) = fontSize * 0.85 + i * fontSize * lineHeight. */
export function textBaselineY(layer: TextLayer, lineIndex: number): number {
  return layer.fontSize * 0.85 + lineIndex * layer.fontSize * layer.lineHeight;
}

function toMatrixMapper(matrix: Matrix2D) {
  return (pt: { x: number; y: number }): MappedPoint => {
    const w = applyMatrixToPoint(matrix, pt);
    return { x: w.x, y: w.y, lx: pt.x, ly: pt.y };
  };
}

function buildTextPathDefs(
  visibleLayers: Layer[],
  allSceneLayers: Layer[]
): string {
  const defs: string[] = [];
  for (const layer of visibleLayers) {
    if (layer.type !== 'text' || !layer.pathId) continue;
    const hostPath = resolveHostPathLayer(allSceneLayers, layer.pathId);
    if (!hostPath) continue;

    const geom = resolveEffectivePathGeometry(hostPath).subpaths.filter(
      (sp) => sp.anchors.length >= 2
    );
    const sp = pickPrimaryHostSubPath(geom);
    if (!sp) continue;
    const isClosedCentered = Boolean(sp.closed && layer.align === 'center');

    if (Math.abs(layer.pathBaselineOffset ?? 0) > 0.1 || isClosedCentered) {
      const offsetSubpath = buildOffsetPathSubPath(
        layer,
        hostPath,
        allSceneLayers,
        isClosedCentered
      );
      if (offsetSubpath) {
        const d = buildSvgPathData([offsetSubpath], (pt) => ({
          x: pt.x,
          y: pt.y,
          lx: pt.x,
          ly: pt.y,
        }));
        if (d) {
          defs.push(`<path id="textpath-${safeSvgId(layer.id)}" d="${d}"/>`);
        }
      }
      continue;
    }

    const targetSubpath = layer.pathFlip
      ? {
          closed: sp.closed,
          anchors: [...sp.anchors].reverse().map((a) => ({
            ...a,
            handleIn: { ...a.handleOut },
            handleOut: { ...a.handleIn },
          })),
        }
      : sp;
    const relMatrix = resolvePathMatrixRelativeToText(
      hostPath,
      layer,
      allSceneLayers
    );
    const d = buildSvgPathData([targetSubpath], toMatrixMapper(relMatrix));
    if (d) {
      defs.push(`<path id="textpath-${safeSvgId(layer.id)}" d="${d}"/>`);
    }
  }
  return defs.join('');
}

function buildTextSvg(layer: TextLayer, allSceneLayers: Layer[]): string {
  const hostPath = resolveHostPathLayer(allSceneLayers, layer.pathId);
  const sid = safeSvgId(layer.id);
  const attrs: string[] = [
    `font-family="${escapeXml(layer.fontFamily)}"`,
    `font-weight="${layer.fontWeight}"`,
    `font-size="${formatNumber(layer.fontSize)}"`,
    `text-anchor="${textAnchor(layer.align)}"`,
    `fill="${
      isGradientPaint(layer.fill)
        ? `url(#grad-fill-${sid})`
        : colorToCssRgb(layer.fill)
    }"`,
  ];

  let effectiveTracking = layer.letterSpacing ?? 0;
  if (hostPath && layer.pathStretch) {
    const singleLine = (layer.content || '').replace(/\r?\n/g, ' ');
    const chars = Array.from(singleLine);
    const measure = createTextCharMeasurer(layer);
    const widths = chars.map(measure);
    const offsetSubpath = buildOffsetPathSubPath(layer, hostPath, allSceneLayers);
    const approxLen = offsetSubpath
      ? offsetSubpath.anchors.reduce((sum, a, idx, arr) => {
          const next = arr[(idx + 1) % arr.length];
          if (!offsetSubpath.closed && idx === arr.length - 1) return sum;
          return sum + Math.hypot(next.x - a.x, next.y - a.y);
        }, 0)
      : 0;
    if (approxLen > 1e-4) {
      effectiveTracking = resolveTextPathTracking(
        approxLen,
        widths,
        effectiveTracking,
        Boolean(offsetSubpath?.closed),
        true
      );
    }
  }
  if (Math.abs(effectiveTracking) > 1e-4) {
    attrs.push(`letter-spacing="${formatNumber(effectiveTracking)}"`);
  }

  if (layer.stroke && layer.stroke.width > 0) {
    const strokeVal = isGradientPaint(layer.stroke.color)
      ? `url(#grad-stroke-${sid})`
      : colorToCssRgb(layer.stroke.color);
    attrs.push(`stroke="${strokeVal}"`);
    attrs.push(`stroke-width="${formatNumber(layer.stroke.width)}"`);
    attrs.push(`stroke-linecap="${layer.stroke.lineCap ?? 'round'}"`);
    attrs.push(`stroke-linejoin="${layer.stroke.lineJoin ?? 'round'}"`);
    const dash = sanitizeDashArray(layer.stroke.dashArray);
    if (dash) {
      attrs.push(`stroke-dasharray="${dash.map(formatNumber).join(' ')}"`);
      if (layer.stroke.dashOffset) {
        attrs.push(`stroke-dashoffset="${formatNumber(layer.stroke.dashOffset)}"`);
      }
    }
    attrs.push(`paint-order="stroke fill"`);
  }

  if (hostPath) {
    const singleLine = (layer.content || '').replace(/\r?\n/g, ' ');
    const basePct = clamp(layer.pathOffset ?? 0, 0, 100);
    const isClosed = Boolean(pickPrimaryHostSubPath(hostPath.subpaths)?.closed);
    const startOffset =
      layer.align === 'center'
        ? isClosed
          ? 50
          : clamp(50 + basePct, 0, 100)
        : layer.align === 'right'
          ? clamp(100 - basePct, 0, 100)
          : basePct;
    return `<text ${attrs.join(' ')}><textPath href="#textpath-${sid}" startOffset="${formatNumber(startOffset)}%">${escapeXml(singleLine)}</textPath></text>`;
  }

  const lines = (layer.content || '').split('\n');
  if (lines.length === 1) {
    return `<text ${attrs.join(' ')} x="0" y="${formatNumber(textBaselineY(layer, 0))}">${escapeXml(lines[0])}</text>`;
  }

  const spans = lines
    .map(
      (line, i) =>
        `<tspan x="0" y="${formatNumber(textBaselineY(layer, i))}">${escapeXml(line)}</tspan>`
    )
    .join('');
  return `<text ${attrs.join(' ')}>${spans}</text>`;
}

function buildPathSvg(layer: PathLayer): string {
  const { subpaths, extrudeFaces } = resolveEffectivePathGeometry(layer);
  const facePaths = extrudeFaces
    .map((face) => {
      const fd = buildSvgPathData(face.subpaths, toLocal);
      return `<path d="${fd}" fill-rule="nonzero" fill="${colorToCssRgb(face.fill)}" stroke="none"/>`;
    })
    .join('');

  const d = buildSvgPathData(subpaths, toLocal);
  const attrs: string[] = [`d="${d}"`, `fill-rule="${layer.fillRule}"`];
  const sid = safeSvgId(layer.id);
  if (!layer.fill) {
    attrs.push(`fill="none"`);
  } else if (isGradientPaint(layer.fill)) {
    attrs.push(`fill="url(#grad-fill-${sid})"`);
  } else {
    attrs.push(`fill="${colorToCssRgb(layer.fill)}"`);
  }

  if (layer.stroke && layer.stroke.width > 0) {
    const strokeVal = isGradientPaint(layer.stroke.color)
      ? `url(#grad-stroke-${sid})`
      : colorToCssRgb(layer.stroke.color);
    attrs.push(`stroke="${strokeVal}"`);
    attrs.push(`stroke-width="${formatNumber(layer.stroke.width)}"`);
    attrs.push(`stroke-linecap="${layer.stroke.lineCap ?? 'round'}"`);
    attrs.push(`stroke-linejoin="${layer.stroke.lineJoin ?? 'round'}"`);
    const dash = sanitizeDashArray(layer.stroke.dashArray);
    if (dash) {
      attrs.push(`stroke-dasharray="${dash.map(formatNumber).join(' ')}"`);
      if (layer.stroke.dashOffset) {
        attrs.push(`stroke-dashoffset="${formatNumber(layer.stroke.dashOffset)}"`);
      }
    }
  } else {
    attrs.push(`stroke="none"`);
  }
  return `${facePaths}<path ${attrs.join(' ')}/>`;
}

async function buildImageSvg(layer: Layer & { type: 'image' }): Promise<string> {
  const dataUrl = await assetToDataUrl(layer.assetId);
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return '';
  return (
    `<image href="${escapeXml(dataUrl)}" x="${formatNumber(-layer.width / 2)}" ` +
    `y="${formatNumber(-layer.height / 2)}" width="${formatNumber(layer.width)}" ` +
    `height="${formatNumber(layer.height)}" preserveAspectRatio="none"/>`
  );
}

function collectMaskLayers(scene: Scene): PathLayer[] {
  const all = flattenLayers(scene.layers);
  const byId = new Map(all.map((l) => [l.id, l] as const));
  const result: PathLayer[] = [];
  const seen = new Set<string>();
  for (const layer of all) {
    if (!layer.clipMaskId || seen.has(layer.clipMaskId)) continue;
    const mask = byId.get(layer.clipMaskId);
    if (mask?.type === 'path') {
      result.push(mask);
      seen.add(mask.id);
    }
  }
  return result;
}

function buildMaskDefs(maskLayers: PathLayer[]): string {
  return maskLayers
    .map((mask) => {
      const d = buildSvgPathData(mask.subpaths, toLocal);
      const transform = layerMatrixAttr(mask);
      const tAttr = transform ? ` transform="${transform}"` : '';
      return `<clipPath id="clip-${safeSvgId(mask.id)}"><path d="${d}" clip-rule="${mask.fillRule}"${tAttr}/></clipPath>`;
    })
    .join('');
}

function formatSvgGradientDef(
  id: string,
  grad: GradientPaint,
  origin: { x: number; y: number },
  destination: { x: number; y: number }
): string {
  const stopsXml = normalizeGradientStops(grad.stops)
    .map((s) => {
      const opAttr =
        s.opacity !== undefined && s.opacity < 0.999
          ? ` stop-opacity="${formatNumber(clamp(s.opacity, 0, 1))}"`
          : '';
      return `<stop offset="${formatNumber(s.offset * 100)}%" stop-color="${colorToCssRgb(s.color)}"${opAttr}/>`;
    })
    .join('');

  if (grad.kind === 'radial') {
    const r = Math.max(
      0.001,
      Math.hypot(destination.x - origin.x, destination.y - origin.y)
    );
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${formatNumber(origin.x)}" cy="${formatNumber(origin.y)}" r="${formatNumber(r)}">${stopsXml}</radialGradient>`;
  }

  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${formatNumber(origin.x)}" y1="${formatNumber(origin.y)}" x2="${formatNumber(destination.x)}" y2="${formatNumber(destination.y)}">${stopsXml}</linearGradient>`;
}

function collectVisibleRenderLayers(
  layers: Layer[],
  maskLayerIds: Set<string>,
  out: Layer[] = []
): Layer[] {
  for (const layer of layers) {
    if (!layer.visible || maskLayerIds.has(layer.id)) continue;
    out.push(layer);
    if (layer.type === 'group') {
      collectVisibleRenderLayers(layer.children, maskLayerIds, out);
    }
  }
  return out;
}

function buildGradientDefs(visibleLayers: Layer[], allSceneLayers: Layer[]): string {
  const defs: string[] = [];
  for (const layer of visibleLayers) {
    const sid = safeSvgId(layer.id);
    if (layer.type === 'path') {
      const localBox = computeSubPathsBBox(
        resolveEffectivePathGeometry(layer).subpaths
      );
      if (isGradientPaint(layer.fill)) {
        const ep = resolveGradientEndpoints(layer.fill, localBox);
        defs.push(
          formatSvgGradientDef(
            `grad-fill-${sid}`,
            layer.fill,
            ep.origin,
            ep.destination
          )
        );
      }
      if (layer.stroke && layer.stroke.width > 0 && isGradientPaint(layer.stroke.color)) {
        const ep = resolveGradientEndpoints(layer.stroke.color, localBox);
        defs.push(
          formatSvgGradientDef(
            `grad-stroke-${sid}`,
            layer.stroke.color,
            ep.origin,
            ep.destination
          )
        );
      }
    } else if (layer.type === 'text') {
      const hostPath = resolveHostPathLayer(allSceneLayers, layer.pathId);
      const localBox = hostPath
        ? computeTextOnPathLocalBBox(layer, hostPath, allSceneLayers)
        : computeLayerLocalBBox(layer);
      if (isGradientPaint(layer.fill)) {
        const ep = resolveGradientEndpoints(layer.fill, localBox);
        defs.push(
          formatSvgGradientDef(
            `grad-fill-${sid}`,
            layer.fill,
            ep.origin,
            ep.destination
          )
        );
      }
      if (layer.stroke && layer.stroke.width > 0 && isGradientPaint(layer.stroke.color)) {
        const ep = resolveGradientEndpoints(layer.stroke.color, localBox);
        defs.push(
          formatSvgGradientDef(
            `grad-stroke-${sid}`,
            layer.stroke.color,
            ep.origin,
            ep.destination
          )
        );
      }
    }
  }
  return defs.join('');
}

function buildFilterDefs(visibleLayers: Layer[]): string {
  return visibleLayers
    .filter((l) => hasRasterEffects(l.effects))
    .map((layer) => {
      const eff = layer.effects!;
      const primitives: string[] = [];
      let cur = 'SourceGraphic';
      let step = 0;
      const nextId = () => `fx${(step += 1)}`;
      const needsExplicitChain = Boolean(
        hasActiveColorAdjust(eff.colorAdjust) || eff.innerShadow || eff.motionBlur
      );

      if (hasActiveColorAdjust(eff.colorAdjust) && eff.colorAdjust) {
        const ca = eff.colorAdjust;
        if (Math.abs(ca.brightness) > 0.5 || Math.abs(ca.contrast) > 0.5) {
          const b = Math.max(0, 1 + ca.brightness / 100);
          const c = Math.max(0, 1 + ca.contrast / 100);
          const slope = formatNumber(c * b);
          const intercept = formatNumber(0.5 * (1 - c));
          const res = nextId();
          primitives.push(
            `<feComponentTransfer in="${cur}" result="${res}"><feFuncR type="linear" slope="${slope}" intercept="${intercept}"/><feFuncG type="linear" slope="${slope}" intercept="${intercept}"/><feFuncB type="linear" slope="${slope}" intercept="${intercept}"/></feComponentTransfer>`
          );
          cur = res;
        }
        if (Math.abs(ca.saturate) > 0.5) {
          const res = nextId();
          primitives.push(
            `<feColorMatrix type="saturate" values="${formatNumber(Math.max(0, 1 + ca.saturate / 100))}" in="${cur}" result="${res}"/>`
          );
          cur = res;
        }
        if (Math.abs(ca.hue) > 0.5) {
          const res = nextId();
          primitives.push(
            `<feColorMatrix type="hueRotate" values="${formatNumber(ca.hue)}" in="${cur}" result="${res}"/>`
          );
          cur = res;
        }
      }

      if (eff.innerShadow) {
        const is = eff.innerShadow;
        const offId = nextId();
        const blurId = nextId();
        const maskId = nextId();
        const floodId = nextId();
        const shadowId = nextId();
        const doneId = nextId();
        primitives.push(
          `<feOffset dx="${formatNumber(is.offsetX)}" dy="${formatNumber(is.offsetY)}" in="${cur}" result="${offId}"/>`
        );
        primitives.push(
          `<feGaussianBlur stdDeviation="${formatNumber(is.blur / 2)}" in="${offId}" result="${blurId}"/>`
        );
        primitives.push(
          `<feComposite operator="out" in="SourceAlpha" in2="${blurId}" result="${maskId}"/>`
        );
        primitives.push(
          `<feFlood flood-color="${colorWithOpacity(is.color, is.opacity)}" result="${floodId}"/>`
        );
        primitives.push(
          `<feComposite operator="in" in="${floodId}" in2="${maskId}" result="${shadowId}"/>`
        );
        primitives.push(
          `<feComposite operator="over" in="${shadowId}" in2="${cur}" result="${doneId}"/>`
        );
        cur = doneId;
      }

      if (eff.motionBlur && eff.motionBlur.amount > 0.1) {
        const rad = (eff.motionBlur.angle * Math.PI) / 180;
        const rawSx = Math.abs(Math.cos(rad)) * (eff.motionBlur.amount / 2.5);
        const rawSy = Math.abs(Math.sin(rad)) * (eff.motionBlur.amount / 2.5);
        const sx = rawSx < 0.01 ? 0 : rawSx;
        const sy = rawSy < 0.01 ? 0 : rawSy;
        const res = nextId();
        primitives.push(
          `<feGaussianBlur stdDeviation="${formatNumber(sx)} ${formatNumber(sy)}" in="${cur}" result="${res}"/>`
        );
        cur = res;
      }

      if (eff.blur && eff.blur > 0.1) {
        if (needsExplicitChain) {
          const res = nextId();
          primitives.push(
            `<feGaussianBlur stdDeviation="${formatNumber(eff.blur)}" in="${cur}" result="${res}"/>`
          );
          cur = res;
        } else {
          primitives.push(`<feGaussianBlur stdDeviation="${formatNumber(eff.blur)}"/>`);
        }
      }

      if (eff.outerGlow && eff.outerGlow.blur > 0) {
        const inAttr = needsExplicitChain ? ` in="${cur}"` : '';
        const res = needsExplicitChain ? nextId() : '';
        const resAttr = res ? ` result="${res}"` : '';
        primitives.push(
          `<feDropShadow dx="0" dy="0" stdDeviation="${formatNumber(eff.outerGlow.blur / 2)}" flood-color="${colorWithOpacity(eff.outerGlow.color, eff.outerGlow.opacity)}"${inAttr}${resAttr}/>`
        );
        if (res) cur = res;
      }

      if (eff.dropShadow) {
        const inAttr = needsExplicitChain ? ` in="${cur}"` : '';
        primitives.push(
          `<feDropShadow dx="${formatNumber(eff.dropShadow.offsetX)}" dy="${formatNumber(eff.dropShadow.offsetY)}" stdDeviation="${formatNumber(eff.dropShadow.blur / 2)}" flood-color="${colorWithOpacity(eff.dropShadow.color, eff.dropShadow.opacity)}"${inAttr}/>`
        );
      }

      const largeBlur =
        (eff.blur ?? 0) > 30 ||
        (eff.motionBlur?.amount ?? 0) > 30 ||
        (eff.dropShadow?.blur ?? 0) > 30;
      const boundsAttrs = largeBlur
        ? 'x="-200%" y="-200%" width="500%" height="500%"'
        : 'x="-60%" y="-60%" width="220%" height="220%"';
      return `<filter id="fx-${safeSvgId(layer.id)}" ${boundsAttrs}>${primitives.join('')}</filter>`;
    })
    .join('');
}

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\r\n\0]/g, '')
    .replace(/<\//g, '<\\/');
}

function buildCustomFontStyleDefs(visibleLayers: Layer[]): string {
  const rules: string[] = [];
  const seen = new Set<string>();
  for (const layer of visibleLayers) {
    if (layer.type !== 'text') continue;
    const entry = getProjectFontBytes(layer.fontFamily, layer.fontWeight);
    if (!entry) continue;
    const key = `${entry.family.toLowerCase()}:${entry.weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const safeMime = /^font\/(woff2|woff|ttf|otf)$/i.test(entry.mimeType)
      ? entry.mimeType.toLowerCase()
      : 'font/ttf';
    const dataUrl = bytesToDataUrl(entry.bytes, safeMime);
    if (!/^data:font\/(?:woff2|woff|ttf|otf);base64,[A-Za-z0-9+/=]+$/i.test(dataUrl)) {
      continue;
    }
    const escapedFamily = escapeCssString(entry.family);
    rules.push(
      `@font-face{font-family:'${escapedFamily}';font-weight:${entry.weight};src:url('${dataUrl}');}`
    );
  }
  return rules.length > 0 ? `<style>${rules.join('')}</style>` : '';
}

async function buildGroupNodeSvg(
  group: GroupLayer,
  maskLayerIds: Set<string>,
  allSceneLayers: Layer[],
  clipId?: string | null
): Promise<string> {
  const attrs: string[] = [
    `id="${safeSvgId(group.id)}"`,
    `data-name="${escapeXml(group.name)}"`,
  ];
  if (clipId) {
    attrs.push(`clip-path="url(#clip-${safeSvgId(clipId)})"`);
  }
  if (group.opacity < 1) {
    attrs.push(`opacity="${formatNumber(clamp(group.opacity, 0, 1))}"`);
  }
  const transform = layerMatrixAttr(group);
  if (transform) {
    attrs.push(`transform="${transform}"`);
  }
  if (hasRasterEffects(group.effects)) {
    attrs.push(`filter="url(#fx-${safeSvgId(group.id)})"`);
  }
  if (group.blendMode && group.blendMode !== 'normal') {
    attrs.push(`style="mix-blend-mode:${escapeXml(group.blendMode)}"`);
  }
  const body = await buildSvgBodyForList(group.children, maskLayerIds, allSceneLayers);
  return `<g ${attrs.join(' ')}>${body}</g>`;
}

async function buildLayerContent(
  layer: Layer,
  maskLayerIds: Set<string>,
  allSceneLayers: Layer[],
  includeOpacity = false
): Promise<string> {
  if (layer.type === 'group') {
    return buildGroupNodeSvg(layer, maskLayerIds, allSceneLayers);
  }
  const transform = layerMatrixAttr(layer);
  const hasFx = hasRasterEffects(layer.effects);
  const wrap = (content: string) => {
    let out = transform ? `<g transform="${transform}">${content}</g>` : content;
    if (includeOpacity && layer.opacity < 1) {
      out = `<g opacity="${formatNumber(clamp(layer.opacity, 0, 1))}">${out}</g>`;
    }
    if (hasFx) {
      out = `<g filter="url(#fx-${safeSvgId(layer.id)})">${out}</g>`;
    }
    if (layer.blendMode && layer.blendMode !== 'normal') {
      out = `<g style="mix-blend-mode:${escapeXml(layer.blendMode)}">${out}</g>`;
    }
    return out;
  };
  if (layer.type === 'path') return wrap(buildPathSvg(layer));
  if (layer.type === 'text') return wrap(buildTextSvg(layer, allSceneLayers));
  return wrap(await buildImageSvg(layer));
}

/** Последовательные видимые слои с одинаковым `clipMaskId` → один `<g>`. */
async function buildLayerGroup(
  group: Layer[],
  clipId: string | null,
  maskLayerIds: Set<string>,
  allSceneLayers: Layer[]
): Promise<string> {
  if (group.length === 1 && group[0].type === 'group') {
    return buildGroupNodeSvg(group[0], maskLayerIds, allSceneLayers, clipId);
  }
  const attrs: string[] = [];
  if (clipId) {
    attrs.push(`clip-path="url(#clip-${safeSvgId(clipId)})"`);
  }
  const first = group[0];
  const groupId = group.length === 1 ? safeSvgId(first.id) : `clipwrap-${safeSvgId(first.id)}`;
  attrs.push(`id="${groupId}"`);
  attrs.push(`data-name="${escapeXml(group.length === 1 ? first.name : `Группа (${group.length})`)}"`);
  if (group.length === 1 && first.type !== 'group' && first.opacity < 1) {
    attrs.push(`opacity="${formatNumber(clamp(first.opacity, 0, 1))}"`);
  }
  const includeChildOpacity = group.length > 1;
  const inner = await Promise.all(
    group.map((layer) =>
      buildLayerContent(layer, maskLayerIds, allSceneLayers, includeChildOpacity)
    )
  );
  return `<g ${attrs.join(' ')}>${inner.join('')}</g>`;
}

function isMaskOrHidden(layer: Layer, maskLayerIds: Set<string>): boolean {
  return maskLayerIds.has(layer.id) || !layer.visible;
}

async function buildSvgBodyForList(
  layers: Layer[],
  maskLayerIds: Set<string>,
  allSceneLayers: Layer[]
): Promise<string> {
  const body: string[] = [];
  let i = 0;
  while (i < layers.length) {
    const layer = layers[i];
    if (isMaskOrHidden(layer, maskLayerIds)) {
      i += 1;
      continue;
    }
    const clipId = layer.clipMaskId ?? null;
    let j = i;
    while (
      j + 1 < layers.length &&
      layers[j + 1].clipMaskId === clipId &&
      !isMaskOrHidden(layers[j + 1], maskLayerIds)
    ) {
      j += 1;
    }
    body.push(
      await buildLayerGroup(
        layers.slice(i, j + 1),
        clipId,
        maskLayerIds,
        allSceneLayers
      )
    );
    i = j + 1;
  }
  return body.join('');
}

export async function sceneToSvg(
  scene: Scene,
  options: SvgExportOptions = {}
): Promise<string> {
  let targetScene: Scene = scene;
  if (options.layerIds && options.layerIds.length > 0) {
    targetScene = extractSelectionScene(scene, options.layerIds, options.padding ?? 0) ?? scene;
  } else if (options.artboardId) {
    targetScene = extractArtboardScene(scene, getActiveArtboard(scene, options.artboardId));
  }
  const maskLayers = collectMaskLayers(targetScene);
  const maskLayerIds = new Set(maskLayers.map((m) => m.id));
  const visibleLayers = collectVisibleRenderLayers(targetScene.layers, maskLayerIds);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(targetScene.width)}" height="${formatNumber(targetScene.height)}" viewBox="0 0 ${formatNumber(targetScene.width)} ${formatNumber(targetScene.height)}">`,
  ];
  if (
    options.includeBackground !== false &&
    targetScene.background &&
    targetScene.background !== 'transparent'
  ) {
    parts.push(
      `<rect x="0" y="0" width="${formatNumber(targetScene.width)}" height="${formatNumber(targetScene.height)}" fill="${colorToCssRgb(targetScene.background)}"/>`
    );
  }
  const fontStyleDefs = buildCustomFontStyleDefs(visibleLayers);
  const textPathDefs = buildTextPathDefs(visibleLayers, targetScene.layers);
  const maskDefs = buildMaskDefs(maskLayers);
  const gradientDefs = buildGradientDefs(visibleLayers, targetScene.layers);
  const filterDefs = buildFilterDefs(visibleLayers);
  if (fontStyleDefs || textPathDefs || maskDefs || gradientDefs || filterDefs) {
    parts.push(
      `<defs>${fontStyleDefs}${textPathDefs}${maskDefs}${gradientDefs}${filterDefs}</defs>`
    );
  }
  parts.push(await buildSvgBodyForList(targetScene.layers, maskLayerIds, targetScene.layers));
  parts.push('</svg>');
  return parts.join('\n');
}
