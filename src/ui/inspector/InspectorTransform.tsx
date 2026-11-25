import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Link2,
  Link2Off,
} from 'lucide-react';
import type { AlignMode } from '../../core/commands';
import { clamp, computeLayerLocalBBox } from '../../core/math';
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
  const [lockAspect, setLockAspect] = useState(false);
  const localBox = computeLayerLocalBBox(layer);
  const canEditW = localBox.width > 1e-4;
  const canEditH = localBox.height > 1e-4;
  const baseW = canEditW ? localBox.width : 1;
  const baseH = canEditH ? localBox.height : 1;
  const curW = canEditW ? Math.abs(layer.scaleX) * baseW : 0;
  const curH = canEditH ? Math.abs(layer.scaleY) * baseH : 0;

  const aspectRatioRef = useRef<number>(curH > 1e-4 ? curW / curH : 1);

  useEffect(() => {
    if (!lockAspect && curW > 1e-4 && curH > 1e-4) {
      aspectRatioRef.current = curW / curH;
    }
  }, [layer.id, lockAspect, curW, curH]);

  const toggleLockAspect = () => {
    if (!lockAspect && curW > 1e-4 && curH > 1e-4) {
      aspectRatioRef.current = curW / curH;
    }
    setLockAspect((prev) => !prev);
  };

  const commitDimension = (axis: 'w' | 'h', nextValue: number) => {
    const signX = layer.scaleX < 0 ? -1 : 1;
    const signY = layer.scaleY < 0 ? -1 : 1;
    const ratio = Math.max(1e-4, aspectRatioRef.current);

    if (axis === 'w') {
      if (!canEditW) return;
      const safeW = Math.max(0.02 * baseW, nextValue);
      const nextScaleX = signX * Math.max(0.02, safeW / baseW);
      if (lockAspect && canEditH) {
        const nextScaleY = signY * Math.max(0.02, safeW / ratio / baseH);
        onUpdateLayers([layer.id], { scaleX: nextScaleX, scaleY: nextScaleY });
      } else {
        onUpdateLayers([layer.id], { scaleX: nextScaleX });
      }
      return;
    }

    if (!canEditH) return;
    const safeH = Math.max(0.02 * baseH, nextValue);
    const nextScaleY = signY * Math.max(0.02, safeH / baseH);
    if (lockAspect && canEditW) {
      const nextScaleX = signX * Math.max(0.02, (safeH * ratio) / baseW);
      onUpdateLayers([layer.id], { scaleX: nextScaleX, scaleY: nextScaleY });
    } else {
      onUpdateLayers([layer.id], { scaleY: nextScaleY });
    }
  };

  return (
    <div data-tour="inspector.transform" className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
        <NumberField
          label="W (px)"
          value={curW}
          min={canEditW ? 1 : 0}
          decimals={1}
          onCommit={(w) => commitDimension('w', w)}
        />
        <button
          type="button"
          onClick={toggleLockAspect}
          aria-label={lockAspect ? 'Отвязать пропорции' : 'Связать пропорции'}
          aria-pressed={lockAspect}
          title={lockAspect ? 'Пропорции связаны' : 'Связать пропорции W / H'}
          className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
            lockAspect
              ? 'border-paper-accent bg-paper-accent/15 text-paper-accent'
              : 'border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
          }`}
        >
          {lockAspect ? (
            <Link2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Link2Off className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
        <NumberField
          label="H (px)"
          value={curH}
          min={canEditH ? 1 : 0}
          decimals={1}
          onCommit={(h) => commitDimension('h', h)}
        />
      </div>

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
