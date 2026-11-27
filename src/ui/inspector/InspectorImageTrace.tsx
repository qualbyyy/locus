import { useState } from 'react';
import { ImagePlus, Wand2 } from 'lucide-react';
import type { ImageLayer } from '../../core/types';
import type { ImageTraceOptions } from '../../engine/imageTrace';
import { SegmentedButton } from '../InspectorControls';
import { Checkbox, Slider } from '../controls';

export interface InspectorImageTraceProps {
  layer: ImageLayer;
  onReplaceImage: (layerId: string) => void;
  onTraceImage: (layerId: string, options: Partial<ImageTraceOptions>) => void;
}

export function InspectorImageTrace({
  layer,
  onReplaceImage,
  onTraceImage,
}: InspectorImageTraceProps) {
  const [traceMode, setTraceMode] = useState<'bw' | 'color'>('bw');
  const [traceThreshold, setTraceThreshold] = useState(140);
  const [traceColors, setTraceColors] = useState(4);
  const [traceInvert, setTraceInvert] = useState(false);
  const [traceSimplify, setTraceSimplify] = useState(1.8);

  return (
    <div className="flex flex-col gap-2 border-t border-paper-border pt-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-paper-muted">Исходный размер</span>
        <span className="font-display text-paper-ink">
          {layer.width} × {layer.height} px
        </span>
      </div>
      <button
        type="button"
        onClick={() => onReplaceImage(layer.id)}
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
            onTraceImage(layer.id, {
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
  );
}
