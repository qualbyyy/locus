import { useEffect, useRef, useState } from 'react';
import { Redo2, Settings, Sparkles, Undo2 } from 'lucide-react';
import { MenuBar, type MenuBarActions, type MenuBarState } from './MenuBar';

interface TopBarProps {
  documentName: string;
  isDirty: boolean;
  zoomPercent: number;
  canUndo: boolean;
  canRedo: boolean;
  menuState: MenuBarState;
  menuActions: MenuBarActions;
  onRenameDocument: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenCommandBar: () => void;
  onFitArtboard: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  documentName,
  isDirty,
  zoomPercent,
  canUndo,
  canRedo,
  menuState,
  menuActions,
  onRenameDocument,
  onUndo,
  onRedo,
  onOpenCommandBar,
  onFitArtboard,
  onOpenSettings,
}: TopBarProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(documentName);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftName(documentName);
  }, [documentName]);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  const commitName = () => {
    const trimmed = draftName.trim();
    if (trimmed) {
      onRenameDocument(trimmed);
    } else {
      setDraftName(documentName);
    }
    setIsEditingName(false);
  };

  return (
    <header className="flex h-10 shrink-0 items-center justify-between border-b border-paper-border bg-paper-panel px-2.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="flex shrink-0 items-center gap-1.5 pr-1">
          <img src="/icon.svg" alt="Locus" className="h-5 w-5 rounded" />
          <span className="text-[13px] font-semibold tracking-tight text-paper-ink">
            Locus
          </span>
        </div>

        <span className="h-4 w-px shrink-0 bg-paper-border" />

        <div className="flex min-w-0 shrink-0 items-center gap-1">
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitName();
                } else if (e.key === 'Escape') {
                  setDraftName(documentName);
                  setIsEditingName(false);
                }
              }}
              className="h-6 w-36 rounded border border-paper-accent bg-paper-bg px-2 text-[12px] font-medium text-paper-ink outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              title="Нажмите, чтобы переименовать документ"
              className="max-w-36 truncate rounded px-1.5 py-0.5 text-[12px] font-medium text-paper-ink hover:bg-paper-hover"
            >
              {documentName}
            </button>
          )}
          {isDirty && (
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-paper-accent"
              title="Есть несохранённые изменения"
            />
          )}
        </div>

        <span className="h-4 w-px shrink-0 bg-paper-border" />

        <MenuBar state={menuState} actions={menuActions} />

        <span className="h-4 w-px shrink-0 bg-paper-border" />

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Отменить (Ctrl+Z)"
            className="flex h-7 w-7 items-center justify-center rounded text-paper-ink hover:bg-paper-hover disabled:opacity-45 disabled:hover:bg-transparent"
          >
            <Undo2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Повторить (Ctrl+Shift+Z)"
            className="flex h-7 w-7 items-center justify-center rounded text-paper-ink hover:bg-paper-hover disabled:opacity-45 disabled:hover:bg-transparent"
          >
            <Redo2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenCommandBar}
          title="Командная строка и ИИ (Ctrl+K)"
          className="flex h-7 items-center gap-1.5 rounded border border-paper-border bg-paper-bg px-2 text-[12px] text-paper-ink hover:border-paper-accent"
        >
          <Sparkles className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
          <span className="hidden whitespace-nowrap text-paper-muted lg:inline">
            Команда ИИ…
          </span>
          <kbd className="rounded border border-paper-border bg-paper-panel px-1 py-0.2 font-display text-[10px] text-paper-muted">
            Ctrl+K
          </kbd>
        </button>

        <span className="h-4 w-px bg-paper-border" />

        <button
          type="button"
          onClick={onFitArtboard}
          title="Вписать артборд (Ctrl+0)"
          className="flex h-7 min-w-12 items-center justify-center rounded border border-paper-border bg-paper-bg px-2 font-display text-[12px] text-paper-ink hover:bg-paper-hover"
        >
          {zoomPercent}%
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Настройки (Ctrl+,)"
          className="flex h-7 w-7 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
        >
          <Settings className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
