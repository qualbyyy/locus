import { clamp, degToRad } from '../../core/math';
import type { BBox, LayerEffects } from '../../core/types';
import {
  colorWithOpacity,
  getEffectsPadding,
  hasActiveColorAdjust,
  hasRasterEffects,
} from '../../engine/effects';
import { createCanvas, isCanvas2dSupported, zeroCanvas } from './canvasPool';

function buildColorAdjustFilter(effects?: LayerEffects): string {
  const ca = effects?.colorAdjust;
  if (!hasActiveColorAdjust(ca) || !ca) return '';
  const parts: string[] = [];
  if (Math.abs(ca.brightness) > 0.5) {
    parts.push(`brightness(${Math.max(0, 1 + ca.brightness / 100).toFixed(3)})`);
  }
  if (Math.abs(ca.contrast) > 0.5) {
    parts.push(`contrast(${Math.max(0, 1 + ca.contrast / 100).toFixed(3)})`);
  }
  if (Math.abs(ca.saturate) > 0.5) {
    parts.push(`saturate(${Math.max(0, 1 + ca.saturate / 100).toFixed(3)})`);
  }
  if (Math.abs(ca.hue) > 0.5) {
    parts.push(`hue-rotate(${ca.hue.toFixed(1)}deg)`);
  }
  return parts.join(' ');
}

function buildFilterString(
  effects?: LayerEffects,
  options: { includeColorAdjust?: boolean; includeBlur?: boolean } = {}
): string {
  if (!effects) return 'none';
  const parts: string[] = [];
  if (options.includeColorAdjust !== false) {
    const caStr = buildColorAdjustFilter(effects);
    if (caStr) parts.push(caStr);
  }
  if (effects.outerGlow && effects.outerGlow.blur > 0) {
    const glowColor = colorWithOpacity(effects.outerGlow.color, effects.outerGlow.opacity);
    parts.push(`drop-shadow(0px 0px ${effects.outerGlow.blur}px ${glowColor})`);
  }
  if (effects.dropShadow) {
    const shColor = colorWithOpacity(effects.dropShadow.color, effects.dropShadow.opacity);
    parts.push(
      `drop-shadow(${effects.dropShadow.offsetX}px ${effects.dropShadow.offsetY}px ${effects.dropShadow.blur}px ${shColor})`
    );
  }
  if (options.includeBlur !== false && effects.blur && effects.blur > 0.1) {
    parts.push(`blur(${effects.blur}px)`);
  }
  return parts.length > 0 ? parts.join(' ') : 'none';
}

let cachedCanvasFilterSupport: boolean | null = null;

/** Проверяет, реально ли 2D-контекст применяет CSS-фильтр blur (в WebKitGTK может игнорироваться). */
export function supportsCanvasFilter(): boolean {
  if (cachedCanvasFilterSupport !== null) return cachedCanvasFilterSupport;
  if (!isCanvas2dSupported()) {
    cachedCanvasFilterSupport = false;
    return false;
  }
  try {
    const testCanvas = createCanvas(9, 9);
    try {
      const ctx = testCanvas.getContext('2d');
      if (!ctx || !('filter' in ctx)) {
        cachedCanvasFilterSupport = false;
        return false;
      }
      ctx.filter = 'blur(2px)';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(4, 4, 1, 1);
      const pixel = ctx.getImageData(2, 4, 1, 1).data;
      cachedCanvasFilterSupport = pixel[3] > 0;
      return cachedCanvasFilterSupport;
    } finally {
      zeroCanvas(testCanvas);
    }
  } catch {
    cachedCanvasFilterSupport = false;
    return false;
  }
}

function boxBlur1D(
  src: Float32Array,
  dst: Float32Array,
  count: number,
  lineLen: number,
  elemStride: number,
  lineStride: number,
  radius: number
): void {
  const inv = 1 / (radius * 2 + 1);
  for (let i = 0; i < count; i += 1) {
    const base = i * lineStride;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const pos = clamp(k, 0, lineLen - 1);
      const idx = base + pos * elemStride;
      sumR += src[idx];
      sumG += src[idx + 1];
      sumB += src[idx + 2];
      sumA += src[idx + 3];
    }
    for (let j = 0; j < lineLen; j += 1) {
      const outIdx = base + j * elemStride;
      dst[outIdx] = sumR * inv;
      dst[outIdx + 1] = sumG * inv;
      dst[outIdx + 2] = sumB * inv;
      dst[outIdx + 3] = sumA * inv;

      const addPos = clamp(j + radius + 1, 0, lineLen - 1);
      const subPos = clamp(j - radius, 0, lineLen - 1);
      const addIdx = base + addPos * elemStride;
      const subIdx = base + subPos * elemStride;
      sumR += src[addIdx] - src[subIdx];
      sumG += src[addIdx + 1] - src[subIdx + 1];
      sumB += src[addIdx + 2] - src[subIdx + 2];
      sumA += src[addIdx + 3] - src[subIdx + 3];
    }
  }
}

/**
 * Программное размытие по Гауссу (3-проходный separable box blur по premultiplied RGBA).
 * Используется как фоллбэк, если 2D-контекст не поддерживает `ctx.filter`.
 */
export function applyBoxBlurToCanvas(canvas: HTMLCanvasElement, radiusPx: number): void {
  if (radiusPx <= 0.1) return;
  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const len = data.length;
  const bufA = new Float32Array(len);
  const bufB = new Float32Array(len);

  for (let i = 0; i < len; i += 4) {
    const a = data[i + 3] / 255;
    bufA[i] = data[i] * a;
    bufA[i + 1] = data[i + 1] * a;
    bufA[i + 2] = data[i + 2] * a;
    bufA[i + 3] = data[i + 3];
  }

  const passes = radiusPx < 1 ? 1 : 3;
  const boxRadius =
    radiusPx < 1
      ? 1
      : Math.max(1, Math.round(Math.sqrt(radiusPx * radiusPx + 0.25) - 0.5));

  for (let p = 0; p < passes; p += 1) {
    boxBlur1D(bufA, bufB, h, w, 4, w * 4, boxRadius);
    boxBlur1D(bufB, bufA, w, h, w * 4, 4, boxRadius);
  }

  for (let i = 0; i < len; i += 4) {
    const a = bufA[i + 3];
    if (a > 0.5) {
      const invA = 255 / a;
      data[i] = clamp(Math.round(bufA[i] * invA), 0, 255);
      data[i + 1] = clamp(Math.round(bufA[i + 1] * invA), 0, 255);
      data[i + 2] = clamp(Math.round(bufA[i + 2] * invA), 0, 255);
      data[i + 3] = clamp(Math.round(a), 0, 255);
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

export function needsOffscreenEffectSurface(effects?: LayerEffects): boolean {
  if (!effects) return false;
  return Boolean(
    effects.innerShadow ||
      (effects.motionBlur && effects.motionBlur.amount > 0.1) ||
      (effects.blur && effects.blur > 0.1 && !supportsCanvasFilter()) ||
      (effects.dropShadow && effects.outerGlow && effects.outerGlow.blur > 0 && !supportsCanvasFilter())
  );
}

export interface LayerEffectSurface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  ox: number;
  oy: number;
  w: number;
  h: number;
  scale: number;
}

export function createLayerEffectSurface(
  localBox: BBox,
  effects?: LayerEffects
): LayerEffectSurface | null {
  const innerPad = effects?.innerShadow
    ? Math.ceil(
        effects.innerShadow.blur * 2 +
          Math.max(
            Math.abs(effects.innerShadow.offsetX),
            Math.abs(effects.innerShadow.offsetY)
          )
      ) + 8
    : 0;
  const pad = Math.max(getEffectsPadding(effects), innerPad, 8);
  const ox = localBox.x - pad;
  const oy = localBox.y - pad;
  const w = Math.max(1, localBox.width + pad * 2);
  const h = Math.max(1, localBox.height + pad * 2);
  const scale = Math.min(1, 2048 / Math.max(w, h));
  const canvas = createCanvas(w * scale, h * scale);
  const surfCtx = canvas.getContext('2d');
  if (!surfCtx) {
    zeroCanvas(canvas);
    return null;
  }
  surfCtx.scale(scale, scale);
  surfCtx.translate(-ox, -oy);
  const caStr = buildColorAdjustFilter(effects);
  if (caStr && 'filter' in surfCtx) {
    surfCtx.filter = caStr;
  }
  return { canvas, ctx: surfCtx, ox, oy, w, h, scale };
}

export function finishLayerEffectSurface(
  targetCtx: CanvasRenderingContext2D,
  surface: LayerEffectSurface,
  effects?: LayerEffects
): void {
  let activeCanvas = surface.canvas;
  const { scale } = surface;
  const pw = activeCanvas.width;
  const ph = activeCanvas.height;

  const useNativeFilter = supportsCanvasFilter();
  let motionCanvas: HTMLCanvasElement | null = null;

  try {
    if (effects?.innerShadow) {
      const is = effects.innerShadow;
      const invCanvas = createCanvas(pw, ph);
      const shadowCanvas = createCanvas(pw, ph);
      try {
        const invCtx = invCanvas.getContext('2d');
        const shadowCtx = shadowCanvas.getContext('2d');
        const activeCtx = activeCanvas.getContext('2d');
        if (invCtx && shadowCtx && activeCtx) {
          invCtx.fillStyle = colorWithOpacity(is.color, is.opacity);
          invCtx.fillRect(0, 0, pw, ph);
          invCtx.globalCompositeOperation = 'destination-out';
          invCtx.drawImage(activeCanvas, 0, 0);

          if (is.blur > 0.1 && useNativeFilter) {
            shadowCtx.filter = `blur(${(is.blur * scale).toFixed(2)}px)`;
            shadowCtx.drawImage(invCanvas, is.offsetX * scale, is.offsetY * scale);
          } else {
            shadowCtx.drawImage(invCanvas, is.offsetX * scale, is.offsetY * scale);
            if (is.blur > 0.1) {
              applyBoxBlurToCanvas(shadowCanvas, is.blur * scale);
            }
          }

          activeCtx.save();
          activeCtx.setTransform(1, 0, 0, 1, 0, 0);
          activeCtx.filter = 'none';
          activeCtx.globalCompositeOperation = 'source-atop';
          activeCtx.drawImage(shadowCanvas, 0, 0);
          activeCtx.restore();
        }
      } finally {
        zeroCanvas(invCanvas);
        zeroCanvas(shadowCanvas);
      }
    }

    if (effects?.motionBlur && effects.motionBlur.amount > 0.1) {
      const mb = effects.motionBlur;
      let steps = clamp(Math.ceil(mb.amount / 2), 9, 25);
      if (steps % 2 === 0) steps += 1;
      const rad = degToRad(mb.angle);
      const dx = Math.cos(rad) * mb.amount * scale;
      const dy = Math.sin(rad) * mb.amount * scale;
      motionCanvas = createCanvas(pw, ph);
      const motionCtx = motionCanvas.getContext('2d');
      if (motionCtx) {
        for (let i = 0; i < steps; i += 1) {
          const t = steps === 1 ? 0 : i / (steps - 1) - 0.5;
          motionCtx.globalAlpha = 1 / (i + 1);
          motionCtx.drawImage(activeCanvas, dx * t, dy * t);
        }
        activeCanvas = motionCanvas;
      }
    }

    const hasGaussianBlur = Boolean(effects?.blur && effects.blur > 0.1);
    if (hasGaussianBlur && !useNativeFilter) {
      applyBoxBlurToCanvas(activeCanvas, effects!.blur! * scale);
    }

    if (!useNativeFilter && effects?.outerGlow && effects.outerGlow.blur > 0 && effects?.dropShadow) {
      targetCtx.save();
      targetCtx.shadowColor = colorWithOpacity(effects.outerGlow.color, effects.outerGlow.opacity);
      targetCtx.shadowOffsetX = 0;
      targetCtx.shadowOffsetY = 0;
      targetCtx.shadowBlur = effects.outerGlow.blur;
      targetCtx.drawImage(activeCanvas, surface.ox, surface.oy, surface.w, surface.h);
      targetCtx.restore();

      targetCtx.save();
      targetCtx.shadowColor = colorWithOpacity(effects.dropShadow.color, effects.dropShadow.opacity);
      targetCtx.shadowOffsetX = effects.dropShadow.offsetX;
      targetCtx.shadowOffsetY = effects.dropShadow.offsetY;
      targetCtx.shadowBlur = effects.dropShadow.blur;
      targetCtx.drawImage(activeCanvas, surface.ox, surface.oy, surface.w, surface.h);
      targetCtx.restore();
      return;
    }

    applyEffectsToContext(targetCtx, effects, {
      includeColorAdjust: false,
      includeBlur: useNativeFilter,
    });
    targetCtx.drawImage(activeCanvas, surface.ox, surface.oy, surface.w, surface.h);
  } finally {
    zeroCanvas(motionCanvas);
    zeroCanvas(surface.canvas);
  }
}

export function applyEffectsToContext(
  ctx: CanvasRenderingContext2D,
  effects?: LayerEffects,
  options: { includeColorAdjust?: boolean; includeBlur?: boolean } = {}
): void {
  if (!effects || !hasRasterEffects(effects)) return;
  const filterStr = buildFilterString(effects, options);
  if (supportsCanvasFilter() && filterStr !== 'none') {
    ctx.filter = filterStr;
  } else if (effects.dropShadow) {
    ctx.shadowColor = colorWithOpacity(effects.dropShadow.color, effects.dropShadow.opacity);
    ctx.shadowOffsetX = effects.dropShadow.offsetX;
    ctx.shadowOffsetY = effects.dropShadow.offsetY;
    ctx.shadowBlur = effects.dropShadow.blur;
  } else if (effects.outerGlow && effects.outerGlow.blur > 0) {
    ctx.shadowColor = colorWithOpacity(effects.outerGlow.color, effects.outerGlow.opacity);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = effects.outerGlow.blur;
  }
}
