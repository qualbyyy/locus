import JSZip from 'jszip';
import { clearAssets, getAllAssets, registerAssetFromBytes } from '../core/assets';
import { loadScene } from '../core/commands';
import type { Layer, Scene } from '../core/types';

export const LOCUS_SCENE_ENTRY = 'scene.json';
export const LOCUS_ASSET_DIR = 'assets';

/** ID картинок, на которые реально ссылаются ImageLayer (включая невидимые). */
export function collectUsedAssetIds(scene: Scene): Set<string> {
  const used = new Set<string>();
  for (const layer of scene.layers as Layer[]) {
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
    layers: scene.layers,
  };
}

function isValidScene(value: unknown): value is Scene {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Scene>;
  return (
    s.version === 1 &&
    typeof s.name === 'string' &&
    typeof s.width === 'number' &&
    Number.isFinite(s.width) &&
    s.width > 0 &&
    typeof s.height === 'number' &&
    Number.isFinite(s.height) &&
    s.height > 0 &&
    typeof s.dpi === 'number' &&
    Number.isFinite(s.dpi) &&
    typeof s.background === 'string' &&
    Array.isArray(s.layers)
  );
}

/**
 * Сериализует проект в `.locus` (ZIP): `scene.json` + только используемые ассеты.
 * Байты ассетов читаются из `AssetRegistry` по `blob.arrayBuffer()`.
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

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Парсит `.locus` без применения к стору — для тестов и предпросмотра. */
export async function parseLocusArchive(bytes: Uint8Array): Promise<{
  scene: Scene;
  assets: Array<{ id: string; name: string; mimeType: string; bytes: Uint8Array }>;
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
  // `zip.folder()` возвращает общий словарь архива, поэтому фильтруем по префиксу.
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

  return { scene, assets };
}

/**
 * Открывает `.locus`: очищает старый `AssetRegistry`, регистрирует ассеты
 * из архива, восстанавливает размеры картинок из `ImageLayer` и загружает сцену
 * с очисткой истории `zundo`.
 */
export async function openLocusFromBytes(bytes: Uint8Array): Promise<Scene> {
  const { scene, assets } = await parseLocusArchive(bytes);

  // Целостность проверяем ДО очистки реестра: при ошибке текущий документ не трогаем.
  const available = new Set(assets.map((a) => a.id));
  const missing = (scene.layers as Layer[]).filter(
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

  return loadScene(scene);
}
