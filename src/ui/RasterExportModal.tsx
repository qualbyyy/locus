import { useEffect, useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import { exportRasterDialog, type RasterExportOptions } from '../core/documentFile';
import { clamp, computeCombinedWorldBBox } from '../core/math';
import type { Scene } from '../core/types';
import { rasterizeSceneToBytes } from '../export/rasterize';
import { HexColorRow, NumberField, SegmentedButton } from './InspectorControls';
import { Checkbox, Slider } from './controls';

interface RasterExportModalProps {
  isOpen: boolean;
  scene: Scene;
  selectedIds: string[];
  initialFormat?: 'png' | 'jpg';
  onClose: () => void;
  onExported: (target: string) => void;
  onError: (message: string) => void;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

export function RasterExportModal({
  isOpen,
  scene,
  selectedIds,
  initialFormat = 'png',
  onClose,
  onExported,
  onError,
}: RasterExportModalProps) {
  const [format, setFormat] = useState<'png' | 'jpg'>(initialFormat);
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(90);
  const [transparent, setTransparent] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState(scene.background || '#ffffff');
  const [scope, setScope] = useState<'artboard' | 'selection'>('artboard');

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [outputDims, setOutputDims] = useState<{ w: number; h: number }>({
    w: scene.width * 2,
    h: scene.height * 2,
  });
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFormat(initialFormat);
    setBackgroundColor(scene.background || '#ffffff');
    if (selectedIds.length === 0) setScope('artboard');
  }, [initialFormat, isOpen, scene.background, selectedIds.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const baseSize = useMemo(() => {
    if (scope === 'selection' && selectedIds.length > 0) {
      const idSet = new Set(selectedIds);
      const layers = scene.layers.filter((l) => idSet.has(l.id) && l.visible);
      if (layers.length > 0) {
        const box = computeCombinedWorldBBox(layers);
        return {
          w: Math.max(1, Math.round(box.width)),
          h: Math.max(1, Math.round(box.height)),
        };
      }
    }
    return { w: Math.max(1, scene.width), h: Math.max(1, scene.height) };
  }, [scene.height, scene.layers, scene.width, scope, selectedIds]);

  const exportOptions: RasterExportOptions = useMemo(
    () => ({
      format,
      scale,
      quality: quality / 100,
      transparent: format === 'png' ? transparent : false,
      backgroundColor,
      scope: selectedIds.length > 0 ? scope : 'artboard',
      selectedIds,
    }),
    [backgroundColor, format, quality, scale, scope, selectedIds, transparent]
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let createdUrl: string | null = null;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { bytes, width, height } = await rasterizeSceneToBytes(
            scene,
            exportOptions
          );
          if (cancelled) return;
          const mime = exportOptions.format === 'jpg' ? 'image/jpeg' : 'image/png';
          const copy = new Uint8Array(bytes.byteLength);
          copy.set(bytes);
          createdUrl = URL.createObjectURL(new Blob([copy], { type: mime }));
          setOutputDims({ w: width, h: height });
          setEstimatedBytes(bytes.byteLength);
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return createdUrl;
          });
        } catch {
          if (!cancelled) setEstimatedBytes(null);
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [exportOptions, isOpen, scene]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsExporting(true);
    try {
      const target = await exportRasterDialog(exportOptions);
      if (target !== null) {
        onExported(target);
        onClose();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Не удалось экспортировать изображение');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
    >
      <div className="animate-rise flex w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-paper-border bg-paper-panel text-paper-ink shadow-2xl">
        <div className="flex items-center justify-between border-b border-paper-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-paper-accent" strokeWidth={1.75} />
            <h2 className="text-[13px] font-semibold">Экспорт в растр (PNG / JPG)</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          {/* Превью */}
          <div className="flex flex-col gap-2">
            <div
              style={{
                backgroundImage:
                  'linear-gradient(45deg, rgba(128,128,128,0.14) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.14) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.14) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.14) 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
              }}
              className="flex h-64 items-center justify-center overflow-hidden rounded border border-paper-border bg-paper-bg p-3"
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Предпросмотр экспорта"
                  className="max-h-full max-w-full object-contain shadow"
                />
              ) : (
                <span className="text-[12px] text-paper-muted">Рендер превью…</span>
              )}
            </div>
            <div className="flex items-center justify-between font-display text-[11px] text-paper-muted">
              <span>
                {outputDims.w} × {outputDims.h} px
              </span>
              <span>
                {estimatedBytes !== null ? `~${formatByteSize(estimatedBytes)}` : '—'}
              </span>
            </div>
          </div>

          {/* Настройки */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-paper-muted">Формат</span>
              <div className="flex gap-1">
                <SegmentedButton
                  active={format === 'png'}
                  label="PNG (без потерь)"
                  onClick={() => setFormat('png')}
                />
                <SegmentedButton
                  active={format === 'jpg'}
                  label="JPG (сжатие)"
                  onClick={() => setFormat('jpg')}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-paper-muted">Область</span>
              <div className="flex gap-1">
                <SegmentedButton
                  active={scope === 'artboard'}
                  label="Весь артборд"
                  onClick={() => setScope('artboard')}
                />
                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => {
                    if (selectedIds.length > 0) setScope('selection');
                  }}
                  className={`flex-1 rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-45 ${
                    scope === 'selection'
                      ? 'border-paper-accent bg-paper-accent/12 font-medium text-paper-ink'
                      : 'border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
                  }`}
                >
                  Выделение ({selectedIds.length})
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-paper-muted">Масштаб и размер</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((s) => (
                  <SegmentedButton
                    key={s}
                    active={Math.abs(scale - s) < 0.01}
                    label={`${s}x`}
                    onClick={() => setScale(s)}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Ширина px"
                  value={Math.round(baseSize.w * scale)}
                  min={16}
                  max={16000}
                  step={10}
                  decimals={0}
                  onCommit={(w) => setScale(clamp(w / baseSize.w, 0.1, 8))}
                />
                <NumberField
                  label="Высота px"
                  value={Math.round(baseSize.h * scale)}
                  min={16}
                  max={16000}
                  step={10}
                  decimals={0}
                  onCommit={(h) => setScale(clamp(h / baseSize.h, 0.1, 8))}
                />
              </div>
            </div>

            {format === 'jpg' ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-paper-muted">Качество JPEG</span>
                  <span className="font-display text-paper-ink">{quality}%</span>
                </div>
                <Slider
                  value={quality}
                  min={10}
                  max={100}
                  step={1}
                  ariaLabel="Качество JPEG"
                  onChange={setQuality}
                />
              </div>
            ) : (
              <Checkbox
                checked={transparent}
                onChange={setTransparent}
                label="Прозрачный фон"
              />
            )}

            {(format === 'jpg' || !transparent) && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-paper-muted">Цвет фона</span>
                <HexColorRow value={backgroundColor} onChange={setBackgroundColor} />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-paper-border px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded border border-paper-border px-3 text-[12px] text-paper-ink hover:bg-paper-hover"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={isExporting}
            onClick={() => void handleConfirm()}
            className="h-7 rounded bg-paper-accent px-3.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {isExporting ? 'Сохранение…' : `Экспортировать ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
