import { getSceneArtboards } from '../../core/artboards';
import { hexToRgb } from '../../core/themes';
import type { Scene } from '../../core/types';
import type { SmartGuideLine } from '../snapping';
import type { OverlayRenderState } from './shared';

const MANUAL_GUIDE_HEX = '#0ea5e9';

function getGridLineColor(
  scope: paper.PaperScope,
  backgroundHex: string,
  opacity: number
): paper.Color {
  const rgb = hexToRgb(backgroundHex);
  const lum = rgb ? 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b : 255;
  const channel = lum > 128 ? 28 / 255 : 1;
  return new scope.Color(channel, channel, channel, opacity);
}

export function renderGridOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  scene: Scene,
  grid: { show: boolean; size: number; opacity: number },
  zoom: number
): void {
  if (!grid.show) return;

  let step = Math.max(4, grid.size);
  while (step * zoom < 8) {
    step *= 2;
  }

  const vb = scope.view.bounds;
  for (const ab of getSceneArtboards(scene)) {
    if (ab.width <= 0 || ab.height <= 0) continue;
    if (
      vb &&
      (ab.x + ab.width < vb.left ||
        ab.x > vb.right ||
        ab.y + ab.height < vb.top ||
        ab.y > vb.bottom)
    ) {
      continue;
    }
    const minX = vb ? Math.max(step, Math.floor((vb.left - ab.x) / step) * step) : step;
    const maxX = vb ? Math.min(ab.width, Math.ceil((vb.right - ab.x) / step) * step) : ab.width;
    const minY = vb ? Math.max(step, Math.floor((vb.top - ab.y) / step) * step) : step;
    const maxY = vb ? Math.min(ab.height, Math.ceil((vb.bottom - ab.y) / step) * step) : ab.height;
    const drawTop = vb ? Math.max(ab.y, vb.top) : ab.y;
    const drawBottom = vb ? Math.min(ab.y + ab.height, vb.bottom) : ab.y + ab.height;
    const drawLeft = vb ? Math.max(ab.x, vb.left) : ab.x;
    const drawRight = vb ? Math.min(ab.x + ab.width, vb.right) : ab.x + ab.width;

    const children: paper.Path[] = [];
    for (let x = minX; x < maxX; x += step) {
      if (x <= 0 || x >= ab.width) continue;
      children.push(
        new scope.Path.Line(
          new scope.Point(ab.x + x, drawTop),
          new scope.Point(ab.x + x, drawBottom)
        )
      );
    }
    for (let y = minY; y < maxY; y += step) {
      if (y <= 0 || y >= ab.height) continue;
      children.push(
        new scope.Path.Line(
          new scope.Point(drawLeft, ab.y + y),
          new scope.Point(drawRight, ab.y + y)
        )
      );
    }
    if (children.length === 0) continue;

    const compound = new scope.CompoundPath({
      children,
      applyMatrix: false,
    });
    compound.strokeColor = getGridLineColor(scope, ab.background, grid.opacity);
    compound.strokeWidth = 1 / zoom;
    overlayLayer.addChild(compound);
  }
}

export function renderSmartGuidesOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  guides: SmartGuideLine[],
  accentHex: string,
  zoom: number
): void {
  const strokeW = 1 / zoom;
  for (const guide of guides) {
    const p1 =
      guide.orientation === 'vertical'
        ? new scope.Point(guide.pos, guide.start)
        : new scope.Point(guide.start, guide.pos);
    const p2 =
      guide.orientation === 'vertical'
        ? new scope.Point(guide.pos, guide.end)
        : new scope.Point(guide.end, guide.pos);
    const line = new scope.Path.Line(p1, p2);
    line.strokeColor = new scope.Color(accentHex);
    line.strokeWidth = strokeW;
    overlayLayer.addChild(line);
  }
}

export function renderManualGuidesOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  state: OverlayRenderState,
  zoom: number
): void {
  if (state.showGuides === false) return;
  const saved = state.scene.guides ?? [];
  const dragging = state.draggingGuide ?? null;
  if (saved.length === 0 && !dragging) return;

  const pad = 4000 / zoom;
  const vb = scope.view.bounds;
  const left = (vb?.left ?? -2000) - pad;
  const right = (vb?.right ?? 2000) + pad;
  const top = (vb?.top ?? -2000) - pad;
  const bottom = (vb?.bottom ?? 2000) + pad;

  const drawGuide = (
    orientation: 'horizontal' | 'vertical',
    position: number,
    isPreview: boolean
  ) => {
    const p1 =
      orientation === 'vertical'
        ? new scope.Point(position, top)
        : new scope.Point(left, position);
    const p2 =
      orientation === 'vertical'
        ? new scope.Point(position, bottom)
        : new scope.Point(right, position);
    const line = new scope.Path.Line(p1, p2);
    line.strokeColor = new scope.Color(MANUAL_GUIDE_HEX);
    line.strokeWidth = (isPreview ? 1.5 : 1) / zoom;
    line.opacity = isPreview ? 0.95 : 0.85;
    if (isPreview) {
      line.dashArray = [4 / zoom, 3 / zoom];
    }
    overlayLayer.addChild(line);
  };

  for (const guide of saved) {
    if (dragging?.id && dragging.id === guide.id) continue;
    drawGuide(guide.orientation, guide.position, false);
  }
  if (dragging) {
    drawGuide(dragging.orientation, dragging.position, true);
  }
}
