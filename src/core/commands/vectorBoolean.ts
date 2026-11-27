import {
  computeBooleanOperation,
  computeCombineCompoundPath,
  computeDivideOperation,
  computeSplitCompoundPath,
  type BooleanOp,
  type BooleanResult,
} from '../../engine/booleans';
import {
  flattenLayers,
  getParentWorldMatrix,
  mapLayerTree,
  reconcileLayerRefs,
} from '../layerTree';
import {
  applyMatrixToPoint,
  applyMatrixToVector,
  centerSubPathsAtOrigin,
  invertMatrix,
  type Matrix2D,
} from '../math';
import { clonePaint, cloneStroke } from '../paint';
import { useEditorStore } from '../store';
import type { Layer, PathLayer, SubPath } from '../types';
import {
  clearTextPathProps,
  commitScene,
  createLayerId,
  findSharedClipMaskId,
  replaceLayersAtHighestIndex,
  replacePerIdInList,
} from './helpers';
import { deleteLayers } from './layerCrud';

const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  unite: 'Объединение',
  subtract: 'Вычитание',
  intersect: 'Пересечение',
  exclude: 'Исключение',
  divide: 'Разделение',
};

function worldBooleanResultToScope(
  res: BooleanResult,
  parentMatrix: Matrix2D
): BooleanResult {
  if (
    parentMatrix.a === 1 &&
    parentMatrix.b === 0 &&
    parentMatrix.c === 0 &&
    parentMatrix.d === 1 &&
    parentMatrix.tx === 0 &&
    parentMatrix.ty === 0
  ) {
    return res;
  }
  const inv = invertMatrix(parentMatrix);
  const worldSubpaths: SubPath[] = res.subpaths.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => {
      const p = applyMatrixToPoint(inv, { x: res.x + a.x, y: res.y + a.y });
      return {
        x: p.x,
        y: p.y,
        handleIn: applyMatrixToVector(inv, a.handleIn),
        handleOut: applyMatrixToVector(inv, a.handleOut),
        smooth: a.smooth,
      };
    }),
  }));
  const { subpaths, offset } = centerSubPathsAtOrigin(worldSubpaths);
  return { x: offset.x, y: offset.y, subpaths, fillRule: res.fillRule };
}

export function divideLayers(layerIds: string[]): PathLayer[] {
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (layer): layer is PathLayer =>
      idSet.has(layer.id) && layer.type === 'path' && !layer.locked
  );

  if (targets.length < 2) {
    return [];
  }

  const pieces = computeDivideOperation(targets, state.scene.layers);
  if (pieces.length === 0) {
    return [];
  }

  const anchorTarget = targets[targets.length - 1];
  const anchorParentM = getParentWorldMatrix(state.scene.layers, anchorTarget.id);
  const targetSet = new Set(targets.map((t) => t.id));
  const preserveClipMaskId = findSharedClipMaskId(targets, targetSet);

  const createdLayers: PathLayer[] = pieces.map((piece, idx) => {
    const scoped = worldBooleanResultToScope(piece, anchorParentM);
    const src = targets[piece.sourceIndex] ?? targets[0];
    return {
      id: createLayerId('path'),
      name: `Часть ${idx + 1}`,
      type: 'path',
      visible: true,
      locked: false,
      x: scoped.x,
      y: scoped.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: src.opacity,
      subpaths: scoped.subpaths,
      fillRule: scoped.fillRule,
      fill: clonePaint(src.fill),
      stroke: cloneStroke(src.stroke),
      ...(preserveClipMaskId ? { clipMaskId: preserveClipMaskId } : {}),
    };
  });

  replaceLayersAtHighestIndex(targetSet, createdLayers, anchorTarget.id);
  return createdLayers;
}

export function booleanLayers(
  layerIds: string[],
  operation: BooleanOp
): PathLayer | null {
  if (operation === 'divide') {
    const pieces = divideLayers(layerIds);
    return pieces[0] ?? null;
  }

  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (layer): layer is PathLayer =>
      idSet.has(layer.id) && layer.type === 'path' && !layer.locked
  );

  if (targets.length < 2) {
    return null;
  }

  const rawResult = computeBooleanOperation(targets, operation, state.scene.layers);
  if (!rawResult) {
    return null;
  }

  const topTarget = targets[targets.length - 1];
  const anchorParentM = getParentWorldMatrix(state.scene.layers, topTarget.id);
  const result = worldBooleanResultToScope(rawResult, anchorParentM);
  const styleSource =
    operation === 'subtract'
      ? targets[0]
      : topTarget.fill !== null || topTarget.stroke !== null
        ? topTarget
        : targets[0];

  const targetSet = new Set(targets.map((t) => t.id));
  const preserveClipMaskId = findSharedClipMaskId(targets, targetSet);

  const newLayer: PathLayer = {
    id: createLayerId('path'),
    name: BOOLEAN_LABELS[operation],
    type: 'path',
    visible: true,
    locked: false,
    x: result.x,
    y: result.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: styleSource.opacity,
    subpaths: result.subpaths,
    fillRule: result.fillRule,
    fill: clonePaint(styleSource.fill),
    stroke: cloneStroke(styleSource.stroke),
    ...(preserveClipMaskId ? { clipMaskId: preserveClipMaskId } : {}),
  };

  replaceLayersAtHighestIndex(targetSet, [newLayer], topTarget.id);
  return newLayer;
}

export function splitCompoundPathLayers(layerIds: string[]): PathLayer[] {
  if (layerIds.length === 0) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (l): l is PathLayer =>
      idSet.has(l.id) && l.type === 'path' && !l.locked && l.subpaths.length > 1
  );
  if (targets.length === 0) return [];

  const splitMap = new Map<string, Layer[]>();
  const splitSourceIds = new Set<string>();
  const createdAll: PathLayer[] = [];

  for (const layer of targets) {
    const parts = computeSplitCompoundPath(layer);
    if (parts.length < 2) continue;

    splitSourceIds.add(layer.id);
    const createdForLayer = parts.map((part, idx): PathLayer => ({
      id: createLayerId('path'),
      name: `${layer.name} · ${idx + 1}`,
      type: 'path',
      visible: layer.visible,
      locked: false,
      x: part.x,
      y: part.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: layer.opacity,
      subpaths: part.subpaths,
      fillRule: part.fillRule,
      fill: clonePaint(layer.fill),
      stroke: cloneStroke(layer.stroke),
      ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
    }));
    splitMap.set(layer.id, createdForLayer);
    createdAll.push(...createdForLayer);
  }

  if (createdAll.length === 0) return [];

  commitScene((scene) => {
    const replaced = replacePerIdInList(scene.layers, splitMap);
    const cleaned = mapLayerTree(replaced, (layer) => {
      let nextLayer = layer;
      if (nextLayer.clipMaskId && splitSourceIds.has(nextLayer.clipMaskId)) {
        const copy = { ...nextLayer };
        delete copy.clipMaskId;
        nextLayer = copy;
      }
      if (
        nextLayer.type === 'text' &&
        nextLayer.pathId &&
        splitSourceIds.has(nextLayer.pathId)
      ) {
        nextLayer = clearTextPathProps(nextLayer);
      }
      return nextLayer;
    });
    return { ...scene, layers: reconcileLayerRefs(cleaned, true) };
  });

  useEditorStore.setState({
    selectedIds: createdAll.map((l) => l.id),
    selectedNode: null,
  });

  return createdAll;
}

export function combineCompoundPathLayers(layerIds: string[]): PathLayer | null {
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (l): l is PathLayer => idSet.has(l.id) && l.type === 'path' && !l.locked
  );
  if (targets.length < 2) return null;

  const rawCombined = computeCombineCompoundPath(targets, state.scene.layers);
  if (!rawCombined) return null;

  const topTarget = targets[targets.length - 1];
  const anchorParentM = getParentWorldMatrix(state.scene.layers, topTarget.id);
  const combined = worldBooleanResultToScope(rawCombined, anchorParentM);
  const styleSource =
    topTarget.fill !== null || topTarget.stroke !== null ? topTarget : targets[0];
  const targetSet = new Set(targets.map((t) => t.id));
  const preserveClipMaskId = findSharedClipMaskId(targets, targetSet);

  const newLayer: PathLayer = {
    id: createLayerId('path'),
    name: 'Составной контур',
    type: 'path',
    visible: true,
    locked: false,
    x: combined.x,
    y: combined.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: styleSource.opacity,
    subpaths: combined.subpaths,
    fillRule: 'evenodd',
    fill: clonePaint(styleSource.fill),
    stroke: cloneStroke(styleSource.stroke),
    ...(preserveClipMaskId ? { clipMaskId: preserveClipMaskId } : {}),
  };

  replaceLayersAtHighestIndex(targetSet, [newLayer], topTarget.id);
  return newLayer;
}

export function applyShapeBuilderOperation(
  sourceLayerIds: string[],
  pieces: Array<BooleanResult & { sourceIndex: number }>
): PathLayer[] {
  if (sourceLayerIds.length === 0) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(sourceLayerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (layer): layer is PathLayer =>
      idSet.has(layer.id) && layer.type === 'path' && !layer.locked
  );
  if (targets.length === 0) return [];

  const targetSet = new Set(targets.map((t) => t.id));
  if (pieces.length === 0) {
    deleteLayers(Array.from(targetSet));
    return [];
  }

  const preserveClipMaskId = findSharedClipMaskId(targets, targetSet);
  const createdLayers: PathLayer[] = pieces.map((piece, idx) => {
    const src = targets[piece.sourceIndex] ?? targets[0];
    return {
      id: createLayerId('path'),
      name: `Фигура ${idx + 1}`,
      type: 'path',
      visible: true,
      locked: false,
      x: piece.x,
      y: piece.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: src.opacity,
      ...(src.blendMode ? { blendMode: src.blendMode } : {}),
      subpaths: piece.subpaths,
      fillRule: piece.fillRule,
      fill: clonePaint(src.fill),
      stroke: cloneStroke(src.stroke),
      ...(preserveClipMaskId ? { clipMaskId: preserveClipMaskId } : {}),
    };
  });

  replaceLayersAtHighestIndex(targetSet, createdLayers);
  return createdLayers;
}
