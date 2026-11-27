import { getActiveArtboard, getSceneArtboards } from '../core/artboards';
import {
  getLayerWorldMatrix,
  getParentWorldMatrix,
} from '../core/layerTree';
import { computeLayerBBoxWithMatrix, decomposeMatrix } from '../core/math';
import { isGradientPaint } from '../core/paint';
import type { Artboard, BBox, Layer, Paint, Scene } from '../core/types';
import { contrastRatio, normalizeHexColor } from './palette';

function collectVisibleLayers(layers: Layer[], out: Layer[] = []): Layer[] {
  for (const layer of layers) {
    if (!layer.visible) continue;
    out.push(layer);
    if (layer.type === 'group') {
      collectVisibleLayers(layer.children, out);
    }
  }
  return out;
}

export type PreflightSeverity = 'error' | 'warning';
export type PreflightCategory = 'contrast' | 'typography' | 'bounds';

export interface PreflightIssue {
  id: string;
  severity: PreflightSeverity;
  category: PreflightCategory;
  layerId?: string;
  layerName?: string;
  message: string;
  suggestion: string;
}

export interface PreflightReport {
  checkedAt: number;
  dpi: number;
  issues: PreflightIssue[];
  summary: string;
}

function resolveSolidOrStopHex(paint: Paint | null | undefined): string | null {
  if (!paint) return null;
  if (typeof paint === 'string') return normalizeHexColor(paint);
  if (isGradientPaint(paint) && paint.stops.length > 0) {
    return normalizeHexColor(paint.stops[0].color);
  }
  return null;
}

function boxesOverlap(a: BBox, b: BBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function findArtboardForBox(
  box: BBox,
  artboards: Artboard[],
  fallback: Artboard
): Artboard {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const containing = artboards.find(
    (ab) => cx >= ab.x && cx <= ab.x + ab.width && cy >= ab.y && cy <= ab.y + ab.height
  );
  if (containing) return containing;
  const overlapping = artboards.find((ab) => boxesOverlap(box, ab));
  return overlapping ?? fallback;
}

function resolveTextBackgroundHex(
  textIdx: number,
  textBox: BBox,
  allFlat: Layer[],
  allBoxes: Map<string, BBox>,
  artboard: Artboard
): string {
  const cx = textBox.x + textBox.width / 2;
  const cy = textBox.y + textBox.height / 2;
  for (let i = textIdx - 1; i >= 0; i -= 1) {
    const candidate = allFlat[i];
    if (!candidate.visible || candidate.type !== 'path') continue;
    const fillHex = resolveSolidOrStopHex(candidate.fill);
    if (!fillHex) continue;
    const cBox = allBoxes.get(candidate.id);
    if (!cBox) continue;
    if (cx >= cBox.x && cx <= cBox.x + cBox.width && cy >= cBox.y && cy <= cBox.y + cBox.height) {
      return fillHex;
    }
  }
  return normalizeHexColor(artboard.background) ?? '#ffffff';
}

export function runPreflightCheck(
  scene: Scene,
  artboardId?: string
): PreflightReport {
  const issues: PreflightIssue[] = [];
  const artboards = getSceneArtboards(scene);
  const fallbackAb = getActiveArtboard(scene, artboardId);
  const allFlat = collectVisibleLayers(scene.layers);

  const boxById = new Map<string, BBox>();
  for (const layer of allFlat) {
    if (!layer.visible || layer.type === 'group') continue;
    boxById.set(
      layer.id,
      computeLayerBBoxWithMatrix(layer, getParentWorldMatrix(scene.layers, layer.id))
    );
  }

  for (let idx = 0; idx < allFlat.length; idx += 1) {
    const layer = allFlat[idx];
    if (!layer.visible || layer.type === 'group') continue;
    const box = boxById.get(layer.id);
    if (!box) continue;

    const ab = findArtboardForBox(box, artboards, fallbackAb);

    // 1. Bounds check (out of artboard)
    const outside =
      box.x + box.width < ab.x ||
      box.x > ab.x + ab.width ||
      box.y + box.height < ab.y ||
      box.y > ab.y + ab.height;
    if (outside) {
      issues.push({
        id: `bounds_${layer.id}`,
        severity: 'error',
        category: 'bounds',
        layerId: layer.id,
        layerName: layer.name,
        message: `Слой «${layer.name}» полностью находится за пределами артборда «${ab.name}».`,
        suggestion: `Переместите или впишите слой в область артборда (${ab.width}×${ab.height} px).`,
      });
    } else {
      const overhang = Math.max(
        ab.x - box.x,
        ab.y - box.y,
        box.x + box.width - (ab.x + ab.width),
        box.y + box.height - (ab.y + ab.height)
      );
      if (overhang > 2) {
        issues.push({
          id: `bounds_${layer.id}`,
          severity: 'warning',
          category: 'bounds',
          layerId: layer.id,
          layerName: layer.name,
          message: `Слой «${layer.name}» выступает за края артборда на ${Math.round(overhang)} px.`,
          suggestion: `Скорректируйте положение или размер слоя, чтобы не обрезать края при экспорте.`,
        });
      }
    }

    // 2 & 3. Typography & contrast checks on TextLayer
    if (layer.type === 'text') {
      const worldDecomp = decomposeMatrix(getLayerWorldMatrix(scene.layers, layer.id));
      const effectivePx = layer.fontSize * Math.max(0.05, Math.abs(worldDecomp.scaleY));

      if (scene.dpi >= 250) {
        const pt = (effectivePx * 72) / scene.dpi;
        if (pt < 6) {
          issues.push({
            id: `type_${layer.id}`,
            severity: 'error',
            category: 'typography',
            layerId: layer.id,
            layerName: layer.name,
            message: `Слишком мелкий кегль для печати (${scene.dpi} dpi): «${layer.name}» ~${pt.toFixed(1)} pt.`,
            suggestion: `Увеличьте fontSize хотя бы до 8 pt (~${Math.ceil((8 * scene.dpi) / 72)} px при ${scene.dpi} dpi).`,
          });
        } else if (pt < 8) {
          issues.push({
            id: `type_${layer.id}`,
            severity: 'warning',
            category: 'typography',
            layerId: layer.id,
            layerName: layer.name,
            message: `Мелкий кегль для печати (${scene.dpi} dpi): «${layer.name}» ~${pt.toFixed(1)} pt (< 8 pt).`,
            suggestion: `Рекомендуемый минимальный кегль для ${scene.dpi} dpi — 8 pt.`,
          });
        }
      } else if (effectivePx < 10) {
        issues.push({
          id: `type_${layer.id}`,
          severity: 'warning',
          category: 'typography',
          layerId: layer.id,
          layerName: layer.name,
          message: `Мелкий шрифт у слоя «${layer.name}»: ${effectivePx.toFixed(1)} px (< 10 px).`,
          suggestion: 'Увеличьте размер шрифта для комфортной читаемости на экране.',
        });
      }

      const textHex = resolveSolidOrStopHex(layer.fill);
      if (textHex) {
        const bgHex = resolveTextBackgroundHex(
          idx,
          box,
          allFlat,
          boxById,
          ab
        );
        const ratio = contrastRatio(textHex, bgHex);
        const isLarge =
          effectivePx >= 24 || (effectivePx >= 18.66 && layer.fontWeight >= 700);
        const minRequired = isLarge ? 3.0 : 4.5;
        if (ratio < minRequired) {
          issues.push({
            id: `contrast_${layer.id}`,
            severity: ratio < 3.0 ? 'error' : 'warning',
            category: 'contrast',
            layerId: layer.id,
            layerName: layer.name,
            message: `Низкий контраст текста «${layer.name}» (${ratio.toFixed(2)}:1, нужно ${minRequired}:1; текст ${textHex} на ${bgHex}).`,
            suggestion: 'Сделайте цвет текста темнее или светлее относительно подложки.',
          });
        }
      }
    }
  }

  const errCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  const summary =
    issues.length === 0
      ? `Проверка макета (${scene.dpi} dpi): проблем не обнаружено.`
      : `Проверка макета (${scene.dpi} dpi): ошибок — ${errCount}, предупреждений — ${warnCount}.`;

  return {
    checkedAt: Date.now(),
    dpi: scene.dpi,
    issues,
    summary,
  };
}
