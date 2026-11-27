import { findLayerById, flattenLayers } from '../core/layerTree';
import type { Layer, PathLayer } from '../core/types';
import {
  renderGridOverlay,
  renderManualGuidesOverlay,
  renderSmartGuidesOverlay,
} from './overlay/gridAndGuidesOverlay';
import {
  renderClipMaskOutlines,
  renderMarqueeOverlay,
  renderSelectOverlay,
} from './overlay/selectionOverlay';
import {
  DEFAULT_ACCENT_HEX,
  type OverlayRenderState,
  applyDraftLayer,
  getDraftMatrices,
} from './overlay/shared';
import {
  renderEditingTextCaretOverlay,
  renderTextToolOverlay,
} from './overlay/textPathOverlay';
import {
  renderFreehandDraftOverlay,
  renderNodeOverlay,
  renderPenDraftOverlay,
  renderShapeBuilderOverlay,
  renderShapeDraftOverlay,
} from './overlay/toolDraftsOverlay';

export type {
  FreehandDraftOverlay,
  GradientHandleData,
  MarqueeOverlay,
  OverlayRenderState,
  PenDraftOverlay,
  SelectHandleId,
  ShapeBuilderOverlay,
  ShapeDraftOverlay,
  TextPathHandleId,
} from './overlay/shared';
export { resolveEditableGradient } from './overlay/gradientOverlay';

export function renderOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  state: OverlayRenderState
): void {
  const prevActiveLayer = scope.project?.activeLayer;
  scope.activate();
  overlayLayer.activate();
  overlayLayer.removeChildren();
  try {
    const zoom = Math.max(0.05, scope.view.zoom);
    const accentHex = state.accentColor || DEFAULT_ACCENT_HEX;

    if (state.grid) {
      renderGridOverlay(scope, overlayLayer, state.scene, state.grid, zoom);
    }
    renderManualGuidesOverlay(scope, overlayLayer, state, zoom);

    const allLayers = flattenLayers(state.scene.layers);
    const selectedSet = new Set(state.selectedIds);
    const selectedLayers = state.selectedIds
      .map((id) => findLayerById(state.scene.layers, id))
      .filter((l): l is Layer => l !== null)
      .map((l) => applyDraftLayer(l, state.draftOverrides));
    const layersById = new Map(allLayers.map((l) => [l.id, l]));

    renderClipMaskOutlines(
      scope,
      overlayLayer,
      state.scene,
      allLayers,
      layersById,
      selectedSet,
      state.hoveredMaskId,
      state.draftOverrides,
      zoom,
      accentHex
    );

    if (state.activeTool === 'select') {
      renderSelectOverlay(
        scope,
        overlayLayer,
        state.scene,
        selectedLayers,
        state.draftOverrides,
        zoom,
        accentHex,
        state.activeGradientTarget ?? 'fill'
      );
    } else if (state.activeTool === 'node') {
      const nodeTarget =
        (state.selectedNode
          ? selectedLayers.find(
              (l): l is PathLayer =>
                l.type === 'path' && l.id === state.selectedNode?.layerId
            )
          : undefined) ??
        selectedLayers.find((l): l is PathLayer => l.type === 'path');

      if (nodeTarget && !nodeTarget.locked) {
        const { worldM } = getDraftMatrices(
          state.scene,
          nodeTarget.id,
          state.draftOverrides
        );
        renderNodeOverlay(
          scope,
          overlayLayer,
          nodeTarget,
          worldM,
          state.selectedNode,
          zoom,
          accentHex
        );
      } else if (nodeTarget) {
        renderSelectOverlay(
          scope,
          overlayLayer,
          state.scene,
          [nodeTarget],
          state.draftOverrides,
          zoom,
          accentHex
        );
      }
    } else if (state.activeTool === 'pen' && state.penDraft) {
      renderPenDraftOverlay(scope, overlayLayer, state.penDraft, zoom, accentHex);
    } else if (state.activeTool === 'blob' && state.shapeDraft) {
      renderShapeDraftOverlay(scope, overlayLayer, state.shapeDraft, zoom, accentHex);
    } else if (state.activeTool === 'shapeBuilder' && state.shapeBuilder) {
      renderShapeBuilderOverlay(
        scope,
        overlayLayer,
        state.shapeBuilder,
        zoom,
        accentHex
      );
    } else if (state.activeTool === 'text') {
      renderTextToolOverlay(
        scope,
        overlayLayer,
        state,
        selectedLayers,
        layersById,
        zoom,
        accentHex
      );
    } else if (
      (state.activeTool === 'pencil' || state.activeTool === 'knife') &&
      state.freehandDraft &&
      state.freehandDraft.points.length >= 2
    ) {
      renderFreehandDraftOverlay(
        scope,
        overlayLayer,
        state.freehandDraft,
        zoom,
        accentHex
      );
    }

    renderEditingTextCaretOverlay(
      scope,
      overlayLayer,
      state,
      layersById,
      zoom,
      accentHex
    );

    if (state.guides && state.guides.length > 0) {
      renderSmartGuidesOverlay(scope, overlayLayer, state.guides, accentHex, zoom);
    }

    if (state.marquee) {
      renderMarqueeOverlay(scope, overlayLayer, state.marquee, zoom, accentHex);
    }
  } finally {
    if (prevActiveLayer && prevActiveLayer !== overlayLayer && prevActiveLayer.project) {
      prevActiveLayer.activate();
    }
  }
}
