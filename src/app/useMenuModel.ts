import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { copySelectedLayers, pasteLayers } from '../core/clipboard';
import {
  booleanLayers,
  createClipMaskFromSelection,
  deleteLayers,
  deselectAllLayers,
  duplicateLayers,
  flipLayers,
  invertSelection,
  redoCommand,
  reorderLayer,
  rotateLayersBy,
  selectAllLayers,
  selectSimilarLayers,
  simplifyPathLayers,
  transformTextCase,
  undoCommand,
  updateLayerEffects,
  type TextSplitMode,
} from '../core/commands';
import type { ExportKind } from '../core/documentFile';
import { flattenLayers } from '../core/layerTree';
import { useEditorStore } from '../core/store';
import type { Layer, Scene, TextLayer } from '../core/types';
import { hasAnyEffects } from '../engine/effects';
import type { ImageTraceOptions } from '../engine/imageTrace';
import type { PaperCanvasHandle } from '../engine/PaperCanvas';
import type { EffectTarget } from '../ui/inspector/EffectControls';
import type { MenuBarActions, MenuBarState } from '../ui/MenuBar';
import type { SettingsTabId } from '../ui/SettingsModal';

export interface UseMenuModelOptions {
  sceneGuides: Scene['guides'];
  selectedLayers: Layer[];
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  snapEnabled: boolean;
  snapToGuides: boolean;
  outlineMode: boolean;
  showToolbar: boolean;
  showLayers: boolean;
  showInspector: boolean;
  canvasRef: RefObject<PaperCanvasHandle | null>;
  requestNewProject: () => void;
  requestOpenProject: () => void;
  handleSaveProject: () => Promise<void> | void;
  handlePlaceImage: () => Promise<void> | void;
  handleImportSvg: () => Promise<void> | void;
  handleQuickExportPng: () => void;
  openRasterExport: (format: 'png' | 'jpg', scope?: 'artboard' | 'selection') => void;
  handleExportDocument: (format: ExportKind) => void;
  handleExportSelectionSvg: (ids?: string[]) => void;
  handleExportSelectionRaster: (ids?: string[]) => void;
  handleAddArtboard: () => void;
  setShowInspector: Dispatch<SetStateAction<boolean>>;
  handleCopySvg: (ids?: string[]) => void;
  handleGroupLayers: (ids: string[]) => void;
  handleUngroupLayers: (ids: string[]) => void;
  handleToggleLock: () => void;
  handleUploadFont: () => Promise<void> | void;
  openSettingsTab: (tab?: SettingsTabId | null) => void;
  openTutorial: () => void;
  handleOffsetLayers: (ids: string[], distance: number, copyBehind: boolean) => void;
  handleOutlineStroke: (ids: string[]) => void;
  handleExpandAppearance: (ids: string[]) => void;
  handleTraceImage: (layerId: string, options?: Partial<ImageTraceOptions>) => void;
  handleConvertToOutlines: (ids: string[]) => Promise<void> | void;
  handleAttachTextToPath: (textLayerId: string, pathLayerId: string) => void;
  handleCreateTextOnPathFromShape: (pathLayerId: string) => void;
  handleDetachTextFromPath: (textLayerId: string) => void;
  handleCreateCircleText: () => void;
  handleSplitText: (ids: string[], mode: TextSplitMode) => void;
  handleOpenEffect: (target: EffectTarget) => void;
  handleFitArtboard: () => void;
  handleToggleGrid: () => void;
  handleToggleRulers: () => void;
  handleToggleGuides: () => void;
  handleToggleSnap: () => void;
  handleToggleSnapToGuides: () => void;
  handleClearGuides: () => void;
  setOutlineMode: Dispatch<SetStateAction<boolean>>;
  setShowToolbar: Dispatch<SetStateAction<boolean>>;
  setShowLayers: Dispatch<SetStateAction<boolean>>;
  openCommandBar: () => void;
  handleRunPreflight: () => void;
  showNotice: (message: string) => void;
}

export function useMenuModel({
  sceneGuides,
  selectedLayers,
  canUndo,
  canRedo,
  showGrid,
  showRulers,
  showGuides,
  snapEnabled,
  snapToGuides,
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
}: UseMenuModelOptions) {
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
      showGrid,
      showRulers,
      showGuides,
      snapEnabled,
      snapToGuides,
      hasGuides: Boolean(sceneGuides && sceneGuides.length > 0),
      outlineMode,
      showToolbar,
      showLayers,
      showInspector,
    };
  }, [
    canRedo,
    canUndo,
    outlineMode,
    sceneGuides,
    selectedLayers,
    showGrid,
    showGuides,
    showInspector,
    showLayers,
    showRulers,
    showToolbar,
    snapEnabled,
    snapToGuides,
  ]);

  const menuActions: MenuBarActions = useMemo(
    () => ({
      onNewDocument: requestNewProject,
      onOpenDocument: requestOpenProject,
      onSaveDocument: () => void handleSaveProject(),
      onImportImage: () => void handlePlaceImage(),
      onImportSvg: () => void handleImportSvg(),
      onQuickExportPng: handleQuickExportPng,
      onOpenRasterExport: (fmt = 'png') => openRasterExport(fmt, 'artboard'),
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
      canvasRef,
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
      handleImportSvg,
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
      openRasterExport,
      openSettingsTab,
      openTutorial,
      requestNewProject,
      requestOpenProject,
      setOutlineMode,
      setShowInspector,
      setShowLayers,
      setShowToolbar,
      showNotice,
    ]
  );

  return { menuState, menuActions };
}
