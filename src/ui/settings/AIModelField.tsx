import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';

export function AIModelField({
  value,
  placeholder,
  quickModels,
  fetchedModels,
  isFetching,
  fetchError,
  onChange,
  onFetch,
}: {
  value: string;
  placeholder: string;
  quickModels: string[];
  fetchedModels: string[];
  isFetching: boolean;
  fetchError: string | null;
  onChange: (model: string) => void;
  onFetch: () => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [dropdownOpen]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-paper-muted">Модель</span>
        {fetchedModels.length > 0 && (
          <span className="text-[10px] text-paper-muted">
            Загружено: {fetchedModels.length}
          </span>
        )}
      </div>

      <div ref={dropdownRef} className="relative flex items-center gap-1.5">
        <div className="relative flex flex-1 items-center">
          <input
            type="text"
            value={value}
            spellCheck={false}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-full rounded border border-paper-border bg-paper-bg pl-2.5 pr-8 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
          />
          {fetchedModels.length > 0 && (
            <button
              type="button"
              onClick={() => setDropdownOpen((open) => !open)}
              title="Выбрать из загруженных моделей"
              className="absolute right-1 flex h-6 w-6 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
            >
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={isFetching}
          onClick={() => {
            onFetch();
            setDropdownOpen(true);
          }}
          title="Загрузить список моделей от провайдера"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded border border-paper-border bg-paper-bg px-2.5 text-[11px] font-medium text-paper-ink hover:bg-paper-hover disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 text-paper-muted ${isFetching ? 'animate-spin' : ''}`}
            strokeWidth={1.75}
          />
          <span>{isFetching ? 'Загрузка…' : 'Обновить'}</span>
        </button>

        {dropdownOpen && fetchedModels.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded border border-paper-border bg-paper-panel py-1">
            {fetchedModels.map((modelId) => {
              const active = modelId === value;
              return (
                <button
                  key={modelId}
                  type="button"
                  onClick={() => {
                    onChange(modelId);
                    setDropdownOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left font-display text-[11px] ${
                    active
                      ? 'bg-paper-accent/15 text-paper-ink'
                      : 'text-paper-ink hover:bg-paper-hover'
                  }`}
                >
                  <span className="truncate">{modelId}</span>
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

      {quickModels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {quickModels.map((modelId) => {
            const active = value === modelId;
            return (
              <button
                key={modelId}
                type="button"
                onClick={() => onChange(modelId)}
                className={`rounded border px-2 py-0.5 font-display text-[10px] transition-colors ${
                  active
                    ? 'border-paper-accent bg-paper-accent/15 text-paper-ink'
                    : 'border-paper-border bg-paper-bg/60 text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
                }`}
              >
                {modelId}
              </button>
            );
          })}
        </div>
      )}

      {fetchError && (
        <div className="rounded border border-paper-danger/40 bg-paper-danger/10 px-2.5 py-1 text-[11px] text-paper-danger">
          {fetchError}
        </div>
      )}
    </div>
  );
}
