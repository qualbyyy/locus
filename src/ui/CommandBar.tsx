import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactElement,
} from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  Paperclip,
  Settings2,
  Sparkles,
  Square,
  Undo2,
  X,
} from 'lucide-react';
import { getAiModelLabel, getAiProviderIssue } from '../ai/providers';
import { useAiTaskStore } from '../ai/taskStore';
import { bytesToDataUrl, inferImageMimeType } from '../core/assets';
import { useSettingsStore } from '../core/settings';
import { useEditorStore } from '../core/store';
import { pickOpenFile } from '../platform/io';
import { useRotatingStatusWord } from './useRotatingStatusWord';

export interface CommandBarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: (tab?: 'ai') => void;
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
  const streamText = useAiTaskStore((s) => s.streamText);
  const error = useAiTaskStore((s) => s.error);
  const canUndo = useAiTaskStore((s) => s.canUndo);
  const attachments = useAiTaskStore((s) => s.attachments);
  const addAttachment = useAiTaskStore((s) => s.addAttachment);
  const removeAttachment = useAiTaskStore((s) => s.removeAttachment);
  const start = useAiTaskStore((s) => s.start);
  const stop = useAiTaskStore((s) => s.stop);
  const revertLastRun = useAiTaskStore((s) => s.revertLastRun);
  const minimize = useAiTaskStore((s) => s.minimize);
  const restore = useAiTaskStore((s) => s.restore);

  const [prompt, setPrompt] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isRunning = status === 'running';
  const statusWord = useRotatingStatusWord(isRunning);
  const planText = useMemo(
    () => log.find((entry) => entry.name === 'report_plan' && entry.ok)?.summary,
    [log]
  );
  const actionLog = useMemo(
    () => log.filter((entry) => entry.name !== 'report_plan'),
    [log]
  );
  const lastAction = actionLog[actionLog.length - 1];

  const providerIssue = useMemo(() => getAiProviderIssue(ai), [ai]);
  const hasImages = attachments.length > 0;

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
    if (task.status === 'error' && task.prompt) {
      setPrompt((prev) => (!prev.trim() ? task.prompt : prev));
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

  const attachImageBytes = useCallback(
    (name: string, bytes: Uint8Array): boolean => {
      const mimeType = inferImageMimeType(name, bytes);
      if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
        setAttachError('Поддерживаются PNG, JPEG и WebP');
        return false;
      }
      if (bytes.byteLength > 8 * 1024 * 1024) {
        setAttachError('Файл больше 8 МБ');
        return false;
      }
      const dataUrl = bytesToDataUrl(bytes, mimeType);
      const dataBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (!dataBase64) {
        setAttachError('Не удалось прочитать изображение');
        return false;
      }
      addAttachment({
        id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        mimeType,
        dataUrl,
        dataBase64,
      });
      return true;
    },
    [addAttachment]
  );

  const attachBrowserFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || isRunning) return;
      setAttachError(null);
      let count = attachments.length;
      for (const file of files) {
        if (count >= 4) break;
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (attachImageBytes(file.name || 'image.png', bytes)) {
            count += 1;
          }
        } catch (err) {
          setAttachError(
            err instanceof Error ? err.message : 'Не удалось прочитать изображение'
          );
        }
      }
    },
    [attachImageBytes, attachments.length, isRunning]
  );

  const handleAttach = useCallback(async () => {
    if (attachments.length >= 4 || isRunning) return;
    setAttachError(null);
    try {
      const file = await pickOpenFile({
        title: 'Прикрепить изображение',
        filters: [
          { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        ],
      });
      if (!file) return;
      attachImageBytes(file.name, file.bytes);
    } catch (err) {
      setAttachError(
        err instanceof Error ? err.message : 'Не удалось прикрепить изображение'
      );
    }
  }, [attachImageBytes, attachments.length, isRunning]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (isRunning || attachments.length >= 4) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageFiles = items
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (imageFiles.length === 0) return;
      event.preventDefault();
      void attachBrowserFiles(imageFiles);
    },
    [attachBrowserFiles, attachments.length, isRunning]
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (isRunning || !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      if (!isDragOver) setIsDragOver(true);
    },
    [isDragOver, isRunning]
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      setIsDragOver(false);
      if (isRunning) return;
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void attachBrowserFiles(files);
    },
    [attachBrowserFiles, isRunning]
  );

  const submit = useCallback(() => {
    const value = prompt.trim();
    if (!value || isRunning) return;
    void start(value);
    if (providerIssue) {
      onOpenSettings?.('ai');
    } else {
      setPrompt('');
      setAttachError(null);
      setLogExpanded(false);
    }
  }, [isRunning, onOpenSettings, prompt, providerIssue, start]);

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
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`animate-rise flex w-full max-w-[680px] flex-col overflow-hidden rounded-lg border bg-paper-panel text-paper-ink shadow-2xl ${
          isDragOver ? 'border-paper-accent ring-2 ring-paper-accent/40' : 'border-paper-border'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-paper-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-paper-accent" strokeWidth={1.75} />
            <h2 className="shrink-0 text-[13px]">Командная строка ИИ</h2>
            <span className="truncate text-[11px] text-paper-muted">
              {getAiModelLabel(ai)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] text-paper-muted">
              Выделено: {selectedCount}
            </span>
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => onOpenSettings('ai')}
                aria-label="Настройки ИИ"
                title="Настройки ИИ"
                className="flex h-6 w-6 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
              >
                <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            )}
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
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={prompt}
              rows={4}
              onChange={(event) => setPrompt(event.target.value)}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              className="w-full resize-none rounded border border-paper-border bg-paper-bg px-3 py-2 pb-9 pr-11 text-[13px] leading-relaxed text-paper-ink outline-none placeholder:text-paper-muted focus:border-paper-accent"
            />
            <button
              type="button"
              onClick={() => void handleAttach()}
              disabled={isRunning || attachments.length >= 4}
              title="Прикрепить изображение"
              aria-label="Прикрепить изображение"
              className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded text-paper-muted transition-colors hover:text-paper-accent disabled:cursor-default disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>

          {(hasImages || attachError) && (
            <div className="flex flex-col gap-1.5">
              {hasImages && (
                <div className="flex flex-wrap items-center gap-2">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      title={`${attachment.name} · ${attachment.mimeType}`}
                      className="relative h-12 w-12 overflow-hidden rounded border border-paper-border bg-paper-bg"
                    >
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => removeAttachment(attachment.id)}
                        aria-label={`Убрать ${attachment.name}`}
                        className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-paper-panel/90 text-paper-muted hover:text-paper-danger disabled:opacity-40"
                      >
                        <X className="h-2.5 w-2.5" strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                  <span className="text-[11px] text-paper-muted">
                    {attachments.length}/4
                  </span>
                </div>
              )}
              {attachError && (
                <div className="text-[11px] text-paper-danger">{attachError}</div>
              )}
            </div>
          )}

          {isRunning && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[12px] text-paper-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
                <span key={statusWord} className="animate-fade-in">
                  {statusWord}…
                </span>
              </div>
              {(planText || streamText || lastAction) && (
                <div className="animate-rise flex flex-col gap-1.5 rounded border border-paper-border bg-paper-bg/60 px-3 py-2 text-[12px] leading-relaxed text-paper-muted">
                  {planText && (
                    <div className="whitespace-pre-wrap">{planText}</div>
                  )}
                  {lastAction && (
                    <div className="truncate text-[11px]">
                      {lastAction.ok ? '✓' : '✗'} {lastAction.summary}
                    </div>
                  )}
                  {streamText && (
                    <div className="whitespace-pre-wrap">
                      {streamText}
                      <span className="ai-caret" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {answer && !isRunning && (
            <div className="flex items-start gap-2 rounded border border-paper-border bg-paper-bg px-3 py-2 text-[12px] leading-relaxed">
              <div className="min-w-0 flex-1 whitespace-pre-wrap">{answer}</div>
              {canUndo && (
                <button
                  type="button"
                  onClick={revertLastRun}
                  className="flex shrink-0 items-center gap-1 rounded border border-paper-border bg-paper-panel px-2 py-1 text-[11px] text-paper-ink hover:bg-paper-hover"
                >
                  <Undo2 className="h-3 w-3" strokeWidth={1.75} />
                  Откатить
                </button>
              )}
            </div>
          )}

          {status === 'stopped' && (
            <div className="flex items-center gap-2 rounded border border-paper-border bg-paper-bg px-3 py-2 text-[12px] text-paper-muted">
              <span className="min-w-0 flex-1">
                Команда остановлена пользователем. Сцена сохранила уже сделанные шаги.
              </span>
              {canUndo && (
                <button
                  type="button"
                  onClick={revertLastRun}
                  className="flex shrink-0 items-center gap-1 rounded border border-paper-border bg-paper-panel px-2 py-1 text-[11px] text-paper-ink hover:bg-paper-hover"
                >
                  <Undo2 className="h-3 w-3" strokeWidth={1.75} />
                  Откатить
                </button>
              )}
            </div>
          )}

          {!isRunning && actionLog.length > 0 && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setLogExpanded((v) => !v)}
                className="flex w-fit items-center gap-1 text-[11px] text-paper-muted hover:text-paper-ink"
              >
                {logExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                Что было сделано ({actionLog.length})
              </button>
              {logExpanded && (
                <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded border border-paper-border bg-paper-bg/60 px-3 py-2 text-[11px] text-paper-muted">
                  {actionLog.map((entry, idx) => (
                    <div key={`${entry.name}_${idx}`} className="flex items-start gap-1.5">
                      <span className={entry.ok ? 'text-paper-accent' : 'text-paper-danger'}>
                        {entry.ok ? '✓' : '✗'}
                      </span>
                      <span className="min-w-0 flex-1">
                        {entry.summary}
                        {entry.error ? ` — ${entry.error}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-paper-danger/40 bg-paper-danger/5 px-3 py-2 text-[12px] text-paper-danger">
              <span className="min-w-0 flex-1">{error}</span>
              {(providerIssue || error.includes('настройк')) && onOpenSettings && (
                <button
                  type="button"
                  onClick={() => onOpenSettings('ai')}
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
