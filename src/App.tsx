import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { BookOpen, X } from 'lucide-react';
import { inferImageMimeType, registerAssetFromBytes } from './core/assets';
import {
  copyLayerStyle,
  copySelectedLayers,
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
  addLayer,
  alignLayers,
  booleanLayers,
  combineCompoundPathLayers,
  convertTextLayersToOutlines,
  createClipMaskFromSelection,
  createImageLayer,
  createLayerId,
  deleteAnchor,
  deleteLayers,
  deselectAllLayers,
  duplicateLayers,
  expandLayerAppearance,
  flipLayers,
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
  transformTextCase,
  undoCommand,
  updateArtboard,
  updateLayerEffects,
  updateLayers,
  wobbleLayers,
} from './core/commands';
import { saveSceneDraft, useSettingsStore } from './core/settings';
import {
  exportDocumentDialog,
  openProjectDialog,
  quickExportPngDialog,
  saveProjectDialog,
  type ExportKind,
} from './core/documentFile';
import { openLocusFromBytes } from './export/projectFile';
import { matchShortcut } from './core/shortcuts';
import { useCanRedo, useCanUndo, useEditorStore } from './core/store';
import type { ImageLayer, Scene } from './core/types';
import type { BooleanOp } from './engine/booleans';
import { isCanvasZoomWheel } from './engine/zoom';
import { hasAnyEffects } from './engine/effects';
import { PaperCanvas, type PaperCanvasHandle } from './engine/PaperCanvas';
import {
  isTauri,
  pickOpenFile,
  readFileBytes,
  subscribeFileDrop,
} from './platform/io';
import { ContextMenu } from './ui/ContextMenu';
import { AiTaskIndicator } from './ui/AiTaskIndicator';
import { CommandBar } from './ui/CommandBar';
import { EffectModal, type EffectModalTarget } from './ui/EffectModal';
import { Inspector } from './ui/Inspector';
import { LayersPanel } from './ui/LayersPanel';
import type { MenuBarActions, MenuBarState } from './ui/MenuBar';
import { RasterExportModal } from './ui/RasterExportModal';
import { SettingsModal, type SettingsTabId } from './ui/SettingsModal';
import { TutorialModal } from './ui/tutorial/TutorialModal';
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
  const zoomPercent = useEditorStore((s) => s.zoomPercent);
  const isDirty = useEditorStore((s) => s.isDirty);
  const isAcademyOpen = useTutorialStore((state) => state.isAcademyOpen);

  const setSelectedIds = useEditorStore((s) => s.setSelectedIds);
  const setSelectedNode = useEditorStore((s) => s.setSelectedNode);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const setSmartShapeOptions = useEditorStore((s) => s.setSmartShapeOptions);
  const setZoomPercent = useEditorStore((s) => s.setZoomPercent);

  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [isStartModalOpen, setIsStartModalOpen] = useState(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] =
    useState<SettingsTabId | null>(null);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  const [rasterExportOpen, setRasterExportOpen] = useState(false);
  const [rasterExportFormat, setRasterExportFormat] = useState<'png' | 'jpg'>('png');
  const [activeEffectModal, setActiveEffectModal] = useState<EffectModalTarget | null>(null);
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

      const scene = useEditorStore.getState().scene;
      const previous = scene.layers.find(
        (layer) => layer.type === 'image' && layer.name === BACKGROUND_LAYER_NAME
      );
      const coverScale = Math.max(
        scene.width / Math.max(1, asset.naturalWidth),
        scene.height / Math.max(1, asset.naturalHeight)
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
          x: scene.width / 2,
          y: scene.height / 2,
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
        { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
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
          const imagePaths = paths.filter((p) =>
            /\.(png|jpe?g|webp|svg)$/i.test(p)
          );
          if (imagePaths.length === 0) return;

          try {
            const entries = await Promise.all(
              imagePaths.map(async (p) => ({
                name: p.split(/[\\/]/).pop() || 'image.png',
                bytes: await readFileBytes(p),
              }))
            );
            await insertDroppedImages(entries);
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
  }, [handleOpenLocusPath, insertDroppedImages, showNotice]);

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

  const handleToggleSnap = useCallback(() => {
    const cur = useSettingsStore.getState().settings;
    const isAnyEnabled = cur.snapToGrid || cur.snapToObjects || cur.snapToArtboard;
    if (isAnyEnabled) {
      updateSettings({
        snapToGrid: false,
        snapToObjects: false,
        snapToArtboard: false,
      });
      showNotice('Привязка выключена');
    } else {
      updateSettings({
        snapToObjects: true,
        snapToArtboard: true,
      });
      showNotice('Привязка включена');
    }
  }, [showNotice, updateSettings]);

  const handleRestoreDraft = useCallback(
    (draftScene: Scene) => {
      loadScene(draftScene);
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
        if (isCommandBarOpen || rasterExportOpen || activeEffectModal) return;
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
        rasterExportOpen ||
        activeEffectModal !== null
      ) {
        return;
      }

      const modKey = event.ctrlKey || event.metaKey;
      if (modKey && !event.altKey) {
        if (event.shiftKey && event.code === 'KeyE') {
          event.preventDefault();
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

      if (action === 'view.zoom100') {
        event.preventDefault();
        canvasRef.current?.resetZoom100();
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
            setSelectedIds([]);
            setSelectedNode(null);
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
    handlePlaceImage,
    handleSaveProject,
    handleSplitCompound,
    handleToggleGrid,
    handleToggleSnap,
    requestNewProject,
    requestOpenProject,
    activeEffectModal,
    isSettingsModalOpen,
    isStartModalOpen,
    isAcademyOpen,
    isCommandBarOpen,
    openCommandBar,
    openTutorial,
    rasterExportOpen,
    setActiveTool,
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
    const settingsState = useSettingsStore.getState();
    if (settingsState.loaded && !settingsState.settings.tutorial.welcomeDismissed) {
      settingsState.updateSettings({
        tutorial: dismissTutorialWelcome(settingsState.settings.tutorial),
      });
      setShowTutorialHint(true);
    }
    setIsStartModalOpen(false);
    requestAnimationFrame(() => {
      canvasRef.current?.fitArtboard();
    });
  };

  const handleExportDocument = useCallback(
    (format: ExportKind) => {
      if (format === 'png' || format === 'jpg') {
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
    (target: EffectModalTarget) => {
      const ids = useEditorStore.getState().selectedIds;
      if (ids.length === 0) {
        showNotice('Сначала выберите слой для применения эффекта');
        return;
      }
      setActiveEffectModal(target);
    },
    [showNotice]
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

  const snapEnabled =
    settings.snapToGrid || settings.snapToObjects || settings.snapToArtboard;

  const menuState: MenuBarState = useMemo(() => {
    const idSet = new Set(selectedIds);
    const selected = scene.layers.filter((l) => idSet.has(l.id));
    return {
      hasSelection: selected.length > 0,
      hasMultiSelection: selected.length >= 2,
      hasPathSelection: selected.some((l) => l.type === 'path'),
      hasTextSelection: selected.some((l) => l.type === 'text'),
      hasEffects: selected.some((l) => hasAnyEffects(l.effects)),
      canUndo,
      canRedo,
      showGrid: settings.showGrid,
      snapEnabled,
      outlineMode,
      showToolbar,
      showLayers,
      showInspector,
    };
  }, [
    canRedo,
    canUndo,
    outlineMode,
    scene.layers,
    selectedIds,
    settings.showGrid,
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
      onQuickExportPng: handleQuickExportPng,
      onOpenRasterExport: (fmt = 'png') => {
        setRasterExportFormat(fmt);
        setRasterExportOpen(true);
      },
      onExportDocument: handleExportDocument,
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
      onPaste: () => {
        const created = pasteLayers({ inPlace: false });
        if (created.length === 0) showNotice('Буфер обмена пуст');
      },
      onDuplicate: () => duplicateLayers(useEditorStore.getState().selectedIds, 16, 16),
      onDelete: () => deleteLayers(useEditorStore.getState().selectedIds),
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
      onConvertToOutlines: () => void handleConvertToOutlines(useEditorStore.getState().selectedIds),
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
      onResetZoom100: () => canvasRef.current?.resetZoom100(),
      onToggleGrid: handleToggleGrid,
      onToggleSnap: handleToggleSnap,
      onToggleOutline: () => setOutlineMode((v) => !v),
      onToggleToolbar: () => setShowToolbar((v) => !v),
      onToggleLayers: () => setShowLayers((v) => !v),
      onToggleInspector: () => setShowInspector((v) => !v),
      onOpenCommandBar: openCommandBar,
    }),
    [
      handleConvertToOutlines,
      handleExpandAppearance,
      handleExportDocument,
      handleFitArtboard,
      handleOffsetLayers,
      handleOpenEffect,
      handleOutlineStroke,
      handlePlaceImage,
      handleQuickExportPng,
      handleSaveProject,
      handleToggleGrid,
      handleToggleSnap,
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
    [contextMenu, openCommandBar, showNotice]
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
        const imageFiles = files.filter((f) =>
          /\.(png|jpe?g|webp|svg)$/i.test(f.name)
        );
        if (imageFiles.length === 0) return;

        void (async () => {
          try {
            const entries = await Promise.all(
              imageFiles.map(async (file) => ({
                name: file.name,
                bytes: new Uint8Array(await file.arrayBuffer()),
              }))
            );
            await insertDroppedImages(entries);
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
            onSelectTool={setActiveTool}
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
                onSelectLayer={handleSelectLayer}
                onToggleVisible={(id) => {
                  const target = scene.layers.find((l) => l.id === id);
                  if (target) updateLayers([id], { visible: !target.visible });
                }}
                onToggleLocked={(id) => {
                  const target = scene.layers.find((l) => l.id === id);
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
                activeTool={activeTool}
                smartShapeOptions={smartShapeOptions}
                onChangeSmartShapeOptions={setSmartShapeOptions}
                onUpdateArtboard={updateArtboard}
                onImportBackgroundImage={() => void handleImportBackgroundImage()}
                onUpdateLayers={updateLayers}
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
                onEditTextOnCanvas={(layerId) =>
                  canvasRef.current?.startTextEditing(layerId, false)
                }
                onTransformTextCase={transformTextCase}
                onConvertToOutlines={(ids) => void handleConvertToOutlines(ids)}
                onSplitCompound={handleSplitCompound}
                onCombineCompound={handleCombineCompound}
                onOffsetLayers={handleOffsetLayers}
                onOutlineStroke={handleOutlineStroke}
                onSimplifyLayers={(ids) => simplifyPathLayers(ids, 2.5)}
                onOpenEffect={handleOpenEffect}
                onUpdateEffects={updateLayerEffects}
                onExpandAppearance={handleExpandAppearance}
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
            onClick={() => {
              setShowTutorialHint(false);
              openTutorial();
            }}
            className="shrink-0 font-medium text-paper-accent hover:underline"
          >
            Открыть обучение
          </button>
          <button
            type="button"
            onClick={() => setShowTutorialHint(false)}
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

      <RasterExportModal
        isOpen={rasterExportOpen}
        scene={scene}
        selectedIds={selectedIds}
        initialFormat={rasterExportFormat}
        onClose={() => setRasterExportOpen(false)}
        onExported={(target) => showNotice(`Экспортировано: ${target}`)}
        onError={(msg) => showNotice(msg)}
      />

      <EffectModal
        target={activeEffectModal}
        selectedIds={selectedIds}
        onClose={() => setActiveEffectModal(null)}
        onApplied={(label) => showNotice(`Применён эффект: ${label}`)}
      />

      <UnsavedChangesModal
        isOpen={isUnsavedOpen}
        documentName={scene.name}
        isSaving={isSavingBeforeAction}
        onCancel={cancelUnsaved}
        onDiscard={() => void resolveUnsaved('discard')}
        onSave={() => void resolveUnsaved('save')}
      />
    </div>
  );
}

export default App;
