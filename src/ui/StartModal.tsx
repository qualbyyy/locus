import { useEffect, useState } from 'react';
import { ArrowLeftRight, FolderOpen, X } from 'lucide-react';
import { DOCUMENT_PRESETS, type DocumentPreset } from '../core/types';
import { NumberField } from './InspectorControls';
import { ColorField } from './controls';

function PresetRatioPreview({
  width,
  height,
  active,
}: {
  width: number;
  height: number;
  active: boolean;
}) {
  const maxSide = 18;
  const ratio = width / Math.max(1, height);
  const boxW = ratio >= 1 ? maxSide : Math.max(7, Math.round(maxSide * ratio));
  const boxH = ratio >= 1 ? Math.max(7, Math.round(maxSide / ratio)) : maxSide;

  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center">
      <span
        style={{ width: boxW, height: boxH }}
        className={`rounded-[2px] border transition-colors ${
          active
            ? 'border-paper-accent bg-paper-accent/15'
            : 'border-paper-muted/50 bg-paper-bg/60'
        }`}
      />
    </span>
  );
}

interface StartModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateDocument: (opts: {
    name: string;
    width: number;
    height: number;
    dpi: number;
    background: string;
  }) => void;
  onOpenProject: () => void;
}

export function StartModal({
  isOpen,
  onClose,
  onCreateDocument,
  onOpenProject,
}: StartModalProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    DOCUMENT_PRESETS[0].id
  );
  const [name, setName] = useState('Новый макет');
  const [width, setWidth] = useState(DOCUMENT_PRESETS[0].width);
  const [height, setHeight] = useState(DOCUMENT_PRESETS[0].height);
  const [dpi, setDpi] = useState(DOCUMENT_PRESETS[0].dpi);
  const [background, setBackground] = useState('#ffffff');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const applyPreset = (preset: DocumentPreset) => {
    setSelectedPresetId(preset.id);
    setWidth(preset.width);
    setHeight(preset.height);
    setDpi(preset.dpi);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const safeWidth = Math.min(16000, Math.max(64, Number(width) || 1080));
    const safeHeight = Math.min(16000, Math.max(64, Number(height) || 1080));
    const safeDpi = Math.min(600, Math.max(72, Number(dpi) || 72));
    onCreateDocument({
      name: name.trim() || 'Новый макет',
      width: safeWidth,
      height: safeHeight,
      dpi: safeDpi,
      background: /^#[0-9a-fA-F]{6}$/.test(background) ? background : '#ffffff',
    });
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper-ink/25 p-4"
    >
      <div className="animate-rise w-full max-w-2xl rounded border border-paper-border bg-paper-panel">
        <div className="flex items-center justify-between border-b border-paper-border px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="Locus" className="h-5 w-5 rounded" />
            <h2 className="text-[14px] font-semibold text-paper-ink">
              Новый документ Locus
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть (Esc)"
            className="flex h-7 w-7 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-paper-muted">
                Пресеты
              </span>
              <div className="grid grid-cols-1 gap-1.5">
                {DOCUMENT_PRESETS.map((preset) => {
                  const active = selectedPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={`flex items-center justify-between gap-2.5 rounded border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-paper-accent bg-paper-bg'
                          : 'border-paper-border bg-paper-panel hover:bg-paper-hover'
                      }`}
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[12px] font-medium text-paper-ink">
                          {preset.label}
                        </span>
                        <span className="font-display text-[11px] text-paper-muted">
                          {preset.width} × {preset.height} px • {preset.dpi} DPI
                        </span>
                      </div>
                      <PresetRatioPreview
                        width={preset.width}
                        height={preset.height}
                        active={active}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-paper-muted">
                Параметры артборда
              </span>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-paper-muted">Название</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 rounded border border-paper-border bg-paper-bg px-2.5 text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                />
              </label>

              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
                <NumberField
                  label="Ширина (px)"
                  value={width}
                  min={64}
                  max={16000}
                  onCommit={(nextWidth) => {
                    setSelectedPresetId('custom');
                    setWidth(nextWidth);
                  }}
                  className="h-8 w-full rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPresetId('custom');
                    setWidth(height);
                    setHeight(width);
                  }}
                  title="Поменять ширину и высоту местами"
                  className="flex h-8 w-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                <NumberField
                  label="Высота (px)"
                  value={height}
                  min={64}
                  max={16000}
                  onCommit={(nextHeight) => {
                    setSelectedPresetId('custom');
                    setHeight(nextHeight);
                  }}
                  className="h-8 w-full rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="DPI"
                  value={dpi}
                  min={72}
                  max={600}
                  onCommit={(nextDpi) => {
                    setSelectedPresetId('custom');
                    setDpi(nextDpi);
                  }}
                  className="h-8 w-full rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                />
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-paper-muted">Фон</span>
                  <div className="flex items-center gap-1.5">
                    <ColorField
                      value={background}
                      ariaLabel="Цвет фона документа"
                      onChange={setBackground}
                    />
                    <input
                      type="text"
                      value={background}
                      onChange={(e) => setBackground(e.target.value)}
                      className="h-8 min-w-0 flex-1 rounded border border-paper-border bg-paper-bg px-2 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                    />
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-paper-border px-4 py-3">
            <button
              type="button"
              onClick={onOpenProject}
              className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-paper-border bg-paper-bg px-3 text-[12px] text-paper-ink hover:bg-paper-hover"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-paper-muted" strokeWidth={1.75} />
              <span>Открыть .locus</span>
            </button>
            <button
              type="submit"
              className="h-8 shrink-0 whitespace-nowrap rounded bg-paper-accent px-4 text-[12px] font-medium text-white hover:bg-paper-accent-hover"
            >
              Создать документ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
