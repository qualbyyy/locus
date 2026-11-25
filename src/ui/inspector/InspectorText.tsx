import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Rows3,
  Spline,
  Type,
} from 'lucide-react';
import type { TextCaseMode, TextSplitMode } from '../../core/commands';
import { useEditorStore } from '../../core/store';
import type { Layer, StrokeStyle, TextLayer } from '../../core/types';
import { Checkbox, Select, Slider } from '../controls';
import {
  FontFamilySelect,
  NumberField,
  SegmentedButton,
  TextContentField,
} from '../InspectorControls';
import { PaintEditor } from './PaintEditor';

interface InspectorTextProps {
  layer: TextLayer;
  documentColors: string[];
  availablePaths?: Array<{ id: string; name: string; closed?: boolean }>;
  onUpdateLayers: (
    layerIds: string[],
    patch: Partial<Layer> | ((layer: Layer) => Layer)
  ) => void;
  onEditTextOnCanvas: (layerId: string) => void;
  onTransformTextCase: (layerIds: string[], mode: TextCaseMode) => void;
  onConvertToOutlines: (layerIds: string[]) => void;
  onSplitText?: (layerIds: string[], mode: TextSplitMode) => void;
  onAttachTextToPath?: (textLayerId: string, pathLayerId: string) => void;
  onDetachTextFromPath?: (textLayerId: string) => void;
  onApplyTextPathArc?: (textLayerId: string, arc: 'top' | 'bottom') => void;
  onUploadFont?: () => void;
}

const DEFAULT_TEXT_STROKE: StrokeStyle = {
  color: '#ffffff',
  width: 3,
  lineCap: 'round',
  lineJoin: 'round',
};

const TEXT_STROKE_JOIN_OPTIONS: Array<{
  value: NonNullable<StrokeStyle['lineJoin']>;
  label: string;
}> = [
  { value: 'round', label: 'Круглый' },
  { value: 'miter', label: 'Острый' },
  { value: 'bevel', label: 'Скошенный' },
];

const ALIGN_BUTTONS: Array<{
  id: TextLayer['align'];
  Icon: typeof AlignLeft;
  label: string;
}> = [
  { id: 'left', Icon: AlignLeft, label: 'По левому' },
  { id: 'center', Icon: AlignCenter, label: 'По центру' },
  { id: 'right', Icon: AlignRight, label: 'По правому' },
];

export function InspectorText({
  layer,
  documentColors,
  availablePaths = [],
  onUpdateLayers,
  onEditTextOnCanvas,
  onTransformTextCase,
  onConvertToOutlines,
  onSplitText,
  onAttachTextToPath,
  onDetachTextFromPath,
  onApplyTextPathArc,
  onUploadFont,
}: InspectorTextProps) {
  const hostPathMeta = layer.pathId
    ? availablePaths.find((p) => p.id === layer.pathId)
    : undefined;
  const hostIsClosed = hostPathMeta?.closed ?? true;
  const baselineOffset = layer.pathBaselineOffset ?? 0;
  const canSplitLines = !layer.pathId && (layer.content || '').split('\n').filter((l) => l.trim().length > 0).length >= 2;
  const canSplitChars = Array.from(layer.content || '').filter((c) => c.trim().length > 0).length >= 2;
  const textStroke = layer.stroke ?? null;

  return (
    <div
      data-tour="inspector.text"
      className="flex flex-col gap-2.5 border-t border-paper-border pt-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-paper-muted">
          Типографика
        </span>
        <button
          type="button"
          onClick={() => onEditTextOnCanvas(layer.id)}
          className="text-[11px] text-paper-accent hover:underline"
        >
          Редактировать на холсте
        </button>
      </div>

      <TextContentField
        value={layer.content}
        onCommit={(content) => onUpdateLayers([layer.id], { content })}
      />

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Шрифт</span>
        <FontFamilySelect
          value={layer.fontFamily}
          onChange={(fontFamily) => onUpdateLayers([layer.id], { fontFamily })}
          onUploadFont={onUploadFont}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Начертание</span>
        <div className="flex gap-1">
          <SegmentedButton
            active={layer.fontWeight === 400}
            label="Regular 400"
            onClick={() => onUpdateLayers([layer.id], { fontWeight: 400 })}
          />
          <SegmentedButton
            active={layer.fontWeight === 700}
            label="Bold 700"
            onClick={() => onUpdateLayers([layer.id], { fontWeight: 700 })}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <NumberField
          label="Кегль"
          value={layer.fontSize}
          min={6}
          max={1000}
          onCommit={(fontSize) => onUpdateLayers([layer.id], { fontSize })}
        />
        <NumberField
          label="Интерл."
          value={layer.lineHeight}
          min={0.6}
          max={4}
          step={0.05}
          decimals={2}
          onCommit={(lineHeight) => onUpdateLayers([layer.id], { lineHeight })}
        />
        <NumberField
          label="Трекинг"
          value={layer.letterSpacing ?? 0}
          min={-20}
          max={200}
          step={0.5}
          decimals={1}
          onCommit={(letterSpacing) =>
            onUpdateLayers([layer.id], { letterSpacing })
          }
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Регистр</span>
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            title="ВСЕ ПРОПИСНЫЕ"
            onClick={() => onTransformTextCase([layer.id], 'upper')}
            className="flex h-7 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
          >
            <CaseUpper className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>АА</span>
          </button>
          <button
            type="button"
            title="все строчные"
            onClick={() => onTransformTextCase([layer.id], 'lower')}
            className="flex h-7 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
          >
            <CaseLower className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>аа</span>
          </button>
          <button
            type="button"
            title="С Заглавной Каждого Слова"
            onClick={() => onTransformTextCase([layer.id], 'title')}
            className="flex h-7 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover"
          >
            <CaseSensitive className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>Аа</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Выравнивание</span>
        <div className="flex gap-1">
          {ALIGN_BUTTONS.map(({ id, Icon, label }) => {
            const active = layer.align === id;
            return (
              <button
                key={id}
                type="button"
                title={label}
                onClick={() => onUpdateLayers([layer.id], { align: id })}
                className={`flex h-7 flex-1 items-center justify-center rounded border transition-colors ${
                  active
                    ? 'border-paper-accent bg-paper-accent text-white'
                    : 'border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Цвет текста</span>
        <PaintEditor
          value={layer.fill}
          documentColors={documentColors}
          onFocusGradient={() =>
            useEditorStore.getState().setActiveGradientTarget('fill')
          }
          onChange={(fill) => onUpdateLayers([layer.id], { fill })}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-paper-border pt-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-paper-muted">
            Обводка текста
          </span>
          {textStroke ? (
            <button
              type="button"
              onClick={() => onUpdateLayers([layer.id], { stroke: null })}
              className="text-[11px] text-paper-muted hover:text-paper-danger"
            >
              Убрать
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                onUpdateLayers([layer.id], {
                  stroke: { ...DEFAULT_TEXT_STROKE },
                })
              }
              className="text-[11px] text-paper-accent hover:underline"
            >
              Добавить
            </button>
          )}
        </div>

        {textStroke && (
          <div className="flex flex-col gap-2">
            <PaintEditor
              value={textStroke.color}
              documentColors={documentColors}
              onFocusGradient={() =>
                useEditorStore.getState().setActiveGradientTarget('stroke')
              }
              onChange={(color) =>
                onUpdateLayers([layer.id], {
                  stroke: { ...textStroke, color },
                })
              }
            />
            <NumberField
              label="Толщина (px)"
              value={textStroke.width}
              min={0.5}
              max={50}
              step={0.5}
              decimals={1}
              onCommit={(width) =>
                onUpdateLayers([layer.id], {
                  stroke: { ...textStroke, width },
                })
              }
            />
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-paper-muted">Углы контура</span>
              <div className="flex gap-1">
                {TEXT_STROKE_JOIN_OPTIONS.map((opt) => (
                  <SegmentedButton
                    key={opt.value}
                    active={(textStroke.lineJoin ?? 'round') === opt.value}
                    label={opt.label}
                    onClick={() =>
                      onUpdateLayers([layer.id], {
                        stroke: { ...textStroke, lineJoin: opt.value },
                      })
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {(availablePaths.length > 0 || layer.pathId) && (
        <div className="flex flex-col gap-2 border-t border-paper-border pt-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-paper-muted">
              Текст по контуру
            </span>
            {layer.pathId && onDetachTextFromPath && (
              <button
                type="button"
                onClick={() => onDetachTextFromPath(layer.id)}
                className="text-[11px] text-paper-muted hover:text-paper-danger"
              >
                Открепить
              </button>
            )}
          </div>
          <Select
            ariaLabel="Контур для текста"
            value={layer.pathId ?? ''}
            options={[
              { value: '', label: 'Нет (свободный текст)' },
              ...availablePaths.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={(nextId) => {
              if (!nextId) {
                onDetachTextFromPath?.(layer.id);
              } else {
                onAttachTextToPath?.(layer.id, nextId);
              }
            }}
          />
          {layer.pathId && (
            <>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (onApplyTextPathArc) {
                      onApplyTextPathArc(layer.id, 'top');
                      return;
                    }
                    const margin = baselineOffset > 0 ? Math.max(8, Math.min(48, baselineOffset)) : 10;
                    onUpdateLayers([layer.id], {
                      align: 'center',
                      pathFlip: false,
                      pathOffset: hostIsClosed ? 50 : 0,
                      pathBaselineOffset: margin,
                    });
                  }}
                  className="h-7 rounded border border-paper-border bg-paper-bg px-1.5 text-[11px] text-paper-ink hover:bg-paper-hover"
                >
                  Сверху дугой
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onApplyTextPathArc) {
                      onApplyTextPathArc(layer.id, 'bottom');
                      return;
                    }
                    const margin = baselineOffset > 0 ? Math.max(8, Math.min(48, baselineOffset)) : 10;
                    onUpdateLayers([layer.id], {
                      align: 'center',
                      pathFlip: true,
                      pathOffset: 0,
                      pathBaselineOffset: -Math.round(layer.fontSize * 0.72 + margin),
                    });
                  }}
                  className="h-7 rounded border border-paper-border bg-paper-bg px-1.5 text-[11px] text-paper-ink hover:bg-paper-hover"
                >
                  Снизу дугой
                </button>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] text-paper-muted">
                  <span>Смещение по кривой</span>
                  <span className="font-display text-paper-ink">
                    {Math.round(layer.pathOffset ?? 0)}%
                  </span>
                </div>
                <Slider
                  value={layer.pathOffset ?? 0}
                  min={0}
                  max={100}
                  step={1}
                  ariaLabel="Смещение текста по контуру"
                  onChange={(pathOffset) =>
                    onUpdateLayers([layer.id], { pathOffset })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] text-paper-muted">
                  <span>Отступ от края</span>
                  <div className="flex items-center gap-1.5">
                    {Math.abs(baselineOffset) > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateLayers([layer.id], { pathBaselineOffset: 0 })
                        }
                        className="text-[10px] text-paper-accent hover:underline"
                      >
                        Сброс
                      </button>
                    )}
                    <span className="font-display text-paper-ink">
                      {Math.round(baselineOffset)} px
                    </span>
                  </div>
                </div>
                <Slider
                  value={baselineOffset}
                  min={-120}
                  max={120}
                  step={1}
                  ariaLabel="Отступ текста от края контура"
                  onChange={(pathBaselineOffset) =>
                    onUpdateLayers([layer.id], { pathBaselineOffset })
                  }
                />
              </div>
              <Checkbox
                checked={Boolean(layer.pathFlip)}
                onChange={(pathFlip) => onUpdateLayers([layer.id], { pathFlip })}
                label="Перевернуть сторону"
              />
              <Checkbox
                checked={Boolean(layer.pathStretch)}
                onChange={(pathStretch) =>
                  onUpdateLayers([layer.id], { pathStretch })
                }
                label="Растянуть по контуру"
              />
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5">
        {onSplitText && (
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              disabled={!canSplitChars}
              onClick={() => onSplitText([layer.id], 'chars')}
              className="flex h-7 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover disabled:opacity-40"
            >
              <Type className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
              <span>На буквы</span>
            </button>
            <button
              type="button"
              disabled={!canSplitLines}
              onClick={() => onSplitText([layer.id], 'lines')}
              className="flex h-7 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg text-[11px] text-paper-ink hover:bg-paper-hover disabled:opacity-40"
            >
              <Rows3 className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
              <span>На строки</span>
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => onConvertToOutlines([layer.id])}
          title="Перевести текст в кривые Безье (Ctrl+Shift+O)"
          className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] font-medium text-paper-ink hover:bg-paper-hover"
        >
          <Spline className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
          <span>В кривые (Ctrl+Shift+O)</span>
        </button>
      </div>
    </div>
  );
}
