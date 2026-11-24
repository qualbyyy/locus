export type ToolType = 'select' | 'node' | 'pen' | 'blob' | 'text' | 'eyedropper';

export type SmartShapePreset = 'blob' | 'ellipse' | 'rect' | 'polygon' | 'star';

export interface SmartShapeOptions {
  preset: SmartShapePreset;
  points: number;           // 3..24 (для blob, polygon, star)
  wobble: number;           // 0..1 (для blob)
  cornerRadius: number;     // px (для rect)
  innerRadiusRatio: number; // 0.1..0.9 (для star)
}

export interface Point2D {
  x: number;
  y: number;
}

export interface AnchorPoint {
  x: number;
  y: number;
  handleIn: Point2D;  // Смещение относительно (x, y)
  handleOut: Point2D; // Смещение относительно (x, y)
  smooth: boolean;
}

export interface SubPath {
  closed: boolean;
  anchors: AnchorPoint[]; // В локальных координатах относительно центра (0, 0) PathLayer
}

export interface StrokeStyle {
  color: string;
  width: number;
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
}

export type WarpStyle =
  | 'flag'
  | 'wave'
  | 'arc'
  | 'arch'
  | 'bulge'
  | 'fisheye'
  | 'twist'
  | 'squeeze'
  | 'rise';

export interface WarpEffect {
  style: WarpStyle;
  bend: number;     // -100..100
  distortH: number; // -100..100
  distortV: number; // -100..100
}

export type DistortEffect =
  | { kind: 'zigzag'; size: number; ridges: number; smooth: boolean }
  | { kind: 'roughen'; size: number; detail: number; seed: number }
  | { kind: 'roundCorners'; radius: number };

export interface Effect3D {
  kind: 'rotate' | 'extrude';
  rotateX: number;     // -75..75 deg
  rotateY: number;     // -75..75 deg
  rotateZ: number;     // -180..180 deg
  perspective: number; // 0..100
  depth: number;       // 0..120 px
  shade: number;       // 0..1
}

export interface DropShadowEffect {
  color: string;
  opacity: number; // 0..1
  offsetX: number;
  offsetY: number;
  blur: number;
}

export interface OuterGlowEffect {
  color: string;
  opacity: number; // 0..1
  blur: number;
}

export interface LayerEffects {
  warp?: WarpEffect;
  distort?: DistortEffect;
  effect3d?: Effect3D;
  blur?: number; // px, 0..60
  dropShadow?: DropShadowEffect;
  outerGlow?: OuterGlowEffect;
}

export interface BaseLayer {
  id: string;
  name: string;
  type: 'path' | 'text' | 'image';
  visible: boolean;
  locked: boolean;
  x: number;
  y: number;
  rotation: number;   // Градусы по часовой стрелке
  scaleX: number;
  scaleY: number;
  opacity: number;    // 0..1
  clipMaskId?: string; // ID PathLayer, который обрезает этот слой
  effects?: LayerEffects;
}

export interface PathLayer extends BaseLayer {
  type: 'path';
  subpaths: SubPath[];
  fillRule: 'nonzero' | 'evenodd';
  fill: string | null;
  stroke: StrokeStyle | null;
  isClipMask?: boolean;
}

export type BuiltinFontFamily =
  | 'Inter'
  | 'Manrope'
  | 'Golos Text'
  | 'Playfair Display'
  | 'JetBrains Mono'
  | 'Unbounded';

export interface TextLayer extends BaseLayer {
  type: 'text';
  content: string;
  fontSize: number;
  fontFamily: BuiltinFontFamily;
  fontWeight: 400 | 700;
  lineHeight: number;     // По умолчанию 1.2
  letterSpacing?: number; // px, по умолчанию 0
  fill: string;
  align: 'left' | 'center' | 'right';
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  assetId: string; // Ключ в AssetRegistry
  width: number;
  height: number;
}

export type Layer = PathLayer | TextLayer | ImageLayer;

export interface Scene {
  version: 1;
  name: string;
  width: number;
  height: number;
  dpi: number;       // 72 по умолчанию, 300 для A4 Print
  background: string;
  layers: Layer[];   // Порядок отрисовки: снизу вверх (0 = самый нижний слой)
}

export interface DocumentPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  dpi: number;
}

export interface AssetEntry {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

export type AIProviderType = 'gemini' | 'anthropic' | 'ollama' | 'openai';

export interface AIConfig {
  provider: AIProviderType;
  geminiApiKey: string;
  geminiModel: string;     // по умолчанию 'gemini-4-hydrogen'
  anthropicApiKey: string;
  anthropicModel: string;  // по умолчанию 'claude-haiku-5-5'
  ollamaBaseUrl: string;   // по умолчанию 'http://localhost:11434'
  ollamaModel: string;     // по умолчанию 'qwen3.8'
  openaiBaseUrl: string;   // например 'https://api.openai.com/v1' или 'https://api.deepseek.com/v1'
  openaiApiKey: string;
  openaiModel: string;     // по умолчанию 'gpt-6-luna'
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectedNodeRef {
  layerId: string;
  subpathIndex: number;
  anchorIndex: number;
}

export const DOCUMENT_PRESETS: DocumentPreset[] = [
  {
    id: 'square',
    label: 'Square Post (Telegram / Instagram)',
    width: 1080,
    height: 1080,
    dpi: 72,
  },
  {
    id: 'stories',
    label: 'Stories / Reels',
    width: 1080,
    height: 1920,
    dpi: 72,
  },
  {
    id: 'desktop',
    label: 'Desktop / YouTube',
    width: 1920,
    height: 1080,
    dpi: 72,
  },
  {
    id: 'a4',
    label: 'A4 Print (300 DPI)',
    width: 2480,
    height: 3508,
    dpi: 300,
  },
];

export function createDefaultScene(
  init?: Partial<Pick<Scene, 'name' | 'width' | 'height' | 'dpi' | 'background'>>
): Scene {
  return {
    version: 1,
    name: init?.name?.trim() || 'Без названия',
    width: init?.width ?? 1080,
    height: init?.height ?? 1080,
    dpi: init?.dpi ?? 72,
    background: init?.background ?? '#ffffff',
    layers: [],
  };
}
