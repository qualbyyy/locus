import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { ContextMenuActionId, ContextMenuItem } from '../core/contextMenu';

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onAction: (action: ContextMenuActionId) => void;
  onClose: () => void;
}

const VIEWPORT_MARGIN = 8;

export function ContextMenu({
  x,
  y,
  items,
  onAction,
  onClose,
}: ContextMenuProps): ReactElement {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    setPosition({
      x: Math.min(Math.max(VIEWPORT_MARGIN, x), maxX),
      y: Math.min(Math.max(VIEWPORT_MARGIN, y), maxY),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Контекстное меню"
      data-context-menu="true"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className="animate-fade-in fixed z-[70] min-w-52 rounded border border-paper-border bg-paper-panel py-1 text-[12px] text-paper-ink"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          aria-disabled={item.disabled || undefined}
          onClick={() => {
            if (item.disabled) return;
            onAction(item.id);
          }}
          className={`flex w-full items-center px-3 py-1.5 text-left transition-colors disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${
            item.separatorBefore ? 'mt-1 border-t border-paper-border pt-2' : ''
          } ${
            item.emphasis === 'accent'
              ? 'font-medium text-paper-accent hover:bg-paper-accent/10'
              : 'hover:bg-paper-hover'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
