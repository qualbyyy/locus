import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { BookOpen, X } from 'lucide-react';
import { getActiveArtboard } from './core/artboards';
import { inferImageMimeType, registerAssetFromBytes } from './core/assets';
import {
  copyLayerStyle,
  copySelectedLayers,
  copySelectionAsSvg,
  hasCopiedLayers,
  pasteLayers,
  pasteLayerStyle,
} from './core/clipboard';
import {
  buildContextMenuModel,
  runTextContextAction,
  type ContextMenuActionId,
  type ContextMenuArea,
} from './core/contextMenu';
import {
  addArtboard,
  addLayer,
  addLayers,
  alignLayers,
  applyTextPathArc,
  attachTextToPath,
  booleanLayers,
  clearGuides,
  combineCompoundPathLayers,
  convertTextLayersToOutlines,
  createCircleTextPreset,
  createClipMaskFromSelection,
  createImageLayer,
  createLayerId,
  createTextOnPathFromShape,
  deleteAnchor,
  deleteArtboard,
  deleteLayers,
  deselectAllLayers,
  detachTextFromPath,
  duplicateArtboard,
  duplicateLayers,
  expandLayerAppearance,
  flipLayers,
  groupLayers,
  invertSelection,
  loadScene,
  nudgeLayers,
  offsetPathLayers,
  outlineStrokeLayers,
  redoCommand,
  releaseClipMask,
  reorderLayer,
  replaceImageLayerAsset,
  resetDocument,
  rotateLayersBy,
  runCommandBatch,
  selectAllLayers,
  selectSimilarLayers,
  setClipMask,
  simplifyPathLayers,
  smoothLayers,
  splitCompoundPathLayers,
  splitTextLayers,
  traceImageLayer,
  transformTextCase,
  type TextSplitMode,
  undoCommand,
  ungroupLayers,
  updateArtboard,
  updateArtboardById,
  updateLayerEffects,
  updateLayers,
  wobbleLayers,
} from './core/commands';
import { registerProjectFontFromBytes } from './core/fonts';
import { findLayerById, flattenLayers, getParentGroupId } from './core/layerTree';
import {
  clearSceneDraft,
  saveSceneDraft,
  useSettingsStore,
} from './core/settings';
import {
  exportDocumentDialog,
  exportSelectionDialog,
  openProjectDialog,
  quickExportPngDialog,
  saveProjectDialog,
  type ExportKind,
} from './core/documentFile';
import { openLocusFromBytes } from './export/projectFile';
import { parseSvgToLayers } from './export/importSvg';
import { matchShortcut } from './core/shortcuts';
import { useCanRedo, useCanUndo, useEditorStore } from './core/store';
import type { Artboard, ImageLayer, Scene, TextLayer } from './core/types';
import type { BooleanOp } from './engine/booleans';
import type { ImageTraceOptions } from './engine/imageTrace';
import { isCanvasZoomWheel } from './engine/zoom';
import { hasAnyEffects } from './engine/effects';
import { PaperCanvas, type PaperCanvasHandle } from './engine/PaperCanvas';
import {
  isTauri,
  pickOpenFile,
  readFileBytes,
  subscribeFileDrop,
  takeLaunchFile,
} from './platform/io';
import { ContextMenu } from './ui/ContextMenu';
import { AiTaskIndicator } from './ui/AiTaskIndicator';
import { CommandBar } from './ui/CommandBar';
import { isVectorEffectKind, type EffectTarget } from './ui/inspector/EffectControls';
import { EffectModal } from './ui/inspector/EffectModal';
import { Inspector } from './ui/Inspector';
import { LayersPanel } from './ui/LayersPanel';
import type { MenuBarActions, MenuBarState } from './ui/MenuBar';
import { RasterExportModal } from './ui/RasterExportModal';
import { SettingsModal, type SettingsTabId } from './ui/SettingsModal';
import { TutorialModal } from './ui/tutorial/TutorialModal';
import { TutorialSpotlight } from './ui/tutorial/TutorialSpotlight';
import { useTutorialStore } from './tutorial/store';
import { dismissTutorialWelcome } from './tutorial/progress';
import { StartModal } from './ui/StartModal';
import { Toolbar } from './ui/Toolbar';
import { TopBar } from './ui/TopBar';
import { UnsavedChangesModal } from './ui/UnsavedChangesModal';

const BACKGROUND_LAYER_NAME = 'Фон артборда';

function stripFileExtension(fileName: string): string {
  const cleaned = fileName.replace(/\.[^.]+$/, '').trim();
  return cleaned || 'Изображение';
}

function findEditableElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const element = target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
  );
  return element instanceof HTMLElement ? element : null;
}

function isEditableElement(target: EventTarget | null): boolean {
  const candidates = [document.activeElement, target];
  for (const item of candidates) {
    if (!(item instanceof HTMLElement)) continue;
    const tag = item.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      item.isContentEditable
    ) {
      return true;
    }
  }
  return false;
}

export function App() {
  const scene = useEditorStore((s) => s.scene);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedNode = useEditorStore((s) => s.selectedNode);
  const activeTool = useEditorStore((s) => s.activeTool);
  const smartShapeOptions = useEditorStore((s) => s.smartShapeOptions);
  const textToolMode = useEditorStore((s) => s.textToolMode);
  const knifeToolMode = useEditorStore((s) => s.knifeToolMode);
  const pencilSmoothness = useEditorStore((s) => s.pencilSmoothness);
  const zoomPercent = useEditorStore((s) => s.zoomPercent);
  const isDirty = useEditorStore((s) => s.isDirty);
  const activeArtboardId = useEditorStore((s) => s.activeArtboardId);
  const editingGroupId = useEditorStore((s) => s.editingGroupId);
  const isAcademyOpen = useTutorialStore((state) => state.isAcademyOpen);

  const setSelectedIds = useEditorStore((s) => s.setSelectedIds);
  const setSelectedNode = useEditorStore((s) => s.setSelectedNode);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const setSmartShapeOptions = useEditorStore((s) => s.setSmartShapeOptions);
  const setTextToolMode = useEditorStore((s) => s.setTextToolMode);
  const setKnifeToolMode = useEditorStore((s) => s.setKnifeToolMode);
  const setPencilSmoothness = useEditorStore((s) => s.setPencilSmoothness);
  const setZoomPercent = useEditorStore((s) => s.setZoomPercent);
  const setActiveArtboardId = useEditorStore((s) => s.setActiveArtboardId);
  const setEditingGroupId = useEditorStore((s) => s.setEditingGroupId);

  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [isStartModalOpen, setIsStartModalOpen] = useState(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] =
    useState<SettingsTabId | null>(null);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  const [preflightTrigger, setPreflightTrigger] = useState(0);
  const [rasterExportOpen, setRasterExportOpen] = useState(false);
  const [rasterExportFormat, setRasterExportFormat] = useState<'png' | 'jpg'>('png');
  const [rasterExportScope, setRasterExportScope] = useState<'artboard' | 'selection'>('artboard');
  const [focusedEffect, setFocusedEffect] = useState<EffectTarget | null>(null);
  const [effectModalTarget, setEffectModalTarget] = useState<EffectTarget | null>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [showLayers, setShowLayers] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [outlineMode, setOutlineMode] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [isFileDragHover, setIsFileDragHover] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isUnsavedOpen, setIsUnsavedOpen] = useState(false);
  const [isSavingBeforeAction, setIsSavingBeforeAction] = useState(false);
  const [showTutorialHint, setShowTutorialHint] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    area: ContextMenuArea;
    layerIds: string[];
    editableElement: HTMLElement | null;
  } | null>(null);

  const canvasRef = useRef<PaperCanvasHandle | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const openSettingsTab = useCallback((tab: SettingsTabId | null = null) => {
    setSettingsInitialTab(tab);
    setIsSettingsModalOpen(true);
  }, []);

  const openTutorial = useCallback(() => {
    setIsStartModalOpen(false);
    setIsSettingsModalOpen(false);
    setSettingsInitialTab(null);
    setShowTutorialHint(false);
    const st = useSettingsStore.getState();
    if (!st.settings.tutorial.welcomeDismissed) {
      st.updateSettings({
        tutorial: dismissTutorialWelcome(st.settings.tutorial),
      });
    }
    useTutorialStore.getState().openAcademy();
  }, []);

  useEffect(() => {
    void useSettingsStore.getState().loadSettings();
  }, []);

  useEffect(() => {
    if (!settings.autosaveEnabled) return;
    const intervalMs = Math.max(15, settings.autosaveIntervalSec) * 1000;
    const timer = window.setInterval(() => {
      const st = useEditorStore.getState();
      if (st.isDirty && st.scene.layers.length > 0) {
        void saveSceneDraft(st.scene);
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [settings.autosaveEnabled, settings.autosaveIntervalSec]);

  useEffect(() => {
    if (!settings.autosaveEnabled || !isDirty || scene.layers.length === 0) return;
    const timer = window.setTimeout(() => {
      const st = useEditorStore.getState();
      if (st.isDirty && st.scene.layers.length > 0) {
        void saveSceneDraft(st.scene);
      }
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [isDirty, scene, settings.autosaveEnabled]);

  useEffect(() => {
    const flushDraft = () => {
      const { autosaveEnabled } = useSettingsStore.getState().settings;
      if (!autosaveEnabled) return;
      const st = useEditorStore.getState();
      if (st.isDirty && st.scene.layers.length > 0) {
        void saveSceneDraft(st.scene);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const guardUnsaved = useCallback((action: () => void) => {
    const state = useEditorStore.getState();
    if (!state.isDirty) {
      action();
      return;
    }
    pendingActionRef.current = action;
    setIsUnsavedOpen(true);
  }, []);

  const resolveUnsaved = useCallback(
    async (choice: 'discard' | 'save') => {
      const action = pendingActionRef.current;
      if (choice === 'discard') {
        pendingActionRef.current = null;
        setIsUnsavedOpen(false);
        void clearSceneDraft();
        action?.();
        return;
      }

      setIsSavingBeforeAction(true);
      try {
        const target = await saveProjectDialog();
        if (target === null) return;
        pendingActionRef.current = null;
        setIsUnsavedOpen(false);
        action?.();
      } catch (err) {
        showNotice(
          err instanceof Error ? err.message : 'Не удалось сохранить проект'
        );
      } finally {
        setIsSavingBeforeAction(false);
      }
    },
    [showNotice]
  );

  const cancelUnsaved = useCallback(() => {
    pendingActionRef.current = null;
    setIsUnsavedOpen(false);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const off = await win.onCloseRequested((event) => {
        if (!useEditorStore.getState().isDirty) return;
        event.preventDefault();
        pendingActionRef.current = () => {
          void win.destroy();
        };
        setIsUnsavedOpen(true);
      });
      if (disposed) {
        off();
      } else {
        unlisten = off;
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleFitArtboard = useCallback(() => {
    canvasRef.current?.fitArtboard();
  }, []);

  const openCommandBar = useCallback(() => {
    setContextMenu(null);
    setIsCommandBarOpen(true);
  }, []);

  const closeCommandBar = useCallback(() => {
    setIsCommandBarOpen(false);
  }, []);

  const handleRunPreflight = useCallback(() => {
    setContextMenu(null);
    setIsCommandBarOpen(true);
    setPreflightTrigger((n) => n + 1);
  }, []);

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
  }, [showNotice]);

  const requestOpenProject = useCallback(() => {
    guardUnsaved(() => {
      void handleOpenProject();
    });
  }, [guardUnsaved, handleOpenProject]);

  const requestNewProject = useCallback(() => {
    guardUnsaved(() => setIsStartModalOpen(true));
  }, [guardUnsaved]);

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
    [showNotice]
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

  const handleCopySvg = useCallback((ids?: string[]) => {
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
  }, [showNotice]);

  const handleExportSelectionSvg = useCallback((ids?: string[]) => {
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
  }, [showNotice]);

  const handleExportSelectionRaster = useCallback((ids?: string[]) => {
    const resolved = ids ?? useEditorStore.getState().selectedIds;
    if (resolved.length === 0) {
      showNotice('Выберите хотя бы один слой для экспорта');
      return;
    }
    if (ids && ids.length > 0) {
      useEditorStore.setState({ selectedIds: ids, selectedNode: null });
    }
    setRasterExportScope('selection');
    setRasterExportFormat('png');
    setRasterExportOpen(true);
  }, [showNotice]);

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
      const currentScene = useEditorStore.getState().scene;
      const createdIds: string[] = [];

      runCommandBatch(() => {
        registered.forEach(({ name, asset }, idx) => {
          const created = createImageLayer({
            assetId: asset.id,
            width: asset.naturalWidth,
            height: asset.naturalHeight,
            x: currentScene.width / 2 + idx * 24,
            y: currentScene.height / 2 + idx * 24,
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
    [setActiveTool, setSelectedIds]
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
    const file = await pickOpenFile({
      title: 'Вставить изображение',
      filters: [
        { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      ],
    });
    if (!file) return;
    try {
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
          : `Не удалось загрузить изображение «${file.name}»`
      );
    }
  }, [setActiveTool, showNotice]);

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
    [setActiveTool, showNotice]
  );

  const handleImportSvg = useCallback(async () => {
    const file = await pickOpenFile({
      title: 'Импорт SVG в векторные слои',
      filters: [{ name: 'SVG Vector', extensions: ['svg'] }],
    });
    if (!file) return;
    try {
      await insertSvgFiles([file]);
    } catch (err) {
      showNotice(
        err instanceof Error
          ? err.message
          : `Не удалось импортировать SVG «${file.name}»`
      );
    }
  }, [insertSvgFiles, showNotice]);

  const handleReplaceImage = useCallback(
    async (layerId: string) => {
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
      try {
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
            : `Не удалось заменить изображение «${file.name}»`
        );
      }
    },
    [showNotice]
  );

  const handleConvertToOutlines = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      try {
        const created = await convertTextLayersToOutlines(ids);
        if (created.length === 0) {
          showNotice('Выберите разблокированный текстовый слой');
        }
      } catch (err) {
        showNotice(
          err instanceof Error
            ? err.message
            : 'Не удалось перевести текст в кривые'
        );
      }
    },
    [showNotice]
  );

  const handleGroupLayers = useCallback(
    (ids: string[]) => {
      const group = groupLayers(ids);
      if (!group) {
        showNotice('Выберите хотя бы один незаблокированный слой');
      }
    },
    [showNotice]
  );

  const handleUngroupLayers = useCallback(
    (ids: string[]) => {
      const released = ungroupLayers(ids);
      if (released.length === 0) {
        showNotice('Среди выделенных слоёв нет групп');
      }
    },
    [showNotice]
  );

  const handleSplitCompound = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const parts = splitCompoundPathLayers(ids);
      if (parts.length === 0) {
        showNotice('Контур уже состоит из одной части');
      }
    },
    [showNotice]
  );

  const handleCombineCompound = useCallback(
    (ids: string[]) => {
      if (ids.length < 2) return;
      const combined = combineCompoundPathLayers(ids);
      if (!combined) {
        showNotice('Выберите 2+ разблокированных векторных слоя');
      }
    },
    [showNotice]
  );

  const handleOffsetLayers = useCallback(
    (ids: string[], distance: number, copyBehind: boolean) => {
      const result = offsetPathLayers(ids, distance, { copyBehind });
      if (result.length === 0) {
        showNotice('Не удалось построить параллельный контур');
      }
    },
    [showNotice]
  );

  const handleOutlineStroke = useCallback(
    (ids: string[]) => {
      const result = outlineStrokeLayers(ids);
      if (result.length === 0) {
        showNotice('У выделенного слоя нет видимой обводки');
      }
    },
    [showNotice]
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const file = await takeLaunchFile();
      if (disposed || !file) return;
      try {
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
            : `Не удалось открыть «${file.name}»`
        );
      }
    })();

    void subscribeFileDrop(
      (paths) => {
        if (disposed) return;
        void (async () => {
          const locusPath = paths.find((p) => /\.locus$/i.test(p));
          if (locusPath) {
            await handleOpenLocusPath(
              locusPath,
              locusPath.split(/[\\/]/).pop() || 'project.locus'
            );
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
    ).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleOpenLocusPath, insertDroppedImages, insertSvgFiles, showNotice]);

  useEffect(() => {
    const preventWebviewZoom = (event: WheelEvent) => {
      if (
        isCanvasZoomWheel(event) &&
        !(event.target instanceof HTMLCanvasElement)
      ) {
        event.preventDefault();
      }
    };
    const preventGesture = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener('wheel', preventWebviewZoom, { passive: false });
    window.addEventListener('gesturestart', preventGesture);
    return () => {
      window.removeEventListener('wheel', preventWebviewZoom);
      window.removeEventListener('gesturestart', preventGesture);
    };
  }, []);

  const handleToggleGrid = useCallback(() => {
    const next = !useSettingsStore.getState().settings.showGrid;
    updateSettings({ showGrid: next });
    showNotice(next ? 'Сетка включена' : 'Сетка скрыта');
  }, [showNotice, updateSettings]);

  const handleToggleRulers = useCallback(() => {
    const next = !useSettingsStore.getState().settings.showRulers;
    updateSettings({ showRulers: next });
    showNotice(next ? 'Линейки включены' : 'Линейки скрыты');
  }, [showNotice, updateSettings]);

  const handleToggleGuides = useCallback(() => {
    const next = !useSettingsStore.getState().settings.showGuides;
    updateSettings({ showGuides: next });
    showNotice(next ? 'Направляющие показаны' : 'Направляющие скрыты');
  }, [showNotice, updateSettings]);

  const handleToggleSnapToGuides = useCallback(() => {
    const next = !useSettingsStore.getState().settings.snapToGuides;
    updateSettings({ snapToGuides: next });
    showNotice(next ? 'Привязка к направляющим включена' : 'Привязка к направляющим выключена');
  }, [showNotice, updateSettings]);

  const handleClearGuides = useCallback(() => {
    clearGuides();
    showNotice('Направляющие очищены');
  }, [showNotice]);

  const handleToggleSnap = useCallback(() => {
    const cur = useSettingsStore.getState().settings;
    const isAnyEnabled =
      cur.snapToGrid || cur.snapToObjects || cur.snapToArtboard || cur.snapToGuides;
    if (isAnyEnabled) {
      updateSettings({
        snapToGrid: false,
        snapToObjects: false,
        snapToArtboard: false,
        snapToGuides: false,
      });
      showNotice('Привязка выключена');
    } else {
      updateSettings({
        snapToObjects: true,
        snapToArtboard: true,
        snapToGuides: true,
      });
      showNotice('Привязка включена');
    }
  }, [showNotice, updateSettings]);

  const handleRestoreDraft = useCallback(
    (draftScene: Scene) => {
      loadScene(draftScene);
      useEditorStore.getState().setDirty(true);
      setIsStartModalOpen(false);
      setIsSettingsModalOpen(false);
      requestAnimationFrame(() => {
        canvasRef.current?.fitArtboard();
      });
      showNotice('Черновик восстановлен');
    },
    [showNotice]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const currentSettings = useSettingsStore.getState().settings;
      const action = matchShortcut(event, currentSettings.customShortcuts);
      const editable = isEditableElement(event.target);

      if (action === 'app.openTutorial') {
        event.preventDefault();
        if (isCommandBarOpen || rasterExportOpen) return;
        openTutorial();
        return;
      }

      if (action === 'app.openSettings' && !isStartModalOpen && !editable) {
        event.preventDefault();
        useTutorialStore.getState().closeAcademy();
        setSettingsInitialTab(null);
        setIsSettingsModalOpen((open) => !open);
        return;
      }

      if (
        action === 'app.commandBar' &&
        !isStartModalOpen &&
        !isSettingsModalOpen &&
        !isAcademyOpen &&
        !isCommandBarOpen
      ) {
        event.preventDefault();
        openCommandBar();
        return;
      }

      if (
        isStartModalOpen ||
        isSettingsModalOpen ||
        isAcademyOpen ||
        isCommandBarOpen ||
        rasterExportOpen
      ) {
        return;
      }

      const modKey = event.ctrlKey || event.metaKey;
      if (modKey && !event.altKey) {
        if (event.shiftKey && event.code === 'KeyE') {
          event.preventDefault();
          setRasterExportScope('artboard');
          setRasterExportFormat('png');
          setRasterExportOpen(true);
          return;
        }
        if (!event.shiftKey && event.code === 'KeyY') {
          event.preventDefault();
          setOutlineMode((prev) => !prev);
          return;
        }
        if (!event.shiftKey && event.code === 'KeyN') {
          event.preventDefault();
          requestNewProject();
          return;
        }
        if (!editable && !event.shiftKey && event.code === 'KeyA') {
          event.preventDefault();
          selectAllLayers();
          return;
        }
        if (!editable && !event.shiftKey && event.code === 'KeyX') {
          event.preventDefault();
          const st = useEditorStore.getState();
          if (st.selectedIds.length > 0) {
            copySelectedLayers(st.selectedIds);
            deleteLayers(st.selectedIds);
          }
          return;
        }
        if (!editable && (event.code === 'Equal' || event.code === 'NumpadAdd')) {
          event.preventDefault();
          canvasRef.current?.zoomIn();
          return;
        }
        if (!editable && (event.code === 'Minus' || event.code === 'NumpadSubtract')) {
          event.preventDefault();
          canvasRef.current?.zoomOut();
          return;
        }
      }

      if (action === 'view.fitArtboard') {
        event.preventDefault();
        canvasRef.current?.fitArtboard();
        return;
      }

      if (action === 'view.zoomToSelection') {
        event.preventDefault();
        canvasRef.current?.zoomToSelection();
        return;
      }

      if (action === 'view.zoom100') {
        event.preventDefault();
        canvasRef.current?.resetZoom100();
        return;
      }

      if (action === 'view.toggleRulers') {
        event.preventDefault();
        if (!editable) handleToggleRulers();
        return;
      }

      if (action === 'file.save') {
        event.preventDefault();
        void handleSaveProject();
        return;
      }

      if (action === 'file.saveAs') {
        event.preventDefault();
        void handleSaveProject();
        return;
      }

      if (action === 'file.open') {
        event.preventDefault();
        requestOpenProject();
        return;
      }

      if (editable) {
        return;
      }

      if (action) {
        event.preventDefault();
        const st = useEditorStore.getState();
        switch (action) {
          case 'tool.select':
            setActiveTool('select');
            return;
          case 'tool.node':
            setActiveTool('node');
            return;
          case 'tool.pen':
            setActiveTool('pen');
            return;
          case 'tool.blob':
            setActiveTool('blob');
            return;
          case 'tool.text':
            setActiveTool('text');
            return;
          case 'tool.eyedropper':
            setActiveTool('eyedropper');
            return;
          case 'tool.shapeBuilder':
            setActiveTool('shapeBuilder');
            return;
          case 'tool.pencil':
            setActiveTool('pencil');
            return;
          case 'tool.knife':
            setActiveTool('knife');
            return;
          case 'action.placeImage':
            void handlePlaceImage();
            return;
          case 'edit.undo':
            undoCommand();
            return;
          case 'edit.redo':
            redoCommand();
            return;
          case 'edit.duplicate':
            if (st.selectedIds.length > 0) {
              duplicateLayers(st.selectedIds, 16, 16);
            }
            return;
          case 'edit.copy': {
            const count = copySelectedLayers(st.selectedIds);
            if (count > 0) {
              showNotice(`Скопировано слоёв: ${count}`);
            }
            return;
          }
          case 'edit.copySvg':
            handleCopySvg(st.selectedIds);
            return;
          case 'edit.paste': {
            const created = pasteLayers({ inPlace: false });
            if (created.length === 0) {
              showNotice('Буфер обмена пуст');
            }
            return;
          }
          case 'edit.pasteInPlace': {
            const created = pasteLayers({ inPlace: true });
            if (created.length === 0) {
              showNotice('Буфер обмена пуст');
            }
            return;
          }
          case 'edit.copyStyle': {
            if (copyLayerStyle()) {
              showNotice('Стиль слоя скопирован');
            }
            return;
          }
          case 'edit.pasteStyle': {
            const count = pasteLayerStyle(st.selectedIds);
            if (count === 0) {
              showNotice('Нет скопированного стиля или выделения');
            }
            return;
          }
          case 'view.toggleGrid':
            handleToggleGrid();
            return;
          case 'view.toggleSnap':
            handleToggleSnap();
            return;
          case 'vector.textToOutlines':
            void handleConvertToOutlines(st.selectedIds);
            return;
          case 'vector.combineCompound':
            handleCombineCompound(st.selectedIds);
            return;
          case 'vector.splitCompound':
            handleSplitCompound(st.selectedIds);
            return;
          case 'layer.backward':
          case 'layer.forward':
            if (st.selectedIds.length > 0) {
              reorderLayer(
                st.selectedIds[0],
                action === 'layer.backward' ? 'backward' : 'forward'
              );
            }
            return;
          case 'layer.group':
            handleGroupLayers(st.selectedIds);
            return;
          case 'layer.ungroup':
            handleUngroupLayers(st.selectedIds);
            return;
          case 'layer.toggleLock':
            handleToggleLock();
            return;
        }
      }

      const mod = event.ctrlKey || event.metaKey;

      if (event.code === 'Space' && !mod && !event.altKey) {
        event.preventDefault();
        if (!event.repeat) {
          setIsSpacePanning(true);
        }
        return;
      }

      if (mod || event.altKey) {
        return;
      }

      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight'
      ) {
        const ids = useEditorStore.getState().selectedIds;
        if (ids.length > 0) {
          event.preventDefault();
          const step = event.shiftKey
            ? currentSettings.nudgeShiftStep
            : currentSettings.nudgeStep;
          const dx =
            event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy =
            event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          nudgeLayers(ids, dx, dy);
        }
        return;
      }

      switch (event.code) {
        case 'Delete':
        case 'Backspace': {
          event.preventDefault();
          const st = useEditorStore.getState();
          if (st.activeTool === 'node' && st.selectedNode) {
            deleteAnchor(
              st.selectedNode.layerId,
              st.selectedNode.subpathIndex,
              st.selectedNode.anchorIndex
            );
          } else if (st.selectedIds.length > 0) {
            deleteLayers(st.selectedIds);
          }
          break;
        }
        case 'Enter': {
          if (canvasRef.current?.finishActiveTool()) {
            event.preventDefault();
          }
          break;
        }
        case 'Escape': {
          const handled = canvasRef.current?.finishActiveTool();
          if (!handled) {
            const st = useEditorStore.getState();
            if (st.selectedIds.length > 0 || st.selectedNode) {
              setSelectedIds([]);
              setSelectedNode(null);
            } else if (st.editingGroupId) {
              setEditingGroupId(getParentGroupId(st.scene.layers, st.editingGroupId));
            }
            setNotice(null);
          }
          break;
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setIsSpacePanning(false);
      }
    };

    const handleBlur = () => {
      setIsSpacePanning(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [
    handleCombineCompound,
    handleConvertToOutlines,
    handleCopySvg,
    handleGroupLayers,
    handlePlaceImage,
    handleSaveProject,
    handleSplitCompound,
    handleToggleGrid,
    handleToggleRulers,
    handleToggleSnap,
    handleUngroupLayers,
    requestNewProject,
    requestOpenProject,
    isSettingsModalOpen,
    isStartModalOpen,
    isAcademyOpen,
    isCommandBarOpen,
    openCommandBar,
    openTutorial,
    rasterExportOpen,
    setActiveTool,
    setEditingGroupId,
    setSelectedIds,
    setSelectedNode,
    showNotice,
  ]);

  const handleCreateDocument = (opts: {
    name: string;
    width: number;
    height: number;
    dpi: number;
    background: string;
  }) => {
    resetDocument(opts);
    const showWelcomeHintOnce = () => {
      const st = useSettingsStore.getState();
      if (st.settings.tutorial.welcomeDismissed) return;
      st.updateSettings({
        tutorial: dismissTutorialWelcome(st.settings.tutorial),
      });
      setShowTutorialHint(true);
    };
    if (useSettingsStore.getState().loaded) {
      showWelcomeHintOnce();
    } else {
      void useSettingsStore.getState().loadSettings().then(showWelcomeHintOnce);
    }
    setIsStartModalOpen(false);
    requestAnimationFrame(() => {
      canvasRef.current?.fitArtboard();
    });
  };

  const handleExportDocument = useCallback(
    (format: ExportKind) => {
      if (format === 'png' || format === 'jpg') {
        setRasterExportScope('artboard');
        setRasterExportFormat(format);
        setRasterExportOpen(true);
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
    [showNotice]
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

  const handleOpenEffect = useCallback(
    (target: EffectTarget) => {
      const st = useEditorStore.getState();
      if (st.selectedIds.length === 0) {
        showNotice('Сначала выберите слой для применения эффекта');
        return;
      }
      const idSet = new Set(st.selectedIds);
      const selected = flattenLayers(st.scene.layers).filter((l) => idSet.has(l.id));
      if (selected.length === 0) {
        showNotice('Сначала выберите слой для применения эффекта');
        return;
      }
      if (
        isVectorEffectKind(target.kind) &&
        !selected.some((l) => l.type === 'path' || l.type === 'text')
      ) {
        showNotice('Векторные эффекты доступны только для фигур и текста');
        return;
      }
      setEffectModalTarget(target);
    },
    [showNotice]
  );

  const handleEnterGroup = useCallback(
    (groupId: string | null) => {
      setEditingGroupId(groupId);
      setSelectedIds([]);
      setSelectedNode(null);
    },
    [setEditingGroupId, setSelectedIds, setSelectedNode]
  );

  const handleUploadFont = useCallback(async () => {
    const file = await pickOpenFile({
      title: 'Загрузить шрифт в проект',
      filters: [{ name: 'Шрифты', extensions: ['ttf', 'otf', 'woff2'] }],
    });
    if (!file) return;
    try {
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
          : `Не удалось загрузить шрифт «${file.name}»`
      );
    }
  }, [showNotice]);

  const handleSelectArtboard = useCallback(
    (id: string) => {
      setActiveArtboardId(id);
      requestAnimationFrame(() => canvasRef.current?.focusArtboard(id));
    },
    [setActiveArtboardId]
  );

  const handleAddArtboard = useCallback(() => {
    const ab = addArtboard();
    requestAnimationFrame(() => canvasRef.current?.focusArtboard(ab.id));
    showNotice(`Добавлен «${ab.name}»`);
  }, [showNotice]);

  const handleDuplicateArtboard = useCallback(
    (id: string) => {
      const ab = duplicateArtboard(id);
      if (ab) {
        requestAnimationFrame(() => canvasRef.current?.focusArtboard(ab.id));
        showNotice(`Дублирован «${ab.name}»`);
      }
    },
    [showNotice]
  );

  const handleDeleteArtboard = useCallback(
    (id: string) => {
      if (deleteArtboard(id)) {
        showNotice('Артборд удалён');
      }
    },
    [showNotice]
  );

  const handleUpdateActiveArtboard = useCallback(
    (
      patch: Partial<
        Pick<Artboard, 'name' | 'x' | 'y' | 'width' | 'height' | 'background'>
      > & { dpi?: number }
    ) => {
      if (patch.dpi !== undefined) {
        updateArtboard({ dpi: patch.dpi });
      }
      const abPatch: Partial<
        Pick<Artboard, 'name' | 'x' | 'y' | 'width' | 'height' | 'background'>
      > = {};
      if (patch.name !== undefined) abPatch.name = patch.name;
      if (patch.x !== undefined) abPatch.x = patch.x;
      if (patch.y !== undefined) abPatch.y = patch.y;
      if (patch.width !== undefined) abPatch.width = patch.width;
      if (patch.height !== undefined) abPatch.height = patch.height;
      if (patch.background !== undefined) abPatch.background = patch.background;
      if (Object.keys(abPatch).length > 0) {
        updateArtboardById(useEditorStore.getState().activeArtboardId, abPatch);
      }
    },
    []
  );

  const handleExportArtboard = useCallback(
    (kind: ExportKind, artboardId: string) => {
      if (kind === 'png' || kind === 'jpg') {
        setActiveArtboardId(artboardId);
        setRasterExportScope('artboard');
        setRasterExportFormat(kind);
        setRasterExportOpen(true);
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
    [setActiveArtboardId, showNotice]
  );

  const handleExpandAppearance = useCallback(
    (ids: string[]) => {
      const out = expandLayerAppearance(ids);
      if (out.length === 0) {
        showNotice('Нет векторных эффектов для разбора');
      } else {
        showNotice('Оформление разобрано в векторные кривые');
      }
    },
    [showNotice]
  );

  const handleTraceImage = useCallback(
    (layerId: string, options: Partial<ImageTraceOptions> = { mode: 'bw' }) => {
      const result = traceImageLayer(layerId, options);
      if (!result) {
        showNotice('Не удалось векторизовать изображение');
      } else {
        showNotice(`Изображение переведено в вектор: «${result.name}»`);
      }
    },
    [showNotice]
  );

  const handleAttachTextToPath = useCallback(
    (textLayerId: string, pathLayerId: string) => {
      const result = attachTextToPath(textLayerId, pathLayerId);
      if (!result) {
        showNotice('Выберите текстовый слой и векторный контур');
      } else {
        showNotice('Текст привязан к контуру');
      }
    },
    [showNotice]
  );

  const handleDetachTextFromPath = useCallback(
    (textLayerId: string) => {
      if (detachTextFromPath(textLayerId)) {
        showNotice('Текст откреплён от контура');
      }
    },
    [showNotice]
  );

  const handleCreateTextOnPathFromShape = useCallback(
    (pathLayerId: string) => {
      const created = createTextOnPathFromShape(pathLayerId);
      if (!created) {
        showNotice('Выберите разблокированный векторный контур');
        return;
      }
      showNotice('Текст создан по контуру');
      requestAnimationFrame(() => {
        canvasRef.current?.startTextEditing(created.id, true);
      });
    },
    [showNotice]
  );

  const handleCreateCircleText = useCallback(() => {
    const created = createCircleTextPreset();
    setActiveTool('select');
    showNotice('Создан текст по кругу');
    requestAnimationFrame(() => {
      canvasRef.current?.startTextEditing(created.id, true);
    });
  }, [setActiveTool, showNotice]);

  const handleSplitText = useCallback(
    (ids: string[], mode: TextSplitMode) => {
      const created = splitTextLayers(ids, mode);
      if (created.length === 0) {
        showNotice(
          mode === 'lines'
            ? 'Нужен многострочный свободный текст'
            : 'Нужен текстовый слой минимум с двумя символами'
        );
        return;
      }
      showNotice(
        mode === 'lines'
          ? 'Текст разбит на отдельные строки'
          : 'Текст разбит на отдельные буквы'
      );
    },
    [showNotice]
  );

  const handleToggleLock = useCallback(() => {
    const st = useEditorStore.getState();
    if (st.selectedIds.length === 0) return;
    const idSet = new Set(st.selectedIds);
    const selected = flattenLayers(st.scene.layers).filter((l) => idSet.has(l.id));
    if (selected.length === 0) return;
    const shouldLock = selected.some((l) => !l.locked);
    updateLayers(
      selected.map((l) => l.id),
      { locked: shouldLock }
    );
  }, []);

  const snapEnabled =
    settings.snapToGrid ||
    settings.snapToObjects ||
    settings.snapToArtboard ||
    settings.snapToGuides;

  const selectedLayers = useMemo(() => {
    if (selectedIds.length === 0) return [];
    const idSet = new Set(selectedIds);
    return flattenLayers(scene.layers).filter((l) => idSet.has(l.id));
  }, [scene.layers, selectedIds]);

  const menuState: MenuBarState = useMemo(() => {
    const selected = selectedLayers;
    const hasPairText = selected.some((l) => l.type === 'text' && !l.locked);
    const hasPairPath = selected.some((l) => l.type === 'path' && !l.locked);
    const selectedTexts = selected.filter(
      (l): l is TextLayer => l.type === 'text' && !l.locked
    );
    return {
      hasSelection: selected.length > 0,
      hasMultiSelection: selected.length >= 2,
      hasPathSelection: selected.some((l) => l.type === 'path'),
      hasTextSelection: selected.some((l) => l.type === 'text'),
      hasImageSelection: selected.some((l) => l.type === 'image' && !l.locked),
      hasGroupSelection: selected.some((l) => l.type === 'group'),
      canAttachTextToPath: selected.length === 2 && hasPairText && hasPairPath,
      canDetachTextFromPath: selectedTexts.some((l) => Boolean(l.pathId)),
      canSplitTextChars: selectedTexts.some(
        (l) => Array.from(l.content || '').filter((c) => c.trim().length > 0).length >= 2
      ),
      canSplitTextLines: selectedTexts.some(
        (l) =>
          !l.pathId &&
          (l.content || '').split('\n').filter((line) => line.trim().length > 0).length >= 2
      ),
      hasEffects: selected.some((l) => hasAnyEffects(l.effects)),
      canUndo,
      canRedo,
      showGrid: settings.showGrid,
      showRulers: settings.showRulers,
      showGuides: settings.showGuides,
      snapEnabled,
      snapToGuides: settings.snapToGuides,
      hasGuides: Boolean(scene.guides && scene.guides.length > 0),
      outlineMode,
      showToolbar,
      showLayers,
      showInspector,
    };
  }, [
    canRedo,
    canUndo,
    outlineMode,
    scene.guides,
    selectedLayers,
    settings.showGrid,
    settings.showGuides,
    settings.showRulers,
    settings.snapToGuides,
    showInspector,
    showLayers,
    showToolbar,
    snapEnabled,
  ]);

  const menuActions: MenuBarActions = useMemo(
    () => ({
      onNewDocument: requestNewProject,
      onOpenDocument: requestOpenProject,
      onSaveDocument: () => void handleSaveProject(),
      onImportImage: () => void handlePlaceImage(),
      onImportSvg: () => void handleImportSvg(),
      onQuickExportPng: handleQuickExportPng,
      onOpenRasterExport: (fmt = 'png') => {
        setRasterExportScope('artboard');
        setRasterExportFormat(fmt);
        setRasterExportOpen(true);
      },
      onExportDocument: handleExportDocument,
      onExportSelectionSvg: () => handleExportSelectionSvg(),
      onExportSelectionRaster: () => handleExportSelectionRaster(),
      onAddArtboard: handleAddArtboard,
      onOpenDocSetup: () => {
        deselectAllLayers();
        setShowInspector(true);
      },
      onUndo: undoCommand,
      onRedo: redoCommand,
      onCut: () => {
        const ids = useEditorStore.getState().selectedIds;
        if (ids.length > 0) {
          copySelectedLayers(ids);
          deleteLayers(ids);
        }
      },
      onCopy: () => {
        const count = copySelectedLayers(useEditorStore.getState().selectedIds);
        if (count > 0) showNotice(`Скопировано слоёв: ${count}`);
      },
      onCopySvg: () => handleCopySvg(),
      onPaste: () => {
        const created = pasteLayers({ inPlace: false });
        if (created.length === 0) showNotice('Буфер обмена пуст');
      },
      onDuplicate: () => duplicateLayers(useEditorStore.getState().selectedIds, 16, 16),
      onDelete: () => deleteLayers(useEditorStore.getState().selectedIds),
      onGroup: () => handleGroupLayers(useEditorStore.getState().selectedIds),
      onUngroup: () => handleUngroupLayers(useEditorStore.getState().selectedIds),
      onToggleLock: handleToggleLock,
      onUploadFont: () => void handleUploadFont(),
      onOpenSettings: () => openSettingsTab(null),
      onOpenTutorial: openTutorial,
      onOpenShortcuts: () => openSettingsTab('shortcuts'),
      onOpenAbout: () => openSettingsTab('about'),
      onRotateBy: (deg) => rotateLayersBy(useEditorStore.getState().selectedIds, deg),
      onFlip: (axis) => flipLayers(useEditorStore.getState().selectedIds, axis),
      onReorder: (mode) => {
        const ids = useEditorStore.getState().selectedIds;
        if (ids.length > 0) reorderLayer(ids[0], mode);
      },
      onBooleanOp: (op) => {
        const ids = useEditorStore.getState().selectedIds;
        if (!booleanLayers(ids, op)) {
          showNotice('Фигуры не пересекаются или результат пуст');
        }
      },
      onOffsetPath: () => handleOffsetLayers(useEditorStore.getState().selectedIds, 8, false),
      onOutlineStroke: () => handleOutlineStroke(useEditorStore.getState().selectedIds),
      onSimplifyPath: () => simplifyPathLayers(useEditorStore.getState().selectedIds, 2.5),
      onCreateClipMask: () => {
        if (!createClipMaskFromSelection(useEditorStore.getState().selectedIds)) {
          showNotice('Для маски нужен векторный контур и слой под ним');
        }
      },
      onExpandAppearance: () => handleExpandAppearance(useEditorStore.getState().selectedIds),
      onTraceImage: () => {
        const st = useEditorStore.getState();
        const img = flattenLayers(st.scene.layers).find(
          (l) => st.selectedIds.includes(l.id) && l.type === 'image' && !l.locked
        );
        if (img) handleTraceImage(img.id, { mode: 'bw' });
      },
      onConvertToOutlines: () => void handleConvertToOutlines(useEditorStore.getState().selectedIds),
      onAttachTextToPath: () => {
        const st = useEditorStore.getState();
        const idSet = new Set(st.selectedIds);
        const sel = flattenLayers(st.scene.layers).filter((l) => idSet.has(l.id) && !l.locked);
        const txt = sel.find((l) => l.type === 'text');
        const pth = sel.find((l) => l.type === 'path');
        if (txt && pth) {
          handleAttachTextToPath(txt.id, pth.id);
        } else if (pth) {
          handleCreateTextOnPathFromShape(pth.id);
        }
      },
      onDetachTextFromPath: () => {
        const st = useEditorStore.getState();
        const idSet = new Set(st.selectedIds);
        const txt = flattenLayers(st.scene.layers).find(
          (l) => idSet.has(l.id) && l.type === 'text' && !l.locked && l.pathId
        );
        if (txt) handleDetachTextFromPath(txt.id);
      },
      onCreateCircleText: handleCreateCircleText,
      onSplitText: (mode) => handleSplitText(useEditorStore.getState().selectedIds, mode),
      onTransformTextCase: (mode) => transformTextCase(useEditorStore.getState().selectedIds, mode),
      onSelectAll: selectAllLayers,
      onDeselect: deselectAllLayers,
      onInvertSelection: invertSelection,
      onSelectSimilar: (criterion) => {
        const count = selectSimilarLayers(criterion);
        showNotice(`Выделено слоёв: ${count}`);
      },
      onOpenEffect: handleOpenEffect,
      onClearEffects: () => updateLayerEffects(useEditorStore.getState().selectedIds, null),
      onZoomIn: () => canvasRef.current?.zoomIn(),
      onZoomOut: () => canvasRef.current?.zoomOut(),
      onFitArtboard: handleFitArtboard,
      onZoomToSelection: () => canvasRef.current?.zoomToSelection(),
      onResetZoom100: () => canvasRef.current?.resetZoom100(),
      onToggleGrid: handleToggleGrid,
      onToggleRulers: handleToggleRulers,
      onToggleGuides: handleToggleGuides,
      onToggleSnap: handleToggleSnap,
      onToggleSnapToGuides: handleToggleSnapToGuides,
      onClearGuides: handleClearGuides,
      onToggleOutline: () => setOutlineMode((v) => !v),
      onToggleToolbar: () => setShowToolbar((v) => !v),
      onToggleLayers: () => setShowLayers((v) => !v),
      onToggleInspector: () => setShowInspector((v) => !v),
      onOpenCommandBar: openCommandBar,
      onRunPreflight: handleRunPreflight,
    }),
    [
      handleAddArtboard,
      handleAttachTextToPath,
      handleClearGuides,
      handleConvertToOutlines,
      handleCopySvg,
      handleCreateCircleText,
      handleCreateTextOnPathFromShape,
      handleDetachTextFromPath,
      handleExpandAppearance,
      handleExportDocument,
      handleExportSelectionRaster,
      handleExportSelectionSvg,
      handleFitArtboard,
      handleGroupLayers,
      handleOffsetLayers,
      handleOpenEffect,
      handleOutlineStroke,
      handlePlaceImage,
      handleQuickExportPng,
      handleRunPreflight,
      handleSaveProject,
      handleSplitText,
      handleToggleGrid,
      handleToggleGuides,
      handleToggleLock,
      handleToggleRulers,
      handleToggleSnap,
      handleToggleSnapToGuides,
      handleTraceImage,
      handleUngroupLayers,
      handleUploadFont,
      openCommandBar,
      openSettingsTab,
      openTutorial,
      requestNewProject,
      requestOpenProject,
      showNotice,
    ]
  );

  const handleBooleanOp = useCallback(
    (ids: string[], operation: BooleanOp) => {
      const result = booleanLayers(ids, operation);
      if (!result) {
        showNotice('Фигуры не пересекаются или результат пуст');
      }
    },
    [showNotice]
  );

  const handleRootContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      const editableElement = findEditableElement(event.target);
      if (editableElement) {
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          area: 'editable',
          layerIds: [],
          editableElement,
        });
        return;
      }
      const row = (event.target as HTMLElement | null)?.closest('[data-layer-id]');
      const rowId =
        row instanceof HTMLElement ? row.dataset.layerId ?? null : null;
      const current = useEditorStore.getState().selectedIds;
      const layerIds = rowId
        ? current.includes(rowId)
          ? current
          : [rowId]
        : current;
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        area: 'app',
        layerIds,
        editableElement: null,
      });
    },
    []
  );

  const handleContextMenuAction = useCallback(
    (action: ContextMenuActionId) => {
      const menu = contextMenu;
      setContextMenu(null);
      if (!menu) return;

      if (menu.area === 'editable' && menu.editableElement) {
        if (
          action === 'cut' ||
          action === 'copy' ||
          action === 'paste' ||
          action === 'selectAll'
        ) {
          void runTextContextAction(action, menu.editableElement);
        }
        return;
      }

      const ids = menu.layerIds;
      switch (action) {
        case 'copy': {
          const count = copySelectedLayers(ids);
          if (count > 0) showNotice(`Скопировано слоёв: ${count}`);
          return;
        }
        case 'copySvg':
          handleCopySvg(ids);
          return;
        case 'exportSelection':
          handleExportSelectionRaster(ids);
          return;
        case 'cut': {
          if (copySelectedLayers(ids) > 0) deleteLayers(ids);
          return;
        }
        case 'paste': {
          if (pasteLayers({ inPlace: false }).length === 0) {
            showNotice('Буфер обмена пуст');
          }
          return;
        }
        case 'duplicate':
          if (ids.length > 0) duplicateLayers(ids, 16, 16);
          return;
        case 'delete':
          if (ids.length > 0) deleteLayers(ids);
          return;
        case 'group':
          handleGroupLayers(ids);
          return;
        case 'ungroup':
          handleUngroupLayers(ids);
          return;
        case 'bringForward':
          ids.forEach((id) => reorderLayer(id, 'forward'));
          return;
        case 'sendBackward':
          ids.forEach((id) => reorderLayer(id, 'backward'));
          return;
        case 'selectAll':
          selectAllLayers();
          return;
        case 'deselect':
          deselectAllLayers();
          return;
        case 'ai':
          if (ids.length > 0) {
            useEditorStore.setState({ selectedIds: ids, selectedNode: null });
          }
          openCommandBar();
          return;
      }
    },
    [
      contextMenu,
      handleCopySvg,
      handleExportSelectionRaster,
      handleGroupLayers,
      handleUngroupLayers,
      openCommandBar,
      showNotice,
    ]
  );

  const handleCreateClipMask = useCallback(
    (ids: string[]) => {
      const result = createClipMaskFromSelection(ids);
      if (!result) {
        showNotice('Для маски нужен векторный контур и слой под ним');
      }
    },
    [showNotice]
  );

  const handleSelectLayer = (id: string, additive: boolean) => {
    const st = useEditorStore.getState();
    const parentId = getParentGroupId(st.scene.layers, id);
    if (parentId !== st.editingGroupId) {
      setEditingGroupId(parentId);
      setSelectedIds([id]);
      setSelectedNode(null);
      return;
    }
    if (additive) {
      if (selectedIds.includes(id)) {
        setSelectedIds(selectedIds.filter((item) => item !== id));
      } else {
        setSelectedIds([...selectedIds, id]);
      }
    } else {
      setSelectedIds([id]);
    }
  };

  return (
    <div
      onContextMenu={handleRootContextMenu}
      onDragOver={(e) => {
        if (isTauri()) return;
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          setIsFileDragHover(true);
        }
      }}
      onDragLeave={(e) => {
        if (isTauri()) return;
        if (
          e.currentTarget === e.target ||
          !e.currentTarget.contains(e.relatedTarget as Node)
        ) {
          setIsFileDragHover(false);
        }
      }}
      onDrop={(e) => {
        if (isTauri()) return;
        e.preventDefault();
        setIsFileDragHover(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        const locusFile = files.find((f) => /\.locus$/i.test(f.name));
        if (locusFile) {
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
      }}
      className="flex h-screen w-screen flex-col overflow-hidden bg-paper-bg text-paper-ink"
    >
      <TopBar
        documentName={scene.name}
        isDirty={isDirty}
        zoomPercent={zoomPercent}
        canUndo={canUndo}
        canRedo={canRedo}
        menuState={menuState}
        menuActions={menuActions}
        onRenameDocument={(name) => updateArtboard({ name })}
        onUndo={undoCommand}
        onRedo={redoCommand}
        onOpenCommandBar={openCommandBar}
        onFitArtboard={handleFitArtboard}
        onOpenSettings={() => openSettingsTab(null)}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showToolbar && (
          <Toolbar
            activeTool={activeTool}
            showGrid={settings.showGrid}
            snapEnabled={snapEnabled}
            smartShapePreset={smartShapeOptions.preset}
            textToolMode={textToolMode}
            knifeToolMode={knifeToolMode}
            onSelectTool={setActiveTool}
            onSelectShapePreset={(preset) => setSmartShapeOptions({ preset })}
            onSelectTextMode={setTextToolMode}
            onCreateCircleText={handleCreateCircleText}
            onSelectKnifeMode={setKnifeToolMode}
            onPlaceImage={() => void handlePlaceImage()}
            onToggleGrid={handleToggleGrid}
            onToggleSnap={handleToggleSnap}
            onFitArtboard={handleFitArtboard}
          />
        )}

        <PaperCanvas
          ref={canvasRef}
          scene={scene}
          selectedIds={selectedIds}
          selectedNode={selectedNode}
          activeTool={activeTool}
          isSpacePanning={isSpacePanning}
          outlineMode={outlineMode}
          onZoomChange={setZoomPercent}
          onColorSampled={(hex, target) =>
            showNotice(
              target === 'stroke'
                ? `Цвет обводки: ${hex}`
                : `Цвет заливки: ${hex}`
            )
          }
          onOpenContextMenu={({ x, y, layerId }) =>
            setContextMenu({
              x,
              y,
              area: 'canvas',
              layerIds: layerId ? [layerId] : [],
              editableElement: null,
            })
          }
        />

        {(showLayers || showInspector) && (
          <aside className="flex w-[280px] shrink-0 flex-col border-l border-paper-border bg-paper-panel">
            {showLayers && (
              <LayersPanel
                layers={scene.layers}
                selectedIds={selectedIds}
                editingGroupId={editingGroupId}
                onSelectLayer={handleSelectLayer}
                onEnterGroup={handleEnterGroup}
                onToggleVisible={(id) => {
                  const target = findLayerById(scene.layers, id);
                  if (target) updateLayers([id], { visible: !target.visible });
                }}
                onToggleLocked={(id) => {
                  const target = findLayerById(scene.layers, id);
                  if (target) updateLayers([id], { locked: !target.locked });
                }}
                onRenameLayer={(id, name) => updateLayers([id], { name })}
                onMoveLayer={(id, dir, toExtreme) =>
                  reorderLayer(
                    id,
                    toExtreme
                      ? dir === 'up'
                        ? 'front'
                        : 'back'
                      : dir === 'up'
                        ? 'forward'
                        : 'backward'
                  )
                }
                onDeleteLayer={(id) => deleteLayers([id])}
                onReleaseMask={(maskId) => releaseClipMask(maskId)}
              />
            )}
            {showInspector && (
              <Inspector
                scene={scene}
                selectedIds={selectedIds}
                activeArtboardId={activeArtboardId}
                activeTool={activeTool}
                smartShapeOptions={smartShapeOptions}
                pencilSmoothness={pencilSmoothness}
                onChangeSmartShapeOptions={setSmartShapeOptions}
                onChangePencilSmoothness={setPencilSmoothness}
                onSelectArtboard={handleSelectArtboard}
                onAddArtboard={handleAddArtboard}
                onDuplicateArtboard={handleDuplicateArtboard}
                onDeleteArtboard={handleDeleteArtboard}
                onUpdateArtboard={handleUpdateActiveArtboard}
                onExportArtboard={handleExportArtboard}
                onImportBackgroundImage={() => void handleImportBackgroundImage()}
                onUpdateLayers={updateLayers}
                onGroupLayers={handleGroupLayers}
                onUngroupLayers={handleUngroupLayers}
                onEnterGroup={handleEnterGroup}
                onUploadFont={() => void handleUploadFont()}
                onSmoothLayers={(ids) => smoothLayers(ids, 1)}
                onWobbleLayers={(ids, intensity) => wobbleLayers(ids, intensity)}
                onDuplicateLayers={(ids) => duplicateLayers(ids, 16, 16)}
                onDeleteLayers={deleteLayers}
                onReorderLayer={(id, mode) => reorderLayer(id, mode)}
                onAlignLayers={alignLayers}
                onFlipLayers={flipLayers}
                onBooleanOp={handleBooleanOp}
                onCreateClipMask={handleCreateClipMask}
                onReleaseClipMask={(maskId) => releaseClipMask(maskId)}
                onDetachFromMask={(layerId) => setClipMask(null, [layerId])}
                onReplaceImage={(layerId) => void handleReplaceImage(layerId)}
                onTraceImage={handleTraceImage}
                onEditTextOnCanvas={(layerId) =>
                  canvasRef.current?.startTextEditing(layerId, false)
                }
                onTransformTextCase={transformTextCase}
                onConvertToOutlines={(ids) => void handleConvertToOutlines(ids)}
                onSplitText={handleSplitText}
                onAttachTextToPath={handleAttachTextToPath}
                onDetachTextFromPath={handleDetachTextFromPath}
                onApplyTextPathArc={(layerId, arc) => applyTextPathArc(layerId, arc)}
                onCreateTextOnPath={handleCreateTextOnPathFromShape}
                onSplitCompound={handleSplitCompound}
                onCombineCompound={handleCombineCompound}
                onOffsetLayers={handleOffsetLayers}
                onOutlineStroke={handleOutlineStroke}
                onSimplifyLayers={(ids) => simplifyPathLayers(ids, 2.5)}
                focusedEffect={focusedEffect}
                onConsumeFocusedEffect={() => setFocusedEffect(null)}
                onUpdateEffects={updateLayerEffects}
                onExpandAppearance={handleExpandAppearance}
                onCopySvg={() => handleCopySvg()}
                onExportSelectionRaster={() => handleExportSelectionRaster()}
              />
            )}
          </aside>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuModel({
            area: contextMenu.area,
            layerIds: contextMenu.layerIds,
            hasCopiedLayers: hasCopiedLayers(),
            hasGroupSelected: contextMenu.layerIds.some(
              (id) => findLayerById(scene.layers, id)?.type === 'group'
            ),
          })}
          onAction={handleContextMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      {isFileDragHover && (
        <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded border border-dashed border-paper-accent bg-paper-bg/85">
          <div className="rounded border border-paper-border bg-paper-panel px-4 py-2 text-[13px] font-medium text-paper-ink">
            Отпустите PNG, JPEG, WebP или SVG для вставки на холст
          </div>
        </div>
      )}

      {showTutorialHint && (
        <div className="animate-rise fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-32px)] items-center gap-2 rounded border border-paper-border bg-paper-panel px-3 py-2 text-[12px] text-paper-ink">
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-paper-accent" strokeWidth={1.75} />
          <span className="whitespace-nowrap">Не знаете с чего начать?</span>
          <button
            type="button"
            onClick={openTutorial}
            className="shrink-0 font-medium text-paper-accent hover:underline"
          >
            Открыть обучение
          </button>
          <button
            type="button"
            onClick={() => {
              setShowTutorialHint(false);
              const st = useSettingsStore.getState();
              if (!st.settings.tutorial.welcomeDismissed) {
                st.updateSettings({
                  tutorial: dismissTutorialWelcome(st.settings.tutorial),
                });
              }
            }}
            title="Скрыть"
            className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

      {notice && (
        <div
          onClick={() => setNotice(null)}
          className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 cursor-pointer rounded border border-paper-border bg-paper-panel px-3 py-1.5 text-[12px] text-paper-ink"
        >
          {notice}
        </div>
      )}

      <CommandBar
        isOpen={isCommandBarOpen}
        preflightTrigger={preflightTrigger}
        onClose={closeCommandBar}
        onOpenSettings={(tab) => {
          setIsCommandBarOpen(false);
          openSettingsTab(tab ?? null);
        }}
      />

      <AiTaskIndicator onOpen={openCommandBar} />

      <StartModal
        isOpen={isStartModalOpen}
        onClose={() => setIsStartModalOpen(false)}
        onCreateDocument={handleCreateDocument}
        onOpenProject={requestOpenProject}
        onRestoreDraft={handleRestoreDraft}
        onOpenTutorial={openTutorial}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        initialTab={settingsInitialTab}
        onClose={() => {
          setIsSettingsModalOpen(false);
          setSettingsInitialTab(null);
        }}
        onRestoreDraft={handleRestoreDraft}
        onOpenTutorial={openTutorial}
      />

      <TutorialModal />

      <TutorialSpotlight
        onEnsurePanel={(panel) => {
          if (panel === 'toolbar') setShowToolbar(true);
          else if (panel === 'layers') setShowLayers(true);
          else if (panel === 'inspector') setShowInspector(true);
        }}
      />

      <RasterExportModal
        isOpen={rasterExportOpen}
        scene={scene}
        selectedIds={selectedIds}
        activeArtboardId={activeArtboardId}
        initialFormat={rasterExportFormat}
        initialScope={rasterExportScope}
        onClose={() => setRasterExportOpen(false)}
        onExported={(target) => showNotice(`Экспортировано: ${target}`)}
        onError={(msg) => showNotice(msg)}
      />

      <UnsavedChangesModal
        isOpen={isUnsavedOpen}
        documentName={scene.name}
        isSaving={isSavingBeforeAction}
        onCancel={cancelUnsaved}
        onDiscard={() => void resolveUnsaved('discard')}
        onSave={() => void resolveUnsaved('save')}
      />

      <EffectModal
        target={effectModalTarget}
        layers={selectedLayers}
        onClose={() => setEffectModalTarget(null)}
        onApply={(ids, patch) => {
          updateLayerEffects(ids, patch);
        }}
      />
    </div>
  );
}

export default App;
