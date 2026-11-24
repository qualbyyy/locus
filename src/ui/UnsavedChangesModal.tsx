import { useEffect, useRef } from 'react';
import { FileWarning } from 'lucide-react';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  documentName: string;
  isSaving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function UnsavedChangesModal({
  isOpen,
  documentName,
  isSaving,
  onCancel,
  onDiscard,
  onSave,
}: UnsavedChangesModalProps) {
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    saveButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!isSaving) onCancel();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!isSaving) onSave();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, isSaving, onCancel, onSave]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
    >
      <div className="animate-rise flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-paper-border bg-paper-panel text-paper-ink">
        <div className="flex items-center gap-2 border-b border-paper-border px-4 py-2.5">
          <FileWarning className="h-4 w-4 text-paper-accent" strokeWidth={1.75} />
          <h2 id="unsaved-title" className="text-[13px] font-semibold">
            Несохранённые изменения
          </h2>
        </div>

        <div className="px-4 py-4 text-[13px] leading-relaxed text-paper-ink">
          В документе{' '}
          <span className="font-medium">«{documentName}»</span> есть несохранённые
          изменения. Сохранить их перед продолжением?
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-paper-border px-4 py-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={onCancel}
            className="rounded border border-paper-border px-3 py-1.5 text-[12px] text-paper-muted transition-colors hover:bg-paper-hover hover:text-paper-ink disabled:opacity-50"
          >
            Отменить
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={onDiscard}
            className="rounded border border-paper-border px-3 py-1.5 text-[12px] text-paper-ink transition-colors hover:bg-paper-hover disabled:opacity-50"
          >
            Не сохранять
          </button>
          <button
            ref={saveButtonRef}
            type="button"
            disabled={isSaving}
            onClick={onSave}
            className="rounded bg-paper-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-paper-accent-hover disabled:opacity-60"
          >
            {isSaving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
