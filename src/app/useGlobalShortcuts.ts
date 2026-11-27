import {
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  copyLayerStyle,
  copySelectedLayers,
  pasteLayers,
  pasteLayerStyle,
} from '../core/clipboard';
import {
  deleteAnchor,
  deleteLayers,
  duplicateLayers,
  nudgeLayers,
  redoCommand,
  reorderLayer,
  selectAllLayers,
  undoCommand,
} from '../core/commands';
import { getParentGroupId } from '../core/layerTree';
import { useSettingsStore } from '../core/settings';
import { matchShortcut } from '../core/shortcuts';
import { useEditorStore } from '../core/store';
import type { SelectedNodeRef, ToolType } from '../core/types';
import type { PaperCanvasHandle } from '../engine/PaperCanvas';
import { useTutorialStore } from '../tutorial/store';
import type { EffectTarget } from '../ui/inspector/EffectControls';

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

export interface UseGlobalShortcutsOptions {
  canvasRef: RefObject<PaperCanvasHandle | null>;
  isStartModalOpen: boolean;
  isSettingsModalOpen: boolean;
  isAcademyOpen: boolean;
  isCommandBarOpen: boolean;
  rasterExportOpen: boolean;
  isUnsavedOpen: boolean;
  effectModalTarget: EffectTarget | null;
  setActiveTool: (tool: ToolType) => void;
  setSelectedIds: (ids: string[]) => void;
  setSelectedNode: (node: SelectedNodeRef | null) => void;
  setEditingGroupId: (id: string | null) => void;
  setOutlineMode: Dispatch<SetStateAction<boolean>>;
  setNotice: (message: string | null) => void;
  openTutorial: () => void;
  toggleSettingsModal: () => void;
  openCommandBar: () => void;
  openRasterExport: (format: 'png' | 'jpg', scope?: 'artboard' | 'selection') => void;
  requestNewProject: () => void;
  requestOpenProject: () => void;
  handleSaveProject: () => Promise<void> | void;
  handlePlaceImage: () => Promise<void> | void;
  handleCopySvg: (ids?: string[]) => void;
  handleToggleRulers: () => void;
  handleToggleGrid: () => void;
  handleToggleSnap: () => void;
  handleConvertToOutlines: (ids: string[]) => Promise<void> | void;
  handleCombineCompound: (ids: string[]) => void;
  handleSplitCompound: (ids: string[]) => void;
  handleGroupLayers: (ids: string[]) => void;
  handleUngroupLayers: (ids: string[]) => void;
  handleToggleLock: () => void;
  showNotice: (message: string) => void;
}

export function useGlobalShortcuts({
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
}: UseGlobalShortcutsOptions) {
  const [isSpacePanning, setIsSpacePanning] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isBlockingModal = isUnsavedOpen || effectModalTarget !== null;
      if (isBlockingModal) {
        return;
      }

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
        toggleSettingsModal();
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
          openRasterExport('png', 'artboard');
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
          case 'view.toggleOutline':
            setOutlineMode((prev) => !prev);
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
    canvasRef,
    effectModalTarget,
    handleCombineCompound,
    handleConvertToOutlines,
    handleCopySvg,
    handleGroupLayers,
    handlePlaceImage,
    handleSaveProject,
    handleSplitCompound,
    handleToggleGrid,
    handleToggleLock,
    handleToggleRulers,
    handleToggleSnap,
    handleUngroupLayers,
    isAcademyOpen,
    isCommandBarOpen,
    isSettingsModalOpen,
    isStartModalOpen,
    isUnsavedOpen,
    openCommandBar,
    openRasterExport,
    openTutorial,
    rasterExportOpen,
    requestNewProject,
    requestOpenProject,
    setActiveTool,
    setEditingGroupId,
    setNotice,
    setOutlineMode,
    setSelectedIds,
    setSelectedNode,
    showNotice,
    toggleSettingsModal,
  ]);

  return { isSpacePanning };
}
