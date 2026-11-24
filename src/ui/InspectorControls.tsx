import { useEffect, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Check,
  ChevronDown,
  FlipHorizontal2,
  FlipVertical2,
} from 'lucide-react';
import type { AlignMode } from '../core/commands';
import { BUILTIN_FONTS } from '../core/fonts';
import { clamp } from '../core/math';
import type { BuiltinFontFamily } from '../core/types';

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  className,
  onCommit,
}: {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  className?: string;
  onCommit: (nextValue: number) => void;
}) {
  const format = (num: number) =>
    decimals > 0 ? Number(num.toFixed(decimals)).toString() : String(Math.round(num));

  const [draft, setDraft] = useState(() => format(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(format(value));
    }
  }, [value, focused, decimals]);

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(format(value));
      return;
    }
    const lo = min ?? -Infinity;
    const hi = max ?? Infinity;
    const clamped = clamp(parsed, lo, hi);
    onCommit(clamped);
    setDraft(format(clamped));
  };

  const inputEl = (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = Number.parseFloat(e.target.value);
        if (Number.isFinite(parsed)) {
          const lo = min ?? -Infinity;
          const hi = max ?? Infinity;
          onCommit(clamp(parsed, lo, hi));
        }
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(draft);
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(format(value));
          e.currentTarget.blur();
        }
      }}
      className={
        className ??
        'h-7 w-full rounded border border-paper-border bg-paper-bg px-2 font-mono text-[12px] text-paper-ink outline-none focus:border-paper-accent'
      }
    />
  );

  if (!label) {
    return inputEl;
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-paper-muted">{label}</span>
      {inputEl}
    </label>
  );
}

export function HexColorRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(value);
    }
  }, [value, focused]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#1c1b1a'}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 cursor-pointer rounded border border-paper-border bg-paper-bg p-0.5"
      />
      <input
        type="text"
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setDraft(e.target.value);
          const val = e.target.value.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(val)) {
            onChange(val);
          }
        }}
        onBlur={() => {
          setFocused(false);
          setDraft(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
        className="h-7 flex-1 rounded border border-paper-border bg-paper-bg px-2 font-mono text-[12px] text-paper-ink outline-none focus:border-paper-accent"
      />
    </div>
  );
}

export function SegmentedButton({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-6 flex-1 rounded border px-1.5 text-[11px] font-medium transition-colors ${
        active
          ? 'border-paper-accent bg-paper-accent/15 text-paper-ink'
          : 'border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
      }`}
    >
      {label}
    </button>
  );
}

export function FontFamilySelect({
  value,
  onChange,
}: {
  value: BuiltinFontFamily;
  onChange: (family: BuiltinFontFamily) => void;
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{ fontFamily: `"${value}", sans-serif` }}
        className="flex h-7 w-full items-center justify-between rounded border border-paper-border bg-paper-bg px-2 text-[12px] text-paper-ink hover:bg-paper-hover focus:border-paper-accent focus:outline-none"
      >
        <span className="truncate">{value}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-paper-muted" strokeWidth={1.75} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded border border-paper-border bg-paper-panel py-1">
          {BUILTIN_FONTS.map((font) => {
            const active = font.family === value;
            return (
              <button
                key={font.family}
                type="button"
                onClick={() => {
                  onChange(font.family);
                  setOpen(false);
                }}
                style={{ fontFamily: `"${font.family}", sans-serif` }}
                className={`flex h-7 w-full items-center justify-between px-2.5 text-left text-[12px] ${
                  active
                    ? 'bg-paper-accent/12 text-paper-ink font-medium'
                    : 'text-paper-ink hover:bg-paper-hover'
                }`}
              >
                <span className="truncate">{font.label}</span>
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

export function TextContentField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (nextContent: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(value);
    }
  }, [value, focused]);

  const commit = () => {
    if (draft !== value && draft.trim().length > 0) {
      onCommit(draft);
    } else if (draft.trim().length === 0) {
      setDraft(value);
    }
  };

  return (
    <textarea
      rows={3}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className="w-full resize-y rounded border border-paper-border bg-paper-bg px-2 py-1.5 text-[12px] text-paper-ink outline-none focus:border-paper-accent"
    />
  );
}

export function AlignSection({
  layerIds,
  canDistribute,
  onAlign,
  onFlip,
}: {
  layerIds: string[];
  canDistribute: boolean;
  onAlign: (layerIds: string[], mode: AlignMode) => void;
  onFlip: (layerIds: string[], axis: 'horizontal' | 'vertical') => void;
}) {
  const buttons: Array<{
    mode: AlignMode;
    title: string;
    Icon: typeof AlignStartVertical;
  }> = [
    { mode: 'left', title: 'По левому краю', Icon: AlignStartVertical },
    { mode: 'center', title: 'По центру (гориз.)', Icon: AlignCenterVertical },
    { mode: 'right', title: 'По правому краю', Icon: AlignEndVertical },
    { mode: 'top', title: 'По верхнему краю', Icon: AlignStartHorizontal },
    { mode: 'middle', title: 'По центру (верт.)', Icon: AlignCenterHorizontal },
    { mode: 'bottom', title: 'По нижнему краю', Icon: AlignEndHorizontal },
  ];

  return (
    <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
      <span className="text-[11px] font-medium text-paper-muted">
        Выравнивание и отражение
      </span>
      <div className="grid grid-cols-6 gap-1">
        {buttons.map(({ mode, title, Icon }) => (
          <button
            key={mode}
            type="button"
            title={title}
            onClick={() => onAlign(layerIds, mode)}
            className="flex h-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover"
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onAlign(layerIds, 'artboard_center')}
          className="h-6 flex-1 rounded border border-paper-border bg-paper-bg px-1.5 text-[11px] text-paper-ink hover:bg-paper-hover"
        >
          Центр артборда
        </button>
        <button
          type="button"
          disabled={!canDistribute}
          title="Распределить по горизонтали (от 3 слоёв)"
          onClick={() => onAlign(layerIds, 'distribute_h')}
          className="flex h-6 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover disabled:opacity-40"
        >
          <AlignHorizontalSpaceBetween className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          disabled={!canDistribute}
          title="Распределить по вертикали (от 3 слоёв)"
          onClick={() => onAlign(layerIds, 'distribute_v')}
          className="flex h-6 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover disabled:opacity-40"
        >
          <AlignVerticalSpaceBetween className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="Отразить по горизонтали"
          onClick={() => onFlip(layerIds, 'horizontal')}
          className="flex h-6 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover"
        >
          <FlipHorizontal2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="Отразить по вертикали"
          onClick={() => onFlip(layerIds, 'vertical')}
          className="flex h-6 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover"
        >
          <FlipVertical2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
