import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { BookOpen, X } from 'lucide-react';
import { useAutosaveGuard } from './app/useAutosaveGuard';
import { resetLaunchFileCacheForTest, useFileHandlers } from './app/useFileHandlers';
import { useGlobalShortcuts } from './app/useGlobalShortcuts';
import { useMenuModel } from './app/useMenuModel';
import { copySelectedLayers, hasCopiedLayers, pasteLayers } from './core/clipboard';
import {
  buildContextMenuModel,
  runTextContextAction,
  type ContextMenuActionId,
  type ContextMenuArea,
} from './core/contextMenu';
import {
  addArtboard,
  alignLayers,
  applyTextPathArc,
  attachTextToPath,
  booleanLayers,
  clearGuides,
  combineCompoundPathLayers,
  convertTextLayersToOutlines,
  createCircleTextPreset,
  createClipMaskFromSelection,
  createTextOnPathFromShape,
  deleteArtboard,
  deleteLayers,
  deselectAllLayers,
  detachTextFromPath,
  duplicateArtboard,
  duplicateLayers,
  expandLayerAppearance,
  flipLayers,
  groupLayers,
  loadScene,
  offsetPathLayers,
  outlineStrokeLayers,
  redoCommand,
  releaseClipMask,
  reorderLayer,
  resetDocument,
  runCommandBatch,
  selectAllLayers,
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
import { findLayerById, flattenLayers, getParentGroupId } from './core/layerTree';
import { useSettingsStore } from './core/settings';
import { useCanRedo, useCanUndo, useEditorStore } from './core/store';
import type { Artboard, Scene } from './core/types';
import type { BooleanOp } from './engine/booleans';
import type { ImageTraceOptions } from './engine/imageTrace';
import { isCanvasZoomWheel } from './engine/zoom';
import { PaperCanvas, type PaperCanvasHandle } from './engine/PaperCanvas';
import { AiTaskIndicator } from './ui/AiTaskIndicator';
import { CommandBar } from './ui/CommandBar';
import { ContextMenu } from './ui/ContextMenu';
import { isVectorEffectKind, type EffectTarget } from './ui/inspector/EffectControls';
import { EffectModal } from './ui/inspector/EffectModal';
import { Inspector } from './ui/Inspector';
import { LayersPanel } from './ui/LayersPanel';
import { RasterExportModal } from './ui/RasterExportModal';
import { SettingsModal, type SettingsTabId } from './ui/SettingsModal';
import { StartModal } from './ui/StartModal';
import { Toolbar } from './ui/Toolbar';
import { TopBar } from './ui/TopBar';
import { UnsavedChangesModal } from './ui/UnsavedChangesModal';
import { TutorialModal } from './ui/tutorial/TutorialModal';
import { TutorialSpotlight } from './ui/tutorial/TutorialSpotlight';
import { dismissTutorialWelcome } from './tutorial/progress';
import { useTutorialStore } from './tutorial/store';

export { resetLaunchFileCacheForTest };

function findEditableElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const element = target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
  );
  return element instanceof HTMLElement ? element : null;
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
  const [rasterExportScope, setRasterExportScope] =
    useState<'artboard' | 'selection'>('artboard');
  const [focusedEffect, setFocusedEffect] = useState<EffectTarget | null>(null);
  const [effectModalTarget, setEffectModalTarget] = useState<EffectTarget | null>(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [showLayers, setShowLayers] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [outlineMode, setOutlineMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  const openSettingsTab = useCallback((tab: SettingsTabId | null = null) => {
    setSettingsInitialTab(tab);
    setIsSettingsModalOpen(true);
  }, []);

  const toggleSettingsModal = useCallback(() => {
    setSettingsInitialTab(null);
    setIsSettingsModalOpen((open) => !open);
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

  const openRasterExport = useCallback(
    (format: 'png' | 'jpg', scope: 'artboard' | 'selection' = 'artboard') => {
      setRasterExportScope(scope);
      setRasterExportFormat(format);
      setRasterExportOpen(true);
    },
    []
  );

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

  const {
    isUnsavedOpen,
    isSavingBeforeAction,
    guardUnsaved,
    resolveUnsaved,
    cancelUnsaved,
  } = useAutosaveGuard({
    scene,
    isDirty,
    autosaveEnabled: settings.autosaveEnabled,
    autosaveIntervalSec: settings.autosaveIntervalSec,
    showNotice,
  });

  const {
    isFileDragHover,
    requestOpenProject,
    requestNewProject,
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
  } = useFileHandlers({
    canvasRef,
    guardUnsaved,
    showNotice,
    setIsStartModalOpen,
    setActiveTool,
    setSelectedIds,
    setActiveArtboardId,
    openRasterExport,
  });

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
      const abPatch: Partial<
        Pick<Artboard, 'name' | 'x' | 'y' | 'width' | 'height' | 'background'>
      > = {};
      if (patch.name !== undefined) abPatch.name = patch.name;
      if (patch.x !== undefined) abPatch.x = patch.x;
      if (patch.y !== undefined) abPatch.y = patch.y;
      if (patch.width !== undefined) abPatch.width = patch.width;
      if (patch.height !== undefined) abPatch.height = patch.height;
      if (patch.background !== undefined) abPatch.background = patch.background;
      const hasAbPatch = Object.keys(abPatch).length > 0;
      if (patch.dpi === undefined && !hasAbPatch) return;
      runCommandBatch(() => {
        if (patch.dpi !== undefined) {
          updateArtboard({ dpi: patch.dpi });
        }
        if (hasAbPatch) {
          updateArtboardById(useEditorStore.getState().activeArtboardId, abPatch);
        }
      });
    },
    []
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

  const { isSpacePanning } = useGlobalShortcuts({
    canvasRef,
    isStartModalOpen,
    isSettingsModalOpen,
    isAcademyOpen,
    isCommandBarOpen,
    rasterExportOpen,
    isUnsavedOpen,
    effectModalTarget,
    setActiveTool,
    setSelectedIds,
    setSelectedNode,
    setEditingGroupId,
    setOutlineMode,
    setNotice,
    openTutorial,
    toggleSettingsModal,
    openCommandBar,
    openRasterExport,
    requestNewProject,
    requestOpenProject,
    handleSaveProject,
    handlePlaceImage,
    handleCopySvg,
    handleToggleRulers,
    handleToggleGrid,
    handleToggleSnap,
    handleConvertToOutlines,
    handleCombineCompound,
    handleSplitCompound,
    handleGroupLayers,
    handleUngroupLayers,
    handleToggleLock,
    showNotice,
  });

  const { menuState, menuActions } = useMenuModel({
    sceneGuides: scene.guides,
    selectedLayers,
    canUndo,
    canRedo,
    showGrid: settings.showGrid,
    showRulers: settings.showRulers,
    showGuides: settings.showGuides,
    snapEnabled,
    snapToGuides: settings.snapToGuides,
    outlineMode,
    showToolbar,
    showLayers,
    showInspector,
    canvasRef,
    requestNewProject,
    requestOpenProject,
    handleSaveProject,
    handlePlaceImage,
    handleImportSvg,
    handleQuickExportPng,
    openRasterExport,
    handleExportDocument,
    handleExportSelectionSvg,
    handleExportSelectionRaster,
    handleAddArtboard,
    setShowInspector,
    handleCopySvg,
    handleGroupLayers,
    handleUngroupLayers,
    handleToggleLock,
    handleUploadFont,
    openSettingsTab,
    openTutorial,
    handleOffsetLayers,
    handleOutlineStroke,
    handleExpandAppearance,
    handleTraceImage,
    handleConvertToOutlines,
    handleAttachTextToPath,
    handleCreateTextOnPathFromShape,
    handleDetachTextFromPath,
    handleCreateCircleText,
    handleSplitText,
    handleOpenEffect,
    handleFitArtboard,
    handleToggleGrid,
    handleToggleRulers,
    handleToggleGuides,
    handleToggleSnap,
    handleToggleSnapToGuides,
    handleClearGuides,
    setOutlineMode,
    setShowToolbar,
    setShowLayers,
    openCommandBar,
    handleRunPreflight,
    showNotice,
  });

  const handleBooleanOp = useCallback(
    (ids: string[], operation: BooleanOp) => {
      const result = booleanLayers(ids, operation);
      if (!result) {
        showNotice('Фигуры не пересекаются или результат пуст');
      }
    },
    [showNotice]
  );

  const handleRootContextMenu = useCallback((event: ReactMouseEvent) => {
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
  }, []);

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
          if (ids.length > 0) {
            runCommandBatch(() => {
              ids.forEach((id) => reorderLayer(id, 'forward'));
            });
          }
          return;
        case 'sendBackward':
          if (ids.length > 0) {
            runCommandBatch(() => {
              ids.forEach((id) => reorderLayer(id, 'backward'));
            });
          }
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
      if (st.selectedIds.includes(id)) {
        setSelectedIds(st.selectedIds.filter((item) => item !== id));
      } else {
        setSelectedIds([...st.selectedIds, id]);
      }
    } else {
      setSelectedIds([id]);
    }
  };

  return (
    <div
      onContextMenu={handleRootContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
        onPreflightConsumed={() => setPreflightTrigger(0)}
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
