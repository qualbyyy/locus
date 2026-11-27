import { useCallback, useEffect, useRef } from 'react';
import paper from 'paper/dist/paper-core';
import { getSceneArtboards } from '../../core/artboards';
import { subscribeAssets } from '../../core/assets';
import { subscribeFonts } from '../../core/fonts';
import { findLayerById } from '../../core/layerTree';
import { useSettingsStore } from '../../core/settings';
import type { Scene, SelectedNodeRef, ToolType } from '../../core/types';
import { renderOverlay } from '../overlay';
import { syncSceneToPaper } from '../sync';
import type { OverlayExtras } from '../tools/types';
import type { EditingTextState } from './InlineTextEditor';

export interface PaperRig {
  scope: paper.PaperScope;
  artboardLayer: paper.Layer;
  sceneLayer: paper.Layer;
  overlayLayer: paper.Layer;
  artboardRects: paper.Path.Rectangle[];
  artboardLabels: paper.PointText[];
  itemMap: Map<string, paper.Item>;
}

interface UsePaperRigParams {
  scene: Scene;
  selectedIds: string[];
  selectedNode: SelectedNodeRef | null;
  activeTool: ToolType;
  activeGradientTarget: 'fill' | 'stroke';
  editingGroupId: string | null;
  activeArtboardId: string;
  outlineMode: boolean;
  isSpacePanning: boolean;
  editingText: EditingTextState | null;
  editingTextRef: React.MutableRefObject<EditingTextState | null>;
  onZoomChange: (zoomPercent: number) => void;
  onColorSampled?: (hex: string, target: 'fill' | 'stroke') => void;
  onOpenContextMenu?: (payload: {
    x: number;
    y: number;
    layerId: string | null;
  }) => void;
  onBeforeDestroyRef: React.MutableRefObject<((rig: PaperRig) => void) | null>;
}

export function usePaperRig({
  scene,
  selectedIds,
  selectedNode,
  activeTool,
  activeGradientTarget,
  editingGroupId,
  activeArtboardId,
  outlineMode,
  isSpacePanning,
  editingText,
  editingTextRef,
  onZoomChange,
  onColorSampled,
  onOpenContextMenu,
  onBeforeDestroyRef,
}: UsePaperRigParams) {
  const showGrid = useSettingsStore((s) => s.settings.showGrid);
  const gridSize = useSettingsStore((s) => s.settings.gridSize);
  const gridOpacity = useSettingsStore((s) => s.settings.gridOpacity);
  const showGuides = useSettingsStore((s) => s.settings.showGuides);
  const accentColor = useSettingsStore((s) => s.settings.accentColor);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rigRef = useRef<PaperRig | null>(null);

  const sceneRef = useRef(scene);
  const selectedIdsRef = useRef(selectedIds);
  const selectedNodeRef = useRef(selectedNode);
  const activeToolRef = useRef(activeTool);
  const activeGradientTargetRef = useRef(activeGradientTarget);
  const editingGroupIdRef = useRef(editingGroupId);
  const activeArtboardIdRef = useRef(activeArtboardId);
  const outlineModeRef = useRef(outlineMode);
  const isSpacePanningRef = useRef(isSpacePanning);
  const onZoomChangeRef = useRef(onZoomChange);
  const onColorSampledRef = useRef(onColorSampled);
  const onOpenContextMenuRef = useRef(onOpenContextMenu);
  const overlayExtrasRef = useRef<OverlayExtras>({});

  sceneRef.current = scene;
  selectedIdsRef.current = selectedIds;
  selectedNodeRef.current = selectedNode;
  activeToolRef.current = activeTool;
  activeGradientTargetRef.current = activeGradientTarget;
  editingGroupIdRef.current = editingGroupId;
  activeArtboardIdRef.current = activeArtboardId;
  outlineModeRef.current = outlineMode;
  isSpacePanningRef.current = isSpacePanning;
  onZoomChangeRef.current = onZoomChange;
  onColorSampledRef.current = onColorSampled;
  onOpenContextMenuRef.current = onOpenContextMenu;

  const redrawOverlayFromRefs = useCallback(
    (rig: PaperRig, extras?: OverlayExtras) => {
      if (extras) {
        overlayExtrasRef.current = {
          ...overlayExtrasRef.current,
          ...extras,
        };
      }

      const settings = useSettingsStore.getState().settings;
      renderOverlay(rig.scope, rig.overlayLayer, {
        scene: sceneRef.current,
        selectedIds: selectedIdsRef.current,
        selectedNode: selectedNodeRef.current,
        editingGroupId: editingGroupIdRef.current,
        activeArtboardId: activeArtboardIdRef.current,
        activeTool: activeToolRef.current,
        activeGradientTarget: activeGradientTargetRef.current,
        draftOverrides: overlayExtrasRef.current.draftOverrides,
        marquee: overlayExtrasRef.current.marquee,
        penDraft: overlayExtrasRef.current.penDraft,
        shapeDraft: overlayExtrasRef.current.shapeDraft,
        shapeBuilder: overlayExtrasRef.current.shapeBuilder,
        freehandDraft: overlayExtrasRef.current.freehandDraft,
        hoveredMaskId: overlayExtrasRef.current.hoveredMaskId,
        hoveredTextPathId: overlayExtrasRef.current.hoveredTextPathId,
        editingTextCaret: overlayExtrasRef.current.editingTextCaret,
        accentColor: settings.accentColor,
        grid: {
          show: settings.showGrid,
          size: settings.gridSize,
          opacity: settings.gridOpacity,
        },
        guides: overlayExtrasRef.current.guides,
        showGuides: settings.showGuides,
        draggingGuide: overlayExtrasRef.current.draggingGuide,
      });
    },
    []
  );

  const updateArtboardBorderWidth = useCallback((rig: PaperRig) => {
    const zoom = Math.max(0.05, rig.scope.view.zoom);
    for (const rect of rig.artboardRects) {
      rect.strokeWidth = (rect.data?.isActiveArtboard ? 1.5 : 1) / zoom;
    }
    for (const label of rig.artboardLabels) {
      label.fontSize = 11 / zoom;
      if (typeof label.data?.artboardY === 'number') {
        label.point = new rig.scope.Point(
          label.point.x,
          label.data.artboardY - 6 / zoom
        );
      }
    }
  }, []);

  const drawArtboard = useCallback(
    (rig: PaperRig, targetScene: Scene, activeAbId: string) => {
      const { scope, artboardLayer, sceneLayer } = rig;
      scope.activate();
      artboardLayer.activate();
      artboardLayer.removeChildren();

      const zoom = Math.max(0.05, scope.view.zoom);
      const accentHex = useSettingsStore.getState().settings.accentColor || '#da7756';
      const artboards = getSceneArtboards(targetScene);
      const rects: paper.Path.Rectangle[] = [];
      const labels: paper.PointText[] = [];

      for (const ab of artboards) {
        const isActive = ab.id === activeAbId;
        const highlightActive = artboards.length > 1 && isActive;
        const rect = new scope.Path.Rectangle(
          new scope.Rectangle(ab.x, ab.y, ab.width, ab.height)
        );
        rect.applyMatrix = false;
        rect.fillColor = new scope.Color(ab.background || '#ffffff');
        rect.strokeColor = new scope.Color(highlightActive ? accentHex : '#c8c0b2');
        rect.strokeWidth = (highlightActive ? 1.5 : 1) / zoom;
        rect.data = { isActiveArtboard: highlightActive };
        rect.locked = true;
        rects.push(rect);

        if (artboards.length > 1) {
          const label = new scope.PointText({
            point: new scope.Point(ab.x, ab.y - 6 / zoom),
            content: `${ab.name} · ${ab.width}×${ab.height}`,
            fontFamily: 'Inter',
            fontWeight: isActive ? 'bold' : 'normal',
            fontSize: 11 / zoom,
            fillColor: new scope.Color(isActive ? accentHex : '#7b746a'),
            applyMatrix: false,
          });
          label.data = { artboardY: ab.y };
          label.locked = true;
          labels.push(label);
        }
      }

      rig.artboardRects = rects;
      rig.artboardLabels = labels;

      sceneLayer.activate();
      scope.view.update();
    },
    []
  );

  // Эффект монтирования PaperScope — держит стабильные зависимости, чтобы холст не пересоздавался
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scope = new paper.PaperScope();
    scope.settings.applyMatrix = false;
    scope.setup(canvas);
    scope.project.clear();

    const artboardLayer = new scope.Layer({ name: 'artboardLayer' });
    artboardLayer.applyMatrix = false;
    const sceneLayer = new scope.Layer({ name: 'sceneLayer' });
    sceneLayer.applyMatrix = false;
    const overlayLayer = new scope.Layer({ name: 'overlayLayer' });
    overlayLayer.applyMatrix = false;

    sceneLayer.activate();

    const rig: PaperRig = {
      scope,
      artboardLayer,
      sceneLayer,
      overlayLayer,
      artboardRects: [],
      artboardLabels: [],
      itemMap: new Map(),
    };
    rigRef.current = rig;
    drawArtboard(rig, sceneRef.current, activeArtboardIdRef.current);
    rig.itemMap = syncSceneToPaper(scope, sceneLayer, sceneRef.current, {
      editingTextLayerId: editingTextRef.current?.layerId ?? null,
      outlineMode: outlineModeRef.current,
      editingGroupId: editingGroupIdRef.current,
    });
    redrawOverlayFromRefs(rig);
    scope.view.update();

    return () => {
      onBeforeDestroyRef.current?.(rig);
      rigRef.current = null;
      scope.project?.remove();
      scope.remove();
    };
  }, [
    drawArtboard,
    editingTextRef,
    onBeforeDestroyRef,
    redrawOverlayFromRefs,
  ]);

  useEffect(() => {
    const resync = () => {
      const rig = rigRef.current;
      if (!rig) return;
      rig.itemMap = syncSceneToPaper(rig.scope, rig.sceneLayer, sceneRef.current, {
        editingTextLayerId: editingTextRef.current?.layerId ?? null,
        editingTextDraft: editingTextRef.current
          ? {
              layerId: editingTextRef.current.layerId,
              content: editingTextRef.current.draft,
            }
          : null,
        outlineMode: outlineModeRef.current,
        editingGroupId: editingGroupIdRef.current,
      });
      redrawOverlayFromRefs(rig);
      rig.scope.view.update();
    };
    const unsubAssets = subscribeAssets(resync);
    const unsubFonts = subscribeFonts(resync);
    return () => {
      unsubAssets();
      unsubFonts();
    };
  }, [editingTextRef, redrawOverlayFromRefs]);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    drawArtboard(rig, scene, activeArtboardIdRef.current);
    const curEdit = editingTextRef.current;
    overlayExtrasRef.current.editingTextCaret = curEdit
      ? {
          layerId: curEdit.layerId,
          content: curEdit.draft,
          caretIndex: curEdit.caretIndex,
        }
      : null;
    rig.itemMap = syncSceneToPaper(rig.scope, rig.sceneLayer, scene, {
      editingTextLayerId: curEdit?.layerId ?? null,
      editingTextDraft: curEdit
        ? { layerId: curEdit.layerId, content: curEdit.draft }
        : null,
      outlineMode,
      editingGroupId,
    });
    overlayExtrasRef.current.draftOverrides = undefined;
    redrawOverlayFromRefs(rig);
    rig.scope.view.update();
  }, [
    drawArtboard,
    editingGroupId,
    editingText?.layerId,
    editingTextRef,
    outlineMode,
    redrawOverlayFromRefs,
    scene,
  ]);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || !editingText) return;
    overlayExtrasRef.current.editingTextCaret = {
      layerId: editingText.layerId,
      content: editingText.draft,
      caretIndex: editingText.caretIndex,
    };
    const editedLayer = findLayerById(sceneRef.current.layers, editingText.layerId);
    if (editedLayer?.type === 'text' && editedLayer.pathId && rig.itemMap.get(editedLayer.id)) {
      // Для текста по кривой перерисовываем всю сцену только при наличии такого слоя (обычный текст рисуется DOM-полем)
      rig.itemMap = syncSceneToPaper(rig.scope, rig.sceneLayer, sceneRef.current, {
        editingTextLayerId: editingText.layerId,
        editingTextDraft: { layerId: editingText.layerId, content: editingText.draft },
        outlineMode: outlineModeRef.current,
        editingGroupId: editingGroupIdRef.current,
      });
    }
    redrawOverlayFromRefs(rig);
    rig.scope.view.update();
  }, [editingText?.caretIndex, editingText?.draft, editingText?.layerId, redrawOverlayFromRefs]);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    drawArtboard(rig, sceneRef.current, activeArtboardId);
    redrawOverlayFromRefs(rig);
    rig.scope.view.update();
  }, [accentColor, activeArtboardId, drawArtboard, redrawOverlayFromRefs]);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    redrawOverlayFromRefs(rig);
    rig.scope.view.update();
  }, [
    accentColor,
    activeGradientTarget,
    gridOpacity,
    gridSize,
    redrawOverlayFromRefs,
    showGrid,
    showGuides,
  ]);

  const handlePreviewGuide = useCallback(
    (preview: { orientation: 'horizontal' | 'vertical'; position: number } | null) => {
      const rig = rigRef.current;
      if (!rig) return;
      redrawOverlayFromRefs(rig, { draggingGuide: preview });
      rig.scope.view.update();
    },
    [redrawOverlayFromRefs]
  );

  return {
    containerRef,
    canvasRef,
    rigRef,
    overlayExtrasRef,
    sceneRef,
    selectedIdsRef,
    selectedNodeRef,
    activeToolRef,
    editingGroupIdRef,
    activeArtboardIdRef,
    outlineModeRef,
    isSpacePanningRef,
    onZoomChangeRef,
    onColorSampledRef,
    onOpenContextMenuRef,
    redrawOverlayFromRefs,
    updateArtboardBorderWidth,
    handlePreviewGuide,
  };
}
