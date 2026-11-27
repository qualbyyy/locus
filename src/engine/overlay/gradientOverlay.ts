import { applyMatrixToPoint, clamp, type Matrix2D } from '../../core/math';
import {
  isGradientPaint,
  normalizeGradientStops,
  resolveGradientEndpoints,
} from '../../core/paint';
import type { GradientPaint, Layer, Point2D } from '../../core/types';
import { resolveLayerLocalBBox } from '../geometryBounds';
import { type GradientHandleData, WHITE_HEX, applyPaperMatrix } from './shared';

export function resolveEditableGradient(
  layer: Layer,
  preferred: 'fill' | 'stroke' = 'fill'
): { target: 'fill' | 'stroke'; gradient: GradientPaint } | null {
  if (layer.type === 'path') {
    if (preferred === 'stroke' && isGradientPaint(layer.stroke?.color)) {
      return { target: 'stroke', gradient: layer.stroke.color };
    }
    if (isGradientPaint(layer.fill)) {
      return { target: 'fill', gradient: layer.fill };
    }
    if (isGradientPaint(layer.stroke?.color)) {
      return { target: 'stroke', gradient: layer.stroke.color };
    }
    return null;
  }
  if (layer.type === 'text') {
    if (preferred === 'stroke' && isGradientPaint(layer.stroke?.color)) {
      return { target: 'stroke', gradient: layer.stroke.color };
    }
    if (isGradientPaint(layer.fill)) {
      return { target: 'fill', gradient: layer.fill };
    }
    if (isGradientPaint(layer.stroke?.color)) {
      return { target: 'stroke', gradient: layer.stroke.color };
    }
    return null;
  }
  return null;
}

export function renderGradientOverlay(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  layer: Layer,
  sceneLayers: Layer[],
  worldM: Matrix2D,
  target: 'fill' | 'stroke',
  gradient: GradientPaint,
  zoom: number,
  accentHex: string
): void {
  const localBox = resolveLayerLocalBBox(layer, sceneLayers, { effectivePath: true });
  const { origin, destination, radius } = resolveGradientEndpoints(gradient, localBox);
  const originW = applyMatrixToPoint(worldM, origin);
  const destW = applyMatrixToPoint(worldM, destination);
  const strokeW = 1 / zoom;

  if (gradient.kind === 'radial') {
    const circle = new scope.Path.Circle(
      new scope.Point(origin.x, origin.y),
      radius
    );
    applyPaperMatrix(scope, circle, worldM);
    circle.fillColor = null;
    circle.strokeColor = new scope.Color(accentHex);
    circle.strokeWidth = strokeW;
    circle.dashArray = [4 / zoom, 3 / zoom];
    overlayLayer.addChild(circle);
  }

  const lineHalo = new scope.Path.Line(
    new scope.Point(originW.x, originW.y),
    new scope.Point(destW.x, destW.y)
  );
  lineHalo.strokeColor = new scope.Color(WHITE_HEX);
  lineHalo.strokeWidth = 2.5 / zoom;
  overlayLayer.addChild(lineHalo);

  const line = new scope.Path.Line(
    new scope.Point(originW.x, originW.y),
    new scope.Point(destW.x, destW.y)
  );
  line.strokeColor = new scope.Color(accentHex);
  line.strokeWidth = 1.2 / zoom;
  overlayLayer.addChild(line);

  const stops =
    gradient.stops.length >= 2
      ? gradient.stops
      : normalizeGradientStops(gradient.stops);

  for (let i = 1; i < stops.length - 1; i += 1) {
    const stop = stops[i];
    const t = clamp(stop.offset, 0, 1);
    const pt = {
      x: originW.x + (destW.x - originW.x) * t,
      y: originW.y + (destW.y - originW.y) * t,
    };
    const dot = new scope.Path.Circle(new scope.Point(pt.x, pt.y), 4.5 / zoom);
    dot.fillColor = new scope.Color(stop.color);
    dot.strokeColor = new scope.Color(WHITE_HEX);
    dot.strokeWidth = 1.5 / zoom;
    dot.data = {
      gradientHandle: {
        target,
        kind: 'stop',
        stopIndex: i,
      } satisfies GradientHandleData,
    };
    overlayLayer.addChild(dot);
  }

  const endpoints: Array<{
    kind: 'start' | 'end';
    pt: Point2D;
    color: string;
  }> = [
    { kind: 'start', pt: originW, color: stops[0]?.color ?? '#da7756' },
    {
      kind: 'end',
      pt: destW,
      color: stops[stops.length - 1]?.color ?? '#2563eb',
    },
  ];

  for (const ep of endpoints) {
    const ring = new scope.Path.Circle(
      new scope.Point(ep.pt.x, ep.pt.y),
      6.8 / zoom
    );
    ring.fillColor = null;
    ring.strokeColor = new scope.Color(accentHex);
    ring.strokeWidth = strokeW;
    overlayLayer.addChild(ring);

    const handle = new scope.Path.Circle(
      new scope.Point(ep.pt.x, ep.pt.y),
      5.5 / zoom
    );
    handle.fillColor = new scope.Color(ep.color);
    handle.strokeColor = new scope.Color(WHITE_HEX);
    handle.strokeWidth = 1.8 / zoom;
    handle.data = {
      gradientHandle: {
        target,
        kind: ep.kind,
      } satisfies GradientHandleData,
    };
    overlayLayer.addChild(handle);
  }
}
