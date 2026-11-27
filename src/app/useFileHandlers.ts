import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type RefObject,
} from 'react';
import { getActiveArtboard } from '../core/artboards';
import { inferImageMimeType, registerAssetFromBytes } from '../core/assets';
import { copySelectionAsSvg } from '../core/clipboard';
import {
  addLayer,
  addLayers,
  createImageLayer,
  createLayerId,
  deleteLayers,
  reorderLayer,
  replaceImageLayerAsset,
  runCommandBatch,
  updateLayers,
} from '../core/commands';
import {
  exportDocumentDialog,
  exportSelectionDialog,
  openProjectDialog,
  quickExportPngDialog,
  saveProjectDialog,
  type ExportKind,
} from '../core/documentFile';
import { registerProjectFontFromBytes } from '../core/fonts';
import { findLayerById, flattenLayers } from '../core/layerTree';
import { useEditorStore } from '../core/store';
import type { ImageLayer, ToolType } from '../core/types';
import type { PaperCanvasHandle } from '../engine/PaperCanvas';
import { parseSvgToLayers } from '../export/importSvg';
import { openLocusFromBytes } from '../export/projectFile';
import {
  isTauri,
  pickOpenFile,
  readFileBytes,
  subscribeFileDrop,
  takeLaunchFile,
} from '../platform/io';

const BACKGROUND_LAYER_NAME = 'Фон артборда';

let cachedLaunchFilePromise: ReturnType<typeof takeLaunchFile> | null = null;
let launchFileHandled = false;

export function resetLaunchFileCacheForTest(): void {
  cachedLaunchFilePromise = null;
  launchFileHandled = false;
}

function stripFileExtension(fileName: string): string {
  const cleaned = fileName.replace(/\.[^.]+$/, '').trim();
  return cleaned || 'Изображение';
}

export interface UseFileHandlersOptions {
  canvasRef: RefObject<PaperCanvasHandle | null>;
  guardUnsaved: (action: () => void) => void;
  showNotice: (message: string) => void;
  setIsStartModalOpen: (open: boolean) => void;
  setActiveTool: (tool: ToolType) => void;
  setSelectedIds: (ids: string[]) => void;
  setActiveArtboardId: (id: string) => void;
  openRasterExport: (format: 'png' | 'jpg', scope?: 'artboard' | 'selection') => void;
}

export function useFileHandlers({
  canvasRef,
  guardUnsaved,
  showNotice,
  setIsStartModalOpen,
  setActiveTool,
  setSelectedIds,
  setActiveArtboardId,
  openRasterExport,
}: UseFileHandlersOptions) {
  const [isFileDragHover, setIsFileDragHover] = useState(false);

  const handleOpenProject = useCallback(async () => {
    try {
      const loaded = await openProjectDialog();
      if (!loaded) return;
      setIsStartModalOpen(false);
      requestAnimationFrame(() => {
        canvasRef.current?.fitArtboard();
      });
      showNotice(`Проект «${loaded.name}» открыт`);
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Не удалось открыть проект Locus'
      );
    }
  }, [canvasRef, setIsStartModalOpen, showNotice]);

  const requestOpenProject = useCallback(() => {
    guardUnsaved(() => {
      void handleOpenProject();
    });
  }, [guardUnsaved, handleOpenProject]);

  const requestNewProject = useCallback(() => {
    guardUnsaved(() => setIsStartModalOpen(true));
  }, [guardUnsaved, setIsStartModalOpen]);

  const handleOpenLocusPath = useCallback(
    async (path: string, name: string) => {
      try {
        const bytes = await readFileBytes(path);
        const loaded = await openLocusFromBytes(bytes);
        setIsStartModalOpen(false);
        requestAnimationFrame(() => {
          canvasRef.current?.fitArtboard();
        });
        showNotice(`Проект «${name || loaded.name}» открыт`);
      } catch (err) {
        showNotice(
          err instanceof Error ? err.message : `Не удалось открыть «${name}»`
        );
      }
    },
    [canvasRef, setIsStartModalOpen, showNotice]
  );

  const handleSaveProject = useCallback(async () => {
    try {
      const target = await saveProjectDialog();
      if (target !== null) {
        showNotice(`Проект сохранён: ${target}`);
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Не удалось сохранить проект'
      );
    }
  }, [showNotice]);

  const handleCopySvg = useCallback(
    (ids?: string[]) => {
      void (async () => {
        try {
          const svg = await copySelectionAsSvg(ids);
          if (!svg) {
            showNotice('Выберите хотя бы один слой для копирования');
            return;
          }
          showNotice('SVG скопирован в буфер обмена');
        } catch (err) {
          showNotice(
            err instanceof Error ? err.message : 'Не удалось скопировать SVG'
          );
        }
      })();
    },
    [showNotice]
  );

  const handleExportSelectionSvg = useCallback(
    (ids?: string[]) => {
      void (async () => {
        try {
          const target = await exportSelectionDialog('svg', ids);
          if (target !== null) {
            showNotice(`Экспортировано: ${target}`);
          }
        } catch (err) {
          showNotice(
            err instanceof Error ? err.message : 'Не удалось экспортировать выделенное'
          );
        }
      })();
    },
    [showNotice]
  );

  const handleExportSelectionRaster = useCallback(
    (ids?: string[]) => {
      const resolved = ids ?? useEditorStore.getState().selectedIds;
      if (resolved.length === 0) {
        showNotice('Выберите хотя бы один слой для экспорта');
        return;
      }
      if (ids && ids.length > 0) {
        useEditorStore.setState({ selectedIds: ids, selectedNode: null });
      }
      openRasterExport('png', 'selection');
    },
    [openRasterExport, showNotice]
  );

  const insertDroppedImages = useCallback(
    async (entries: Array<{ name: string; bytes: Uint8Array }>) => {
      if (entries.length === 0) return;
      const registered = await Promise.all(
        entries.map(async (entry) => ({
          name: stripFileExtension(entry.name),
          asset: await registerAssetFromBytes({
            bytes: entry.bytes,
            name: entry.name,
            mimeType: inferImageMimeType(entry.name, entry.bytes),
          }),
        }))
      );

      setIsStartModalOpen(false);
      const st = useEditorStore.getState();
      const activeAb = getActiveArtboard(st.scene, st.activeArtboardId);
      const createdIds: string[] = [];

      runCommandBatch(() => {
        registered.forEach(({ name, asset }, idx) => {
          const created = createImageLayer({
            assetId: asset.id,
            width: asset.naturalWidth,
            height: asset.naturalHeight,
            x: activeAb.x + activeAb.width / 2 + idx * 24,
            y: activeAb.y + activeAb.height / 2 + idx * 24,
            name,
          });
          createdIds.push(created.id);
        });
      });

      if (createdIds.length > 0) {
        setSelectedIds(createdIds);
        setActiveTool('select');
      }
    },
    [setActiveTool, setIsStartModalOpen, setSelectedIds]
  );

  const handleImportBackgroundImage = useCallback(async () => {
    try {
      const file = await pickOpenFile({
        title: 'Фон артборда из изображения',
        filters: [
          { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
        ],
      });
      if (!file) return;

      const asset = await registerAssetFromBytes({
        bytes: file.bytes,
        name: file.name,
        mimeType: inferImageMimeType(file.name, file.bytes),
      });

      const st = useEditorStore.getState();
      const scene = st.scene;
      const activeAb = getActiveArtboard(scene, st.activeArtboardId);
      const previous = flattenLayers(scene.layers).find(
        (layer) => layer.type === 'image' && layer.name === BACKGROUND_LAYER_NAME
      );
      const coverScale = Math.max(
        activeAb.width / Math.max(1, asset.naturalWidth),
        activeAb.height / Math.max(1, asset.naturalHeight)
      );

      runCommandBatch(() => {
        if (previous) {
          deleteLayers([previous.id]);
        }
        const layer: ImageLayer = {
          id: createLayerId('img'),
          name: BACKGROUND_LAYER_NAME,
          type: 'image',
          visible: true,
          locked: true,
          x: activeAb.x + activeAb.width / 2,
          y: activeAb.y + activeAb.height / 2,
          rotation: 0,
          scaleX: coverScale,
          scaleY: coverScale,
          opacity: 1,
          assetId: asset.id,
          width: asset.naturalWidth,
          height: asset.naturalHeight,
        };
        const created = addLayer(layer, { select: false });
        reorderLayer(created.id, 'back');
      });

      showNotice('Фон артборда заменён изображением');
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Не удалось загрузить фон артборда'
      );
    }
  }, [showNotice]);

  const handlePlaceImage = useCallback(async () => {
    let selectedName = '';
    try {
      const file = await pickOpenFile({
        title: 'Вставить изображение',
        filters: [
          { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        ],
      });
      if (!file) return;
      selectedName = file.name;
      const asset = await registerAssetFromBytes({
        bytes: file.bytes,
        name: file.name,
        mimeType: inferImageMimeType(file.name, file.bytes),
      });
      setIsStartModalOpen(false);
      createImageLayer({
        assetId: asset.id,
        width: asset.naturalWidth,
        height: asset.naturalHeight,
        name: stripFileExtension(file.name),
      });
      setActiveTool('select');
    } catch (err) {
      showNotice(
        err instanceof Error
          ? err.message
          : selectedName
            ? `Не удалось загрузить изображение «${selectedName}»`
            : 'Не удалось выбрать изображение'
      );
    }
  }, [setActiveTool, setIsStartModalOpen, showNotice]);

  const insertSvgFiles = useCallback(
    async (entries: Array<{ name: string; bytes: Uint8Array }>) => {
      if (entries.length === 0) return;
      const st = useEditorStore.getState();
      const activeAb = getActiveArtboard(st.scene, st.activeArtboardId);
      const decoder = new TextDecoder('utf-8');
      const collected: ReturnType<typeof addLayers> = [];
      const allWarnings = new Set<string>();

      for (const entry of entries) {
        const svgText = decoder.decode(entry.bytes);
        const result = await parseSvgToLayers(svgText, {
          fileName: entry.name,
          targetArtboard: {
            width: activeAb.width,
            height: activeAb.height,
          },
        });
        const shifted =
          activeAb.x !== 0 || activeAb.y !== 0
            ? result.layers.map((layer) => ({
                ...layer,
                x: layer.x + activeAb.x,
                y: layer.y + activeAb.y,
              }))
            : result.layers;
        collected.push(...shifted);
        for (const w of result.warnings) {
          allWarnings.add(w);
        }
      }

      if (collected.length === 0) {
        showNotice(
          entries.length === 1
            ? `В SVG «${entries[0].name}» не найдено векторных объектов`
            : 'В выбранных SVG не найдено векторных объектов'
        );
        return;
      }

      setIsStartModalOpen(false);
      addLayers(collected);
      setActiveTool('select');

      const firstWarning = allWarnings.values().next().value;
      const suffix = firstWarning ? ` (${firstWarning})` : '';
      showNotice(
        entries.length === 1
          ? `Импортировано из «${entries[0].name}»: ${collected.length} сл.${suffix}`
          : `Импортировано слоёв из SVG: ${collected.length}${suffix}`
      );
    },
    [setActiveTool, setIsStartModalOpen, showNotice]
  );

  const handleImportSvg = useCallback(async () => {
    let selectedName = '';
    try {
      const file = await pickOpenFile({
        title: 'Импорт SVG в векторные слои',
        filters: [{ name: 'SVG Vector', extensions: ['svg'] }],
      });
      if (!file) return;
      selectedName = file.name;
      await insertSvgFiles([file]);
    } catch (err) {
      showNotice(
        err instanceof Error
          ? err.message
          : selectedName
            ? `Не удалось импортировать SVG «${selectedName}»`
            : 'Не удалось выбрать SVG'
      );
    }
  }, [insertSvgFiles, showNotice]);

  const handleReplaceImage = useCallback(
    async (layerId: string) => {
      let selectedName = '';
      try {
        const file = await pickOpenFile({
          title: 'Заменить изображение',
          filters: [
            {
              name: 'Изображения',
              extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'],
            },
          ],
        });
        if (!file) return;
        selectedName = file.name;
        const asset = await registerAssetFromBytes({
          bytes: file.bytes,
          name: file.name,
          mimeType: inferImageMimeType(file.name, file.bytes),
        });
        replaceImageLayerAsset(layerId, asset);
      } catch (err) {
        showNotice(
          err instanceof Error
            ? err.message
            : selectedName
              ? `Не удалось заменить изображение «${selectedName}»`
              : 'Не удалось выбрать изображение'
        );
      }
    },
    [showNotice]
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    if (!launchFileHandled) {
      void (async () => {
        try {
          cachedLaunchFilePromise ??= takeLaunchFile();
          const file = await cachedLaunchFilePromise;
          if (disposed || launchFileHandled || !file) return;
          launchFileHandled = true;
          if (/\.locus$/i.test(file.name)) {
            const loaded = await openLocusFromBytes(file.bytes);
            setIsStartModalOpen(false);
            requestAnimationFrame(() => {
              canvasRef.current?.fitArtboard();
            });
            showNotice(`Проект «${file.name || loaded.name}» открыт`);
          } else if (/\.svg$/i.test(file.name)) {
            await insertSvgFiles([{ name: file.name, bytes: file.bytes }]);
          } else if (/\.(png|jpe?g|webp)$/i.test(file.name)) {
            await insertDroppedImages([{ name: file.name, bytes: file.bytes }]);
          }
        } catch (err) {
          showNotice(
            err instanceof Error
              ? err.message
              : 'Не удалось открыть файл запуска'
          );
        }
      })();
    }

    void subscribeFileDrop(
      (paths) => {
        if (disposed) return;
        void (async () => {
          const locusPath = paths.find((p) => /\.locus$/i.test(p));
          if (locusPath) {
            guardUnsaved(() => {
              void handleOpenLocusPath(
                locusPath,
                locusPath.split(/[\\/]/).pop() || 'project.locus'
              );
            });
            return;
          }
          const svgPaths = paths.filter((p) => /\.svg$/i.test(p));
          const rasterPaths = paths.filter((p) =>
            /\.(png|jpe?g|webp)$/i.test(p)
          );
          if (svgPaths.length === 0 && rasterPaths.length === 0) return;

          try {
            if (svgPaths.length > 0) {
              const svgEntries = await Promise.all(
                svgPaths.map(async (p) => ({
                  name: p.split(/[\\/]/).pop() || 'vector.svg',
                  bytes: await readFileBytes(p),
                }))
              );
              await insertSvgFiles(svgEntries);
            }
            if (rasterPaths.length > 0) {
              const entries = await Promise.all(
                rasterPaths.map(async (p) => ({
                  name: p.split(/[\\/]/).pop() || 'image.png',
                  bytes: await readFileBytes(p),
                }))
              );
              await insertDroppedImages(entries);
            }
          } catch (err) {
            showNotice(
              err instanceof Error
                ? err.message
                : 'Не удалось прочитать перетащенный файл'
            );
          }
        })();
      },
      (hovering) => {
        if (!disposed) setIsFileDragHover(hovering);
      }
    )
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    canvasRef,
    guardUnsaved,
    handleOpenLocusPath,
    insertDroppedImages,
    insertSvgFiles,
    setIsStartModalOpen,
    showNotice,
  ]);

  const handleExportDocument = useCallback(
    (format: ExportKind) => {
      if (format === 'png' || format === 'jpg') {
        openRasterExport(format, 'artboard');
        return;
      }
      void (async () => {
        try {
          const target = await exportDocumentDialog(format);
          if (target !== null) {
            showNotice(`Экспортировано: ${target}`);
          }
        } catch (err) {
          showNotice(
            err instanceof Error
              ? err.message
              : `Не удалось экспортировать .${format}`
          );
        }
      })();
    },
    [openRasterExport, showNotice]
  );

  const handleQuickExportPng = useCallback(() => {
    void (async () => {
      try {
        const target = await quickExportPngDialog();
        if (target !== null) {
          showNotice(`Экспортировано: ${target}`);
        }
      } catch (err) {
        showNotice(
          err instanceof Error ? err.message : 'Не удалось экспортировать PNG'
        );
      }
    })();
  }, [showNotice]);

  const handleUploadFont = useCallback(async () => {
    let selectedName = '';
    try {
      const file = await pickOpenFile({
        title: 'Загрузить шрифт в проект',
        filters: [{ name: 'Шрифты', extensions: ['ttf', 'otf', 'woff2'] }],
      });
      if (!file) return;
      selectedName = file.name;
      const entry = await registerProjectFontFromBytes({
        bytes: file.bytes,
        fileName: file.name,
      });
      const st = useEditorStore.getState();
      const textIds = st.selectedIds.filter((id) => {
        const layer = findLayerById(st.scene.layers, id);
        return layer?.type === 'text' && !layer.locked;
      });
      if (textIds.length > 0) {
        updateLayers(textIds, { fontFamily: entry.family });
      }
      showNotice(`Шрифт «${entry.family}» загружен`);
    } catch (err) {
      showNotice(
        err instanceof Error
          ? err.message
          : selectedName
            ? `Не удалось загрузить шрифт «${selectedName}»`
            : 'Не удалось выбрать файл шрифта'
      );
    }
  }, [showNotice]);

  const handleExportArtboard = useCallback(
    (kind: ExportKind, artboardId: string) => {
      if (kind === 'png' || kind === 'jpg') {
        setActiveArtboardId(artboardId);
        openRasterExport(kind, 'artboard');
        return;
      }
      void (async () => {
        try {
          const target = await exportDocumentDialog(kind, artboardId);
          if (target !== null) {
            showNotice(`Экспортировано: ${target}`);
          }
        } catch (err) {
          showNotice(
            err instanceof Error ? err.message : `Не удалось экспортировать .${kind}`
          );
        }
      })();
    },
    [openRasterExport, setActiveArtboardId, showNotice]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (isTauri()) return;
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      setIsFileDragHover(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (isTauri()) return;
    if (
      e.currentTarget === e.target ||
      !e.currentTarget.contains(e.relatedTarget as Node)
    ) {
      setIsFileDragHover(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (isTauri()) return;
      e.preventDefault();
      setIsFileDragHover(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const locusFile = files.find((f) => /\.locus$/i.test(f.name));
      if (locusFile) {
        guardUnsaved(() => {
          void (async () => {
            try {
              const loaded = await openLocusFromBytes(
                new Uint8Array(await locusFile.arrayBuffer())
              );
              setIsStartModalOpen(false);
              requestAnimationFrame(() => {
                canvasRef.current?.fitArtboard();
              });
              showNotice(`Проект «${loaded.name}» открыт`);
            } catch (err) {
              showNotice(
                err instanceof Error ? err.message : 'Не удалось открыть проект Locus'
              );
            }
          })();
        });
        return;
      }
      const svgFiles = files.filter((f) => /\.svg$/i.test(f.name));
      const rasterFiles = files.filter((f) =>
        /\.(png|jpe?g|webp)$/i.test(f.name)
      );
      if (svgFiles.length === 0 && rasterFiles.length === 0) return;

      void (async () => {
        try {
          if (svgFiles.length > 0) {
            const svgEntries = await Promise.all(
              svgFiles.map(async (file) => ({
                name: file.name,
                bytes: new Uint8Array(await file.arrayBuffer()),
              }))
            );
            await insertSvgFiles(svgEntries);
          }
          if (rasterFiles.length > 0) {
            const entries = await Promise.all(
              rasterFiles.map(async (file) => ({
                name: file.name,
                bytes: new Uint8Array(await file.arrayBuffer()),
              }))
            );
            await insertDroppedImages(entries);
          }
        } catch (err) {
          showNotice(
            err instanceof Error
              ? err.message
              : 'Не удалось прочитать перетащенный файл'
          );
        }
      })();
    },
    [
      canvasRef,
      guardUnsaved,
      insertDroppedImages,
      insertSvgFiles,
      setIsStartModalOpen,
      showNotice,
    ]
  );

  return {
    isFileDragHover,
    handleOpenProject,
    requestOpenProject,
    requestNewProject,
    handleOpenLocusPath,
    handleSaveProject,
    handleCopySvg,
    handleExportSelectionSvg,
    handleExportSelectionRaster,
    handleImportBackgroundImage,
    handlePlaceImage,
    handleImportSvg,
    handleReplaceImage,
    handleExportDocument,
    handleQuickExportPng,
    handleUploadFont,
    handleExportArtboard,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
