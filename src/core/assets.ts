import type { AssetEntry } from './types';

const assets = new Map<string, AssetEntry>();
const imageElements = new Map<string, HTMLImageElement>();
const blobUrls = new Set<string>();
const listeners = new Set<() => void>();

let assetFallbackCounter = 0;
let registryGeneration = 0;

function createAssetId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `asset_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  assetFallbackCounter += 1;
  return `asset_${Date.now().toString(36)}_${assetFallbackCounter}`;
}

function notifyAssetListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length && offset + i < bytes.length; i++) {
    out += String.fromCharCode(bytes[offset + i]);
  }
  return out;
}

export function inferImageMimeType(fileName: string, bytes?: Uint8Array): string {
  if (bytes && bytes.length >= 4) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      bytes.length >= 12 &&
      asciiAt(bytes, 0, 4) === 'RIFF' &&
      asciiAt(bytes, 8, 4) === 'WEBP'
    ) {
      return 'image/webp';
    }
    const prefix = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(0, Math.min(bytes.length, 512))
    );
    if (/<svg[\s>]/i.test(prefix)) {
      return 'image/svg+xml';
    }
  }

  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
    default:
      return 'image/png';
  }
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return null;
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;

    if (
      marker === 0x00 ||
      marker === 0x01 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }

    if (offset + 2 > bytes.length) break;
    const segLen = readUint16BE(bytes, offset);
    if (segLen < 2) break;

    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isSof) {
      if (offset + 7 <= bytes.length) {
        const height = readUint16BE(bytes, offset + 3);
        const width = readUint16BE(bytes, offset + 5);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
      break;
    }

    offset += segLen;
  }
  return null;
}

function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length < 30 ||
    asciiAt(bytes, 0, 4) !== 'RIFF' ||
    asciiAt(bytes, 8, 4) !== 'WEBP'
  ) {
    return null;
  }

  const chunk = asciiAt(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    if (bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
    return null;
  }

  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    if (width > 0 && height > 0) return { width, height };
    return null;
  }

  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    if (width > 0 && height > 0) return { width, height };
  }

  return null;
}

function parseSvgNumericAttr(tag: string, attrName: string): number | null {
  const match = tag.match(
    new RegExp(`\\b${attrName}\\s*=\\s*["']\\s*([^"']+)\\s*["']`, 'i')
  );
  if (!match) return null;
  const raw = match[1].trim();
  if (raw.endsWith('%')) return null;
  const num = Number.parseFloat(raw);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
}

function parseSvgDimensions(bytes: Uint8Array): { width: number; height: number } {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.length, 4096))
  );
  const svgMatch = head.match(/<svg\b[^>]*>/i);
  if (!svgMatch) {
    return { width: 512, height: 512 };
  }

  const tag = svgMatch[0];
  const widthAttr = parseSvgNumericAttr(tag, 'width');
  const heightAttr = parseSvgNumericAttr(tag, 'height');
  if (widthAttr && heightAttr) {
    return { width: widthAttr, height: heightAttr };
  }

  const vbMatch = tag.match(/\bviewBox\s*=\s*["']\s*([^"']+)\s*["']/i);
  if (vbMatch) {
    const parts = vbMatch[1]
      .trim()
      .split(/[\s,]+/)
      .map((v) => Number.parseFloat(v));
    if (
      parts.length === 4 &&
      Number.isFinite(parts[2]) &&
      Number.isFinite(parts[3]) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return {
        width: widthAttr ?? Math.round(parts[2]),
        height: heightAttr ?? Math.round(parts[3]),
      };
    }
  }

  return { width: 512, height: 512 };
}

export function parseImageDimensionsFromBytes(
  bytes: Uint8Array,
  mimeType: string
): { width: number; height: number } | null {
  if (mimeType === 'image/png') return parsePngDimensions(bytes);
  if (mimeType === 'image/jpeg') return parseJpegDimensions(bytes);
  if (mimeType === 'image/webp') return parseWebpDimensions(bytes);
  if (mimeType === 'image/svg+xml') return parseSvgDimensions(bytes);
  return (
    parsePngDimensions(bytes) ??
    parseJpegDimensions(bytes) ??
    parseWebpDimensions(bytes)
  );
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  const chunkSize = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    parts.push(String.fromCharCode(...slice));
  }
  const base64 = btoa(parts.join(''));
  return `data:${mimeType};base64,${base64}`;
}

function isBrowserImageDecodingSupported(): boolean {
  if (typeof Image === 'undefined') return false;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return false;
  }
  return true;
}

function decodeHtmlImage(src: string): Promise<HTMLImageElement | null> {
  if (!isBrowserImageDecodingSupported()) {
    return Promise.resolve(null);
  }

  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (result: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(result);
    };

    const timer = window.setTimeout(() => finish(null), 1500);
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = src;
  });
}

export interface PreparedAsset {
  entry: AssetEntry;
  decodedImg: HTMLImageElement | null;
}

export async function prepareAssetFromBytes(params: {
  bytes: Uint8Array;
  name: string;
  mimeType?: string;
  id?: string;
}): Promise<PreparedAsset> {
  const copy = new Uint8Array(params.bytes.byteLength);
  copy.set(params.bytes);

  const mimeType = params.mimeType ?? inferImageMimeType(params.name, copy);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const canCreateObjectUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  const objectUrl = canCreateObjectUrl
    ? URL.createObjectURL(blob)
    : bytesToDataUrl(copy, mimeType);

  if (canCreateObjectUrl) {
    blobUrls.add(objectUrl);
  }

  const parsedDims = parseImageDimensionsFromBytes(copy, mimeType);
  const decodedImg = await decodeHtmlImage(objectUrl);

  const naturalWidth = Math.max(
    1,
    decodedImg?.naturalWidth || parsedDims?.width || 512
  );
  const naturalHeight = Math.max(
    1,
    decodedImg?.naturalHeight || parsedDims?.height || 512
  );

  const id = params.id ?? createAssetId();
  return {
    entry: {
      id,
      name: params.name,
      mimeType,
      blob,
      objectUrl,
      naturalWidth,
      naturalHeight,
    },
    decodedImg,
  };
}

export function disposePreparedAssets(prepared: PreparedAsset[]): void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  for (const item of prepared) {
    if (blobUrls.has(item.entry.objectUrl)) {
      URL.revokeObjectURL(item.entry.objectUrl);
      blobUrls.delete(item.entry.objectUrl);
    }
  }
}

export function commitLoadedAssets(prepared: PreparedAsset[]): void {
  registryGeneration += 1;
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    const keepUrls = new Set(prepared.map((p) => p.entry.objectUrl));
    for (const url of Array.from(blobUrls)) {
      if (!keepUrls.has(url)) {
        URL.revokeObjectURL(url);
        blobUrls.delete(url);
      }
    }
  }
  imageElements.clear();
  assets.clear();
  for (const item of prepared) {
    assets.set(item.entry.id, item.entry);
    if (item.decodedImg) {
      imageElements.set(item.entry.id, item.decodedImg);
    }
  }
  notifyAssetListeners();
}

export async function registerAssetFromBytes(params: {
  bytes: Uint8Array;
  name: string;
  mimeType?: string;
  id?: string;
}): Promise<AssetEntry> {
  const genAtStart = registryGeneration;
  const { entry, decodedImg } = await prepareAssetFromBytes(params);

  if (registryGeneration !== genAtStart) {
    if (
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function' &&
      blobUrls.has(entry.objectUrl)
    ) {
      URL.revokeObjectURL(entry.objectUrl);
      blobUrls.delete(entry.objectUrl);
    }
    return entry;
  }

  const prev = assets.get(entry.id);
  if (prev && prev.objectUrl !== entry.objectUrl) {
    if (
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function' &&
      blobUrls.has(prev.objectUrl)
    ) {
      URL.revokeObjectURL(prev.objectUrl);
      blobUrls.delete(prev.objectUrl);
    }
    imageElements.delete(entry.id);
  }

  assets.set(entry.id, entry);
  if (decodedImg) {
    imageElements.set(entry.id, decodedImg);
  }
  notifyAssetListeners();
  return entry;
}

export function getAsset(assetId: string): AssetEntry | undefined {
  return assets.get(assetId);
}

export function getAssetImageElement(assetId: string): HTMLImageElement | undefined {
  return imageElements.get(assetId);
}

export function getAllAssets(): AssetEntry[] {
  return Array.from(assets.values());
}

export async function assetToDataUrl(assetId: string): Promise<string | null> {
  const entry = assets.get(assetId);
  if (!entry) return null;
  if (entry.objectUrl.startsWith('data:')) {
    return entry.objectUrl;
  }
  const buffer = await entry.blob.arrayBuffer();
  return bytesToDataUrl(new Uint8Array(buffer), entry.mimeType);
}

export function clearAssets(): void {
  registryGeneration += 1;
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    for (const url of blobUrls) {
      URL.revokeObjectURL(url);
    }
  }
  blobUrls.clear();
  imageElements.clear();
  assets.clear();
  notifyAssetListeners();
}

export function subscribeAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
