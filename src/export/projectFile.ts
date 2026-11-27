import JSZip from 'jszip';
import { getSceneArtboards } from '../core/artboards';
import {
  commitLoadedAssets,
  disposePreparedAssets,
  getAllAssets,
  prepareAssetFromBytes,
  type PreparedAsset,
} from '../core/assets';
import { loadScene } from '../core/commands';
import {
  commitLoadedProjectFonts,
  extensionForFontMime,
  getProjectFonts,
  prepareProjectFontEntry,
  type ProjectFontEntry,
} from '../core/fonts';
import { flattenLayers } from '../core/layerTree';
import { useEditorStore } from '../core/store';
import type { Artboard, Layer, Scene } from '../core/types';

export const LOCUS_SCENE_ENTRY = 'scene.json';
export const LOCUS_ASSET_DIR = 'assets';
export const LOCUS_FONT_DIR = 'fonts';
export const LOCUS_FONT_MANIFEST = 'fonts/manifest.json';

const MAX_ZIP_ENTRIES = 2000;
const MAX_SINGLE_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_LAYER_DEPTH = 64;

interface StoredFontManifestEntry {
  id: string;
  family: string;
  fileName: string;
  weight: 400 | 700;
  mimeType: string;
  entryName: string;
}

/** ID картинок, на которые реально ссылаются ImageLayer (включая вложенные в группы и невидимые). */
export function collectUsedAssetIds(scene: Scene): Set<string> {
  const used = new Set<string>();
  for (const layer of flattenLayers(scene.layers)) {
    if (layer.type === 'image' && layer.assetId) {
      used.add(layer.assetId);
    }
  }
  return used;
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/png':
    default:
      return 'png';
  }
}

function mimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
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

/** Копия сцены без служебных полей, которые не входят в формат (`version: 1`). */
function sanitizeScene(scene: Scene): Scene {
  return {
    version: 1,
    name: scene.name,
    width: scene.width,
    height: scene.height,
    dpi: scene.dpi,
    background: scene.background,
    ...(scene.artboards && scene.artboards.length > 0
      ? { artboards: scene.artboards }
      : {}),
    ...(scene.guides && scene.guides.length > 0 ? { guides: scene.guides } : {}),
    layers: scene.layers,
  };
}

function isValidArtboard(ab: unknown): ab is Artboard {
  if (!ab || typeof ab !== 'object') return false;
  const a = ab as Partial<Artboard>;
  return (
    typeof a.id === 'string' &&
    a.id.length > 0 &&
    typeof a.name === 'string' &&
    typeof a.x === 'number' &&
    Number.isFinite(a.x) &&
    typeof a.y === 'number' &&
    Number.isFinite(a.y) &&
    typeof a.width === 'number' &&
    Number.isFinite(a.width) &&
    a.width > 0 &&
    typeof a.height === 'number' &&
    Number.isFinite(a.height) &&
    a.height > 0 &&
    typeof a.background === 'string'
  );
}

function isSafeArchivePath(path: string): boolean {
  if (!path || path.length > 260) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  const parts = path.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function isSafeArchiveId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= 128 &&
    !id.includes('/') &&
    !id.includes('\\') &&
    !id.includes('..') &&
    !id.includes('\0')
  );
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidLayerNode(value: unknown, depth: number): value is Layer {
  if (depth > MAX_LAYER_DEPTH || !value || typeof value !== 'object') return false;
  const l = value as Partial<Layer>;
  if (
    typeof l.id !== 'string' ||
    l.id.length === 0 ||
    typeof l.name !== 'string' ||
    typeof l.visible !== 'boolean' ||
    typeof l.locked !== 'boolean' ||
    !isFiniteNum(l.x) ||
    !isFiniteNum(l.y) ||
    !isFiniteNum(l.rotation) ||
    !isFiniteNum(l.scaleX) ||
    !isFiniteNum(l.scaleY) ||
    !isFiniteNum(l.opacity)
  ) {
    return false;
  }
  switch (l.type) {
    case 'path':
      return Array.isArray(l.subpaths);
    case 'text':
      return (
        typeof l.content === 'string' &&
        isFiniteNum(l.fontSize) &&
        l.fontSize > 0 &&
        typeof l.fontFamily === 'string'
      );
    case 'image':
      return (
        typeof l.assetId === 'string' &&
        l.assetId.length > 0 &&
        isFiniteNum(l.width) &&
        l.width > 0 &&
        isFiniteNum(l.height) &&
        l.height > 0
      );
    case 'group':
      return (
        Array.isArray(l.children) &&
        l.children.every((child) => isValidLayerNode(child, depth + 1))
      );
    default:
      return false;
  }
}

function isValidScene(value: unknown): value is Scene {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Scene>;
  if (
    s.version !== 1 ||
    typeof s.name !== 'string' ||
    typeof s.width !== 'number' ||
    !Number.isFinite(s.width) ||
    s.width <= 0 ||
    typeof s.height !== 'number' ||
    !Number.isFinite(s.height) ||
    s.height <= 0 ||
    typeof s.dpi !== 'number' ||
    !Number.isFinite(s.dpi) ||
    s.dpi <= 0 ||
    typeof s.background !== 'string' ||
    !Array.isArray(s.layers) ||
    !s.layers.every((layer) => isValidLayerNode(layer, 0))
  ) {
    return false;
  }
  if (
    s.artboards !== undefined &&
    (!Array.isArray(s.artboards) || !s.artboards.every(isValidArtboard))
  ) {
    return false;
  }
  if (
    s.guides !== undefined &&
    (!Array.isArray(s.guides) ||
      !s.guides.every(
        (g) =>
          Boolean(g) &&
          typeof g === 'object' &&
          typeof g.id === 'string' &&
          g.id.length > 0 &&
          (g.orientation === 'horizontal' || g.orientation === 'vertical') &&
          typeof g.position === 'number' &&
          Number.isFinite(g.position)
      ))
  ) {
    return false;
  }
  return true;
}

/**
 * Сериализует проект в `.locus` (ZIP): `scene.json`, используемые ассеты и шрифты проекта.
 */
export async function buildLocusArchive(scene: Scene): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(LOCUS_SCENE_ENTRY, JSON.stringify(sanitizeScene(scene)));

  const usedIds = collectUsedAssetIds(scene);
  for (const entry of getAllAssets()) {
    if (!usedIds.has(entry.id)) continue;
    const buffer = await entry.blob.arrayBuffer();
    const ext = extensionForMime(entry.mimeType);
    zip.file(`${LOCUS_ASSET_DIR}/${entry.id}.${ext}`, buffer);
  }

  const fonts = getProjectFonts();
  if (fonts.length > 0) {
    const manifest: StoredFontManifestEntry[] = fonts.map((font) => {
      const ext = extensionForFontMime(font.mimeType);
      const entryName = `${LOCUS_FONT_DIR}/${font.id}.${ext}`;
      zip.file(entryName, font.bytes);
      return {
        id: font.id,
        family: font.family,
        fileName: font.fileName,
        weight: font.weight,
        mimeType: font.mimeType,
        entryName,
      };
    });
    zip.file(LOCUS_FONT_MANIFEST, JSON.stringify(manifest));
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Парсит `.locus` без применения к стору — для тестов и предпросмотра. */
export async function parseLocusArchive(bytes: Uint8Array): Promise<{
  scene: Scene;
  assets: Array<{ id: string; name: string; mimeType: string; bytes: Uint8Array }>;
  fonts: Array<{
    id: string;
    family: string;
    fileName: string;
    weight: 400 | 700;
    mimeType: string;
    bytes: Uint8Array;
  }>;
}> {
  const zip = await JSZip.loadAsync(bytes);
  const allEntries = Object.values(zip.files);
  if (allEntries.length > MAX_ZIP_ENTRIES) {
    throw new Error('Архив .locus содержит слишком много записей');
  }
  for (const entry of allEntries) {
    const cleanName = entry.dir ? entry.name.replace(/\/+$/, '') : entry.name;
    if (cleanName && !isSafeArchivePath(cleanName)) {
      throw new Error(`Небезопасный путь в архиве: ${entry.name}`);
    }
  }

  let totalUncompressed = 0;
  const readBoundedBytes = async (entry: JSZip.JSZipObject): Promise<Uint8Array> => {
    const data = await entry.async('uint8array');
    if (data.byteLength > MAX_SINGLE_ENTRY_BYTES) {
      throw new Error(`Файл ${entry.name} превышает допустимый размер`);
    }
    totalUncompressed += data.byteLength;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('Распакованный размер архива .locus превышает лимит 256 МБ');
    }
    return data;
  };

  const sceneFile = zip.file(LOCUS_SCENE_ENTRY);
  if (!sceneFile) {
    throw new Error('Файл не является проектом Locus: отсутствует scene.json');
  }

  const sceneBytes = await readBoundedBytes(sceneFile);
  const parsed = JSON.parse(new TextDecoder('utf-8').decode(sceneBytes)) as unknown;
  if (!isValidScene(parsed)) {
    throw new Error('Файл не является проектом Locus: неверная версия или структура сцены');
  }
  const scene = parsed;

  const assets: Array<{ id: string; name: string; mimeType: string; bytes: Uint8Array }> = [];
  const assetEntries = allEntries.filter(
    (f) => !f.dir && f.name.startsWith(`${LOCUS_ASSET_DIR}/`)
  );
  for (const file of assetEntries) {
    const base = file.name.split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    const id = dot > 0 ? base.slice(0, dot) : base;
    if (!isSafeArchiveId(id)) {
      throw new Error(`Некорректный идентификатор ассета: ${file.name}`);
    }
    const ext = dot > 0 ? base.slice(dot + 1) : 'png';
    assets.push({
      id,
      name: base,
      mimeType: mimeForExtension(ext),
      bytes: await readBoundedBytes(file),
    });
  }

  const fonts: Array<{
    id: string;
    family: string;
    fileName: string;
    weight: 400 | 700;
    mimeType: string;
    bytes: Uint8Array;
  }> = [];
  const manifestFile = zip.file(LOCUS_FONT_MANIFEST);
  if (manifestFile) {
    try {
      const manifestBytes = await readBoundedBytes(manifestFile);
      const manifest = JSON.parse(new TextDecoder('utf-8').decode(manifestBytes)) as unknown;
      if (Array.isArray(manifest)) {
        for (const item of manifest) {
          if (!item || typeof item !== 'object') continue;
          const meta = item as Partial<StoredFontManifestEntry>;
          if (
            typeof meta.id !== 'string' ||
            typeof meta.family !== 'string' ||
            typeof meta.entryName !== 'string'
          ) {
            continue;
          }
          if (!isSafeArchiveId(meta.id) || !isSafeArchivePath(meta.entryName)) {
            throw new Error(`Небезопасный путь шрифта в архиве: ${meta.entryName}`);
          }
          if (!meta.entryName.startsWith(`${LOCUS_FONT_DIR}/`)) {
            continue;
          }
          const fontFile = zip.file(meta.entryName);
          if (!fontFile) continue;
          fonts.push({
            id: meta.id,
            family: meta.family,
            fileName: typeof meta.fileName === 'string' ? meta.fileName : `${meta.family}.ttf`,
            weight: meta.weight === 700 ? 700 : 400,
            mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : 'font/ttf',
            bytes: await readBoundedBytes(fontFile),
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && /превышает|Небезопасный/i.test(err.message)) {
        throw err;
      }
      // Ignore malformed font manifest and continue loading scene.
    }
  }

  return { scene, assets, fonts };
}

/**
 * Открывает `.locus` транзакционно: валидирует и подготавливает все ресурсы до изменения стора.
 */
export async function openLocusFromBytes(bytes: Uint8Array): Promise<Scene> {
  const { scene, assets, fonts } = await parseLocusArchive(bytes);

  const available = new Set(assets.map((a) => a.id));
  const missing = flattenLayers(scene.layers).filter(
    (l) => l.type === 'image' && !available.has(l.assetId)
  );
  if (missing.length > 0) {
    throw new Error(
      `В проекте отсутствуют изображения для ${missing.length} слой(ёв): ` +
        missing.map((l) => l.name).join(', ')
    );
  }

  const preparedAssets: PreparedAsset[] = [];
  const preparedFonts: ProjectFontEntry[] = [];
  try {
    for (const asset of assets) {
      preparedAssets.push(
        await prepareAssetFromBytes({
          id: asset.id,
          name: asset.name,
          mimeType: asset.mimeType,
          bytes: asset.bytes,
        })
      );
    }

    for (const font of fonts) {
      preparedFonts.push(
        prepareProjectFontEntry({
          id: font.id,
          family: font.family,
          fileName: font.fileName,
          weight: font.weight,
          bytes: font.bytes,
        })
      );
    }
  } catch (err) {
    disposePreparedAssets(preparedAssets);
    throw err;
  }

  commitLoadedAssets(preparedAssets);
  await commitLoadedProjectFonts(preparedFonts);

  const loaded = loadScene(scene);
  useEditorStore.setState({
    editingGroupId: null,
    activeArtboardId: getSceneArtboards(loaded)[0].id,
  });
  return loaded;
}
