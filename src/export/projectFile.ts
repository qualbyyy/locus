import JSZip from 'jszip';
import { getSceneArtboards } from '../core/artboards';
import { clearAssets, getAllAssets, registerAssetFromBytes } from '../core/assets';
import { loadScene } from '../core/commands';
import {
  clearProjectFonts,
  extensionForFontMime,
  getProjectFonts,
  registerProjectFontFromBytes,
} from '../core/fonts';
import { flattenLayers } from '../core/layerTree';
import { useEditorStore } from '../core/store';
import type { Artboard, Scene } from '../core/types';

export const LOCUS_SCENE_ENTRY = 'scene.json';
export const LOCUS_ASSET_DIR = 'assets';
export const LOCUS_FONT_DIR = 'fonts';
export const LOCUS_FONT_MANIFEST = 'fonts/manifest.json';

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
    typeof s.background !== 'string' ||
    !Array.isArray(s.layers)
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
  const sceneFile = zip.file(LOCUS_SCENE_ENTRY);
  if (!sceneFile) {
    throw new Error('Файл не является проектом Locus: отсутствует scene.json');
  }

  const parsed = JSON.parse(await sceneFile.async('string')) as unknown;
  if (!isValidScene(parsed)) {
    throw new Error('Файл не является проектом Locus: неверная версия или структура сцены');
  }
  const scene = parsed;

  const assets: Array<{ id: string; name: string; mimeType: string; bytes: Uint8Array }> = [];
  const assetEntries = Object.values(zip.files).filter(
    (f) => !f.dir && f.name.startsWith(`${LOCUS_ASSET_DIR}/`)
  );
  for (const file of assetEntries) {
    const base = file.name.split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    const id = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot + 1) : 'png';
    assets.push({
      id,
      name: base,
      mimeType: mimeForExtension(ext),
      bytes: await file.async('uint8array'),
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
      const manifest = JSON.parse(await manifestFile.async('string')) as unknown;
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
          const fontFile = zip.file(meta.entryName);
          if (!fontFile) continue;
          fonts.push({
            id: meta.id,
            family: meta.family,
            fileName: typeof meta.fileName === 'string' ? meta.fileName : `${meta.family}.ttf`,
            weight: meta.weight === 700 ? 700 : 400,
            mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : 'font/ttf',
            bytes: await fontFile.async('uint8array'),
          });
        }
      }
    } catch {
      // Ignore malformed font manifest and continue loading scene.
    }
  }

  return { scene, assets, fonts };
}

/**
 * Открывает `.locus`: очищает старые реестры ассетов и шрифтов, регистрирует ресурсы
 * из архива и загружает сцену с очисткой истории `zundo`.
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

  clearAssets();
  for (const asset of assets) {
    await registerAssetFromBytes({
      id: asset.id,
      name: asset.name,
      mimeType: asset.mimeType,
      bytes: asset.bytes,
    });
  }

  clearProjectFonts();
  for (const font of fonts) {
    await registerProjectFontFromBytes({
      id: font.id,
      family: font.family,
      fileName: font.fileName,
      weight: font.weight,
      bytes: font.bytes,
    });
  }

  const loaded = loadScene(scene);
  useEditorStore.setState({
    editingGroupId: null,
    activeArtboardId: getSceneArtboards(loaded)[0].id,
  });
  return loaded;
}
