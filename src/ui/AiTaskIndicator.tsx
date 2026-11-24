import { Loader2, Sparkles, Square, X } from 'lucide-react';
import { useAiTaskStore } from '../ai/taskStore';
import { useRotatingStatusWord } from './useRotatingStatusWord';

export function AiTaskIndicator({ onOpen }: { onOpen: () => void }) {
  const minimized = useAiTaskStore((s) => s.minimized);
  const status = useAiTaskStore((s) => s.status);
  const log = useAiTaskStore((s) => s.log);
  const answer = useAiTaskStore((s) => s.answer);
  const streamText = useAiTaskStore((s) => s.streamText);
  const error = useAiTaskStore((s) => s.error);
  const stop = useAiTaskStore((s) => s.stop);
  const restore = useAiTaskStore((s) => s.restore);
  const reset = useAiTaskStore((s) => s.reset);

  const isRunning = status === 'running';
  const statusWord = useRotatingStatusWord(isRunning);
  const isVisible = minimized && status !== 'idle';
  if (!isVisible) return null;

  const lastEntry = log[log.length - 1];

  const headline = isRunning
    ? `${statusWord}…`
    : status === 'done'
      ? 'ИИ закончил'
      : status === 'stopped'
        ? 'ИИ остановлен'
        : 'Ошибка ИИ';

  const streamTail = streamText
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .pop();

  const detail = isRunning
    ? lastEntry
      ? lastEntry.summary
      : streamTail ?? 'Модель работает'
    : status === 'done'
      ? answer || `Выполнено действий: ${log.length}`
      : status === 'stopped'
        ? 'Нажмите, чтобы открыть командную строку'
        : error ?? 'Нажмите, чтобы открыть командную строку';

  return (
    <div className="animate-rise fixed bottom-3 right-3 z-[70] flex w-[320px] max-w-[calc(100vw-24px)] items-start gap-2 overflow-hidden rounded border border-paper-border bg-paper-panel px-3 py-2 text-paper-ink">
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
          <span key={headline} className="animate-fade-in block text-[12px] font-medium">
            {headline}
          </span>
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

    </div>
  );
}
