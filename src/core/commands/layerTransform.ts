import { getActiveArtboard } from '../artboards';
import {
  cloneLayersWithRemappedRefs,
  flattenLayers,
  getParentWorldMatrix,
  mapLayerTree,
  reconcileLayerRefs,
} from '../layerTree';
import {
  IDENTITY_MATRIX,
  applyMatrixToPoint,
  applyMatrixToVector,
  clamp,
  computeLayerBBoxWithMatrix,
  invertMatrix,
} from '../math';
import { useEditorStore } from '../store';
import type { Layer, Scene } from '../types';
import { commitScene, createLayerId } from './helpers';

export type AlignMode =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distribute_h'
  | 'distribute_v'
  | 'artboard_center';

export function nudgeLayers(
  layerIds: string[],
  dx: number,
  dy: number
): Scene {
  if (layerIds.length === 0 || (dx === 0 && dy === 0)) {
    return useEditorStore.getState().scene;
  }
  const idSet = new Set(layerIds);
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      changed = true;
      const parentM = getParentWorldMatrix(scene.layers, layer.id);
      const localDelta =
        parentM === IDENTITY_MATRIX
          ? { x: dx, y: dy }
          : applyMatrixToVector(invertMatrix(parentM), { x: dx, y: dy });
      return {
        ...layer,
        x: layer.x + localDelta.x,
        y: layer.y + localDelta.y,
      };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function alignLayers(layerIds: string[], mode: AlignMode): Scene {
  if (layerIds.length === 0) {
    return useEditorStore.getState().scene;
  }

  const activeArtboardId = useEditorStore.getState().activeArtboardId;
  return commitScene((scene) => {
    const ab = getActiveArtboard(scene, activeArtboardId);
    const idSet = new Set(layerIds);
    const targets = flattenLayers(scene.layers).filter(
      (l) => idSet.has(l.id) && !l.locked
    );
    if (targets.length === 0) {
      return scene;
    }

    const boxes = new Map(
      targets.map((layer) => [
        layer.id,
        computeLayerBBoxWithMatrix(layer, getParentWorldMatrix(scene.layers, layer.id)),
      ])
    );
    const deltas = new Map<string, { dx: number; dy: number }>();

    if (mode === 'artboard_center') {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const b of boxes.values()) {
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + b.width > maxX) maxX = b.x + b.width;
        if (b.y + b.height > maxY) maxY = b.y + b.height;
      }
      const dx = ab.x + ab.width / 2 - (minX + (maxX - minX) / 2);
      const dy = ab.y + ab.height / 2 - (minY + (maxY - minY) / 2);
      for (const layer of targets) {
        deltas.set(layer.id, { dx, dy });
      }
    } else if (mode === 'distribute_h' || mode === 'distribute_v') {
      if (targets.length < 3) {
        return scene;
      }
      const isHorizontal = mode === 'distribute_h';
      const sorted = [...targets].sort((a, b) => {
        const ba = boxes.get(a.id)!;
        const bb = boxes.get(b.id)!;
        const ca = isHorizontal ? ba.x + ba.width / 2 : ba.y + ba.height / 2;
        const cb = isHorizontal ? bb.x + bb.width / 2 : bb.y + bb.height / 2;
        return ca - cb;
      });

      const first = boxes.get(sorted[0].id)!;
      const last = boxes.get(sorted[sorted.length - 1].id)!;
      const span = isHorizontal
        ? last.x + last.width - first.x
        : last.y + last.height - first.y;
      const sumSizes = sorted.reduce((acc, layer) => {
        const b = boxes.get(layer.id)!;
        return acc + (isHorizontal ? b.width : b.height);
      }, 0);
      const gap = (span - sumSizes) / (sorted.length - 1);

      let cursor = isHorizontal
        ? first.x + first.width + gap
        : first.y + first.height + gap;

      for (let i = 1; i < sorted.length - 1; i++) {
        const layer = sorted[i];
        const b = boxes.get(layer.id)!;
        if (isHorizontal) {
          deltas.set(layer.id, { dx: cursor - b.x, dy: 0 });
          cursor += b.width + gap;
        } else {
          deltas.set(layer.id, { dx: 0, dy: cursor - b.y });
          cursor += b.height + gap;
        }
      }
    } else {
      let refBox = { x: ab.x, y: ab.y, width: ab.width, height: ab.height };
      if (targets.length > 1) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const b of boxes.values()) {
          if (b.x < minX) minX = b.x;
          if (b.y < minY) minY = b.y;
          if (b.x + b.width > maxX) maxX = b.x + b.width;
          if (b.y + b.height > maxY) maxY = b.y + b.height;
        }
        refBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      }

      for (const layer of targets) {
        const b = boxes.get(layer.id)!;
        let dx = 0;
        let dy = 0;
        switch (mode) {
          case 'left':
            dx = refBox.x - b.x;
            break;
          case 'center':
            dx = refBox.x + refBox.width / 2 - (b.x + b.width / 2);
            break;
          case 'right':
            dx = refBox.x + refBox.width - (b.x + b.width);
            break;
          case 'top':
            dy = refBox.y - b.y;
            break;
          case 'middle':
            dy = refBox.y + refBox.height / 2 - (b.y + b.height / 2);
            break;
          case 'bottom':
            dy = refBox.y + refBox.height - (b.y + b.height);
            break;
        }
        deltas.set(layer.id, { dx, dy });
      }
    }

    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      const d = deltas.get(layer.id);
      if (!d || (Math.abs(d.dx) <= 1e-6 && Math.abs(d.dy) <= 1e-6)) {
        return layer;
      }
      changed = true;
      const parentM = getParentWorldMatrix(scene.layers, layer.id);
      const localDelta =
        parentM === IDENTITY_MATRIX
          ? { x: d.dx, y: d.dy }
          : applyMatrixToVector(invertMatrix(parentM), { x: d.dx, y: d.dy });
      return {
        ...layer,
        x: layer.x + localDelta.x,
        y: layer.y + localDelta.y,
      };
    });

    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function flipLayers(
  layerIds: string[],
  axis: 'horizontal' | 'vertical'
): Scene {
  if (layerIds.length === 0) return useEditorStore.getState().scene;

  return commitScene((scene) => {
    const idSet = new Set(layerIds);
    const targets = flattenLayers(scene.layers).filter(
      (l) => idSet.has(l.id) && !l.locked
    );
    if (targets.length === 0) return scene;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of targets) {
      const b = computeLayerBBoxWithMatrix(
        t,
        getParentWorldMatrix(scene.layers, t.id),
        scene.layers
      );
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    const pivotWorld = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      const parentM = getParentWorldMatrix(scene.layers, layer.id);
      const worldCenter = applyMatrixToPoint(parentM, { x: layer.x, y: layer.y });
      const mirroredWorld =
        axis === 'horizontal'
          ? { x: 2 * pivotWorld.x - worldCenter.x, y: worldCenter.y }
          : { x: worldCenter.x, y: 2 * pivotWorld.y - worldCenter.y };
      const localPos = applyMatrixToPoint(invertMatrix(parentM), mirroredWorld);
      if (axis === 'horizontal') {
        return {
          ...layer,
          x: localPos.x,
          y: localPos.y,
          rotation: -layer.rotation,
          scaleX: -layer.scaleX,
        };
      }
      return {
        ...layer,
        x: localPos.x,
        y: localPos.y,
        rotation: -layer.rotation,
        scaleY: -layer.scaleY,
      };
    });

    return { ...scene, layers: nextLayers };
  });
}

/** Дублирует слои зеркально относительно центральной оси активного артборда. */
export function mirrorDuplicateLayers(
  layerIds: string[],
  axis: 'horizontal' | 'vertical'
): Layer[] {
  if (layerIds.length === 0) return [];
  const sourceSet = new Set(layerIds);
  const created: Layer[] = [];
  const activeArtboardId = useEditorStore.getState().activeArtboardId;

  commitScene((scene) => {
    const ab = getActiveArtboard(scene, activeArtboardId);
    const abCenterX = ab.x + ab.width / 2;
    const abCenterY = ab.y + ab.height / 2;
    const allSceneIds = new Set(flattenLayers(scene.layers).map((l) => l.id));

    const mirrorInList = (layers: Layer[]): Layer[] => {
      let changed = false;
      const walked = layers.map((raw) => {
        if (raw.type === 'group') {
          const nextChildren = mirrorInList(raw.children);
          if (nextChildren !== raw.children) {
            changed = true;
            return { ...raw, children: nextChildren };
          }
        }
        return raw;
      });

      const listTargets = walked.filter((l) => sourceSet.has(l.id) && !l.locked);
      if (listTargets.length === 0) {
        return changed ? walked : layers;
      }

      changed = true;
      const { clones, rootIdMap } = cloneLayersWithRemappedRefs(
        listTargets,
        createLayerId,
        { nameSuffix: ' отражение', existingLayerIds: allSceneIds }
      );
      const cloneByOrigId = new Map<string, Layer>();
      for (const orig of listTargets) {
        const cid = rootIdMap.get(orig.id);
        const copy = clones.find((c) => c.id === cid);
        if (!copy) continue;
        const pMat = getParentWorldMatrix(scene.layers, orig.id);
        const worldPt = applyMatrixToPoint(pMat, { x: orig.x, y: orig.y });
        const mirroredWorld =
          axis === 'horizontal'
            ? { x: abCenterX * 2 - worldPt.x, y: worldPt.y }
            : { x: worldPt.x, y: abCenterY * 2 - worldPt.y };
        const localPt = applyMatrixToPoint(invertMatrix(pMat), mirroredWorld);
        copy.x = localPt.x;
        copy.y = localPt.y;
        copy.rotation = -orig.rotation;
        if (axis === 'horizontal') copy.scaleX = -orig.scaleX;
        else copy.scaleY = -orig.scaleY;
        cloneByOrigId.set(orig.id, copy);
      }

      const next: Layer[] = [];
      for (const item of walked) {
        next.push(item);
        const copy = cloneByOrigId.get(item.id);
        if (copy) {
          created.push(copy);
          next.push(copy);
        }
      }
      return next;
    };

    const nextLayers = mirrorInList(scene.layers);
    return created.length > 0
      ? { ...scene, layers: reconcileLayerRefs(nextLayers, true) }
      : scene;
  });

  if (created.length > 0) {
    useEditorStore.setState({
      selectedIds: created.map((item) => item.id),
      selectedNode: null,
    });
  }
  return created;
}

export interface RepeatLayersOptions {
  mode: 'row' | 'column' | 'grid' | 'ring';
  count: number;
  gap?: number;
  columns?: number;
  radius?: number;
  sweep?: number;
}

/** Размножает слои рядом, сеткой или по кольцу вокруг центра активного артборда. */
export function repeatLayers(
  layerIds: string[],
  opts: RepeatLayersOptions
): Layer[] {
  if (layerIds.length === 0) return [];
  const count = clamp(Math.round(opts.count), 2, 40);
  const gap = Math.max(0, opts.gap ?? 20);
  const columns = clamp(Math.round(opts.columns ?? 3), 2, 10);
  const sourceSet = new Set(layerIds);
  const created: Layer[] = [];
  const activeArtboardId = useEditorStore.getState().activeArtboardId;

  commitScene((scene) => {
    const ab = getActiveArtboard(scene, activeArtboardId);
    const artboardCenter = { x: ab.x + ab.width / 2, y: ab.y + ab.height / 2 };
    const sweep = clamp(opts.sweep ?? 360, -360, 360);
    const allSceneIds = new Set(flattenLayers(scene.layers).map((l) => l.id));

    const repeatInList = (layers: Layer[]): Layer[] => {
      let changed = false;
      const next: Layer[] = [];
      for (const rawLayer of layers) {
        let layer = rawLayer;
        if (layer.type === 'group') {
          const nextChildren = repeatInList(layer.children);
          if (nextChildren !== layer.children) {
            layer = { ...layer, children: nextChildren };
            changed = true;
          }
        }
        next.push(layer);
        if (!sourceSet.has(layer.id) || layer.locked) continue;

        changed = true;
        const parentM = getParentWorldMatrix(scene.layers, layer.id);
        const invParentM = invertMatrix(parentM);
        const box = computeLayerBBoxWithMatrix(layer, parentM, scene.layers);
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const stepX = box.width + gap;
        const stepY = box.height + gap;
        const rows = Math.ceil(count / columns);
        const baseRadius =
          opts.radius ??
          Math.max(
            Math.hypot(center.x - artboardCenter.x, center.y - artboardCenter.y),
            Math.max(box.width, box.height) / 2
          );
        const baseAngle = Math.atan2(
          center.y - artboardCenter.y,
          center.x - artboardCenter.x
        );

        for (let index = 1; index < count; index += 1) {
          let targetCenter: { x: number; y: number };

          if (opts.mode === 'row') {
            targetCenter = { x: center.x + stepX * index, y: center.y };
          } else if (opts.mode === 'column') {
            targetCenter = { x: center.x, y: center.y + stepY * index };
          } else if (opts.mode === 'grid') {
            const col = index % columns;
            const row = Math.floor(index / columns);
            if (row >= rows) break;
            targetCenter = {
              x: center.x + stepX * col,
              y: center.y + stepY * row,
            };
          } else {
            const angle = baseAngle + ((Math.PI * 2 * sweep) / 360) * (index / count);
            targetCenter = {
              x: artboardCenter.x + Math.cos(angle) * baseRadius,
              y: artboardCenter.y + Math.sin(angle) * baseRadius,
            };
          }

          const localDelta = applyMatrixToVector(invParentM, {
            x: targetCenter.x - center.x,
            y: targetCenter.y - center.y,
          });
          const { clones } = cloneLayersWithRemappedRefs([layer], createLayerId, {
            nameSuffix: ` ${index + 1}`,
            offsetX: localDelta.x,
            offsetY: localDelta.y,
            existingLayerIds: allSceneIds,
          });
          const copy = clones[0];
          if (copy) {
            created.push(copy);
            next.push(copy);
          }
        }
      }
      return changed ? next : layers;
    };

    const nextLayers = repeatInList(scene.layers);
    return created.length > 0
      ? { ...scene, layers: reconcileLayerRefs(nextLayers, true) }
      : scene;
  });

  if (created.length > 0) {
    useEditorStore.setState({
      selectedIds: created.map((item) => item.id),
      selectedNode: null,
    });
  }
  return created;
}

/** Вписывает слои в заданный прямоугольник с сохранением пропорций. */
export function placeLayersInBounds(
  layerIds: string[],
  box: { x: number; y: number; width: number; height: number },
  mode: 'fit' | 'fill' = 'fit'
): Scene {
  if (layerIds.length === 0 || box.width <= 0 || box.height <= 0) {
    return useEditorStore.getState().scene;
  }
  const idSet = new Set(layerIds);

  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      const parentM = getParentWorldMatrix(scene.layers, layer.id);
      const current = computeLayerBBoxWithMatrix(layer, parentM);
      if (current.width <= 1e-6 || current.height <= 1e-6) return layer;

      const scaleX = box.width / current.width;
      const scaleY = box.height / current.height;
      const k = mode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
      if (!Number.isFinite(k) || k <= 0) return layer;

      const scaled: Layer = {
        ...layer,
        scaleX: layer.scaleX * k,
        scaleY: layer.scaleY * k,
      };
      const next = computeLayerBBoxWithMatrix(scaled, parentM);
      const dx = box.x + box.width / 2 - (next.x + next.width / 2);
      const dy = box.y + box.height / 2 - (next.y + next.height / 2);
      const localDelta =
        parentM === IDENTITY_MATRIX
          ? { x: dx, y: dy }
          : applyMatrixToVector(invertMatrix(parentM), { x: dx, y: dy });

      changed = true;
      return {
        ...scaled,
        x: scaled.x + localDelta.x,
        y: scaled.y + localDelta.y,
      };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export function rotateLayersBy(layerIds: string[], deltaDeg: number): Scene {
  if (layerIds.length === 0) return useEditorStore.getState().scene;
  const idSet = new Set(layerIds);
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.locked) return layer;
      changed = true;
      return { ...layer, rotation: layer.rotation + deltaDeg };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}
