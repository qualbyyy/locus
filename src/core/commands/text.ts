import {
  computeOptimalArcPathOffset,
  computeTextOnPathLocalBBox,
  computeTextOnPathPlacements,
  createTextCharMeasurer,
  pickPrimaryHostSubPath,
  resolveHostPathLayer,
} from '../../engine/textOnPath';
import { convertTextLayerToOutlines } from '../../engine/textOutlines';
import { getActiveArtboard } from '../artboards';
import {
  findLayerById,
  flattenLayers,
  getParentGroupId,
  mapLayerTree,
} from '../layerTree';
import { applyMatrixToPoint, clamp, degToRad, getLayerMatrix } from '../math';
import { clonePaint, cloneStroke } from '../paint';
import { useEditorStore } from '../store';
import type {
  FontFamily,
  GroupLayer,
  Paint,
  PathLayer,
  Scene,
  StrokeStyle,
  TextLayer,
} from '../types';
import { runCommandBatch } from './document';
import { clearTextPathProps, commitScene, createLayerId } from './helpers';
import { addLayer, createShapeLayer } from './layers';

export type TextCaseMode = 'upper' | 'lower' | 'title';

export function createTextLayer(params: {
  x: number;
  y: number;
  content?: string;
  fontSize?: number;
  fontFamily?: FontFamily;
  fontWeight?: 400 | 700;
  lineHeight?: number;
  letterSpacing?: number;
  align?: 'left' | 'center' | 'right';
  fill?: Paint;
  stroke?: StrokeStyle | null;
  name?: string;
  select?: boolean;
  parentGroupId?: string | null;
  pathId?: string;
  pathOffset?: number;
  pathFlip?: boolean;
  pathBaselineOffset?: number;
  pathStretch?: boolean;
}): TextLayer {
  const state = useEditorStore.getState();
  const sameTypeCount =
    flattenLayers(state.scene.layers).filter((l) => l.type === 'text').length + 1;

  const layer: TextLayer = {
    id: createLayerId('text'),
    name: params.name?.trim() || `Текст ${sameTypeCount}`,
    type: 'text',
    visible: true,
    locked: false,
    x: params.x,
    y: params.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    content: params.content ?? 'Новый текст',
    fontSize: clamp(params.fontSize ?? 48, 6, 1000),
    fontFamily: params.fontFamily ?? 'Inter',
    fontWeight: params.fontWeight ?? 400,
    lineHeight: clamp(params.lineHeight ?? 1.2, 0.6, 4),
    ...(params.letterSpacing !== undefined
      ? { letterSpacing: clamp(params.letterSpacing, -20, 200) }
      : {}),
    fill: clonePaint(params.fill ?? '#1c1b1a'),
    ...(params.stroke ? { stroke: cloneStroke(params.stroke) } : {}),
    align: params.align ?? 'left',
    ...(params.pathId ? { pathId: params.pathId } : {}),
    ...(params.pathOffset !== undefined
      ? { pathOffset: clamp(params.pathOffset, 0, 100) }
      : {}),
    ...(params.pathFlip ? { pathFlip: true } : {}),
    ...(params.pathBaselineOffset !== undefined
      ? { pathBaselineOffset: clamp(params.pathBaselineOffset, -200, 200) }
      : {}),
    ...(params.pathStretch ? { pathStretch: true } : {}),
  };

  return addLayer(layer, {
    select: params.select,
    parentGroupId: params.parentGroupId,
  }) as TextLayer;
}

export function attachTextToPath(
  textLayerId: string,
  pathLayerId: string
): TextLayer | null {
  let updated: TextLayer | null = null;
  commitScene((scene) => {
    const textLayer = findLayerById(scene.layers, textLayerId);
    const pathLayer = resolveHostPathLayer(scene.layers, pathLayerId);
    if (!textLayer || textLayer.type !== 'text' || textLayer.locked || !pathLayer) {
      return scene;
    }
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (layer.id !== textLayerId || layer.type !== 'text') return layer;
      const next: TextLayer = {
        ...layer,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        pathId: pathLayer.id,
        pathOffset: layer.pathOffset ?? 0,
        pathFlip: Boolean(layer.pathFlip),
      };
      updated = next;
      return next;
    });
    return updated ? { ...scene, layers: nextLayers } : scene;
  });
  return updated;
}

export function createTextOnPathFromShape(
  pathLayerId: string,
  options?: {
    content?: string;
    fontSize?: number;
    baselineOffset?: number;
    arc?: 'top' | 'bottom';
    select?: boolean;
  }
): TextLayer | null {
  const scene = useEditorStore.getState().scene;
  const pathLayer = resolveHostPathLayer(scene.layers, pathLayerId);
  if (!pathLayer || pathLayer.locked) {
    return null;
  }

  const fontSize = clamp(options?.fontSize ?? 28, 6, 1000);
  const strokeMargin =
    pathLayer.stroke && pathLayer.stroke.width > 0
      ? Math.round(pathLayer.stroke.width / 2 + 8)
      : 10;
  const outerMargin = options?.baselineOffset ?? strokeMargin;
  const isClosed = Boolean(pickPrimaryHostSubPath(pathLayer.subpaths)?.closed);
  const isBottom = options?.arc === 'bottom';
  const parentGroupId = getParentGroupId(scene.layers, pathLayer.id);
  const pathOffset = isClosed
    ? computeOptimalArcPathOffset(pathLayer, isBottom ? 'bottom' : 'top', scene.layers)
    : 0;

  return createTextLayer({
    x: 0,
    y: 0,
    content: options?.content ?? 'Текст по контуру',
    fontSize,
    align: 'center',
    pathId: pathLayer.id,
    pathFlip: isBottom,
    pathOffset,
    pathBaselineOffset: isBottom
      ? -Math.round(fontSize * 0.72 + outerMargin)
      : outerMargin,
    select: options?.select ?? true,
    parentGroupId,
  });
}

export function applyTextPathArc(
  textLayerId: string,
  arc: 'top' | 'bottom'
): TextLayer | null {
  let updated: TextLayer | null = null;
  commitScene((scene) => {
    const textLayer = findLayerById(scene.layers, textLayerId);
    if (!textLayer || textLayer.type !== 'text' || textLayer.locked || !textLayer.pathId) {
      return scene;
    }
    const hostPath = resolveHostPathLayer(scene.layers, textLayer.pathId);
    if (!hostPath) return scene;

    const isClosed = Boolean(pickPrimaryHostSubPath(hostPath.subpaths)?.closed);
    const isBottom = arc === 'bottom';
    const margin =
      textLayer.pathBaselineOffset !== undefined && textLayer.pathBaselineOffset > 0
        ? Math.max(8, Math.min(48, textLayer.pathBaselineOffset))
        : 10;
    const pathOffset = isClosed
      ? computeOptimalArcPathOffset(hostPath, arc, scene.layers)
      : 0;

    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (layer.id !== textLayerId || layer.type !== 'text') return layer;
      const next: TextLayer = {
        ...layer,
        align: 'center',
        pathFlip: isBottom,
        pathOffset,
        pathBaselineOffset: isBottom
          ? -Math.round(layer.fontSize * 0.72 + margin)
          : margin,
      };
      updated = next;
      return next;
    });
    return updated ? { ...scene, layers: nextLayers } : scene;
  });
  return updated;
}

export function createCircleTextPreset(): TextLayer {
  const state = useEditorStore.getState();
  const selected = state.selectedIds
    .map((id) => findLayerById(state.scene.layers, id))
    .filter((l): l is PathLayer => Boolean(l && l.type === 'path' && !l.locked));

  if (selected.length === 1) {
    const attached = createTextOnPathFromShape(selected[0].id, {
      content: 'ТЕКСТ ПО КРУГУ',
    });
    if (attached) return attached;
  }

  let createdText!: TextLayer;
  runCommandBatch(() => {
    const ab = getActiveArtboard(state.scene, state.activeArtboardId);
    const circle = createShapeLayer({
      preset: 'ellipse',
      x: Math.round(ab.x + ab.width / 2),
      y: Math.round(ab.y + ab.height / 2),
      width: 260,
      height: 260,
      fill: null,
      stroke: {
        color: '#1c1b1a',
        width: 1.5,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: [4, 4],
      },
      name: 'Круг для текста',
      select: false,
      parentGroupId: state.editingGroupId,
    });
    createdText = createTextOnPathFromShape(circle.id, {
      content: 'ТЕКСТ ПО КРУГУ',
      fontSize: 28,
      baselineOffset: 10,
      arc: 'top',
      select: true,
    })!;
  });
  return createdText;
}

export function detachTextFromPath(textLayerId: string): TextLayer | null {
  let updated: TextLayer | null = null;
  commitScene((scene) => {
    const textLayer = findLayerById(scene.layers, textLayerId);
    if (!textLayer || textLayer.type !== 'text' || textLayer.locked || !textLayer.pathId) {
      return scene;
    }
    const hostPath = resolveHostPathLayer(scene.layers, textLayer.pathId);
    const box = hostPath
      ? computeTextOnPathLocalBBox(textLayer, hostPath, scene.layers)
      : null;

    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (layer.id !== textLayerId || layer.type !== 'text') return layer;
      const copy = clearTextPathProps({
        ...layer,
        ...(box ? { x: Math.round(box.x), y: Math.round(box.y) } : {}),
      });
      updated = copy;
      return copy;
    });
    return updated ? { ...scene, layers: nextLayers } : scene;
  });
  return updated;
}

export type TextSplitMode = 'chars' | 'lines';

function cloneEffectsValue<T>(effects: T): T {
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(effects)
    : (JSON.parse(JSON.stringify(effects)) as T);
}

function makeSplitTextChild(
  source: TextLayer,
  content: string,
  name: string,
  transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
  align: TextLayer['align']
): TextLayer {
  const child: TextLayer = clearTextPathProps({
    ...source,
    id: createLayerId('text'),
    name,
    content,
    x: Number(transform.x.toFixed(2)),
    y: Number(transform.y.toFixed(2)),
    rotation: Number(transform.rotation.toFixed(2)),
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    align,
    fill: clonePaint(source.fill),
    ...(source.stroke ? { stroke: cloneStroke(source.stroke) } : {}),
  });
  delete child.clipMaskId;
  delete child.effects;
  return child;
}

export function splitTextLayers(
  layerIds: string[],
  mode: TextSplitMode
): GroupLayer[] {
  if (layerIds.length === 0) return [];
  const idSet = new Set(layerIds);
  const createdGroups: GroupLayer[] = [];

  commitScene((scene) => {
    const replacements = new Map<string, GroupLayer>();
    const allTexts = flattenLayers(scene.layers).filter(
      (l): l is TextLayer => idSet.has(l.id) && l.type === 'text' && !l.locked
    );

    for (const layer of allTexts) {
      const m = getLayerMatrix(layer);
      const children: TextLayer[] = [];

      if (mode === 'lines') {
        if (layer.pathId) continue;
        const rawLines = (layer.content || '').split('\n');
        if (rawLines.length < 2) continue;
        const step = layer.fontSize * layer.lineHeight;
        rawLines.forEach((line, idx) => {
          if (!line.trim()) return;
          const pos = applyMatrixToPoint(m, { x: 0, y: idx * step });
          children.push(
            makeSplitTextChild(
              layer,
              line,
              `${layer.name} · стр. ${idx + 1}`,
              {
                x: pos.x,
                y: pos.y,
                rotation: layer.rotation,
                scaleX: layer.scaleX,
                scaleY: layer.scaleY,
              },
              layer.align
            )
          );
        });
      } else {
        const hostPath = resolveHostPathLayer(scene.layers, layer.pathId);
        if (hostPath) {
          const placements = computeTextOnPathPlacements(
            layer,
            hostPath,
            undefined,
            scene.layers
          );
          const dy = layer.fontSize * 0.85;
          for (const p of placements) {
            if (!p.char.trim()) continue;
            const rad = degToRad(p.angleDeg);
            const localOrigin = {
              x: p.x + Math.sin(rad) * dy,
              y: p.y - Math.cos(rad) * dy,
            };
            const pos = applyMatrixToPoint(m, localOrigin);
            children.push(
              makeSplitTextChild(
                layer,
                p.char,
                p.char,
                {
                  x: pos.x,
                  y: pos.y,
                  rotation: layer.rotation + p.angleDeg,
                  scaleX: layer.scaleX,
                  scaleY: layer.scaleY,
                },
                'center'
              )
            );
          }
        } else {
          const rawLines = (layer.content || '').split('\n');
          const measure = createTextCharMeasurer(layer);
          const tracking = layer.letterSpacing ?? 0;
          const step = layer.fontSize * layer.lineHeight;

          rawLines.forEach((line, lineIdx) => {
            const chars = Array.from(line);
            const widths = chars.map(measure);
            const totalW =
              widths.reduce((sum, w) => sum + w, 0) +
              Math.max(0, chars.length - 1) * tracking;
            let cursor =
              layer.align === 'center'
                ? -totalW / 2
                : layer.align === 'right'
                  ? -totalW
                  : 0;

            for (let i = 0; i < chars.length; i += 1) {
              const ch = chars[i];
              const w = widths[i];
              if (ch.trim()) {
                const pos = applyMatrixToPoint(m, {
                  x: cursor + w / 2,
                  y: lineIdx * step,
                });
                children.push(
                  makeSplitTextChild(
                    layer,
                    ch,
                    ch,
                    {
                      x: pos.x,
                      y: pos.y,
                      rotation: layer.rotation,
                      scaleX: layer.scaleX,
                      scaleY: layer.scaleY,
                    },
                    'center'
                  )
                );
              }
              cursor += w + tracking;
            }
          });
        }
      }

      if (children.length < 2) continue;

      const group: GroupLayer = {
        id: createLayerId('group'),
        name: `${layer.name} (${mode === 'chars' ? 'буквы' : 'строки'})`,
        type: 'group',
        visible: layer.visible,
        locked: false,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
        ...(layer.effects ? { effects: cloneEffectsValue(layer.effects) } : {}),
        ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
        children,
      };
      replacements.set(layer.id, group);
      createdGroups.push(group);
    }

    if (replacements.size === 0) return scene;

    const nextLayers = mapLayerTree(scene.layers, (node) => replacements.get(node.id) ?? node);
    return { ...scene, layers: nextLayers };
  });

  if (createdGroups.length > 0) {
    useEditorStore.setState({
      selectedIds: createdGroups.map((g) => g.id),
      selectedNode: null,
    });
  }
  return createdGroups;
}

export function transformTextCase(layerIds: string[], mode: TextCaseMode): Scene {
  if (layerIds.length === 0) {
    return useEditorStore.getState().scene;
  }
  const idSet = new Set(layerIds);
  return commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      if (!idSet.has(layer.id) || layer.type !== 'text' || layer.locked) {
        return layer;
      }
      let nextContent = layer.content;
      if (mode === 'upper') {
        nextContent = layer.content.toLocaleUpperCase('ru-RU');
      } else if (mode === 'lower') {
        nextContent = layer.content.toLocaleLowerCase('ru-RU');
      } else {
        nextContent = layer.content
          .toLocaleLowerCase('ru-RU')
          .replace(
            /(^|[\s\-—/("«])(\p{L})/gu,
            (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('ru-RU')
          );
      }
      if (nextContent === layer.content) return layer;
      changed = true;
      return { ...layer, content: nextContent };
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });
}

export async function convertTextLayersToOutlines(
  layerIds: string[]
): Promise<PathLayer[]> {
  if (layerIds.length === 0) return [];
  const state = useEditorStore.getState();
  const idSet = new Set(layerIds);
  const targets = flattenLayers(state.scene.layers).filter(
    (l): l is TextLayer => idSet.has(l.id) && l.type === 'text' && !l.locked
  );
  if (targets.length === 0) return [];

  const converted = await Promise.all(
    targets.map(async (layer) => {
      const hostPath = resolveHostPathLayer(state.scene.layers, layer.pathId);
      return {
        layer,
        outline: await convertTextLayerToOutlines(layer, hostPath, state.scene.layers),
      };
    })
  );

  const replacements = new Map<string, PathLayer>();
  const created: PathLayer[] = [];

  for (const { layer, outline } of converted) {
    if (!outline) continue;
    const pathLayer: PathLayer = {
      id: createLayerId('path'),
      name: `${layer.name} (кривые)`,
      type: 'path',
      visible: layer.visible,
      locked: false,
      x: outline.x,
      y: outline.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: layer.opacity,
      ...(layer.blendMode ? { blendMode: layer.blendMode } : {}),
      subpaths: outline.subpaths,
      fillRule: outline.fillRule,
      fill: clonePaint(layer.fill),
      stroke: cloneStroke(layer.stroke ?? null),
      ...(layer.clipMaskId ? { clipMaskId: layer.clipMaskId } : {}),
    };
    replacements.set(layer.id, pathLayer);
    created.push(pathLayer);
  }

  if (created.length === 0) return [];

  commitScene((scene) => {
    let changed = false;
    const nextLayers = mapLayerTree(scene.layers, (layer) => {
      const replacement = replacements.get(layer.id);
      if (!replacement) return layer;
      changed = true;
      return replacement;
    });
    return changed ? { ...scene, layers: nextLayers } : scene;
  });

  useEditorStore.setState({
    selectedIds: created.map((l) => l.id),
    selectedNode: null,
  });

  return created;
}
