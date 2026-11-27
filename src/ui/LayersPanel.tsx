import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CornerDownRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
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
import { findLayerById, flattenLayers } from '../core/layerTree';

interface LayersPanelProps {
  layers: Layer[];
  selectedIds: string[];
  editingGroupId?: string | null;
  onSelectLayer: (id: string, additive: boolean) => void;
  onEnterGroup?: (id: string | null) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onRenameLayer: (id: string, name: string) => void;
  onMoveLayer: (id: string, direction: 'up' | 'down', toExtreme?: boolean) => void;
  onDeleteLayer: (id: string) => void;
  onReleaseMask?: (maskId: string) => void;
}

function LayerTypeIcon({ layer, expanded }: { layer: Layer; expanded?: boolean }) {
  if (layer.type === 'group') {
    const Icon = expanded ? FolderOpen : Folder;
    return <Icon className="h-3.5 w-3.5 shrink-0 text-paper-muted" strokeWidth={1.75} />;
  }
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
  editingGroupId = null,
  onSelectLayer,
  onEnterGroup,
  onToggleVisible,
  onToggleLocked,
  onRenameLayer,
  onMoveLayer,
  onDeleteLayer,
  onReleaseMask,
}: LayersPanelProps) {
  const allLayersFlat = flattenLayers(layers);
  const totalLayers = allLayersFlat.length;
  const referencedMaskIds = new Set<string>();
  for (const item of allLayersFlat) {
    if (item.clipMaskId) referencedMaskIds.add(item.clipMaskId);
  }
  const editingGroup = editingGroupId ? findLayerById(layers, editingGroupId) : undefined;
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCancelledRef = useRef(false);

  useEffect(() => {
    if (editingId) {
      renameInputRef.current?.select();
    }
  }, [editingId]);

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitRename = (layer: Layer) => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== layer.name) {
      onRenameLayer(layer.id, trimmed);
    }
    setEditingId(null);
  };

  const renderRows = (list: Layer[], depth: number): ReactNode[] => {
    const ordered = [...list].reverse();

    const rows: ReactNode[] = [];
    ordered.forEach((layer, viewIdx) => {
      const isSelected = selectedIds.includes(layer.id);
      const isIsolationActive = editingGroupId === layer.id;
      const isMask =
        layer.type === 'path' &&
        (Boolean(layer.isClipMask) || referencedMaskIds.has(layer.id));
      const isTop = viewIdx === 0;
      const isBottom = viewIdx === ordered.length - 1;
      const isEditing = editingId === layer.id;
      const isGroup = layer.type === 'group';
      const isExpanded = isGroup && !collapsedIds.has(layer.id);

      rows.push(
        <li
          key={layer.id}
          data-layer-id={layer.id}
          onClick={(e) => onSelectLayer(layer.id, e.shiftKey)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            renameCancelledRef.current = false;
            setEditingId(layer.id);
            setDraftName(layer.name);
          }}
          style={{ paddingLeft: `${10 + depth * 14}px` }}
          className={`group flex h-7 cursor-pointer items-center justify-between gap-1 pr-2.5 text-[12px] ${
            isSelected
              ? 'bg-paper-accent/12 text-paper-ink'
              : isIsolationActive
                ? 'bg-paper-accent/6 text-paper-ink ring-1 ring-inset ring-paper-accent/30'
                : 'text-paper-ink hover:bg-paper-hover'
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {isGroup ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(layer.id);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                title={isExpanded ? 'Свернуть группу' : 'Развернуть группу'}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-bg hover:text-paper-ink"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
                ) : (
                  <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
                )}
              </button>
            ) : (
              depth > 0 && <span className="w-4 shrink-0" />
            )}
            {layer.clipMaskId && (
              <CornerDownRight
                className="h-3 w-3 shrink-0 text-paper-muted"
                strokeWidth={1.75}
              />
            )}
            <LayerTypeIcon layer={layer} expanded={isExpanded} />
            {isEditing ? (
              <input
                ref={renameInputRef}
                type="text"
                value={draftName}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => {
                  if (renameCancelledRef.current) {
                    renameCancelledRef.current = false;
                    return;
                  }
                  commitRename(layer);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    commitRename(layer);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    renameCancelledRef.current = true;
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
            {isGroup && !isEditing && (
              <span className="shrink-0 rounded bg-paper-bg px-1 font-display text-[9px] text-paper-muted">
                {layer.children.length}
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
                  onDoubleClick={(e) => e.stopPropagation()}
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

          <div
            onDoubleClick={(e) => e.stopPropagation()}
            className="flex shrink-0 items-center gap-0.5"
          >
            {isGroup && onEnterGroup && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEnterGroup(isIsolationActive ? null : layer.id);
                }}
                title={isIsolationActive ? 'Выйти из изоляции' : 'Войти в группу'}
                className={`h-5 w-5 items-center justify-center rounded hover:bg-paper-bg hover:text-paper-ink ${
                  isIsolationActive
                    ? 'flex text-paper-accent'
                    : 'hidden text-paper-muted group-hover:flex'
                }`}
              >
                <FolderOpen className="h-3 w-3" strokeWidth={1.75} />
              </button>
            )}
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

      if (isExpanded && layer.children.length > 0) {
        rows.push(...renderRows(layer.children, depth + 1));
      }
    });

    return rows;
  };

  return (
    <section
      data-tour="layers.root"
      className="flex h-[45%] min-h-40 flex-col border-b border-paper-border bg-paper-panel"
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-paper-border px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 shrink-0 text-paper-muted" strokeWidth={1.75} />
          <span className="text-[12px] font-semibold text-paper-ink">Слои</span>
          {editingGroup && onEnterGroup && (
            <button
              type="button"
              onClick={() => onEnterGroup(null)}
              title={`Выйти из группы «${editingGroup.name}»`}
              className="truncate rounded border border-paper-accent/40 bg-paper-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-paper-accent hover:bg-paper-accent/20"
            >
              Выйти
            </button>
          )}
        </div>
        <span className="shrink-0 font-display text-[11px] text-paper-muted">
          {totalLayers}
        </span>
      </div>

      {layers.length === 0 ? (
        <div
          data-tour="layers.list"
          className="flex flex-1 flex-col items-center justify-center px-4 text-center"
        >
          <p className="text-[12px] font-medium text-paper-muted">Слоёв пока нет</p>
          <p className="mt-1 text-[11px] text-paper-muted/80">
            Выберите B, P, T или I, чтобы добавить фигуру, текст или картинку
          </p>
        </div>
      ) : (
        <ul data-tour="layers.list" className="flex-1 overflow-y-auto py-1">
          {renderRows(layers, 0)}
        </ul>
      )}
    </section>
  );
}
