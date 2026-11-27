import { NumberField } from '../InspectorControls';

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-paper-border bg-paper-bg/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-paper-ink">{label}</div>
        {hint && <div className="text-[11px] text-paper-muted">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`flex h-5 w-9 shrink-0 items-center overflow-hidden rounded-full p-0.5 transition-colors ${
          checked ? 'bg-paper-accent' : 'bg-paper-muted/30'
        }`}
      >
        <span
          className={`h-3.5 w-3.5 shrink-0 rounded-full bg-white transition-transform duration-200 ease-out ${
            checked ? 'translate-x-[1.125rem]' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export function SettingNumberRow({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  onCommit: (nextValue: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-paper-border bg-paper-bg/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-paper-ink">{label}</div>
        {hint && <div className="text-[11px] text-paper-muted">{hint}</div>}
      </div>
      <div className="w-24 shrink-0">
        <NumberField
          value={value}
          min={min}
          max={max}
          step={step}
          decimals={decimals}
          onCommit={onCommit}
        />
      </div>
    </div>
  );
}
