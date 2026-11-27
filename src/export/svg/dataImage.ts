import { inferImageMimeType, registerAssetFromBytes } from '../../core/assets';
import { createLayerId } from '../../core/commands/helpers';
import { applyMatrixToPoint, type Matrix2D } from '../../core/math';
import type { BlendMode, ImageLayer } from '../../core/types';

export interface SvgImageMeta {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PendingImage {
  meta: SvgImageMeta;
  matrix: Matrix2D;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  blendMode?: BlendMode;
  visible: boolean;
  name: string;
  clipMaskId?: string;
}

export function readSvgImageMeta(node: Element): SvgImageMeta | undefined {
  const href =
    node.getAttribute('href') ??
    node.getAttribute('xlink:href') ??
    node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    '';
  if (!href) return undefined;

  return {
    href: href.trim(),
    x: Number.parseFloat(node.getAttribute('x') ?? '0') || 0,
    y: Number.parseFloat(node.getAttribute('y') ?? '0') || 0,
    width: Number.parseFloat(node.getAttribute('width') ?? '0') || 0,
    height: Number.parseFloat(node.getAttribute('height') ?? '0') || 0,
  };
}

export function decodeDataImageUrl(href: string): { bytes: Uint8Array; mimeType: string } | null {
  const commaIdx = href.indexOf(',');
  if (commaIdx === -1 || !href.startsWith('data:')) return null;
  const header = href.slice(5, commaIdx);
  const payload = href.slice(commaIdx + 1);
  const metaParts = header
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const mimeType = metaParts[0]?.toLowerCase() ?? '';
  if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType) || mimeType === 'image/svg+xml') {
    return null;
  }
  const isBase64 = metaParts.slice(1).some((p) => p.toLowerCase() === 'base64');

  try {
    if (isBase64) {
      const binary = atob(payload.replace(/\s+/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { bytes, mimeType };
    }
    const decoded = decodeURIComponent(payload);
    return { bytes: new TextEncoder().encode(decoded), mimeType };
  } catch {
    return null;
  }
}

export async function resolvePendingImages(
  pendingImages: PendingImage[],
  addWarning: (msg: string) => void
): Promise<Map<number, ImageLayer>> {
  const resolvedImages = new Map<number, ImageLayer>();
  for (let i = 0; i < pendingImages.length; i += 1) {
    const pending = pendingImages[i];
    const decoded = decodeDataImageUrl(pending.meta.href);
    if (!decoded) {
      addWarning('Не удалось декодировать встроенное изображение в SVG');
      continue;
    }

    const mimeType =
      decoded.mimeType || inferImageMimeType(pending.name, decoded.bytes);
    const asset = await registerAssetFromBytes({
      bytes: decoded.bytes,
      name: pending.name,
      mimeType,
    });

    const w = pending.meta.width > 0 ? pending.meta.width : asset.naturalWidth;
    const h = pending.meta.height > 0 ? pending.meta.height : asset.naturalHeight;
    const center = applyMatrixToPoint(pending.matrix, {
      x: pending.meta.x + w / 2,
      y: pending.meta.y + h / 2,
    });
    const sx = (pending.scaleX * w) / Math.max(1, asset.naturalWidth);
    const sy = (pending.scaleY * h) / Math.max(1, asset.naturalHeight);

    resolvedImages.set(i, {
      id: createLayerId('img'),
      name: pending.name,
      type: 'image',
      visible: pending.visible,
      locked: false,
      x: center.x,
      y: center.y,
      rotation: Number(pending.rotation.toFixed(3)),
      scaleX: Number(sx.toFixed(4)),
      scaleY: Number(sy.toFixed(4)),
      opacity: pending.opacity,
      ...(pending.blendMode ? { blendMode: pending.blendMode } : {}),
      assetId: asset.id,
      width: asset.naturalWidth,
      height: asset.naturalHeight,
      ...(pending.clipMaskId ? { clipMaskId: pending.clipMaskId } : {}),
    });
  }
  return resolvedImages;
}
