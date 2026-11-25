import { useState, type MouseEvent } from 'react';
import { ArrowLeftRight, Crosshair, Trash2 } from 'lucide-react';
import { clamp } from '../../core/math';
import {
  clonePaint,
  createDefaultLinearGradient,
  createDefaultRadialGradient,
  getGradientAngleDeg,
  getPrimaryColor,
  gradientToCss,
  isGradientPaint,
  normalizeGradientStops,
  setGradientAngleDeg,
} from '../../core/paint';
import { isValidHexColor, hexToRgb } from '../../core/themes';
import { flattenLayers } from '../../core/layerTree';
import type { GradientPaint, Paint, Scene } from '../../core/types';
import { HexColorRow, NumberField, SegmentedButton } from '../InspectorControls';

function addUniqueColor(seen: Set<string>, paint: Paint | null | undefined, max: number): void {
  if (!paint || seen.size >= max) return;
  if (typeof paint === 'string') {
    const normalized = paint.trim().toLowerCase();
    if (isValidHexColor(normalized)) {
      seen.add(normalized);
    }
    return;
  }
  for (const stop of paint.stops) {
    if (seen.size >= max) break;
    const normalized = stop.color.trim().toLowerCase();
    if (isValidHexColor(normalized)) {
      seen.add(normalized);
    }
  }
}

export function collectDocumentColors(scene: Scene, maxColors = 16): string[] {
  const seen = new Set<string>();
  for (const layer of flattenLayers(scene.layers)) {
    if (layer.type === 'path') {
      addUniqueColor(seen, layer.fill, maxColors);
      addUniqueColor(seen, layer.stroke?.color, maxColors);
    } else if (layer.type === 'text') {
      addUniqueColor(seen, layer.fill, maxColors);
    }
    if (seen.size >= maxColors) break;
  }
  if (seen.size < maxColors) {
    addUniqueColor(seen, scene.background, maxColors);
  }
  return Array.from(seen).slice(0, maxColors);
}

export function DocumentColorSwatches({
  colors,
  activeColor,
  onSelect,
}: {
  colors: string[];
  activeColor?: string | null;
  onSelect: (hex: string) => void;
}) {
  if (colors.length === 0) return null;
  const activeNormalized = activeColor?.toLowerCase() ?? null;

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <span className="text-[10px] text-paper-muted">Цвета документа</span>
      <div className="flex flex-wrap gap-1">
        {colors.map((hex) => {
          const isCurrent = activeNormalized === hex;
          return (
            <button
              key={hex}
              type="button"
              title={`Применить ${hex}`}
              onClick={() => onSelect(hex)}
              style={{ backgroundColor: hex }}
              className={`h-4 w-4 rounded-sm border transition-transform hover:scale-110 ${
                isCurrent
                  ? 'border-paper-accent ring-1 ring-paper-accent'
                  : 'border-paper-border'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function interpolateHex(c1: string, c2: string, t: number): string {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  if (!a || !b) return c1;
  const r = Math.round(a.r + (b.r - a.r) * t)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(a.g + (b.g - a.g) * t)
    .toString(16)
    .padStart(2, '0');
  const bl = Math.round(a.b + (b.b - a.b) * t)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${bl}`;
}

function sampleGradientColorAt(grad: GradientPaint, offset: number): string {
  const stops = normalizeGradientStops(grad.stops);
  if (offset <= stops[0].offset) return stops[0].color;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (offset <= b.offset) {
      const span = Math.max(1e-6, b.offset - a.offset);
      return interpolateHex(a.color, b.color, clamp((offset - a.offset) / span, 0, 1));
    }
  }
  return stops[stops.length - 1].color;
}

export function PaintEditor({
  value,
  onChange,
  documentColors = [],
  onFocusGradient,
}: {
  value: Paint;
  onChange: (next: Paint) => void;
  documentColors?: string[];
  onFocusGradient?: () => void;
}) {
  const [selectedStopIdx, setSelectedStopIdx] = useState(0);
  const mode: 'solid' | 'linear' | 'radial' = isGradientPaint(value)
    ? value.kind
    : 'solid';

  const switchMode = (target: 'solid' | 'linear' | 'radial') => {
    if (target === mode) return;
    if (target === 'solid') {
      onChange(getPrimaryColor(value));
      return;
    }
    onFocusGradient?.();
    if (isGradientPaint(value)) {
      const next = clonePaint(value);
      next.kind = target;
      if (target === 'radial') {
        next.start = { x: 0.5, y: 0.5 };
        next.end = { x: 1, y: 0.5 };
      } else {
        next.start = { x: 0, y: 0.5 };
        next.end = { x: 1, y: 0.5 };
      }
      onChange(next);
      return;
    }
    onChange(
      target === 'linear'
        ? createDefaultLinearGradient(value)
        : createDefaultRadialGradient(value)
    );
    setSelectedStopIdx(0);
  };

  if (!isGradientPaint(value)) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1">
          <SegmentedButton
            active={true}
            label="Цвет"
            onClick={() => switchMode('solid')}
          />
          <SegmentedButton
            active={false}
            label="Линейный"
            onClick={() => switchMode('linear')}
          />
          <SegmentedButton
            active={false}
            label="Радиальный"
            onClick={() => switchMode('radial')}
          />
        </div>
        <HexColorRow value={value} onChange={onChange} />
        <DocumentColorSwatches
          colors={documentColors}
          activeColor={value}
          onSelect={onChange}
        />
      </div>
    );
  }

  const stops = normalizeGradientStops(value.stops);
  const safeIdx = clamp(selectedStopIdx, 0, stops.length - 1);
  const activeStop = stops[safeIdx];

  const updateStop = (
    idx: number,
    patch: Partial<{ color: string; offset: number; opacity: number }>
  ) => {
    onFocusGradient?.();
    const targetStop = stops[idx];
    const nextRaw = stops.map((s, i) => {
      if (i !== idx) return { ...s };
      const updated = { ...s, ...patch };
      if (updated.opacity !== undefined && updated.opacity >= 0.999) {
        delete updated.opacity;
      }
      return updated;
    });
    const sorted = normalizeGradientStops(nextRaw);
    const updatedStopRef = nextRaw[idx];
    const newIdx = sorted.findIndex(
      (s) =>
        Math.abs(s.offset - updatedStopRef.offset) < 1e-4 &&
        s.color.toLowerCase() === updatedStopRef.color.toLowerCase()
    );
    if (newIdx >= 0 && idx !== newIdx) {
      setSelectedStopIdx(newIdx);
    } else if (!targetStop) {
      setSelectedStopIdx(0);
    }
    onChange({
      ...clonePaint(value),
      stops: sorted,
    });
  };

  const handleTrackClick = (e: MouseEvent<HTMLDivElement>) => {
    onFocusGradient?.();
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const offset = Number(clamp((e.clientX - rect.left) / rect.width, 0, 1).toFixed(3));
    const color = sampleGradientColorAt(value, offset);
    const nextStops = normalizeGradientStops([...stops, { offset, color }]);
    const addedIdx = nextStops.findIndex(
      (s) => Math.abs(s.offset - offset) < 1e-4 && s.color.toLowerCase() === color.toLowerCase()
    );
    setSelectedStopIdx(addedIdx >= 0 ? addedIdx : 0);
    onChange({
      ...clonePaint(value),
      stops: nextStops,
    });
  };

  const removeStop = () => {
    if (stops.length <= 2) return;
    onFocusGradient?.();
    const nextStops = stops.filter((_, i) => i !== safeIdx);
    setSelectedStopIdx(Math.max(0, safeIdx - 1));
    onChange({
      ...clonePaint(value),
      stops: nextStops,
    });
  };

  const reverseStops = () => {
    onFocusGradient?.();
    const reversed = normalizeGradientStops(
      stops.map((s) => ({
        ...s,
        offset: Number((1 - s.offset).toFixed(4)),
      }))
    );
    setSelectedStopIdx(stops.length - 1 - safeIdx);
    onChange({
      ...clonePaint(value),
      stops: reversed,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <SegmentedButton
          active={false}
          label="Цвет"
          onClick={() => switchMode('solid')}
        />
        <SegmentedButton
          active={value.kind === 'linear'}
          label="Линейный"
          onClick={() => switchMode('linear')}
        />
        <SegmentedButton
          active={value.kind === 'radial'}
          label="Радиальный"
          onClick={() => switchMode('radial')}
        />
      </div>

      <div className="relative py-1">
        <div
          role="button"
          tabIndex={0}
          title="Нажмите на полосу, чтобы добавить точку градиента"
          onClick={handleTrackClick}
          style={{ background: gradientToCss(value) }}
          className="relative h-5 w-full cursor-crosshair rounded border border-paper-border"
        >
          {stops.map((stop, idx) => {
            const isSelected = idx === safeIdx;
            return (
              <button
                key={`${idx}-${stop.offset}`}
                type="button"
                title={`Точка ${Math.round(stop.offset * 100)}%`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedStopIdx(idx);
                  onFocusGradient?.();
                }}
                style={{
                  left: `${stop.offset * 100}%`,
                  backgroundColor: stop.color,
                }}
                className={`absolute top-1/2 h-4 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 transition-transform ${
                  isSelected
                    ? 'z-10 scale-110 border-paper-accent ring-1 ring-white'
                    : 'border-white shadow-sm'
                }`}
              />
            );
          })}
        </div>
      </div>

      <HexColorRow
        value={activeStop.color}
        onChange={(color) => updateStop(safeIdx, { color })}
      />

      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
        <NumberField
          label="Поз. (%)"
          value={Math.round(activeStop.offset * 100)}
          min={0}
          max={100}
          onCommit={(pct) => updateStop(safeIdx, { offset: clamp(pct / 100, 0, 1) })}
        />
        <NumberField
          label="Непр. (%)"
          value={Math.round((activeStop.opacity ?? 1) * 100)}
          min={0}
          max={100}
          onCommit={(pct) => updateStop(safeIdx, { opacity: clamp(pct / 100, 0, 1) })}
        />
        <button
          type="button"
          disabled={stops.length <= 2}
          title="Удалить точку градиента"
          onClick={removeStop}
          className="flex h-7 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:text-paper-danger disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {value.kind === 'linear' ? (
        <div className="grid grid-cols-[1fr_auto] items-end gap-1.5">
          <NumberField
            label="Угол (°)"
            value={Math.round(getGradientAngleDeg(value))}
            min={0}
            max={360}
            onCommit={(deg) => {
              onFocusGradient?.();
              onChange(setGradientAngleDeg(value, deg));
            }}
          />
          <button
            type="button"
            title="Развернуть градиент"
            onClick={reverseStops}
            className="flex h-7 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={reverseStops}
            className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
            <span>Развернуть</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onFocusGradient?.();
              onChange({
                ...clonePaint(value),
                start: { x: 0.5, y: 0.5 },
                end: { x: 1, y: 0.5 },
              });
            }}
            className="flex h-7 flex-1 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
          >
            <Crosshair className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
            <span>По центру</span>
          </button>
        </div>
      )}

      <DocumentColorSwatches
        colors={documentColors}
        activeColor={activeStop.color}
        onSelect={(color) => updateStop(safeIdx, { color })}
      />

      <span className="text-[10px] text-paper-muted">
        Перетаскивайте точки и угол градиента прямо на холсте
      </span>
    </div>
  );
}
