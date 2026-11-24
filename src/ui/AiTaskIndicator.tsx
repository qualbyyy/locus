import { Loader2, Sparkles, Square, X } from 'lucide-react';
import { useAiTaskStore } from '../ai/taskStore';

export function AiTaskIndicator({ onOpen }: { onOpen: () => void }) {
  const minimized = useAiTaskStore((s) => s.minimized);
  const status = useAiTaskStore((s) => s.status);
  const step = useAiTaskStore((s) => s.step);
  const log = useAiTaskStore((s) => s.log);
  const answer = useAiTaskStore((s) => s.answer);
  const error = useAiTaskStore((s) => s.error);
  const stop = useAiTaskStore((s) => s.stop);
  const restore = useAiTaskStore((s) => s.restore);
  const reset = useAiTaskStore((s) => s.reset);

  const isVisible = minimized && status !== 'idle';
  if (!isVisible) return null;

  const isRunning = status === 'running';
  const lastEntry = log[log.length - 1];

  const headline = isRunning
    ? `ИИ работает · шаг ${step?.step ?? 1} из ${step?.maxSteps ?? 8}`
    : status === 'done'
      ? 'ИИ закончил'
      : status === 'stopped'
        ? 'ИИ остановлен'
        : 'Ошибка ИИ';

  const detail = isRunning
    ? lastEntry
      ? lastEntry.summary
      : 'Думает над задачей…'
    : status === 'done'
      ? answer || `Выполнено действий: ${log.length}`
      : status === 'stopped'
        ? 'Нажмите, чтобы открыть командную строку'
        : error ?? 'Нажмите, чтобы открыть командную строку';

  return (
    <div className="fixed bottom-3 right-3 z-[70] flex w-[320px] max-w-[calc(100vw-24px)] items-start gap-2 overflow-hidden rounded border border-paper-border bg-paper-panel px-3 py-2 text-paper-ink">
      <button
        type="button"
        onClick={() => {
          restore();
          onOpen();
        }}
        aria-label="Открыть командную строку ИИ"
        title={detail}
        className="flex min-w-0 flex-1 items-start gap-2 text-left"
      >
        {isRunning ? (
          <Loader2
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-paper-accent"
            strokeWidth={1.75}
          />
        ) : (
          <Sparkles
            className={`mt-0.5 h-4 w-4 shrink-0 ${
              status === 'error' ? 'text-paper-danger' : 'text-paper-accent'
            }`}
            strokeWidth={1.75}
          />
        )}
        <span className="min-w-0">
          <span className="block text-[12px] font-medium">{headline}</span>
          <span className="mt-0.5 block truncate text-[11px] text-paper-muted">
            {detail}
          </span>
        </span>
      </button>

      {isRunning ? (
        <button
          type="button"
          onClick={stop}
          aria-label="Остановить ИИ"
          title="Остановить"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-paper-danger hover:bg-paper-danger/10"
        >
          <Square className="h-3 w-3" strokeWidth={2} />
        </button>
      ) : (
        <button
          type="button"
          onClick={reset}
          aria-label="Скрыть уведомление"
          title="Скрыть"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}

      {isRunning && step && (
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-paper-accent transition-[width]"
          style={{ width: `${Math.min(100, (step.step / step.maxSteps) * 100)}%` }}
        />
      )}
    </div>
  );
}
