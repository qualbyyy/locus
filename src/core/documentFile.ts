import { useEditorStore } from '../core/store';
import type { Scene } from '../core/types';
import { pickOpenFile, saveFileBytes } from '../platform/io';
import { openLocusFromBytes, buildLocusArchive } from '../export/projectFile';
import { sceneToSvg } from '../export/toSvg';
import { sceneToAiBytes } from '../export/toAi';
import { sceneToPsdBytes } from '../export/toPsd';
import {
  rasterizeSceneToBytes,
  type RasterExportOptions,
} from '../export/rasterize';

export type { RasterExportOptions } from '../export/rasterize';
export type ExportKind = 'ai' | 'svg' | 'psd' | 'png' | 'jpg';

/** Имя файла из имени документа: пробелы → `_`, запрещённые символы убираются. */
export function documentFileBaseName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'Без_названия';
}

export function locusFileName(sceneName: string): string {
  return `${documentFileBaseName(sceneName)}.locus`;
}

export function exportFileName(sceneName: string, kind: ExportKind): string {
  return `${documentFileBaseName(sceneName)}.${kind}`;
}

/** Диалог «Открыть» → `.locus`. Возвращает `true`, если проект загружен. */
export async function openProjectDialog(): Promise<Scene | null> {
  const file = await pickOpenFile({
    title: 'Открыть проект Locus',
    filters: [{ name: 'Locus Project', extensions: ['locus'] }],
  });
  if (!file) return null;
  return openLocusFromBytes(file.bytes);
}

/** Диалог «Сохранить как» → `.locus`. Возвращает путь/имя или `null` при отмене. */
export async function saveProjectDialog(): Promise<string | null> {
  const scene = useEditorStore.getState().scene;
  const bytes = await buildLocusArchive(scene);
  const target = await saveFileBytes(bytes, {
    defaultName: locusFileName(scene.name),
    filters: [{ name: 'Locus Project', extensions: ['locus'] }],
  });
  if (target !== null) {
    useEditorStore.getState().setDirty(false);
  }
  return target;
}

export async function exportDocumentDialog(kind: ExportKind): Promise<string | null> {
  const scene = useEditorStore.getState().scene;
  let bytes: Uint8Array;
  if (kind === 'svg') {
    const svg = await sceneToSvg(scene);
    bytes = new TextEncoder().encode(svg);
  } else if (kind === 'ai') {
    bytes = await sceneToAiBytes(scene);
  } else {
    bytes = await sceneToPsdBytes(scene);
  }
  const filters =
    kind === 'svg'
      ? [{ name: 'SVG', extensions: ['svg'] }]
      : kind === 'ai'
        ? [{ name: 'Adobe Illustrator', extensions: ['ai'] }]
        : [{ name: 'Photoshop PSD', extensions: ['psd'] }];
  return saveFileBytes(bytes, {
    defaultName: exportFileName(scene.name, kind),
    filters,
  });
}

export async function exportRasterDialog(
  options: RasterExportOptions
): Promise<string | null> {
  const scene = useEditorStore.getState().scene;
  const { bytes } = await rasterizeSceneToBytes(scene, options);
  const filters =
    options.format === 'jpg'
      ? [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }]
      : [{ name: 'PNG Image', extensions: ['png'] }];
  return saveFileBytes(bytes, {
    defaultName: exportFileName(scene.name, options.format),
    filters,
  });
}

export async function quickExportPngDialog(): Promise<string | null> {
  const scene = useEditorStore.getState().scene;
  return exportRasterDialog({
    format: 'png',
    scale: 2,
    quality: 1,
    transparent: false,
    backgroundColor: scene.background || '#ffffff',
    scope: 'artboard',
  });
}
