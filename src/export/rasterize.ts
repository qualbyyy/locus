import { extractArtboardScene, getActiveArtboard } from '../core/artboards';
import { getAssetImageElement } from '../core/assets';
import {
  IDENTITY_MATRIX,
  computeLayerLocalBBox,
  computeSubPathsBBox,
  type Matrix2D,
} from '../core/math';
import type { BBox, Layer, Scene } from '../core/types';
import { getEffectsPadding, resolveEffectivePathGeometry } from '../engine/effects';
import { computeTextOnPathLocalBBox, resolveHostPathLayer } from '../engine/textOnPath';
import {
  applyMatrix,
  canvasToBytes,
  clampBBoxToArtboard,
  createCanvas,
  isCanvas2dSupported,
  zeroCanvas,
} from './raster/canvasPool';
import {
  applyBoxBlurToCanvas,
  applyEffectsToContext,
  createLayerEffectSurface,
  finishLayerEffectSurface,
  needsOffscreenEffectSurface,
  supportsCanvasFilter,
} from './raster/effectsPipeline';
import {
  defaultPaintLayer,
  paintGroupLayer,
  paintGroupSync,
  paintImageLayer,
  paintLayerList,
  paintPathLayer,
  paintTextLayer,
} from './raster/paintTree';
import { extractSelectionScene } from './selectionScene';

export {
  isCanvas2dSupported,
  createCanvas,
  clampBBoxToArtboard,
  canvasToBytes,
  supportsCanvasFilter,
  applyBoxBlurToCanvas,
  paintPathLayer,
  paintTextLayer,
  paintImageLayer,
  paintLayerList,
  paintGroupLayer,
  defaultPaintLayer,
};

export interface RasterizeOptions {
  /** Масштаб растра (1 = 1 px артборда → 1 px). */
  scale?: number;
}

export interface RasterExportOptions {
  format: 'png' | 'jpg';
  scale: number;
  quality: number; // 0.1..1
  transparent: boolean;
  backgroundColor: string;
  scope: 'artboard' | 'selection';
  selectedIds?: string[];
  artboardId?: string;
}

export interface CompositeRasterOptions {
  scale?: number;
  transparent?: boolean;
  backgroundColor?: string;
  layerIds?: string[];
  padding?: number;
  artboardId?: string;
}

export interface RasterizedLayer {
  canvas: HTMLCanvasElement;
  /** Смещение растра относительно артборда (px). */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Растеризует один слой (без клип-масок) на offscreen canvas размером с его bbox.
 * Возвращает `null`, если bbox пуст или за пределами артборда.
 */
export async function rasterizeLayer(
  layer: Layer,
  scene: Scene,
  bboxOf: (l: Layer) => BBox,
  scale = 1,
  parentMatrix: Matrix2D = IDENTITY_MATRIX
): Promise<RasterizedLayer | null> {
  const box = clampBBoxToArtboard(bboxOf(layer), scene);
  if (box.width <= 0 || box.height <= 0) return null;

  const canvas = createCanvas(box.width * scale, box.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.translate(-box.left, -box.top);
  applyMatrix(ctx, parentMatrix);

  const isolatedLayer = { ...layer, blendMode: 'normal' as const };
  if (isolatedLayer.type === 'path') paintPathLayer(ctx, isolatedLayer);
  else if (isolatedLayer.type === 'text') paintTextLayer(ctx, isolatedLayer, scene.layers);
  else if (isolatedLayer.type === 'group') {
    await paintGroupLayer(ctx, isolatedLayer, defaultPaintLayer, scene.layers);
  } else {
    await paintImageLayer(ctx, isolatedLayer);
  }

  return { canvas, left: box.left, top: box.top, width: box.width, height: box.height };
}

/**
 * Композитный рендер всего документа, артборда или выделенных слоёв.
 */
export async function rasterizeComposite(
  scene: Scene,
  scaleOrOptions: number | CompositeRasterOptions = 1,
  paintLayer: (ctx: CanvasRenderingContext2D, layer: Layer, sceneLayers?: Layer[]) => Promise<void> | void = defaultPaintLayer
): Promise<HTMLCanvasElement> {
  const opts: CompositeRasterOptions =
    typeof scaleOrOptions === 'number' ? { scale: scaleOrOptions } : scaleOrOptions;
  const baseScene = opts.artboardId
    ? extractArtboardScene(scene, getActiveArtboard(scene, opts.artboardId))
    : scene;
  const targetScene =
    opts.layerIds && opts.layerIds.length > 0
      ? extractSelectionScene(baseScene, opts.layerIds, opts.padding ?? 0) ?? baseScene
      : baseScene;
  const scale = Math.max(0.05, opts.scale ?? 1);
  const width = targetScene.width;
  const height = targetScene.height;

  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.scale(scale, scale);
  if (!opts.transparent) {
    const bg = opts.backgroundColor ?? targetScene.background;
    if (bg && bg !== 'transparent') {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
    }
  }

  await paintLayerList(ctx, targetScene.layers, paintLayer, targetScene.layers);
  return canvas;
}

export async function rasterizeSceneToBytes(
  scene: Scene,
  options: RasterExportOptions
): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}> {
  const isJpg = options.format === 'jpg';
  const transparent = isJpg ? false : options.transparent;
  const activeAb = options.artboardId
    ? getActiveArtboard(scene, options.artboardId)
    : null;
  const backgroundColor =
    isJpg && options.transparent
      ? '#ffffff'
      : options.backgroundColor || activeAb?.background || scene.background || '#ffffff';
  const canvas = await rasterizeComposite(scene, {
    scale: options.scale,
    transparent,
    backgroundColor,
    layerIds:
      options.scope === 'selection' && options.selectedIds?.length
        ? options.selectedIds
        : undefined,
    artboardId: options.scope === 'artboard' ? options.artboardId : undefined,
  });
  const bytes = await canvasToBytes(canvas, options.format, options.quality);
  return {
    bytes,
    width: canvas.width,
    height: canvas.height,
    canvas,
  };
}

/**
 * Синхронный рендер одного слоя в его локальных координатах с эффектами (для Paper.js Raster при blur).
 */
export function rasterizeLayerLocalWithEffects(
  layer: Layer,
  maxDim = 2048,
  sceneLayers?: Layer[]
): { canvas: HTMLCanvasElement; centerX: number; centerY: number; scale: number } | null {
  if (!isCanvas2dSupported()) return null;

  let localBox: BBox;
  if (layer.type === 'path') {
    const geom = resolveEffectivePathGeometry(layer);
    localBox = computeSubPathsBBox(geom.subpaths);
    const strokePad = layer.stroke ? layer.stroke.width : 0;
    if (strokePad > 0) {
      localBox = {
        x: localBox.x - strokePad,
        y: localBox.y - strokePad,
        width: localBox.width + strokePad * 2,
        height: localBox.height + strokePad * 2,
      };
    }
  } else if (layer.type === 'text' && sceneLayers) {
    const hostPath = resolveHostPathLayer(sceneLayers, layer.pathId);
    localBox = hostPath
      ? computeTextOnPathLocalBBox(layer, hostPath, sceneLayers)
      : computeLayerLocalBBox(layer);
  } else {
    localBox = computeLayerLocalBBox(layer);
  }

  const pad = getEffectsPadding(layer.effects);
  const w = Math.max(1, localBox.width + pad * 2);
  const h = Math.max(1, localBox.height + pad * 2);
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    zeroCanvas(canvas);
    return null;
  }

  const originX = localBox.x - pad;
  const originY = localBox.y - pad;
  ctx.scale(scale, scale);

  const localLayer = {
    ...layer,
    x: -originX,
    y: -originY,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    blendMode: 'normal' as const,
  };

  if (localLayer.type === 'path') {
    paintPathLayer(ctx, localLayer);
  } else if (localLayer.type === 'text') {
    paintTextLayer(ctx, localLayer, sceneLayers);
  } else if (localLayer.type === 'group') {
    paintGroupSync(ctx, localLayer, sceneLayers);
  } else {
    const img = getAssetImageElement(localLayer.assetId);
    if (!img) {
      zeroCanvas(canvas);
      return null;
    }
    ctx.save();
    ctx.translate(localLayer.x, localLayer.y);
    if (needsOffscreenEffectSurface(localLayer.effects)) {
      const surface = createLayerEffectSurface(computeLayerLocalBBox(localLayer), localLayer.effects);
      if (surface) {
        surface.ctx.drawImage(img, -localLayer.width / 2, -localLayer.height / 2, localLayer.width, localLayer.height);
        finishLayerEffectSurface(ctx, surface, localLayer.effects);
        ctx.restore();
        return {
          canvas,
          centerX: originX + w / 2,
          centerY: originY + h / 2,
          scale,
        };
      }
    }
    applyEffectsToContext(ctx, localLayer.effects);
    ctx.drawImage(img, -localLayer.width / 2, -localLayer.height / 2, localLayer.width, localLayer.height);
    ctx.restore();
  }

  return {
    canvas,
    centerX: originX + w / 2,
    centerY: originY + h / 2,
    scale,
  };
}
