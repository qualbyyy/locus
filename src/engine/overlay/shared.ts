import { findLayerPath } from '../../core/layerTree';
import {
  IDENTITY_MATRIX,
  getLayerMatrix,
  multiplyMatrices,
  type Matrix2D,
} from '../../core/math';
import type {
  AnchorPoint,
  Layer,
  Paint,
  Point2D,
  Scene,
  SelectedNodeRef,
  StrokeStyle,
  SubPath,
  ToolType,
} from '../../core/types';
import type { SmartGuideLine } from '../snapping';

export type TextPathHandleId = 'offset' | 'baseline';

export type SelectHandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'rotate';

export interface MarqueeOverlay {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PenDraftOverlay {
  anchors: AnchorPoint[];
  hoverPoint: Point2D | null;
  isClosingHover: boolean;
}

export interface ShapeDraftOverlay {
  x: number;
  y: number;
  subpaths: SubPath[];
  fill: Paint | null;
  stroke: StrokeStyle | null;
}

export interface ShapeBuilderOverlay {
  regions: Array<{
    id: string;
    x: number;
    y: number;
    subpaths: SubPath[];
    fillRule: 'nonzero' | 'evenodd';
  }>;
  hoveredRegionId: string | null;
  activeRegionIds: string[];
  trail: Point2D[];
  mode: 'merge' | 'erase';
  scopeMatrix: Matrix2D;
}

export interface FreehandDraftOverlay {
  points: Point2D[];
  closedHover?: boolean;
  mode: 'pencil' | 'knife';
}

export interface GradientHandleData {
  target: 'fill' | 'stroke';
  kind: 'start' | 'end' | 'stop';
  stopIndex?: number;
}

export interface OverlayRenderState {
  scene: Scene;
  selectedIds: string[];
  selectedNode: SelectedNodeRef | null;
  editingGroupId?: string | null;
  activeArtboardId?: string | null;
  activeTool: ToolType;
  activeGradientTarget?: 'fill' | 'stroke';
  draftOverrides?: Map<string, Partial<Layer>>;
  marquee?: MarqueeOverlay | null;
  penDraft?: PenDraftOverlay | null;
  shapeDraft?: ShapeDraftOverlay | null;
  shapeBuilder?: ShapeBuilderOverlay | null;
  freehandDraft?: FreehandDraftOverlay | null;
  hoveredMaskId?: string | null;
  hoveredTextPathId?: string | null;
  editingTextCaret?: {
    layerId: string;
    content: string;
    caretIndex: number;
  } | null;
  accentColor?: string;
  grid?: { show: boolean; size: number; opacity: number };
  guides?: SmartGuideLine[] | null;
  showGuides?: boolean;
  draggingGuide?: {
    id?: string;
    orientation: 'horizontal' | 'vertical';
    position: number;
  } | null;
}

export const DEFAULT_ACCENT_HEX = '#da7756';
export const WHITE_HEX = '#ffffff';

export function applyDraftLayer(
  layer: Layer,
  draftOverrides?: Map<string, Partial<Layer>>
): Layer {
  const override = draftOverrides?.get(layer.id);
  if (!override) return layer;
  return { ...layer, ...override } as Layer;
}

export function applyPaperMatrix(
  scope: paper.PaperScope,
  item: paper.Item,
  m: Matrix2D
): void {
  item.applyMatrix = false;
  item.pivot = new scope.Point(0, 0);
  item.matrix = new scope.Matrix(m.a, m.b, m.c, m.d, m.tx, m.ty);
}

export function getDraftMatrices(
  scene: Scene,
  layerId: string,
  draftOverrides?: Map<string, Partial<Layer>>
): { worldM: Matrix2D; parentM: Matrix2D } {
  const path = findLayerPath(scene.layers, layerId);
  if (!path || path.length === 0) {
    return { worldM: IDENTITY_MATRIX, parentM: IDENTITY_MATRIX };
  }
  let parentM = IDENTITY_MATRIX;
  for (let i = 0; i < path.length - 1; i += 1) {
    parentM = multiplyMatrices(
      parentM,
      getLayerMatrix(applyDraftLayer(path[i], draftOverrides))
    );
  }
  const target = applyDraftLayer(path[path.length - 1], draftOverrides);
  const worldM = multiplyMatrices(parentM, getLayerMatrix(target));
  return { worldM, parentM };
}

export function drawHandleSquare(
  scope: paper.PaperScope,
  overlayLayer: paper.Layer,
  center: Point2D,
  size: number,
  rotationDeg: number,
  strokeWidth: number,
  fillHex: string,
  accentHex: string,
  data: Record<string, unknown>
): void {
  const half = size / 2;
  const square = new scope.Path.Rectangle(
    new scope.Rectangle(-half, -half, size, size)
  );
  square.applyMatrix = false;
  square.position = new scope.Point(center.x, center.y);
  square.rotation = rotationDeg;
  square.fillColor = new scope.Color(fillHex);
  square.strokeColor = new scope.Color(accentHex);
  square.strokeWidth = strokeWidth;
  square.data = data;
  overlayLayer.addChild(square);
}
