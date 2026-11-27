import { useCallback, useEffect, useState } from 'react';
import { getActiveArtboard } from '../../core/artboards';
import { findLayerById, getParentWorldMatrix } from '../../core/layerTree';
import { useSettingsStore } from '../../core/settings';
import type { Point2D, Scene } from '../../core/types';
import { resolveLayerWorldBBox } from '../geometryBounds';
import { getWheelZoomFactor } from '../zoom';
import type { PaperRig } from './usePaperRig';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface UseCanvasViewportParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  rigRef: React.MutableRefObject<PaperRig | null>;
  sceneRef: React.MutableRefObject<Scene>;
  selectedIdsRef: React.MutableRefObject<string[]>;
  activeArtboardIdRef: React.MutableRefObject<string>;
  onZoomChangeRef: React.MutableRefObject<(zoomPercent: number) => void>;
  redrawOverlayFromRefs: (rig: PaperRig) => void;
  updateArtboardBorderWidth: (rig: PaperRig) => void;
}

export function useCanvasViewport({
  containerRef,
  canvasRef,
  rigRef,
  sceneRef,
  selectedIdsRef,
  activeArtboardIdRef,
  onZoomChangeRef,
  redrawOverlayFromRefs,
  updateArtboardBorderWidth,
}: UseCanvasViewportParams) {
  const [viewTick, setViewTick] = useState(0);

  const fitBoxInView = useCallback(
    (
      rig: PaperRig,
      box: { x: number; y: number; width: number; height: number }
    ) => {
      const { scope } = rig;
      const vw = scope.view.viewSize.width;
      const vh = scope.view.viewSize.height;
      if (vw <= 0 || vh <= 0) return;

      const padding = 48;
      const availW = Math.max(40, vw - padding * 2);
      const availH = Math.max(40, vh - padding * 2);
      const zoom = clamp(
        Math.min(
          availW / Math.max(1, box.width),
          availH / Math.max(1, box.height)
        ),
        MIN_ZOOM,
        4
      );

      scope.view.zoom = zoom;
      scope.view.center = new scope.Point(
        box.x + box.width / 2,
        box.y + box.height / 2
      );
      updateArtboardBorderWidth(rig);
      redrawOverlayFromRefs(rig);
      scope.view.update();
      onZoomChangeRef.current(Math.round(zoom * 100));
      setViewTick((t) => t + 1);
    },
    [onZoomChangeRef, redrawOverlayFromRefs, updateArtboardBorderWidth]
  );

  const focusArtboard = useCallback(
    (artboardId: string) => {
      const rig = rigRef.current;
      if (!rig) return;
      const ab = getActiveArtboard(sceneRef.current, artboardId);
      fitBoxInView(rig, ab);
    },
    [fitBoxInView, rigRef, sceneRef]
  );

  const fitArtboard = useCallback(() => {
    focusArtboard(activeArtboardIdRef.current);
  }, [activeArtboardIdRef, focusArtboard]);

  const zoomToSelection = useCallback(() => {
    const rig = rigRef.current;
    if (!rig) return;
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    const layers = sceneRef.current.layers;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const id of ids) {
      const layer = findLayerById(layers, id);
      if (!layer) continue;
      const parentM = getParentWorldMatrix(layers, layer.id);
      const box = resolveLayerWorldBBox(layer, parentM, layers);
      if (box.x < minX) minX = box.x;
      if (box.y < minY) minY = box.y;
      if (box.x + box.width > maxX) maxX = box.x + box.width;
      if (box.y + box.height > maxY) maxY = box.y + box.height;
    }

    if (minX === Infinity) return;
    fitBoxInView(rig, {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    });
  }, [fitBoxInView, rigRef, sceneRef, selectedIdsRef]);

  const resetZoom100 = useCallback(() => {
    const rig = rigRef.current;
    if (!rig) return;

    const { scope } = rig;
    const ab = getActiveArtboard(sceneRef.current, activeArtboardIdRef.current);
    scope.view.zoom = 1;
    scope.view.center = new scope.Point(
      ab.x + ab.width / 2,
      ab.y + ab.height / 2
    );
    updateArtboardBorderWidth(rig);
    redrawOverlayFromRefs(rig);
    scope.view.update();
    onZoomChangeRef.current(100);
    setViewTick((t) => t + 1);
  }, [
    activeArtboardIdRef,
    onZoomChangeRef,
    redrawOverlayFromRefs,
    rigRef,
    sceneRef,
    updateArtboardBorderWidth,
  ]);

  const stepZoom = useCallback(
    (factor: number) => {
      const rig = rigRef.current;
      if (!rig) return;
      const { scope } = rig;
      const nextZoom = clamp(scope.view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      scope.view.zoom = nextZoom;
      updateArtboardBorderWidth(rig);
      redrawOverlayFromRefs(rig);
      scope.view.update();
      onZoomChangeRef.current(Math.round(nextZoom * 100));
      setViewTick((t) => t + 1);
    },
    [onZoomChangeRef, redrawOverlayFromRefs, rigRef, updateArtboardBorderWidth]
  );

  const zoomIn = useCallback(() => stepZoom(1.25), [stepZoom]);
  const zoomOut = useCallback(() => stepZoom(1 / 1.25), [stepZoom]);

  const zoomAtViewPoint = useCallback(
    (clientX: number, clientY: number, deltaY: number) => {
      const rig = rigRef.current;
      const canvas = canvasRef.current;
      if (!rig || !canvas) return;
      const { scope } = rig;
      const rect = canvas.getBoundingClientRect();
      const viewPoint = new scope.Point(clientX - rect.left, clientY - rect.top);
      const before = scope.view.viewToProject(viewPoint);
      const wheelSpeed = useSettingsStore.getState().settings.wheelZoomSpeed;
      const nextZoom = clamp(
        scope.view.zoom * getWheelZoomFactor(deltaY, wheelSpeed),
        MIN_ZOOM,
        MAX_ZOOM
      );

      scope.view.zoom = nextZoom;
      const after = scope.view.viewToProject(viewPoint);
      scope.view.center = scope.view.center.add(before.subtract(after));
      updateArtboardBorderWidth(rig);
      redrawOverlayFromRefs(rig);
      scope.view.update();
      onZoomChangeRef.current(Math.round(nextZoom * 100));
      setViewTick((t) => t + 1);
    },
    [canvasRef, onZoomChangeRef, redrawOverlayFromRefs, rigRef, updateArtboardBorderWidth]
  );

  const panByViewDelta = useCallback(
    (dx: number, dy: number) => {
      const rig = rigRef.current;
      if (!rig) return;
      const { scope } = rig;
      scope.view.center = scope.view.center.subtract(
        new scope.Point(dx / scope.view.zoom, dy / scope.view.zoom)
      );
      redrawOverlayFromRefs(rig);
      scope.view.update();
      setViewTick((t) => t + 1);
    },
    [redrawOverlayFromRefs, rigRef]
  );

  useEffect(() => {
    const container = containerRef.current;
    const rig = rigRef.current;
    if (!container || !rig) return;

    let hasFitted = false;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;

      rig.scope.view.viewSize = new rig.scope.Size(width, height);
      if (!hasFitted) {
        hasFitted = true;
        fitArtboard();
      } else {
        redrawOverlayFromRefs(rig);
        rig.scope.view.update();
        setViewTick((t) => t + 1);
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [containerRef, fitArtboard, redrawOverlayFromRefs, rigRef]);

  const rulerViewToProject = useCallback(
    (vx: number, vy: number): Point2D | null => {
      const rig = rigRef.current;
      if (!rig) return null;
      const pt = rig.scope.view.viewToProject(new rig.scope.Point(vx, vy));
      return { x: pt.x, y: pt.y };
    },
    [rigRef]
  );

  const rulerProjectToView = useCallback(
    (px: number, py: number): Point2D | null => {
      const rig = rigRef.current;
      if (!rig) return null;
      const pt = rig.scope.view.projectToView(new rig.scope.Point(px, py));
      return { x: pt.x, y: pt.y };
    },
    [rigRef]
  );

  return {
    viewTick,
    fitArtboard,
    focusArtboard,
    zoomToSelection,
    resetZoom100,
    zoomIn,
    zoomOut,
    zoomAtViewPoint,
    panByViewDelta,
    rulerViewToProject,
    rulerProjectToView,
  };
}
