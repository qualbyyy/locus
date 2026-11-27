import {
  Copy,
  Crop,
  Download,
  FileCode2,
  Group,
  Sparkles,
  Spline,
  Trash2,
  Ungroup,
  Unlink,
} from 'lucide-react';
import type { AlignMode } from '../../core/commands';
import { clamp } from '../../core/math';
import { BLEND_MODE_OPTIONS, getPrimaryColor } from '../../core/paint';
import type {
  BlendMode,
  Layer,
  LayerEffects,
  PathLayer,
  TextLayer,
} from '../../core/types';
import type { BooleanOp } from '../../engine/booleans';
import { AlignSection, NumberField } from '../InspectorControls';
import { ColorField, Select } from '../controls';
import { DocumentColorSwatches } from './InspectorAppearance';
import { InspectorEffects, type EffectTarget } from './InspectorEffects';
import { InspectorMultiVectorOps } from './InspectorVectorOps';

export interface InspectorMultiSelectProps {
  selectedIds: string[];
  selectedLayers: Layer[];
  documentColors: string[];
  isLayerActiveMask: (layer: Layer) => boolean;
  focusedEffect: EffectTarget | null;
  onConsumeFocusedEffect: () => void;
  onUpdateLayers: (
    layerIds: string[],
    patch: Partial<Layer> | ((layer: Layer) => Layer)
  ) => void;
  onAlignLayers: (layerIds: string[], mode: AlignMode) => void;
  onFlipLayers: (layerIds: string[], axis: 'horizontal' | 'vertical') => void;
  onGroupLayers: (layerIds: string[]) => void;
  onUngroupLayers: (layerIds: string[]) => void;
  onAttachTextToPath: (textLayerId: string, pathLayerId: string) => void;
  onConvertToOutlines: (layerIds: string[]) => void;
  onBooleanOp: (layerIds: string[], operation: BooleanOp) => void;
  onCombineCompound: (layerIds: string[]) => void;
  onCreateClipMask: (layerIds: string[]) => void;
  onReleaseClipMask: (maskId: string) => void;
  onDetachFromMask: (layerId: string) => void;
  onSmoothLayers: (layerIds: string[]) => void;
  onUpdateEffects: (layerIds: string[], patch: Partial<LayerEffects> | null) => void;
  onExpandAppearance: (layerIds: string[]) => void;
  onCopySvg: () => void;
  onExportSelectionRaster: () => void;
  onDuplicateLayers: (layerIds: string[]) => void;
  onDeleteLayers: (layerIds: string[]) => void;
}

export function InspectorMultiSelect({
  selectedIds,
  selectedLayers,
  documentColors,
  isLayerActiveMask,
  focusedEffect,
  onConsumeFocusedEffect,
  onUpdateLayers,
  onAlignLayers,
  onFlipLayers,
  onGroupLayers,
  onUngroupLayers,
  onAttachTextToPath,
  onConvertToOutlines,
  onBooleanOp,
  onCombineCompound,
  onCreateClipMask,
  onReleaseClipMask,
  onDetachFromMask,
  onSmoothLayers,
  onUpdateEffects,
  onExpandAppearance,
  onCopySvg,
  onExportSelectionRaster,
  onDuplicateLayers,
  onDeleteLayers,
}: InspectorMultiSelectProps) {
  const pairText =
    selectedLayers.length === 2
      ? selectedLayers.find((l): l is TextLayer => l.type === 'text' && !l.locked)
      : undefined;
  const pairPath =
    selectedLayers.length === 2
      ? selectedLayers.find((l): l is PathLayer => l.type === 'path' && !l.locked)
      : undefined;

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

  return (
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
  );
}
