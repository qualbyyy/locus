import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Spline,
} from 'lucide-react';
import type { TextCaseMode } from '../../core/commands';
import type { Layer, TextLayer } from '../../core/types';
import {
  FontFamilySelect,
  HexColorRow,
  NumberField,
  SegmentedButton,
  TextContentField,
} from '../InspectorControls';
import { DocumentColorSwatches } from './InspectorAppearance';

interface InspectorTextProps {
  layer: TextLayer;
  documentColors: string[];
  onUpdateLayers: (
    layerIds: string[],
    patch: Partial<Layer> | ((layer: Layer) => Layer)
  ) => void;
  onEditTextOnCanvas: (layerId: string) => void;
  onTransformTextCase: (layerIds: string[], mode: TextCaseMode) => void;
  onConvertToOutlines: (layerIds: string[]) => void;
}

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
  onUpdateLayers,
  onEditTextOnCanvas,
  onTransformTextCase,
  onConvertToOutlines,
}: InspectorTextProps) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-paper-border pt-2.5">
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
        <HexColorRow
          value={layer.fill}
          onChange={(fill) => onUpdateLayers([layer.id], { fill })}
        />
        <DocumentColorSwatches
          colors={documentColors}
          activeColor={layer.fill}
          onSelect={(fill) => onUpdateLayers([layer.id], { fill })}
        />
      </div>

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
  );
}
