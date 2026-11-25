import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { AlignMode } from '../../core/commands';
import { clamp } from '../../core/math';
import { BLEND_MODE_OPTIONS } from '../../core/paint';
import type { BlendMode, Layer } from '../../core/types';
import { Select } from '../controls';
import { AlignSection, NumberField } from '../InspectorControls';

interface InspectorTransformProps {
  layer: Layer;
  layerIndex: number;
  totalLayers: number;
  onUpdateLayers: (
    layerIds: string[],
    patch: Partial<Layer> | ((layer: Layer) => Layer)
  ) => void;
  onAlignLayers: (layerIds: string[], mode: AlignMode) => void;
  onFlipLayers: (layerIds: string[], axis: 'horizontal' | 'vertical') => void;
  onReorderLayer: (
    layerId: string,
    mode: 'front' | 'back' | 'forward' | 'backward'
  ) => void;
}

export function InspectorTransform({
  layer,
  layerIndex,
  totalLayers,
  onUpdateLayers,
  onAlignLayers,
  onFlipLayers,
  onReorderLayer,
}: InspectorTransformProps) {
  return (
    <div data-tour="inspector.transform" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="X"
          value={layer.x}
          decimals={1}
          onCommit={(x) => onUpdateLayers([layer.id], { x })}
        />
        <NumberField
          label="Y"
          value={layer.y}
          decimals={1}
          onCommit={(y) => onUpdateLayers([layer.id], { y })}
        />
        <NumberField
          label="Поворот (°)"
          value={layer.rotation}
          decimals={1}
          onCommit={(rotation) => onUpdateLayers([layer.id], { rotation })}
        />
        <NumberField
          label="Непрозр. (%)"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          onCommit={(pct) =>
            onUpdateLayers([layer.id], { opacity: clamp(pct / 100, 0, 1) })
          }
        />
        <NumberField
          label="Масштаб X"
          value={layer.scaleX}
          step={0.1}
          decimals={2}
          onCommit={(scaleX) =>
            onUpdateLayers([layer.id], {
              scaleX: Math.abs(scaleX) < 0.02 ? 0.02 : scaleX,
            })
          }
        />
        <NumberField
          label="Масштаб Y"
          value={layer.scaleY}
          step={0.1}
          decimals={2}
          onCommit={(scaleY) =>
            onUpdateLayers([layer.id], {
              scaleY: Math.abs(scaleY) < 0.02 ? 0.02 : scaleY,
            })
          }
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Режим наложения</span>
        <Select
          ariaLabel="Режим наложения"
          value={layer.blendMode ?? 'normal'}
          options={BLEND_MODE_OPTIONS}
          onChange={(mode) =>
            onUpdateLayers([layer.id], { blendMode: mode as BlendMode })
          }
        />
      </div>

      <AlignSection
        layerIds={[layer.id]}
        canDistribute={false}
        onAlign={onAlignLayers}
        onFlip={onFlipLayers}
      />

      <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
        <span className="text-[11px] font-medium text-paper-muted">
          Порядок слоёв
        </span>
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            disabled={layerIndex >= totalLayers - 1}
            title="На передний план"
            onClick={() => onReorderLayer(layer.id, 'front')}
            className="flex h-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover disabled:opacity-40"
          >
            <ArrowUpToLine className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            disabled={layerIndex >= totalLayers - 1}
            title="Выше (])"
            onClick={() => onReorderLayer(layer.id, 'forward')}
            className="flex h-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover disabled:opacity-40"
          >
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            disabled={layerIndex <= 0}
            title="Ниже ([)"
            onClick={() => onReorderLayer(layer.id, 'backward')}
            className="flex h-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover disabled:opacity-40"
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            disabled={layerIndex <= 0}
            title="На задний план"
            onClick={() => onReorderLayer(layer.id, 'back')}
            className="flex h-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover disabled:opacity-40"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
