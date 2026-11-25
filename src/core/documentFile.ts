import { getActiveArtboard, getSceneArtboards } from '../core/artboards';
import { clearSceneDraft } from './settings';
import { useEditorStore } from '../core/store';
import type { Scene } from '../core/types';
import { pickOpenFile, saveFileBytes } from '../platform/io';
import { openLocusFromBytes, buildLocusArchive } from '../export/projectFile';
import { extractSelectionScene } from '../export/selectionScene';
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

/** Диалог «Открыть» → `.locus`. Возвращает `Scene | null`. */
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
    void clearSceneDraft();
  }
  return target;
}

export async function exportDocumentDialog(
  kind: ExportKind,
  artboardId?: string | 'all'
): Promise<string | null> {
  const { scene, activeArtboardId } = useEditorStore.getState();
  const artboards = getSceneArtboards(scene);
  let bytes: Uint8Array;
  let defaultBaseName = documentFileBaseName(scene.name);

  if (kind === 'ai') {
    const resolvedId = artboardId ?? (artboards.length > 1 ? 'all' : undefined);
    bytes = await sceneToAiBytes(scene, resolvedId ? { artboardId: resolvedId } : {});
    if (resolvedId && resolvedId !== 'all' && artboards.length > 1) {
      const ab = getActiveArtboard(scene, resolvedId);
      defaultBaseName = `${defaultBaseName}_${documentFileBaseName(ab.name)}`;
    }
  } else {
    const useSpecificAb = artboards.length > 1 || (artboardId && artboardId !== 'all');
    const resolvedAb = useSpecificAb
      ? getActiveArtboard(
          scene,
          artboardId && artboardId !== 'all' ? artboardId : activeArtboardId
        )
      : null;
    if (kind === 'svg') {
      const svg = await sceneToSvg(
        scene,
        resolvedAb ? { artboardId: resolvedAb.id } : {}
      );
      bytes = new TextEncoder().encode(svg);
    } else {
      bytes = await sceneToPsdBytes(
        scene,
        resolvedAb ? { artboardId: resolvedAb.id } : {}
      );
    }
    if (resolvedAb && artboards.length > 1) {
      defaultBaseName = `${defaultBaseName}_${documentFileBaseName(resolvedAb.name)}`;
    }
  }

  const filters =
    kind === 'svg'
      ? [{ name: 'SVG', extensions: ['svg'] }]
      : kind === 'ai'
        ? [{ name: 'Adobe Illustrator', extensions: ['ai'] }]
        : [{ name: 'Photoshop PSD', extensions: ['psd'] }];
  return saveFileBytes(bytes, {
    defaultName: `${defaultBaseName}.${kind}`,
    filters,
  });
}

export async function exportSelectionDialog(
  kind: 'svg' | 'ai' | 'psd',
  layerIds?: string[]
): Promise<string | null> {
  const { scene, selectedIds } = useEditorStore.getState();
  const ids = layerIds ?? selectedIds;
  const sub = extractSelectionScene(scene, ids);
  if (!sub) {
    throw new Error('Выберите хотя бы один слой для экспорта');
  }

  let bytes: Uint8Array;
  if (kind === 'svg') {
    const svg = await sceneToSvg(sub, { includeBackground: false });
    bytes = new TextEncoder().encode(svg);
  } else if (kind === 'ai') {
    bytes = await sceneToAiBytes(sub);
  } else {
    bytes = await sceneToPsdBytes(sub);
  }

  const filters =
    kind === 'svg'
      ? [{ name: 'SVG', extensions: ['svg'] }]
      : kind === 'ai'
        ? [{ name: 'Adobe Illustrator', extensions: ['ai'] }]
        : [{ name: 'Photoshop PSD', extensions: ['psd'] }];

  return saveFileBytes(bytes, {
    defaultName: `${documentFileBaseName(scene.name)}-selection.${kind}`,
    filters,
  });
}

export async function exportRasterDialog(
  options: RasterExportOptions
): Promise<string | null> {
  const { scene, activeArtboardId } = useEditorStore.getState();
  const artboards = getSceneArtboards(scene);
  const resolvedAbId =
    options.scope === 'artboard'
      ? (options.artboardId ?? activeArtboardId)
      : options.artboardId;

  const { bytes } = await rasterizeSceneToBytes(scene, {
    ...options,
    artboardId: resolvedAbId,
  });
  const filters =
    options.format === 'jpg'
      ? [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }]
      : [{ name: 'PNG Image', extensions: ['png'] }];
  let defaultBaseName = documentFileBaseName(scene.name);
  if (artboards.length > 1 && options.scope === 'artboard' && resolvedAbId) {
    const ab = getActiveArtboard(scene, resolvedAbId);
    defaultBaseName = `${defaultBaseName}_${documentFileBaseName(ab.name)}`;
  }
  return saveFileBytes(bytes, {
    defaultName: `${defaultBaseName}.${options.format}`,
    filters,
  });
}

export async function quickExportPngDialog(): Promise<string | null> {
  const { scene, activeArtboardId } = useEditorStore.getState();
  const artboards = getSceneArtboards(scene);
  const activeAb = getActiveArtboard(scene, activeArtboardId);
  return exportRasterDialog({
    format: 'png',
    scale: 2,
    quality: 1,
    transparent: false,
    backgroundColor: activeAb.background || '#ffffff',
    scope: 'artboard',
    artboardId: artboards.length > 1 ? activeAb.id : undefined,
  });
}
