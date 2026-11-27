import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Copy,
  ImagePlus,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ExportKind } from '../../core/documentFile';
import { DOCUMENT_PRESETS, type Artboard, type Scene } from '../../core/types';
import { HexColorRow, NumberField } from '../InspectorControls';

function ArtboardPresetSelect({
  width,
  height,
  dpi,
  onSelect,
}: {
  width: number;
  height: number;
  dpi: number;
  onSelect: (patch: Pick<Scene, 'width' | 'height' | 'dpi'>) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  const activePreset = DOCUMENT_PRESETS.find(
    (p) => p.width === width && p.height === height && p.dpi === dpi
  );

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <span className="text-[11px] text-paper-muted">Формат</span>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-7 w-full items-center justify-between gap-2 rounded border border-paper-border bg-paper-bg px-2 text-left text-[12px] text-paper-ink hover:bg-paper-hover focus:border-paper-accent focus:outline-none"
      >
        <span className="truncate">
          {activePreset ? activePreset.label : 'Свой размер'}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-paper-muted"
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded border border-paper-border bg-paper-panel py-1">
          {DOCUMENT_PRESETS.map((preset) => {
            const active = activePreset?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onSelect({
                    width: preset.width,
                    height: preset.height,
                    dpi: preset.dpi,
                  });
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] ${
                  active
                    ? 'bg-paper-accent/12 text-paper-ink'
                    : 'text-paper-ink hover:bg-paper-hover'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{preset.label}</div>
                  <div className="font-display text-[10px] text-paper-muted">
                    {preset.width} × {preset.height} • {preset.dpi} DPI
                  </div>
                </div>
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
  );
}

function ArtboardNameField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const cancelledRef = useRef(false);
  const committedOnEnterRef = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onCommit(trimmed);
    } else {
      setDraft(value);
    }
  };

  return (
    <input
      type="text"
      value={draft}
      aria-label="Название артборда"
      onFocus={() => {
        cancelledRef.current = false;
        committedOnEnterRef.current = false;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        if (committedOnEnterRef.current) {
          committedOnEnterRef.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          committedOnEnterRef.current = true;
          commit();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelledRef.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className="h-7 w-full rounded border border-paper-border bg-paper-bg px-2 text-[12px] text-paper-ink outline-none focus:border-paper-accent"
    />
  );
}

export interface InspectorArtboardProps {
  artboards: Artboard[];
  activeArtboard: Artboard;
  dpi: number;
  onSelectArtboard: (artboardId: string) => void;
  onAddArtboard: () => void;
  onDuplicateArtboard: (artboardId: string) => void;
  onDeleteArtboard: (artboardId: string) => void;
  onUpdateArtboard: (
    patch: Partial<Pick<Artboard, 'name' | 'x' | 'y' | 'width' | 'height' | 'background'>> & {
      dpi?: number;
    }
  ) => void;
  onExportArtboard?: (kind: ExportKind, artboardId: string) => void;
  onImportBackgroundImage: () => void;
}

export function InspectorArtboard({
  artboards,
  activeArtboard,
  dpi,
  onSelectArtboard,
  onAddArtboard,
  onDuplicateArtboard,
  onDeleteArtboard,
  onUpdateArtboard,
  onExportArtboard,
  onImportBackgroundImage,
}: InspectorArtboardProps) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-paper-muted">
            Артборды ({artboards.length})
          </span>
          <button
            type="button"
            onClick={onAddArtboard}
            className="flex items-center gap-1 rounded border border-paper-border bg-paper-bg px-1.5 py-0.5 text-[11px] font-medium text-paper-ink hover:bg-paper-hover"
          >
            <Plus className="h-3 w-3 text-paper-accent" strokeWidth={1.75} />
            <span>Добавить</span>
          </button>
        </div>
        {artboards.length > 1 && (
          <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
            {artboards.map((ab) => {
              const isActive = ab.id === activeArtboard.id;
              return (
                <div
                  key={ab.id}
                  onClick={() => onSelectArtboard(ab.id)}
                  className={`group flex h-7 cursor-pointer items-center justify-between gap-1 rounded border px-2 text-[11px] ${
                    isActive
                      ? 'border-paper-accent bg-paper-accent/10 text-paper-ink font-medium'
                      : 'border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{ab.name}</span>
                  <span className="shrink-0 font-display text-[10px] text-paper-muted">
                    {ab.width}×{ab.height}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateArtboard(ab.id);
                    }}
                    title="Дублировать артборд"
                    className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-panel hover:text-paper-ink group-hover:flex"
                  >
                    <Copy className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteArtboard(ab.id);
                    }}
                    title="Удалить артборд"
                    className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-panel hover:text-paper-danger group-hover:flex"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {artboards.length > 1 && (
        <div className="flex flex-col gap-2 border-t border-paper-border pt-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-paper-muted">Имя артборда</span>
            <ArtboardNameField
              value={activeArtboard.name}
              onCommit={(name) => onUpdateArtboard({ name })}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField
              label="X (px)"
              value={activeArtboard.x}
              min={-100000}
              max={100000}
              onCommit={(x) => onUpdateArtboard({ x })}
            />
            <NumberField
              label="Y (px)"
              value={activeArtboard.y}
              min={-100000}
              max={100000}
              onCommit={(y) => onUpdateArtboard({ y })}
            />
          </div>
        </div>
      )}

      <ArtboardPresetSelect
        width={activeArtboard.width}
        height={activeArtboard.height}
        dpi={dpi}
        onSelect={(patch) => onUpdateArtboard(patch)}
      />

      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
        <NumberField
          label="Ширина (px)"
          value={activeArtboard.width}
          min={64}
          max={16000}
          onCommit={(width) => onUpdateArtboard({ width })}
        />
        <button
          type="button"
          onClick={() =>
            onUpdateArtboard({
              width: activeArtboard.height,
              height: activeArtboard.width,
            })
          }
          title="Поменять ширину и высоту местами"
          className="flex h-7 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <NumberField
          label="Высота (px)"
          value={activeArtboard.height}
          min={64}
          max={16000}
          onCommit={(height) => onUpdateArtboard({ height })}
        />
      </div>

      <NumberField
        label="Разрешение (DPI)"
        value={dpi}
        min={72}
        max={600}
        onCommit={(nextDpi) => onUpdateArtboard({ dpi: nextDpi })}
      />

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Фон артборда</span>
        <HexColorRow
          value={activeArtboard.background}
          onChange={(background) => onUpdateArtboard({ background })}
        />
        <button
          type="button"
          onClick={onImportBackgroundImage}
          className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
        >
          <ImagePlus className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
          <span>Фон из изображения</span>
        </button>
      </div>

      {artboards.length > 1 && onExportArtboard && (
        <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
          <span className="text-[11px] text-paper-muted">
            Экспорт «{activeArtboard.name}»
          </span>
          <div className="grid grid-cols-4 gap-1">
            {(['svg', 'png', 'ai', 'psd'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => onExportArtboard(kind, activeArtboard.id)}
                className="h-7 rounded border border-paper-border bg-paper-bg font-display text-[11px] uppercase text-paper-ink hover:bg-paper-hover"
              >
                {kind}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
