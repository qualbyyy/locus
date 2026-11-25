import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Copy,
  Crop,
  Download,
  FileCode2,
  FolderOpen,
  Group,
  ImagePlus,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Trash2,
  Ungroup,
  Unlink,
  Wand2,
} from 'lucide-react';
import { getActiveArtboard, getSceneArtboards } from '../core/artboards';
import type { AlignMode, TextCaseMode, TextSplitMode } from '../core/commands';
import type { ExportKind } from '../core/documentFile';
import { findLayerById, flattenLayers, getParentGroupId, getScopeLayers } from '../core/layerTree';
import { clamp } from '../core/math';
import { BLEND_MODE_OPTIONS, getPrimaryColor } from '../core/paint';
import {
  DOCUMENT_PRESETS,
  type Artboard,
  type BlendMode,
  type Layer,
  type LayerEffects,
  type PathLayer,
  type Scene,
  type SmartShapeOptions,
  type SmartShapePreset,
  type TextLayer,
  type ToolType,
} from '../core/types';
import type { BooleanOp } from '../engine/booleans';
import type { ImageTraceOptions } from '../engine/imageTrace';
import { InspectorEffects, type EffectTarget } from './inspector/InspectorEffects';
import {
  AlignSection,
  HexColorRow,
  NumberField,
  SegmentedButton,
} from './InspectorControls';
import { Checkbox, ColorField, Select, Slider } from './controls';
import {
  collectDocumentColors,
  DocumentColorSwatches,
  InspectorAppearance,
} from './inspector/InspectorAppearance';
import { InspectorText } from './inspector/InspectorText';
import { InspectorTransform } from './inspector/InspectorTransform';
import {
  InspectorMultiVectorOps,
  InspectorVectorOps,
} from './inspector/InspectorVectorOps';

interface InspectorProps {
  scene: Scene;
  selectedIds: string[];
  activeArtboardId: string;
  activeTool: ToolType;
  smartShapeOptions: SmartShapeOptions;
  pencilSmoothness: number;
  onChangeSmartShapeOptions: (patch: Partial<SmartShapeOptions>) => void;
  onChangePencilSmoothness: (val: number) => void;
  onSelectArtboard: (artboardId: string) => void;
  onAddArtboard: () => void;
  onDuplicateArtboard: (artboardId: string) => void;
  onDeleteArtboard: (artboardId: string) => void;
  onUpdateArtboard: (
    patch: Partial<Pick<Artboard, 'name' | 'x' | 'y' | 'width' | 'height' | 'background'>> & {
      dpi?: number;
    }
  ) => void;
  onExportArtboard?: (kind: ExportKind, artboardId: string) => void;
  onImportBackgroundImage: () => void;
  onUpdateLayers: (
    layerIds: string[],
    patch: Partial<Layer> | ((layer: Layer) => Layer)
  ) => void;
  onGroupLayers: (layerIds: string[]) => void;
  onUngroupLayers: (layerIds: string[]) => void;
  onEnterGroup: (groupId: string | null) => void;
  onUploadFont: () => void;
  onSmoothLayers: (layerIds: string[]) => void;
  onWobbleLayers: (layerIds: string[], intensity: number) => void;
  onDuplicateLayers: (layerIds: string[]) => void;
  onDeleteLayers: (layerIds: string[]) => void;
  onReorderLayer: (
    layerId: string,
    mode: 'front' | 'back' | 'forward' | 'backward'
  ) => void;
  onAlignLayers: (layerIds: string[], mode: AlignMode) => void;
  onFlipLayers: (layerIds: string[], axis: 'horizontal' | 'vertical') => void;
  onBooleanOp: (layerIds: string[], operation: BooleanOp) => void;
  onCreateClipMask: (layerIds: string[]) => void;
  onReleaseClipMask: (maskId: string) => void;
  onDetachFromMask: (layerId: string) => void;
  onReplaceImage: (layerId: string) => void;
  onTraceImage: (layerId: string, options: Partial<ImageTraceOptions>) => void;
  onEditTextOnCanvas: (layerId: string) => void;
  onTransformTextCase: (layerIds: string[], mode: TextCaseMode) => void;
  onConvertToOutlines: (layerIds: string[]) => void;
  onSplitText?: (layerIds: string[], mode: TextSplitMode) => void;
  onAttachTextToPath: (textLayerId: string, pathLayerId: string) => void;
  onDetachTextFromPath: (textLayerId: string) => void;
  onApplyTextPathArc?: (textLayerId: string, arc: 'top' | 'bottom') => void;
  onCreateTextOnPath?: (pathLayerId: string) => void;
  onSplitCompound: (layerIds: string[]) => void;
  onCombineCompound: (layerIds: string[]) => void;
  onOffsetLayers: (layerIds: string[], distance: number, copyBehind: boolean) => void;
  onOutlineStroke: (layerIds: string[]) => void;
  onSimplifyLayers: (layerIds: string[]) => void;
  focusedEffect: EffectTarget | null;
  onConsumeFocusedEffect: () => void;
  onUpdateEffects: (layerIds: string[], patch: Partial<LayerEffects> | null) => void;
  onExpandAppearance: (layerIds: string[]) => void;
  onCopySvg: () => void;
  onExportSelectionRaster: () => void;
}

const SHAPE_PRESETS: Array<{ id: SmartShapePreset; label: string }> = [
  { id: 'ellipse', label: 'Круг' },
  { id: 'rect', label: 'Прям.' },
  { id: 'polygon', label: 'Полигон' },
  { id: 'star', label: 'Звезда' },
  { id: 'capsule', label: 'Капсула' },
];

function ArtboardPresetSelect({
  width,
  height,
  dpi,
  onSelect,
}: {
  width: number;
  height: number;
  dpi: number;
  onSelect: (patch: Pick<Scene, 'width' | 'height' | 'dpi'>) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const activePreset = DOCUMENT_PRESETS.find(
    (p) => p.width === width && p.height === height && p.dpi === dpi
  );

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <span className="text-[11px] text-paper-muted">Формат</span>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-7 w-full items-center justify-between gap-2 rounded border border-paper-border bg-paper-bg px-2 text-left text-[12px] text-paper-ink hover:bg-paper-hover focus:border-paper-accent focus:outline-none"
      >
        <span className="truncate">
          {activePreset ? activePreset.label : 'Свой размер'}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-paper-muted"
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded border border-paper-border bg-paper-panel py-1">
          {DOCUMENT_PRESETS.map((preset) => {
            const active = activePreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onSelect({
                    width: preset.width,
                    height: preset.height,
                    dpi: preset.dpi,
                  });
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] ${
                  active
                    ? 'bg-paper-accent/12 text-paper-ink'
                    : 'text-paper-ink hover:bg-paper-hover'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{preset.label}</div>
                  <div className="font-display text-[10px] text-paper-muted">
                    {preset.width} × {preset.height} • {preset.dpi} DPI
                  </div>
                </div>
                {active && (
                  <Check
                    className="h-3.5 w-3.5 shrink-0 text-paper-accent"
                    strokeWidth={2}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ArtboardNameField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onCommit(trimmed);
    } else {
      setDraft(value);
    }
  };

  return (
    <input
      type="text"
      value={draft}
      aria-label="Название артборда"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className="h-7 w-full rounded border border-paper-border bg-paper-bg px-2 text-[12px] text-paper-ink outline-none focus:border-paper-accent"
    />
  );
}

export function Inspector({
  scene,
  selectedIds,
  activeArtboardId,
  activeTool,
  smartShapeOptions,
  pencilSmoothness,
  onChangeSmartShapeOptions,
  onChangePencilSmoothness,
  onSelectArtboard,
  onAddArtboard,
  onDuplicateArtboard,
  onDeleteArtboard,
  onUpdateArtboard,
  onExportArtboard,
  onImportBackgroundImage,
  onUpdateLayers,
  onGroupLayers,
  onUngroupLayers,
  onEnterGroup,
  onUploadFont,
  onSmoothLayers,
  onWobbleLayers,
  onDuplicateLayers,
  onDeleteLayers,
  onReorderLayer,
  onAlignLayers,
  onFlipLayers,
  onBooleanOp,
  onCreateClipMask,
  onReleaseClipMask,
  onDetachFromMask,
  onReplaceImage,
  onTraceImage,
  onEditTextOnCanvas,
  onTransformTextCase,
  onConvertToOutlines,
  onSplitText,
  onAttachTextToPath,
  onDetachTextFromPath,
  onApplyTextPathArc,
  onCreateTextOnPath,
  onSplitCompound,
  onCombineCompound,
  onOffsetLayers,
  onOutlineStroke,
  onSimplifyLayers,
  focusedEffect,
  onConsumeFocusedEffect,
  onUpdateEffects,
  onExpandAppearance,
  onCopySvg,
  onExportSelectionRaster,
}: InspectorProps) {
  const [traceMode, setTraceMode] = useState<'bw' | 'color'>('bw');
  const [traceThreshold, setTraceThreshold] = useState(140);
  const [traceColors, setTraceColors] = useState(4);
  const [traceInvert, setTraceInvert] = useState(false);
  const [traceSimplify, setTraceSimplify] = useState(1.8);

  const artboards = getSceneArtboards(scene);
  const activeArtboard = getActiveArtboard(scene, activeArtboardId);

  const selectedLayers: Layer[] = [];
  for (const id of selectedIds) {
    const found = findLayerById(scene.layers, id);
    if (found) selectedLayers.push(found);
  }
  const singleLayer = selectedLayers.length === 1 ? selectedLayers[0] : null;
  const singleParentId = singleLayer ? getParentGroupId(scene.layers, singleLayer.id) : null;
  const singleScope = singleLayer ? getScopeLayers(scene.layers, singleParentId) : scene.layers;
  const singleIndex = singleLayer
    ? singleScope.findIndex((l) => l.id === singleLayer.id)
    : -1;

  const allFlatLayers = flattenLayers(scene.layers);
  const referencedMaskIds = new Set<string>();
  for (const layer of allFlatLayers) {
    if (layer.clipMaskId) {
      referencedMaskIds.add(layer.clipMaskId);
    }
  }
  const availablePaths = allFlatLayers
    .filter((l): l is PathLayer => l.type === 'path' && !l.locked)
    .map((l) => ({
      id: l.id,
      name: l.name,
      closed: l.subpaths.some((sp) => sp.closed),
    }));

  const pairText =
    selectedLayers.length === 2
      ? selectedLayers.find((l): l is TextLayer => l.type === 'text' && !l.locked)
      : undefined;
  const pairPath =
    selectedLayers.length === 2
      ? selectedLayers.find((l): l is PathLayer => l.type === 'path' && !l.locked)
      : undefined;

  const isLayerActiveMask = (layer: Layer): boolean =>
    layer.type === 'path' &&
    (Boolean(layer.isClipMask) || referencedMaskIds.has(layer.id));

  const selectedPathIds = selectedLayers
    .filter((l): l is PathLayer => l.type === 'path')
    .map((l) => l.id);
  const selectedTextIds = selectedLayers
    .filter((l): l is TextLayer => l.type === 'text' && !l.locked)
    .map((l) => l.id);
  const allSelectedArePaths =
    selectedLayers.length >= 2 &&
    selectedPathIds.length === selectedLayers.length &&
    !selectedLayers.some((l) => l.locked);

  const hasSelectedMaskOrMasked = selectedLayers.some(
    (l) => isLayerActiveMask(l) || Boolean(l.clipMaskId)
  );

  const documentColors = collectDocumentColors(scene);

  return (
    <section
      data-tour="inspector.root"
      className="flex flex-1 flex-col overflow-y-auto bg-paper-panel"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-paper-border px-3">
        <SlidersHorizontal className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
        <span className="truncate text-[12px] font-semibold text-paper-ink">
          {selectedLayers.length === 0
            ? artboards.length > 1
              ? activeArtboard.name
              : 'Артборд'
            : selectedLayers.length === 1
              ? singleLayer?.name
              : `Выделено: ${selectedLayers.length}`}
        </span>
      </div>

      {activeTool === 'pencil' && (
        <div className="flex flex-col gap-2 border-b border-paper-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
              Карандаш
            </span>
            <span className="font-display text-[11px] text-paper-ink">
              {pencilSmoothness.toFixed(1)}
            </span>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-paper-muted">Авто-сглаживание</span>
            <Slider
              value={pencilSmoothness}
              min={0.5}
              max={12}
              step={0.5}
              ariaLabel="Сглаживание карандаша"
              onChange={onChangePencilSmoothness}
            />
          </label>
        </div>
      )}

      {activeTool === 'shapeBuilder' && (
        <div className="flex flex-col gap-1 border-b border-paper-border p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
            Конструктор фигур
          </span>
          <p className="text-[11px] leading-snug text-paper-muted">
            Проведите по пересечениям для объединения; Alt + клик или штрих — удалить область.
          </p>
        </div>
      )}

      {activeTool === 'knife' && (
        <div className="flex flex-col gap-1 border-b border-paper-border p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
            Нож и Ножницы
          </span>
          <p className="text-[11px] leading-snug text-paper-muted">
            Проведите линию — разрезать фигуру (Shift — прямо); клик по контуру — точка разреза.
          </p>
        </div>
      )}

      {activeTool === 'blob' && (
        <div className="flex flex-col gap-2.5 border-b border-paper-border p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-paper-muted">
            Умная фигура
          </span>

          <div className="grid grid-cols-3 gap-1">
            {SHAPE_PRESETS.map((preset) => {
              const active = smartShapeOptions.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onChangeSmartShapeOptions({ preset: preset.id })}
                  className={`h-6 rounded border px-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-paper-accent bg-paper-accent text-white'
                      : 'border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {(smartShapeOptions.preset === 'blob' ||
            smartShapeOptions.preset === 'polygon' ||
            smartShapeOptions.preset === 'star') && (
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] text-paper-muted">
                <span>Точки / лучи</span>
                <span className="font-display text-paper-ink">{smartShapeOptions.points}</span>
              </div>
              <Slider
                value={smartShapeOptions.points}
                min={3}
                max={24}
                step={1}
                ariaLabel="Точки и лучи"
                onChange={(points) => onChangeSmartShapeOptions({ points })}
              />
            </label>
          )}

          {smartShapeOptions.preset === 'blob' && (
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] text-paper-muted">
                <span>Неровность (Wobble)</span>
                <span className="font-display text-paper-ink">
                  {smartShapeOptions.wobble.toFixed(2)}
                </span>
              </div>
              <Slider
                value={smartShapeOptions.wobble}
                min={0}
                max={1}
                step={0.05}
                ariaLabel="Неровность"
                onChange={(wobble) => onChangeSmartShapeOptions({ wobble })}
              />
            </label>
          )}

          {smartShapeOptions.preset === 'rect' && (
            <NumberField
              label="Скругление углов (px)"
              value={smartShapeOptions.cornerRadius}
              min={0}
              max={400}
              onCommit={(cornerRadius) => onChangeSmartShapeOptions({ cornerRadius })}
            />
          )}

          {smartShapeOptions.preset === 'star' && (
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] text-paper-muted">
                <span>Внутренний радиус</span>
                <span className="font-display text-paper-ink">
                  {smartShapeOptions.innerRadiusRatio.toFixed(2)}
                </span>
              </div>
              <Slider
                value={smartShapeOptions.innerRadiusRatio}
                min={0.1}
                max={0.9}
                step={0.05}
                ariaLabel="Внутренний радиус"
                onChange={(innerRadiusRatio) =>
                  onChangeSmartShapeOptions({ innerRadiusRatio })
                }
              />
            </label>
          )}
        </div>
      )}

      {selectedLayers.length === 0 ? (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-paper-muted">
                Артборды ({artboards.length})
              </span>
              <button
                type="button"
                onClick={onAddArtboard}
                className="flex items-center gap-1 rounded border border-paper-border bg-paper-bg px-1.5 py-0.5 text-[11px] font-medium text-paper-ink hover:bg-paper-hover"
              >
                <Plus className="h-3 w-3 text-paper-accent" strokeWidth={1.75} />
                <span>Добавить</span>
              </button>
            </div>
            {artboards.length > 1 && (
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                {artboards.map((ab) => {
                  const isActive = ab.id === activeArtboard.id;
                  return (
                    <div
                      key={ab.id}
                      onClick={() => onSelectArtboard(ab.id)}
                      className={`group flex h-7 cursor-pointer items-center justify-between gap-1 rounded border px-2 text-[11px] ${
                        isActive
                          ? 'border-paper-accent bg-paper-accent/10 text-paper-ink font-medium'
                          : 'border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{ab.name}</span>
                      <span className="shrink-0 font-display text-[10px] text-paper-muted">
                        {ab.width}×{ab.height}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDuplicateArtboard(ab.id);
                        }}
                        title="Дублировать артборд"
                        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-panel hover:text-paper-ink group-hover:flex"
                      >
                        <Copy className="h-3 w-3" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteArtboard(ab.id);
                        }}
                        title="Удалить артборд"
                        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-panel hover:text-paper-danger group-hover:flex"
                      >
                        <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {artboards.length > 1 && (
            <div className="flex flex-col gap-2 border-t border-paper-border pt-2.5">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-paper-muted">Имя артборда</span>
                <ArtboardNameField
                  value={activeArtboard.name}
                  onCommit={(name) => onUpdateArtboard({ name })}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberField
                  label="X (px)"
                  value={activeArtboard.x}
                  min={-100000}
                  max={100000}
                  onCommit={(x) => onUpdateArtboard({ x })}
                />
                <NumberField
                  label="Y (px)"
                  value={activeArtboard.y}
                  min={-100000}
                  max={100000}
                  onCommit={(y) => onUpdateArtboard({ y })}
                />
              </div>
            </div>
          )}

          <ArtboardPresetSelect
            width={activeArtboard.width}
            height={activeArtboard.height}
            dpi={scene.dpi}
            onSelect={(patch) => onUpdateArtboard(patch)}
          />

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
            <NumberField
              label="Ширина (px)"
              value={activeArtboard.width}
              min={64}
              max={16000}
              onCommit={(width) => onUpdateArtboard({ width })}
            />
            <button
              type="button"
              onClick={() =>
                onUpdateArtboard({
                  width: activeArtboard.height,
                  height: activeArtboard.width,
                })
              }
              title="Поменять ширину и высоту местами"
              className="flex h-7 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <NumberField
              label="Высота (px)"
              value={activeArtboard.height}
              min={64}
              max={16000}
              onCommit={(height) => onUpdateArtboard({ height })}
            />
          </div>

          <NumberField
            label="Разрешение (DPI)"
            value={scene.dpi}
            min={72}
            max={600}
            onCommit={(dpi) => onUpdateArtboard({ dpi })}
          />

          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-paper-muted">Фон артборда</span>
            <HexColorRow
              value={activeArtboard.background}
              onChange={(background) => onUpdateArtboard({ background })}
            />
            <button
              type="button"
              onClick={onImportBackgroundImage}
              className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
            >
              <ImagePlus className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
              <span>Фон из изображения</span>
            </button>
          </div>

          {artboards.length > 1 && onExportArtboard && (
            <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
              <span className="text-[11px] text-paper-muted">
                Экспорт «{activeArtboard.name}»
              </span>
              <div className="grid grid-cols-4 gap-1">
                {(['svg', 'png', 'ai', 'psd'] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => onExportArtboard(kind, activeArtboard.id)}
                    className="h-7 rounded border border-paper-border bg-paper-bg font-display text-[11px] uppercase text-paper-ink hover:bg-paper-hover"
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : singleLayer ? (
        <div className="flex flex-col gap-3 p-3">
          <InspectorTransform
            layer={singleLayer}
            layerIndex={singleIndex}
            totalLayers={singleScope.length}
            onUpdateLayers={onUpdateLayers}
            onAlignLayers={onAlignLayers}
            onFlipLayers={onFlipLayers}
            onReorderLayer={onReorderLayer}
          />

          {singleLayer.type === 'group' && (
            <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-paper-muted">Группа</span>
                <span className="font-display text-paper-ink">
                  {singleLayer.children.length} сл.
                </span>
              </div>
              <button
                type="button"
                onClick={() => onEnterGroup(singleLayer.id)}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
              >
                <FolderOpen className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
                <span>Войти в группу</span>
              </button>
              <button
                type="button"
                onClick={() => onUngroupLayers([singleLayer.id])}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
              >
                <Ungroup className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
                <span>Разгруппировать (Ctrl+Shift+G)</span>
              </button>
            </div>
          )}

          {singleLayer.type === 'path' && (
            <>
              <InspectorAppearance
                layer={singleLayer}
                documentColors={documentColors}
                onUpdateLayers={onUpdateLayers}
              />
              <InspectorVectorOps
                layer={singleLayer}
                onSmoothLayers={onSmoothLayers}
                onSimplifyLayers={onSimplifyLayers}
                onWobbleLayers={onWobbleLayers}
                onOffsetLayers={onOffsetLayers}
                onOutlineStroke={onOutlineStroke}
                onSplitCompound={onSplitCompound}
                onCreateTextOnPath={onCreateTextOnPath}
              />
            </>
          )}

          {singleLayer.type === 'text' && (
            <InspectorText
              layer={singleLayer}
              documentColors={documentColors}
              availablePaths={availablePaths}
              onUpdateLayers={onUpdateLayers}
              onEditTextOnCanvas={onEditTextOnCanvas}
              onTransformTextCase={onTransformTextCase}
              onConvertToOutlines={onConvertToOutlines}
              onSplitText={onSplitText}
              onAttachTextToPath={onAttachTextToPath}
              onDetachTextFromPath={onDetachTextFromPath}
              onApplyTextPathArc={onApplyTextPathArc}
              onUploadFont={onUploadFont}
            />
          )}

          {singleLayer.type === 'image' && (
            <div className="flex flex-col gap-2 border-t border-paper-border pt-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-paper-muted">Исходный размер</span>
                <span className="font-display text-paper-ink">
                  {singleLayer.width} × {singleLayer.height} px
                </span>
              </div>
              <button
                type="button"
                onClick={() => onReplaceImage(singleLayer.id)}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
              >
                <ImagePlus className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
                <span>Заменить изображение</span>
              </button>

              <div className="mt-1 flex flex-col gap-2 border-t border-paper-border pt-2.5">
                <span className="text-[11px] font-medium text-paper-muted">
                  Векторизация (Image Trace)
                </span>
                <div className="flex gap-1">
                  <SegmentedButton
                    active={traceMode === 'bw'}
                    label="Силуэт (Ч/Б)"
                    onClick={() => setTraceMode('bw')}
                  />
                  <SegmentedButton
                    active={traceMode === 'color'}
                    label="Цвета"
                    onClick={() => setTraceMode('color')}
                  />
                </div>
                {traceMode === 'bw' ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[11px] text-paper-muted">
                        <span>Порог яркости</span>
                        <span className="font-display text-paper-ink">{traceThreshold}</span>
                      </div>
                      <Slider
                        value={traceThreshold}
                        min={20}
                        max={235}
                        step={5}
                        ariaLabel="Порог яркости"
                        onChange={setTraceThreshold}
                      />
                    </div>
                    <Checkbox
                      checked={traceInvert}
                      onChange={setTraceInvert}
                      label="Инвертировать (светлое на тёмном)"
                    />
                  </>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px] text-paper-muted">
                      <span>Палитра цветов</span>
                      <span className="font-display text-paper-ink">{traceColors}</span>
                    </div>
                    <Slider
                      value={traceColors}
                      min={2}
                      max={8}
                      step={1}
                      ariaLabel="Количество цветов трассировки"
                      onChange={setTraceColors}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-paper-muted">
                    <span>Сглаживание</span>
                    <span className="font-display text-paper-ink">
                      {traceSimplify.toFixed(1)}
                    </span>
                  </div>
                  <Slider
                    value={traceSimplify}
                    min={0.5}
                    max={6}
                    step={0.1}
                    ariaLabel="Сглаживание трассировки"
                    onChange={setTraceSimplify}
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onTraceImage(singleLayer.id, {
                      mode: traceMode,
                      threshold: traceThreshold,
                      colors: traceColors,
                      invert: traceInvert,
                      simplify: traceSimplify,
                    })
                  }
                  className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-accent/40 bg-paper-accent/10 text-[12px] font-medium text-paper-ink hover:bg-paper-accent/20"
                >
                  <Wand2 className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
                  <span>Векторизовать</span>
                </button>
              </div>
            </div>
          )}

          {(singleLayer.type === 'path' || singleLayer.clipMaskId) && (
            <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
              <span className="text-[11px] font-medium text-paper-muted">
                Обтравочная маска
              </span>
              {singleLayer.type === 'path' &&
                (isLayerActiveMask(singleLayer) ? (
                  <button
                    type="button"
                    onClick={() => onReleaseClipMask(singleLayer.id)}
                    className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
                  >
                    <Unlink className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
                    <span>Снять обтравочную маску</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={singleIndex <= 0}
                    onClick={() => onCreateClipMask([singleLayer.id])}
                    className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover disabled:opacity-40"
                  >
                    <Crop className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
                    <span>Сделать маской слоя ниже</span>
                  </button>
                ))}
              {singleLayer.clipMaskId && (
                <button
                  type="button"
                  onClick={() => onDetachFromMask(singleLayer.id)}
                  className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
                >
                  <Unlink className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
                  <span>Открепить от маски</span>
                </button>
              )}
            </div>
          )}

          <InspectorEffects
            layers={[singleLayer]}
            focusedEffect={focusedEffect}
            onConsumeFocus={onConsumeFocusedEffect}
            onUpdateEffects={onUpdateEffects}
            onExpandAppearance={onExpandAppearance}
          />

          <div data-tour="inspector.export" className="flex gap-2 border-t border-paper-border pt-2.5">
            <button
              type="button"
              onClick={onCopySvg}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
            >
              <FileCode2 className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
              <span>Копировать SVG</span>
            </button>
            <button
              type="button"
              onClick={onExportSelectionRaster}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
            >
              <Download className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
              <span>Экспорт PNG</span>
            </button>
          </div>

          <div className="flex gap-2 border-t border-paper-border pt-2.5">
            <button
              type="button"
              onClick={() => onDuplicateLayers([singleLayer.id])}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
            >
              <Copy className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
              <span>Дубль</span>
            </button>
            <button
              type="button"
              onClick={() => onDeleteLayers([singleLayer.id])}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-danger hover:bg-paper-hover"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Удалить</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <div className="grid grid-cols-2 items-end gap-2">
            <NumberField
              label="Непрозр. (%)"
              value={Math.round(selectedLayers[0].opacity * 100)}
              min={0}
              max={100}
              onCommit={(pct) =>
                onUpdateLayers(
                  selectedLayers.map((l) => l.id),
                  { opacity: clamp(pct / 100, 0, 1) }
                )
              }
            />
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-paper-muted">Наложение</span>
              <Select
                ariaLabel="Режим наложения"
                value={selectedLayers[0].blendMode ?? 'normal'}
                options={BLEND_MODE_OPTIONS}
                onChange={(mode) =>
                  onUpdateLayers(
                    selectedLayers.map((l) => l.id),
                    { blendMode: mode as BlendMode }
                  )
                }
              />
            </div>
          </div>

          <AlignSection
            layerIds={selectedIds}
            canDistribute={selectedLayers.length >= 3}
            onAlign={onAlignLayers}
            onFlip={onFlipLayers}
          />

          <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
            <button
              type="button"
              onClick={() => onGroupLayers(selectedIds)}
              className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
            >
              <Group className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
              <span>Сгруппировать (Ctrl+G)</span>
            </button>
            {selectedLayers.some((l) => l.type === 'group') && (
              <button
                type="button"
                onClick={() => onUngroupLayers(selectedIds)}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
              >
                <Ungroup className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
                <span>Разгруппировать (Ctrl+Shift+G)</span>
              </button>
            )}
          </div>

          {selectedTextIds.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
              <span className="text-[11px] font-medium text-paper-muted">
                Текст ({selectedTextIds.length})
              </span>
              {pairText && pairPath && (
                <button
                  type="button"
                  onClick={() => onAttachTextToPath(pairText.id, pairPath.id)}
                  className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-accent/40 bg-paper-accent/10 text-[12px] font-medium text-paper-ink hover:bg-paper-accent/20"
                >
                  <Spline className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
                  <span>Пустить текст по контуру</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onConvertToOutlines(selectedIds)}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
              >
                <Spline className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
                <span>Текст в кривые (Ctrl+Shift+O)</span>
              </button>
            </div>
          )}

          <InspectorMultiVectorOps
            selectedIds={selectedIds}
            allSelectedArePaths={allSelectedArePaths}
            onBooleanOp={onBooleanOp}
            onCombineCompound={onCombineCompound}
          />

          <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
            <span className="text-[11px] font-medium text-paper-muted">
              Обтравочная маска
            </span>
            <button
              type="button"
              disabled={selectedPathIds.length === 0}
              onClick={() => onCreateClipMask(selectedIds)}
              className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover disabled:opacity-40"
            >
              <Crop className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
              <span>Создать обтравочную маску</span>
            </button>
            {hasSelectedMaskOrMasked && (
              <button
                type="button"
                onClick={() => {
                  const releasedMasks = new Set<string>();
                  for (const layer of selectedLayers) {
                    if (isLayerActiveMask(layer)) {
                      releasedMasks.add(layer.id);
                      onReleaseClipMask(layer.id);
                    }
                  }
                  for (const layer of selectedLayers) {
                    if (layer.clipMaskId && !releasedMasks.has(layer.clipMaskId)) {
                      onDetachFromMask(layer.id);
                    }
                  }
                }}
                className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
              >
                <Unlink className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
                <span>Снять маску</span>
              </button>
            )}
          </div>

          {selectedPathIds.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
              <span className="text-[11px] font-medium text-paper-muted">
                Общая заливка ({selectedPathIds.length})
              </span>
              <div className="flex items-center gap-2">
                <ColorField
                  value={getPrimaryColor(
                    selectedLayers.find(
                      (l): l is PathLayer => l.type === 'path' && l.fill !== null
                    )?.fill,
                    '#da7756'
                  )}
                  ariaLabel="Общая заливка"
                  onChange={(fill) => onUpdateLayers(selectedPathIds, { fill })}
                />
                <button
                  type="button"
                  onClick={() => onSmoothLayers(selectedPathIds)}
                  className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
                >
                  <Sparkles className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
                  <span>Сгладить все</span>
                </button>
              </div>
              <DocumentColorSwatches
                colors={documentColors}
                onSelect={(fill) => onUpdateLayers(selectedPathIds, { fill })}
              />
            </div>
          )}

          <InspectorEffects
            layers={selectedLayers}
            focusedEffect={focusedEffect}
            onConsumeFocus={onConsumeFocusedEffect}
            onUpdateEffects={onUpdateEffects}
            onExpandAppearance={onExpandAppearance}
          />

          <div data-tour="inspector.export" className="flex gap-2 border-t border-paper-border pt-2.5">
            <button
              type="button"
              onClick={onCopySvg}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
            >
              <FileCode2 className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
              <span>Копировать SVG</span>
            </button>
            <button
              type="button"
              onClick={onExportSelectionRaster}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
            >
              <Download className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
              <span>Экспорт PNG</span>
            </button>
          </div>

          <div className="flex gap-2 border-t border-paper-border pt-2.5">
            <button
              type="button"
              onClick={() => onDuplicateLayers(selectedIds)}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
            >
              <Copy className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
              <span>Дубль</span>
            </button>
            <button
              type="button"
              onClick={() => onDeleteLayers(selectedIds)}
              className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-danger hover:bg-paper-hover"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Удалить</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
