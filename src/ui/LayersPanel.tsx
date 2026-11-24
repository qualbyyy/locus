import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Lock,
  Shapes,
  Trash2,
  Type,
  Unlink,
  Unlock,
} from 'lucide-react';
import type { Layer } from '../core/types';

interface LayersPanelProps {
  layers: Layer[];
  selectedIds: string[];
  onSelectLayer: (id: string, additive: boolean) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onRenameLayer: (id: string, name: string) => void;
  onMoveLayer: (id: string, direction: 'up' | 'down', toExtreme?: boolean) => void;
  onDeleteLayer: (id: string) => void;
  onReleaseMask?: (maskId: string) => void;
}

function LayerTypeIcon({ layer }: { layer: Layer }) {
  if (layer.type === 'text') {
    return (
      <Type className="h-3.5 w-3.5 shrink-0 text-paper-muted" strokeWidth={1.75} />
    );
  }
  if (layer.type === 'image') {
    return (
      <ImageIcon
        className="h-3.5 w-3.5 shrink-0 text-paper-muted"
        strokeWidth={1.75}
      />
    );
  }
  return (
    <Shapes className="h-3.5 w-3.5 shrink-0 text-paper-muted" strokeWidth={1.75} />
  );
}

export function LayersPanel({
  layers,
  selectedIds,
  onSelectLayer,
  onToggleVisible,
  onToggleLocked,
  onRenameLayer,
  onMoveLayer,
  onDeleteLayer,
  onReleaseMask,
}: LayersPanelProps) {
  const ordered = [...layers].reverse();
  const referencedMaskIds = new Set<string>();
  for (const layer of layers) {
    if (layer.clipMaskId) {
      referencedMaskIds.add(layer.clipMaskId);
    }
  }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId) {
      renameInputRef.current?.select();
    }
  }, [editingId]);

  const commitRename = (layer: Layer) => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== layer.name) {
      onRenameLayer(layer.id, trimmed);
    }
    setEditingId(null);
  };

  return (
    <section className="flex h-[45%] min-h-40 flex-col border-b border-paper-border bg-paper-panel">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-paper-border px-3">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
          <span className="text-[12px] font-semibold text-paper-ink">Слои</span>
        </div>
        <span className="font-display text-[11px] text-paper-muted">{layers.length}</span>
      </div>

      {ordered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <p className="text-[12px] font-medium text-paper-muted">Слоёв пока нет</p>
          <p className="mt-1 text-[11px] text-paper-muted/80">
            Выберите B, P, T или I, чтобы добавить фигуру, текст или картинку
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto py-1">
          {ordered.map((layer, viewIdx) => {
            const isSelected = selectedIds.includes(layer.id);
            const isMask =
              layer.type === 'path' &&
              (Boolean(layer.isClipMask) || referencedMaskIds.has(layer.id));
            const isTop = viewIdx === 0;
            const isBottom = viewIdx === ordered.length - 1;
            const isEditing = editingId === layer.id;

            return (
              <li
                key={layer.id}
                data-layer-id={layer.id}
                onClick={(e) => onSelectLayer(layer.id, e.shiftKey)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(layer.id);
                  setDraftName(layer.name);
                }}
                className={`group flex h-7 cursor-pointer items-center justify-between gap-1 px-2.5 text-[12px] ${
                  isSelected
                    ? 'bg-paper-accent/12 text-paper-ink'
                    : 'text-paper-ink hover:bg-paper-hover'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {layer.clipMaskId && (
                    <CornerDownRight
                      className="h-3 w-3 shrink-0 text-paper-muted"
                      strokeWidth={1.75}
                    />
                  )}
                  <LayerTypeIcon layer={layer} />
                  {isEditing ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={draftName}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(layer)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitRename(layer);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      className="h-5 min-w-0 flex-1 rounded border border-paper-accent bg-paper-bg px-1 text-[12px] text-paper-ink outline-none"
                    />
                  ) : (
                    <span
                      className={`truncate ${
                        !layer.visible ? 'text-paper-muted line-through' : ''
                      }`}
                    >
                      {layer.name}
                    </span>
                  )}
                  {isMask &&
                    (onReleaseMask ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReleaseMask(layer.id);
                        }}
                        title="Снять обтравочную маску"
                        className="flex shrink-0 items-center gap-0.5 rounded border border-paper-border bg-paper-bg px-1 font-display text-[9px] text-paper-muted hover:border-paper-accent hover:text-paper-accent"
                      >
                        <Unlink className="h-2.5 w-2.5" strokeWidth={1.75} />
                        <span>Mask</span>
                      </button>
                    ) : (
                      <span className="shrink-0 rounded border border-paper-border bg-paper-bg px-1 font-display text-[9px] text-paper-muted">
                        Mask
                      </span>
                    ))}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    disabled={isTop}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveLayer(layer.id, 'up', e.shiftKey);
                    }}
                    title="Выше (], с Shift — на передний план)"
                    className="hidden h-5 w-5 items-center justify-center rounded text-paper-muted hover:bg-paper-bg hover:text-paper-ink disabled:opacity-30 group-hover:flex"
                  >
                    <ChevronUp className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    disabled={isBottom}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveLayer(layer.id, 'down', e.shiftKey);
                    }}
                    title="Ниже ([, с Shift — на задний план)"
                    className="hidden h-5 w-5 items-center justify-center rounded text-paper-muted hover:bg-paper-bg hover:text-paper-ink disabled:opacity-30 group-hover:flex"
                  >
                    <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisible(layer.id);
                    }}
                    title={layer.visible ? 'Скрыть' : 'Показать'}
                    className={`flex h-5 w-5 items-center justify-center rounded hover:bg-paper-bg hover:text-paper-ink ${
                      layer.visible
                        ? 'text-paper-muted opacity-0 transition-opacity group-hover:opacity-100'
                        : 'text-paper-ink opacity-100'
                    }`}
                  >
                    {layer.visible ? (
                      <Eye className="h-3 w-3" strokeWidth={1.75} />
                    ) : (
                      <EyeOff className="h-3 w-3" strokeWidth={1.75} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLocked(layer.id);
                    }}
                    title={layer.locked ? 'Разблокировать' : 'Заблокировать'}
                    className={`flex h-5 w-5 items-center justify-center rounded hover:bg-paper-bg hover:text-paper-ink ${
                      layer.locked
                        ? 'text-paper-accent opacity-100'
                        : 'text-paper-muted opacity-0 transition-opacity group-hover:opacity-100'
                    }`}
                  >
                    {layer.locked ? (
                      <Lock className="h-3 w-3" strokeWidth={1.75} />
                    ) : (
                      <Unlock className="h-3 w-3" strokeWidth={1.75} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteLayer(layer.id);
                    }}
                    title="Удалить слой"
                    className="hidden h-5 w-5 items-center justify-center rounded text-paper-muted hover:bg-paper-bg hover:text-paper-danger group-hover:flex"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
