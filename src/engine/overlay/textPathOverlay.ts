import { applyMatrixToPoint, type Matrix2D } from '../../core/math';
import type { Layer, Scene, TextLayer } from '../../core/types';
import { resolveEffectivePathGeometry } from '../effects';
import { buildPaperPathFromSubPaths } from '../sync';
import {
  computeTextOnPathCaretAndAnchors,
  resolveHostPathLayer,
} from '../textOnPath';
import {
  type OverlayRenderState,
  type TextPathHandleId,
  WHITE_HEX,
  applyPaperMatrix,
  drawHandleSquare,
  getDraftMatrices,
} from './shared';

export function renderTextPathAnchors(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  scene: Scene,
  layer: TextLayer,
  worldM: Matrix2D,
  draftOverrides: Map<string, Partial<Layer>> | undefined,
  zoom: number,
  accentHex: string
): void {
  if (!layer.pathId) return;
  const hostPath = resolveHostPathLayer(scene.layers, layer.pathId);
  if (!hostPath) return;

  const hostM = getDraftMatrices(scene, hostPath.id, draftOverrides).worldM;
  const hostItem = buildPaperPathFromSubPaths(
    scope,
    resolveEffectivePathGeometry(hostPath).subpaths,
    hostPath.fillRule
  );
  applyPaperMatrix(scope, hostItem, hostM);
  hostItem.fillColor = null;
  hostItem.strokeColor = new scope.Color(accentHex);
  hostItem.strokeWidth = 1 / zoom;
  hostItem.dashArray = [4 / zoom, 3 / zoom];
  overlayLayer.addChild(hostItem);

  const anchors = computeTextOnPathCaretAndAnchors(layer, hostPath, scene.layers);
  if (!anchors) return;

  const wCurve = applyMatrixToPoint(worldM, anchors.curvePt);
  const wNormal = applyMatrixToPoint(worldM, anchors.normalPt);

  const guide = new scope.Path.Line(
    new scope.Point(wCurve.x, wCurve.y),
    new scope.Point(wNormal.x, wNormal.y)
  );
  guide.strokeColor = new scope.Color(accentHex);
  guide.strokeWidth = 1 / zoom;
  guide.dashArray = [3 / zoom, 3 / zoom];
  overlayLayer.addChild(guide);

  // Ромбический маркер на базовой кривой: сдвиг текста вдоль пути
  drawHandleSquare(
    scope,
    overlayLayer,
    wCurve,
    9 / zoom,
    45,
    1.4 / zoom,
    WHITE_HEX,
    accentHex,
    { textPathHandle: 'offset' satisfies TextPathHandleId }
  );

  // Круглый маркер вдоль нормали: настройка отступа от базовой линии
  const offsetHandle = new scope.Path.Circle(
    new scope.Point(wNormal.x, wNormal.y),
    4.5 / zoom
  );
  offsetHandle.fillColor = new scope.Color(accentHex);
  offsetHandle.strokeColor = new scope.Color(WHITE_HEX);
  offsetHandle.strokeWidth = 1.4 / zoom;
  offsetHandle.data = { textPathHandle: 'baseline' satisfies TextPathHandleId };
  overlayLayer.addChild(offsetHandle);
}

export function renderTextToolOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  state: OverlayRenderState,
  selectedLayers: Layer[],
  layersById: Map<string, Layer>,
  zoom: number,
  accentHex: string
): void {
  if (
    !state.editingTextCaret &&
    selectedLayers.length === 1 &&
    selectedLayers[0].type === 'text' &&
    selectedLayers[0].pathId &&
    !selectedLayers[0].locked
  ) {
    const selText = selectedLayers[0];
    const { worldM } = getDraftMatrices(state.scene, selText.id, state.draftOverrides);
    renderTextPathAnchors(
      scope,
      overlayLayer,
      state.scene,
      selText,
      worldM,
      state.draftOverrides,
      zoom,
      accentHex
    );
  }
  if (state.hoveredTextPathId) {
    const hovered = layersById.get(state.hoveredTextPathId);
    if (hovered && hovered.type === 'path') {
      const { worldM } = getDraftMatrices(state.scene, hovered.id, state.draftOverrides);
      const outline = buildPaperPathFromSubPaths(
        scope,
        resolveEffectivePathGeometry(hovered).subpaths,
        hovered.fillRule
      );
      applyPaperMatrix(scope, outline, worldM);
      outline.fillColor = null;
      outline.strokeColor = new scope.Color(accentHex);
      outline.strokeWidth = 1.6 / zoom;
      outline.dashArray = [5 / zoom, 3 / zoom];
      overlayLayer.addChild(outline);
    }
  }
}

export function renderEditingTextCaretOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  state: OverlayRenderState,
  layersById: Map<string, Layer>,
  zoom: number,
  accentHex: string
): void {
  if (!state.editingTextCaret) return;
  const rawText = layersById.get(state.editingTextCaret.layerId);
  if (!rawText || rawText.type !== 'text' || !rawText.pathId) return;

  const hostPath = resolveHostPathLayer(state.scene.layers, rawText.pathId);
  if (!hostPath) return;

  const { worldM } = getDraftMatrices(state.scene, rawText.id, state.draftOverrides);
  const info = computeTextOnPathCaretAndAnchors(
    { ...rawText, content: state.editingTextCaret.content },
    hostPath,
    state.scene.layers,
    state.editingTextCaret.caretIndex
  );
  if (!info) return;

  if (state.activeTool !== 'select') {
    const hostM = getDraftMatrices(state.scene, hostPath.id, state.draftOverrides).worldM;
    const hostOutline = buildPaperPathFromSubPaths(
      scope,
      resolveEffectivePathGeometry(hostPath).subpaths,
      hostPath.fillRule
    );
    applyPaperMatrix(scope, hostOutline, hostM);
    hostOutline.fillColor = null;
    hostOutline.strokeColor = new scope.Color(accentHex);
    hostOutline.strokeWidth = 1 / zoom;
    hostOutline.dashArray = [4 / zoom, 3 / zoom];
    overlayLayer.addChild(hostOutline);
  }

  const wBot = applyMatrixToPoint(worldM, info.caretBottom);
  const wTop = applyMatrixToPoint(worldM, info.caretTop);
  const caretLine = new scope.Path.Line(
    new scope.Point(wBot.x, wBot.y),
    new scope.Point(wTop.x, wTop.y)
  );
  caretLine.strokeColor = new scope.Color(accentHex);
  caretLine.strokeWidth = 2 / zoom;
  caretLine.strokeCap = 'round';
  overlayLayer.addChild(caretLine);
}
