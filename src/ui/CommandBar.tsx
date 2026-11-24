import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ArrowUp, Loader2, Settings2, Sparkles, Square, X } from 'lucide-react';
import { getAiModelLabel, getAiProviderIssue } from '../ai/providers';
import { TOOL_LABELS } from '../ai/registry';
import { useAiTaskStore } from '../ai/taskStore';
import { useSettingsStore } from '../core/settings';
import { useEditorStore } from '../core/store';

export interface CommandBarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

export function CommandBar({
  isOpen,
  onClose,
  onOpenSettings,
}: CommandBarProps): ReactElement | null {
  const ai = useSettingsStore((s) => s.settings.ai);
  const selectedCount = useEditorStore((s) => s.selectedIds.length);

  const status = useAiTaskStore((s) => s.status);
  const log = useAiTaskStore((s) => s.log);
  const answer = useAiTaskStore((s) => s.answer);
  const error = useAiTaskStore((s) => s.error);
  const stepInfo = useAiTaskStore((s) => s.step);
  const start = useAiTaskStore((s) => s.start);
  const stop = useAiTaskStore((s) => s.stop);
  const minimize = useAiTaskStore((s) => s.minimize);
  const restore = useAiTaskStore((s) => s.restore);

  const [prompt, setPrompt] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isRunning = status === 'running';

  const providerIssue = useMemo(() => getAiProviderIssue(ai), [ai]);

  const handleClose = useCallback(() => {
    if (useAiTaskStore.getState().status === 'running') {
      minimize();
    }
    onClose();
  }, [minimize, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    restore();
    const task = useAiTaskStore.getState();
    if (task.prompt) {
      setPrompt((prev) =>
        task.status === 'running' || !prev.trim() ? task.prompt : prev
      );
    }
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, restore]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyK') {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  const submit = useCallback(() => {
    const value = prompt.trim();
    if (!value || isRunning) return;
    void start(value);
  }, [isRunning, prompt, start]);

  if (!isOpen) return null;

  return (
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 px-4 pt-[10vh]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Командная строка ИИ"
        className="flex w-full max-w-[680px] flex-col overflow-hidden rounded-lg border border-paper-border bg-paper-panel text-paper-ink shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-paper-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-paper-accent" strokeWidth={1.75} />
            <h2 className="shrink-0 text-[13px] font-semibold">Командная строка ИИ</h2>
            <span className="truncate text-[11px] text-paper-muted">
              {getAiModelLabel(ai)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] text-paper-muted">
              Выделено: {selectedCount}
            </span>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Свернуть"
              title="Свернуть — задача продолжится в фоне"
              className="flex h-6 w-6 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <textarea
            ref={textareaRef}
            value={prompt}
            rows={3}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="resize-none rounded border border-paper-border bg-paper-bg px-3 py-2 text-[13px] leading-relaxed text-paper-ink outline-none placeholder:text-paper-muted focus:border-paper-accent"
          />

          {log.length > 0 && (
            <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded border border-paper-border bg-paper-bg px-2.5 py-2">
              {log.map((entry, index) => (
                <li
                  key={`${entry.name}_${index}`}
                  className="flex items-start gap-2 text-[11px] leading-snug"
                >
                  <span
                    className={
                      entry.ok
                        ? 'mt-0.5 shrink-0 font-semibold text-paper-accent'
                        : 'mt-0.5 shrink-0 font-semibold text-paper-danger'
                    }
                  >
                    {entry.ok ? 'OK' : '!'}
                  </span>
                  <span className="min-w-0">
                    <span className="text-paper-muted">
                      {TOOL_LABELS[entry.name] ?? entry.name}:{' '}
                    </span>
                    <span className={entry.ok ? 'text-paper-ink' : 'text-paper-danger'}>
                      {entry.error ?? entry.summary}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {isRunning && (
            <div className="flex items-center gap-2 text-[12px] text-paper-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              {stepInfo
                ? `Шаг ${stepInfo.step} из ${stepInfo.maxSteps}: модель думает…`
                : 'Отправляю запрос…'}
            </div>
          )}

          {answer && !isRunning && (
            <div className="whitespace-pre-wrap rounded border border-paper-border bg-paper-bg px-3 py-2 text-[12px] leading-relaxed">
              {answer}
            </div>
          )}

          {status === 'stopped' && (
            <div className="rounded border border-paper-border bg-paper-bg px-3 py-2 text-[12px] text-paper-muted">
              Выполнение остановлено. Сцена сохранила уже сделанные шаги.
            </div>
          )}

          {error && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-paper-danger/40 bg-paper-danger/5 px-3 py-2 text-[12px] text-paper-danger">
              <span className="min-w-0 flex-1">{error}</span>
              {(providerIssue || error.includes('настройк')) && onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="flex items-center gap-1 rounded border border-paper-border bg-paper-panel px-2 py-1 text-[11px] text-paper-ink hover:bg-paper-hover"
                >
                  <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Настройки ИИ
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-paper-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            {isRunning ? (
              <button
                type="button"
                onClick={stop}
                className="flex items-center gap-1.5 rounded border border-paper-danger/50 px-2.5 py-1 text-[12px] text-paper-danger hover:bg-paper-danger/10"
              >
                <Square className="h-3 w-3" strokeWidth={2} />
                Стоп
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!prompt.trim()}
                className="flex items-center gap-1.5 rounded bg-paper-accent px-3 py-1 text-[12px] font-medium text-white hover:bg-paper-accent-hover disabled:cursor-default disabled:opacity-40"
              >
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
                Выполнить
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
