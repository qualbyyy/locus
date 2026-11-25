import type { Layer, Point2D } from '../../core/types';
import type {
  FreehandDraftOverlay,
  MarqueeOverlay,
  PenDraftOverlay,
  ShapeBuilderOverlay,
  ShapeDraftOverlay,
} from '../overlay';
import type { SmartGuideLine } from '../snapping';

export interface ToolPointerEvent {
  point: Point2D;
  startPoint: Point2D;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  detail: number;
}

export interface OverlayExtras {
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
  guides?: SmartGuideLine[] | null;
  draggingGuide?: {
    id?: string;
    orientation: 'horizontal' | 'vertical';
    position: number;
  } | null;
}

export interface ToolContext {
  scope: paper.PaperScope;
  sceneLayer: paper.Layer;
  overlayLayer: paper.Layer;
  getItemMap: () => Map<string, paper.Item>;
  redrawOverlay: (extras?: OverlayExtras) => void;
  startTextEditing: (layerId: string, selectAll?: boolean) => void;
}

export interface CanvasToolController {
  onMouseDown: (event: ToolPointerEvent, ctx: ToolContext) => void;
  onMouseDrag: (event: ToolPointerEvent, ctx: ToolContext) => void;
  onMouseMove: (event: ToolPointerEvent, ctx: ToolContext) => void;
  onMouseUp: (event: ToolPointerEvent, ctx: ToolContext) => void;
  onDoubleClick?: (event: ToolPointerEvent, ctx: ToolContext) => void;
  finish?: (ctx: ToolContext) => boolean;
  cancel?: (ctx: ToolContext) => void;
}
