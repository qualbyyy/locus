import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { hexToHsv, hsvToHex, hsvToRgb, type HsvColor } from '../core/themes';

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  value,
  options,
  onChange,
  className = '',
  ariaLabel,
  disabled,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const [activeIndex, setActiveIndex] = useState(currentIndex);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options[currentIndex];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(currentIndex);
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open, currentIndex]);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      onChange(option.value);
      setOpen(false);
    },
    [onChange, options]
  );

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(currentIndex);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => {
        const next = index + delta;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) {
        commit(activeIndex);
      } else {
        setOpen(true);
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
    }
    if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className="flex h-7 w-full items-center justify-between gap-2 rounded border border-paper-border bg-paper-bg px-2 text-left text-[12px] text-paper-ink hover:bg-paper-hover focus:border-paper-accent focus:outline-none disabled:cursor-default disabled:opacity-50"
      >
        <span className="truncate">{selected?.label ?? '—'}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-paper-muted transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded border border-paper-border bg-paper-panel py-1"
        >
          {options.map((option, index) => {
            const active = option.value === value;
            const highlighted = index === activeIndex;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
                className={`flex h-7 w-full items-center justify-between gap-2 px-2.5 text-left text-[12px] ${
                  highlighted ? 'bg-paper-hover' : ''
                } ${active ? 'font-medium text-paper-ink' : 'text-paper-ink'}`}
              >
                <span className="truncate">{option.label}</span>
                {active && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-paper-accent" strokeWidth={2} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  className = '',
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 text-left text-[12px] text-paper-ink disabled:cursor-default disabled:opacity-50 ${className}`}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
          checked
            ? 'border-paper-accent bg-paper-accent text-white'
            : 'border-paper-border bg-paper-bg'
        }`}
      >
        {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
      {label !== undefined && <span>{label}</span>}
    </button>
  );
}

function roundStepped(value: number, min: number, step: number): number {
  const stepped = min + Math.round((value - min) / step) * step;
  return Number(stepped.toFixed(step < 1 ? 6 : 0));
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onChangeStart,
  onChangeEnd,
  className = '',
  ariaLabel,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: () => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const safeMax = max > min ? max : min + 1;
  const clamped = Math.min(safeMax, Math.max(min, value));
  const percent = ((clamped - min) / (safeMax - min)) * 100;

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onChange(roundStepped(min + (safeMax - min) * ratio, min, step));
    },
    [max, min, onChange, safeMax, step]
  );

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (disabled) return;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      next = clamped - step;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      next = clamped + step;
    } else if (event.key === 'PageDown') {
      next = clamped - step * 10;
    } else if (event.key === 'PageUp') {
      next = clamped + step * 10;
    } else if (event.key === 'Home') {
      next = min;
    } else if (event.key === 'End') {
      next = safeMax;
    }
    if (next === null) return;
    event.preventDefault();
    onChange(roundStepped(Math.min(safeMax, Math.max(min, next)), min, step));
  };

  return (
    <div
      ref={rootRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onChangeStart?.();
        updateFromClientX(event.clientX);
      }}
      onPointerMove={(event) => {
        if (!dragging || disabled) return;
        updateFromClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (dragging) {
          setDragging(false);
          onChangeEnd?.();
        }
      }}
      onPointerCancel={() => {
        if (dragging) {
          setDragging(false);
          onChangeEnd?.();
        }
      }}
      className={`relative flex h-5 w-full cursor-pointer items-center rounded outline-none focus-visible:ring-1 focus-visible:ring-paper-accent ${
        disabled ? 'cursor-default opacity-50' : ''
      } ${className}`}
    >
      <div className="relative h-1 w-full rounded-full bg-paper-border">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-paper-accent"
          style={{ width: `${percent}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper-panel bg-paper-accent"
          style={{ left: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export const DEFAULT_COLOR_SWATCHES = [
  '#1c1b1a',
  '#6b665e',
  '#ffffff',
  '#f5f2eb',
  '#dfd9ce',
  '#da7756',
  '#c86443',
  '#b83b2e',
  '#e9c46a',
  '#2f5d62',
  '#264653',
  '#457b9d',
  '#6a4c93',
  '#8ac926',
  '#f4a261',
  '#ef476f',
];

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const WHEEL_SIZE = 156;
const WHEEL_RADIUS = WHEEL_SIZE / 2;
const POPOVER_WIDTH = 224;

let cachedWheelRgba: Uint8ClampedArray | null = null;

function getWheelBaseRgba(): Uint8ClampedArray {
  if (cachedWheelRgba) return cachedWheelRgba;
  const data = new Uint8ClampedArray(WHEEL_SIZE * WHEEL_SIZE * 4);
  for (let py = 0; py < WHEEL_SIZE; py += 1) {
    for (let px = 0; px < WHEEL_SIZE; px += 1) {
      const dx = px + 0.5 - WHEEL_RADIUS;
      const dy = py + 0.5 - WHEEL_RADIUS;
      const dist = Math.hypot(dx, dy);
      const idx = (py * WHEEL_SIZE + px) * 4;
      if (dist > WHEEL_RADIUS) {
        data[idx + 3] = 0;
        continue;
      }
      const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const sat = Math.min(1, dist / WHEEL_RADIUS);
      const { r, g, b } = hsvToRgb(hue, sat, 1);
      const edgeAlpha = dist > WHEEL_RADIUS - 1 ? Math.max(0, WHEEL_RADIUS - dist) : 1;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = Math.round(edgeAlpha * 255);
    }
  }
  cachedWheelRgba = data;
  return data;
}

function drawWheelCanvas(canvas: HTMLCanvasElement, valueV: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.createImageData !== 'function') return;
  const img = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
  img.data.set(getWheelBaseRgba());
  ctx.putImageData(img, 0, 0);
  if (valueV < 0.999) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${(1 - Math.max(0, Math.min(1, valueV))).toFixed(3)})`;
    ctx.fill();
    ctx.restore();
  }
}

export function ColorField({
  value,
  onChange,
  className = '',
  ariaLabel = 'Цвет',
  swatches = DEFAULT_COLOR_SWATCHES,
}: {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
  ariaLabel?: string;
  swatches?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const safeValue = HEX_PATTERN.test(value) ? value.toLowerCase() : '#1c1b1a';
  const [hsv, setHsv] = useState<HsvColor>(
    () => hexToHsv(safeValue) ?? { h: 0, s: 0, v: 0.1 }
  );
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [wheelDragging, setWheelDragging] = useState(false);
  const [valDragging, setValDragging] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const wheelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const valueTrackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  useEffect(() => {
    const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);
    if (safeValue !== currentHex) {
      const parsed = hexToHsv(safeValue);
      if (parsed) {
        setHsv((prev) => ({
          h: parsed.s < 1e-4 ? prev.h : parsed.h,
          s: parsed.s,
          v: parsed.v,
        }));
      }
    }
  }, [safeValue]);

  const updatePopoverPosition = useCallback(() => {
    const trigger = buttonRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popH = popoverRef.current?.offsetHeight ?? 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    let top = rect.bottom + 4;
    if (top + popH > vh - margin && rect.top - 4 - popH >= margin) {
      top = rect.top - 4 - popH;
    } else {
      top = Math.max(margin, Math.min(top, vh - popH - margin));
    }
    const left = Math.max(margin, Math.min(rect.left, vw - POPOVER_WIDTH - margin));
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverPosition();
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setOpen(false);
      }
    };
    const handleReposition = () => updatePopoverPosition();
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open || !wheelCanvasRef.current) return;
    drawWheelCanvas(wheelCanvasRef.current, hsv.v);
  }, [open, hsv.v]);

  const commitHsv = useCallback(
    (next: HsvColor) => {
      setHsv(next);
      const hex = hsvToHex(next.h, next.s, next.v);
      setDraft(hex);
      onChange(hex);
    },
    [onChange]
  );

  const updateWheelFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = wheelCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = Math.min(rect.width, rect.height) / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const s = Math.min(1, Math.hypot(dx, dy) / Math.max(1, radius));
      const h =
        s < 1e-4 ? hsv.h : ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      commitHsv({ h, s, v: hsv.v });
    },
    [commitHsv, hsv.h, hsv.v]
  );

  const updateValueFromClientX = useCallback(
    (clientX: number) => {
      const track = valueTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const v = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      commitHsv({ h: hsv.h, s: hsv.s, v });
    },
    [commitHsv, hsv.h, hsv.s]
  );

  const apply = (hex: string) => {
    const normalized = hex.toLowerCase();
    const parsed = hexToHsv(normalized);
    if (parsed) {
      setHsv((prev) => ({
        h: parsed.s < 1e-4 ? prev.h : parsed.h,
        s: parsed.s,
        v: parsed.v,
      }));
    }
    onChange(normalized);
    setDraft(normalized);
  };

  const markerAngleRad = (hsv.h * Math.PI) / 180;
  const markerRadius = hsv.s * WHEEL_RADIUS;
  const markerX = WHEEL_RADIUS + Math.cos(markerAngleRad) * markerRadius;
  const markerY = WHEEL_RADIUS + Math.sin(markerAngleRad) * markerRadius;
  const fullBrightnessHex = hsvToHex(hsv.h, hsv.s, 1);

  const popover = open ? (
    <div
      ref={popoverRef}
      style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
      className="fixed z-[120] rounded border border-paper-border bg-paper-panel p-2.5 shadow-xl"
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className="relative select-none touch-none"
          style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setWheelDragging(true);
            updateWheelFromPoint(event.clientX, event.clientY);
          }}
          onPointerMove={(event) => {
            if (!wheelDragging) return;
            updateWheelFromPoint(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            setWheelDragging(false);
          }}
          onPointerCancel={() => setWheelDragging(false)}
        >
          <canvas
            ref={wheelCanvasRef}
            width={WHEEL_SIZE}
            height={WHEEL_SIZE}
            aria-label="Цветовой круг"
            className="block h-full w-full cursor-crosshair rounded-full"
          />
          <span
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
            style={{
              left: markerX,
              top: markerY,
              backgroundColor: safeValue,
            }}
          />
        </div>

        <div className="flex w-full flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] text-paper-muted">
            <span>Яркость</span>
            <span className="font-display text-paper-ink">
              {Math.round(hsv.v * 100)}%
            </span>
          </div>
          <div
            ref={valueTrackRef}
            role="slider"
            tabIndex={0}
            aria-label="Яркость цвета"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.v * 100)}
            onKeyDown={(event) => {
              let delta = 0;
              if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -0.02;
              else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = 0.02;
              if (delta === 0) return;
              event.preventDefault();
              commitHsv({
                h: hsv.h,
                s: hsv.s,
                v: Math.min(1, Math.max(0, hsv.v + delta)),
              });
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setValDragging(true);
              updateValueFromClientX(event.clientX);
            }}
            onPointerMove={(event) => {
              if (!valDragging) return;
              updateValueFromClientX(event.clientX);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              setValDragging(false);
            }}
            onPointerCancel={() => setValDragging(false)}
            className="relative h-3 w-full cursor-pointer select-none rounded-full border border-paper-border outline-none focus-visible:ring-1 focus-visible:ring-paper-accent"
            style={{
              background: `linear-gradient(90deg, #000000 0%, ${fullBrightnessHex} 100%)`,
            }}
          >
            <span
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                left: `${hsv.v * 100}%`,
                backgroundColor: safeValue,
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-8 gap-1">
        {swatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            title={swatch}
            onClick={() => apply(swatch)}
            className={`h-4 w-4 rounded-[2px] border ${
              swatch.toLowerCase() === value.toLowerCase()
                ? 'border-paper-accent ring-1 ring-paper-accent'
                : 'border-black/10'
            }`}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="h-6 w-6 shrink-0 rounded border border-paper-border"
          style={{ backgroundColor: HEX_PATTERN.test(draft) ? draft : safeValue }}
        />
        <input
          type="text"
          value={draft}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (HEX_PATTERN.test(next)) {
              const normalized = next.toLowerCase();
              const parsed = hexToHsv(normalized);
              if (parsed) {
                setHsv((prev) => ({
                  h: parsed.s < 1e-4 ? prev.h : parsed.h,
                  s: parsed.s,
                  v: parsed.v,
                }));
              }
              onChange(normalized);
            }
          }}
          onBlur={() => {
            if (!HEX_PATTERN.test(draft)) {
              setDraft(value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (HEX_PATTERN.test(draft)) {
                apply(draft);
                setOpen(false);
              }
            } else if (event.key === 'Escape') {
              setDraft(value);
              setOpen(false);
            }
          }}
          className="h-6 min-w-0 flex-1 rounded border border-paper-border bg-paper-bg px-1.5 font-display text-[11px] text-paper-ink outline-none focus:border-paper-accent"
        />
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        title={value}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-7 w-9 items-center justify-center rounded border border-paper-border bg-paper-bg p-0.5 hover:border-paper-accent"
      >
        <span
          className="block h-full w-full rounded-[2px] border border-black/10"
          style={{ backgroundColor: safeValue }}
        />
      </button>

      {popover &&
        (typeof document !== 'undefined' ? createPortal(popover, document.body) : popover)}
    </div>
  );
}
