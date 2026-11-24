import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Copy,
  Crop,
  ImagePlus,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';
import type { AlignMode, TextCaseMode } from '../core/commands';
import { clamp } from '../core/math';
import {
  DOCUMENT_PRESETS,
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
import { hasAnyEffects, hasVectorEffects } from '../engine/effects';
import type { EffectModalTarget } from './EffectModal';
import { AlignSection, HexColorRow, NumberField } from './InspectorControls';
import { ColorField, Slider } from './controls';
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
  activeTool: ToolType;
  smartShapeOptions: SmartShapeOptions;
  onChangeSmartShapeOptions: (patch: Partial<SmartShapeOptions>) => void;
  onUpdateArtboard: (
    patch: Partial<Pick<Scene, 'width' | 'height' | 'dpi' | 'background'>>
  ) => void;
  onImportBackgroundImage: () => void;
  onUpdateLayers: (
    layerIds: string[],
    patch: Partial<Layer> | ((layer: Layer) => Layer)
  ) => void;
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
  onEditTextOnCanvas: (layerId: string) => void;
  onTransformTextCase: (layerIds: string[], mode: TextCaseMode) => void;
  onConvertToOutlines: (layerIds: string[]) => void;
  onSplitCompound: (layerIds: string[]) => void;
  onCombineCompound: (layerIds: string[]) => void;
  onOffsetLayers: (layerIds: string[], distance: number, copyBehind: boolean) => void;
  onOutlineStroke: (layerIds: string[]) => void;
  onSimplifyLayers: (layerIds: string[]) => void;
  onOpenEffect: (target: EffectModalTarget) => void;
  onUpdateEffects: (layerIds: string[], patch: Partial<LayerEffects> | null) => void;
  onExpandAppearance: (layerIds: string[]) => void;
}

const SHAPE_PRESETS: Array<{ id: SmartShapePreset; label: string }> = [
  { id: 'blob', label: 'Клякса' },
  { id: 'ellipse', label: 'Овал' },
  { id: 'rect', label: 'Прям.' },
  { id: 'polygon', label: 'Полигон' },
  { id: 'star', label: 'Звезда' },
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
                  <div className="font-mono text-[10px] text-paper-muted">
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

export function Inspector({
  scene,
  selectedIds,
  activeTool,
  smartShapeOptions,
  onChangeSmartShapeOptions,
  onUpdateArtboard,
  onImportBackgroundImage,
  onUpdateLayers,
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
  onEditTextOnCanvas,
  onTransformTextCase,
  onConvertToOutlines,
  onSplitCompound,
  onCombineCompound,
  onOffsetLayers,
  onOutlineStroke,
  onSimplifyLayers,
  onOpenEffect,
  onUpdateEffects,
  onExpandAppearance,
}: InspectorProps) {
  const selectedSet = new Set(selectedIds);
  const selectedLayers = scene.layers.filter((layer) => selectedSet.has(layer.id));
  const singleLayer = selectedLayers.length === 1 ? selectedLayers[0] : null;
  const singleIndex = singleLayer
    ? scene.layers.findIndex((l) => l.id === singleLayer.id)
    : -1;

  const referencedMaskIds = new Set<string>();
  for (const layer of scene.layers) {
    if (layer.clipMaskId) {
      referencedMaskIds.add(layer.clipMaskId);
    }
  }

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
    <section className="flex flex-1 flex-col overflow-y-auto bg-paper-panel">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-paper-border px-3">
        <SlidersHorizontal className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
        <span className="truncate text-[12px] font-semibold text-paper-ink">
          {selectedLayers.length === 0
            ? 'Артборд'
            : selectedLayers.length === 1
              ? singleLayer?.name
              : `Выделено: ${selectedLayers.length}`}
        </span>
      </div>

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
                <span className="font-mono text-paper-ink">{smartShapeOptions.points}</span>
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
                <span className="font-mono text-paper-ink">
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
                <span className="font-mono text-paper-ink">
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
          <ArtboardPresetSelect
            width={scene.width}
            height={scene.height}
            dpi={scene.dpi}
            onSelect={(patch) => onUpdateArtboard(patch)}
          />

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
            <NumberField
              label="Ширина (px)"
              value={scene.width}
              min={64}
              max={16000}
              onCommit={(width) => onUpdateArtboard({ width })}
            />
            <button
              type="button"
              onClick={() =>
                onUpdateArtboard({ width: scene.height, height: scene.width })
              }
              title="Поменять ширину и высоту местами"
              className="flex h-7 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <NumberField
              label="Высота (px)"
              value={scene.height}
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
              value={scene.background}
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
        </div>
      ) : singleLayer ? (
        <div className="flex flex-col gap-3 p-3">
          <InspectorTransform
            layer={singleLayer}
            layerIndex={singleIndex}
            totalLayers={scene.layers.length}
            onUpdateLayers={onUpdateLayers}
            onAlignLayers={onAlignLayers}
            onFlipLayers={onFlipLayers}
            onReorderLayer={onReorderLayer}
          />

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
              />
            </>
          )}

          {singleLayer.type === 'text' && (
            <InspectorText
              layer={singleLayer}
              documentColors={documentColors}
              onUpdateLayers={onUpdateLayers}
              onEditTextOnCanvas={onEditTextOnCanvas}
              onTransformTextCase={onTransformTextCase}
              onConvertToOutlines={onConvertToOutlines}
            />
          )}

          {singleLayer.type === 'image' && (
            <div className="flex flex-col gap-2 border-t border-paper-border pt-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-paper-muted">Исходный размер</span>
                <span className="font-mono text-paper-ink">
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

          {hasAnyEffects(singleLayer.effects) && (
            <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-paper-muted">Эффекты</span>
                <button
                  type="button"
                  onClick={() => onUpdateEffects([singleLayer.id], null)}
                  className="text-[11px] text-paper-muted hover:text-paper-danger"
                >
                  Очистить
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {singleLayer.effects?.warp && (
                  <div className="flex items-center justify-between rounded border border-paper-border bg-paper-bg px-2 py-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => onOpenEffect({ kind: 'warp' })}
                      className="flex-1 text-left text-paper-ink hover:text-paper-accent"
                    >
                      Деформация: {singleLayer.effects.warp.style} ({singleLayer.effects.warp.bend}%)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateEffects([singleLayer.id], { warp: undefined })}
                      className="text-paper-muted hover:text-paper-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {singleLayer.effects?.distort && (
                  <div className="flex items-center justify-between rounded border border-paper-border bg-paper-bg px-2 py-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenEffect({ kind: singleLayer.effects!.distort!.kind })
                      }
                      className="flex-1 text-left text-paper-ink hover:text-paper-accent"
                    >
                      Искажение: {singleLayer.effects.distort.kind}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateEffects([singleLayer.id], { distort: undefined })}
                      className="text-paper-muted hover:text-paper-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {singleLayer.effects?.effect3d && (
                  <div className="flex items-center justify-between rounded border border-paper-border bg-paper-bg px-2 py-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenEffect({
                          kind:
                            singleLayer.effects!.effect3d!.kind === 'extrude'
                              ? '3d-extrude'
                              : '3d-rotate',
                        })
                      }
                      className="flex-1 text-left text-paper-ink hover:text-paper-accent"
                    >
                      3D: {singleLayer.effects.effect3d.kind === 'extrude' ? 'Выдавливание' : 'Поворот'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateEffects([singleLayer.id], { effect3d: undefined })}
                      className="text-paper-muted hover:text-paper-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {singleLayer.effects?.blur !== undefined && singleLayer.effects.blur > 0 && (
                  <div className="flex items-center justify-between rounded border border-paper-border bg-paper-bg px-2 py-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => onOpenEffect({ kind: 'blur' })}
                      className="flex-1 text-left text-paper-ink hover:text-paper-accent"
                    >
                      Размытие: {singleLayer.effects.blur} px
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateEffects([singleLayer.id], { blur: undefined })}
                      className="text-paper-muted hover:text-paper-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {singleLayer.effects?.dropShadow && (
                  <div className="flex items-center justify-between rounded border border-paper-border bg-paper-bg px-2 py-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => onOpenEffect({ kind: 'dropShadow' })}
                      className="flex-1 text-left text-paper-ink hover:text-paper-accent"
                    >
                      Тень ({singleLayer.effects.dropShadow.blur} px)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateEffects([singleLayer.id], { dropShadow: undefined })}
                      className="text-paper-muted hover:text-paper-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {singleLayer.effects?.outerGlow && (
                  <div className="flex items-center justify-between rounded border border-paper-border bg-paper-bg px-2 py-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => onOpenEffect({ kind: 'outerGlow' })}
                      className="flex-1 text-left text-paper-ink hover:text-paper-accent"
                    >
                      Свечение ({singleLayer.effects.outerGlow.blur} px)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateEffects([singleLayer.id], { outerGlow: undefined })}
                      className="text-paper-muted hover:text-paper-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {singleLayer.type === 'path' && hasVectorEffects(singleLayer.effects) && (
                <button
                  type="button"
                  onClick={() => onExpandAppearance([singleLayer.id])}
                  className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
                >
                  <Sparkles className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
                  <span>Разобрать оформление</span>
                </button>
              )}
            </div>
          )}

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
          <NumberField
            label="Общая непрозрачность (%)"
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

          <AlignSection
            layerIds={selectedIds}
            canDistribute={selectedLayers.length >= 3}
            onAlign={onAlignLayers}
            onFlip={onFlipLayers}
          />

          {selectedTextIds.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
              <span className="text-[11px] font-medium text-paper-muted">
                Текст ({selectedTextIds.length})
              </span>
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
                  value={
                    selectedLayers.find(
                      (l): l is PathLayer => l.type === 'path' && l.fill !== null
                    )?.fill ?? '#da7756'
                  }
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
