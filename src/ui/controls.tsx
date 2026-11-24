import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';

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
  className = '',
  ariaLabel,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
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
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const safeValue = HEX_PATTERN.test(value) ? value : '#1c1b1a';

  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
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

  const apply = (hex: string) => {
    const normalized = hex.toLowerCase();
    onChange(normalized);
    setDraft(normalized);
  };

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
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

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-52 rounded border border-paper-border bg-paper-panel p-2">
          <div className="grid grid-cols-8 gap-1">
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
                  onChange(next.toLowerCase());
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
              className="h-6 min-w-0 flex-1 rounded border border-paper-border bg-paper-bg px-1.5 font-mono text-[11px] text-paper-ink outline-none focus:border-paper-accent"
            />
          </div>
        </div>
      )}
    </div>
  );
}
