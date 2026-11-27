import { applyMatrixToPoint, decomposeMatrix } from '../../core/math';
import { hexToRgb } from '../../core/themes';
import type { Layer, PathLayer, Point2D, Scene } from '../../core/types';
import { resolveLayerLocalBBox, resolveLayerWorldBBox } from '../geometryBounds';
import { buildPaperPathFromSubPaths } from '../sync';
import { renderGradientOverlay, resolveEditableGradient } from './gradientOverlay';
import {
  type MarqueeOverlay,
  type SelectHandleId,
  WHITE_HEX,
  applyDraftLayer,
  applyPaperMatrix,
  drawHandleSquare,
  getDraftMatrices,
} from './shared';
import { renderTextPathAnchors } from './textPathOverlay';

export function renderClipMaskOutlines(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  scene: Scene,
  allLayers: Layer[],
  layersById: Map<string, Layer>,
  selectedSet: Set<string>,
  hoveredMaskId: string | null | undefined,
  draftOverrides: Map<string, Partial<Layer>> | undefined,
  zoom: number,
  accentHex: string
): void {
  const activeMaskIds = new Set<string>();
  for (const layer of allLayers) {
    if (layer.type === 'path' && layer.isClipMask) {
      activeMaskIds.add(layer.id);
    }
    if (layer.clipMaskId && layersById.get(layer.clipMaskId)?.type === 'path') {
      activeMaskIds.add(layer.clipMaskId);
    }
  }

  for (const maskId of activeMaskIds) {
    if (!selectedSet.has(maskId) && hoveredMaskId !== maskId) {
      continue;
    }
    const rawMask = layersById.get(maskId);
    if (!rawMask || rawMask.type !== 'path') continue;
    const mask = applyDraftLayer(rawMask, draftOverrides) as PathLayer;
    const { worldM } = getDraftMatrices(scene, mask.id, draftOverrides);
    const outline = buildPaperPathFromSubPaths(scope, mask.subpaths, mask.fillRule);
    applyPaperMatrix(scope, outline, worldM);
    outline.fillColor = null;
    outline.strokeColor = new scope.Color(accentHex);
    outline.strokeWidth = 1 / zoom;
    if (!selectedSet.has(maskId)) {
      outline.dashArray = [4 / zoom, 3 / zoom];
    }
    overlayLayer.addChild(outline);
  }
}

export function renderSelectOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  scene: Scene,
  selectedLayers: Layer[],
  draftOverrides: Map<string, Partial<Layer>> | undefined,
  zoom: number,
  accentHex: string,
  activeGradientTarget: 'fill' | 'stroke' = 'fill'
): void {
  if (selectedLayers.length === 0) return;

  const strokeW = 1 / zoom;
  const handleSize = 6.5 / zoom;
  const rotateOffset = 22 / zoom;
  const hasUnlocked = selectedLayers.some((l) => !l.locked);

  if (selectedLayers.length === 1) {
    const layer = selectedLayers[0];
    const { worldM } = getDraftMatrices(scene, layer.id, draftOverrides);
    const box = resolveLayerLocalBBox(layer, scene.layers, { effectivePath: true });
    const tl = applyMatrixToPoint(worldM, { x: box.x, y: box.y });
    const tr = applyMatrixToPoint(worldM, { x: box.x + box.width, y: box.y });
    const br = applyMatrixToPoint(worldM, {
      x: box.x + box.width,
      y: box.y + box.height,
    });
    const bl = applyMatrixToPoint(worldM, { x: box.x, y: box.y + box.height });
    const rotDeg = decomposeMatrix(worldM).rotation;

    const outline = new scope.Path({
      segments: [tl, tr, br, bl].map((p) => new scope.Point(p.x, p.y)),
      closed: true,
      applyMatrix: false,
    });
    outline.strokeColor = new scope.Color(accentHex);
    outline.strokeWidth = strokeW;
    overlayLayer.addChild(outline);

    if (layer.locked) return;

    const isPathText = layer.type === 'text' && Boolean(layer.pathId);
    if (!isPathText) {
      const tm = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
      const rm = { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 };
      const bm = { x: (br.x + bl.x) / 2, y: (br.y + bl.y) / 2 };
      const lm = { x: (bl.x + tl.x) / 2, y: (bl.y + tl.y) / 2 };
      const center = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };

      let upX = tm.x - center.x;
      let upY = tm.y - center.y;
      const upLen = Math.hypot(upX, upY);
      if (upLen > 1e-6) {
        upX /= upLen;
        upY /= upLen;
      } else {
        const rad = (rotDeg * Math.PI) / 180;
        upX = Math.sin(rad);
        upY = -Math.cos(rad);
      }

      const rotPt = {
        x: tm.x + upX * rotateOffset,
        y: tm.y + upY * rotateOffset,
      };

      const stem = new scope.Path.Line(
        new scope.Point(tm.x, tm.y),
        new scope.Point(rotPt.x, rotPt.y)
      );
      stem.strokeColor = new scope.Color(accentHex);
      stem.strokeWidth = strokeW;
      overlayLayer.addChild(stem);

      const rotHandle = new scope.Path.Circle(
        new scope.Point(rotPt.x, rotPt.y),
        4 / zoom
      );
      rotHandle.fillColor = new scope.Color(WHITE_HEX);
      rotHandle.strokeColor = new scope.Color(accentHex);
      rotHandle.strokeWidth = strokeW;
      rotHandle.data = { selectHandle: 'rotate' satisfies SelectHandleId };
      overlayLayer.addChild(rotHandle);

      const handles: Array<{ id: SelectHandleId; pt: Point2D }> = [
        { id: 'nw', pt: tl },
        { id: 'n', pt: tm },
        { id: 'ne', pt: tr },
        { id: 'e', pt: rm },
        { id: 'se', pt: br },
        { id: 's', pt: bm },
        { id: 'sw', pt: bl },
        { id: 'w', pt: lm },
      ];

      for (const h of handles) {
        drawHandleSquare(
          scope,
          overlayLayer,
          h.pt,
          handleSize,
          rotDeg,
          strokeW,
          WHITE_HEX,
          accentHex,
          { selectHandle: h.id }
        );
      }
    }

    const activeGrad = resolveEditableGradient(layer, activeGradientTarget);
    if (activeGrad) {
      renderGradientOverlay(
        scope,
        overlayLayer,
        layer,
        scene.layers,
        worldM,
        activeGrad.target,
        activeGrad.gradient,
        zoom,
        accentHex
      );
    }

    if (layer.type === 'text' && layer.pathId) {
      renderTextPathAnchors(
        scope,
        overlayLayer,
        scene,
        layer,
        worldM,
        draftOverrides,
        zoom,
        accentHex
      );
    }
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of selectedLayers) {
    const { parentM } = getDraftMatrices(scene, layer.id, draftOverrides);
    const b = resolveLayerWorldBBox(layer, parentM, scene.layers);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  const bbox =
    minX === Infinity
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const tl = { x: bbox.x, y: bbox.y };
  const tr = { x: bbox.x + bbox.width, y: bbox.y };
  const br = { x: bbox.x + bbox.width, y: bbox.y + bbox.height };
  const bl = { x: bbox.x, y: bbox.y + bbox.height };
  const tm = { x: bbox.x + bbox.width / 2, y: bbox.y };
  const rm = { x: bbox.x + bbox.width, y: bbox.y + bbox.height / 2 };
  const bm = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height };
  const lm = { x: bbox.x, y: bbox.y + bbox.height / 2 };

  const rect = new scope.Path.Rectangle(
    new scope.Rectangle(bbox.x, bbox.y, bbox.width, bbox.height)
  );
  rect.strokeColor = new scope.Color(accentHex);
  rect.strokeWidth = strokeW;
  overlayLayer.addChild(rect);

  if (!hasUnlocked) return;

  const rotPt = { x: tm.x, y: tm.y - rotateOffset };
  const stem = new scope.Path.Line(
    new scope.Point(tm.x, tm.y),
    new scope.Point(rotPt.x, rotPt.y)
  );
  stem.strokeColor = new scope.Color(accentHex);
  stem.strokeWidth = strokeW;
  overlayLayer.addChild(stem);

  const rotHandle = new scope.Path.Circle(
    new scope.Point(rotPt.x, rotPt.y),
    4 / zoom
  );
  rotHandle.fillColor = new scope.Color(WHITE_HEX);
  rotHandle.strokeColor = new scope.Color(accentHex);
  rotHandle.strokeWidth = strokeW;
  rotHandle.data = { selectHandle: 'rotate' satisfies SelectHandleId };
  overlayLayer.addChild(rotHandle);

  const handles: Array<{ id: SelectHandleId; pt: Point2D }> = [
    { id: 'nw', pt: tl },
    { id: 'n', pt: tm },
    { id: 'ne', pt: tr },
    { id: 'e', pt: rm },
    { id: 'se', pt: br },
    { id: 's', pt: bm },
    { id: 'sw', pt: bl },
    { id: 'w', pt: lm },
  ];

  for (const h of handles) {
    drawHandleSquare(
      scope,
      overlayLayer,
      h.pt,
      handleSize,
      0,
      strokeW,
      WHITE_HEX,
      accentHex,
      { selectHandle: h.id }
    );
  }
}

export function renderMarqueeOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  marquee: MarqueeOverlay,
  zoom: number,
  accentHex: string
): void {
  const { x, y, width, height } = marquee;
  const marqueeRect = new scope.Path.Rectangle(
    new scope.Rectangle(x, y, width, height)
  );
  marqueeRect.strokeColor = new scope.Color(accentHex);
  marqueeRect.strokeWidth = 1 / zoom;
  const rgb = hexToRgb(accentHex) ?? { r: 218, g: 119, b: 86 };
  marqueeRect.fillColor = new scope.Color(
    rgb.r / 255,
    rgb.g / 255,
    rgb.b / 255,
    0.08
  );
  overlayLayer.addChild(marqueeRect);
}
