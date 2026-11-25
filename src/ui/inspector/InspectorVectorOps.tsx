import { useState } from 'react';
import {
  Combine,
  Expand,
  Scissors,
  Sparkles,
  Spline,
  Split,
  SquaresExclude,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  WandSparkles,
  Waves,
} from 'lucide-react';
import type { PathLayer } from '../../core/types';
import type { BooleanOp } from '../../engine/booleans';
import { NumberField } from '../InspectorControls';
import { Slider } from '../controls';

interface InspectorVectorOpsProps {
  layer: PathLayer;
  onSmoothLayers: (layerIds: string[]) => void;
  onSimplifyLayers: (layerIds: string[]) => void;
  onWobbleLayers: (layerIds: string[], intensity: number) => void;
  onOffsetLayers: (layerIds: string[], distance: number, copyBehind: boolean) => void;
  onOutlineStroke: (layerIds: string[]) => void;
  onSplitCompound: (layerIds: string[]) => void;
  onCreateTextOnPath?: (pathLayerId: string) => void;
}

export function InspectorVectorOps({
  layer,
  onSmoothLayers,
  onSimplifyLayers,
  onWobbleLayers,
  onOffsetLayers,
  onOutlineStroke,
  onSplitCompound,
  onCreateTextOnPath,
}: InspectorVectorOpsProps) {
  const [wobbleIntensity, setWobbleIntensity] = useState(6);
  const [offsetDistance, setOffsetDistance] = useState(8);
  const [offsetCopyBehind, setOffsetCopyBehind] = useState(true);

  const anchorCount = layer.subpaths.reduce(
    (sum, sp) => sum + sp.anchors.length,
    0
  );

  return (
    <div
      data-tour="inspector.vectorOps"
      className="flex flex-col gap-2 border-t border-paper-border pt-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-paper-muted">
          Операции с контуром
        </span>
        <span className="font-display text-[10px] text-paper-muted">
          Узлов: {anchorCount}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => onSmoothLayers([layer.id])}
          className="flex h-7 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg px-1.5 text-[11px] text-paper-ink hover:bg-paper-hover"
        >
          <Sparkles className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
          <span>Сгладить</span>
        </button>
        <button
          type="button"
          onClick={() => onSimplifyLayers([layer.id])}
          className="flex h-7 items-center justify-center gap-1 rounded border border-paper-border bg-paper-bg px-1.5 text-[11px] text-paper-ink hover:bg-paper-hover"
        >
          <WandSparkles className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
          <span>Упростить</span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Slider
          value={wobbleIntensity}
          min={1}
          max={25}
          step={1}
          ariaLabel="Интенсивность искажения"
          onChange={setWobbleIntensity}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={() => onWobbleLayers([layer.id], wobbleIntensity)}
          className="flex h-7 shrink-0 items-center gap-1 rounded border border-paper-border bg-paper-bg px-2 text-[11px] text-paper-ink hover:bg-paper-hover"
        >
          <Waves className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
          <span>Шум ({wobbleIntensity})</span>
        </button>
      </div>

      <div className="flex flex-col gap-1.5 rounded border border-paper-border bg-paper-bg/50 p-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-paper-muted">
            Параллельный контур (Offset)
          </span>
          <button
            type="button"
            onClick={() => setOffsetCopyBehind((v) => !v)}
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              offsetCopyBehind
                ? 'border-paper-accent bg-paper-accent text-white'
                : 'border-paper-border bg-paper-bg text-paper-muted'
            }`}
          >
            Подложка
          </button>
        </div>
        <div className="flex items-end gap-1.5">
          <div className="w-24">
            <NumberField
              label="Смещение px"
              value={offsetDistance}
              min={-200}
              max={200}
              step={1}
              decimals={1}
              onCommit={setOffsetDistance}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              onOffsetLayers([layer.id], offsetDistance, offsetCopyBehind)
            }
            className="h-7 flex-1 rounded border border-paper-border bg-paper-bg px-2 text-[11px] font-medium text-paper-ink hover:bg-paper-hover"
          >
            {offsetCopyBehind ? 'Создать' : 'Сместить'}
          </button>
        </div>
      </div>

      {layer.stroke !== null && layer.stroke.width > 0 && (
        <button
          type="button"
          onClick={() => onOutlineStroke([layer.id])}
          className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
        >
          <Expand className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
          <span>Обводку в контур</span>
        </button>
      )}

      {layer.subpaths.length > 1 && (
        <button
          type="button"
          onClick={() => onSplitCompound([layer.id])}
          title="Разбить составной контур (Ctrl+Shift+8)"
          className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover"
        >
          <Split className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
          <span>Разбить на части / буквы</span>
        </button>
      )}

      {onCreateTextOnPath && (
        <button
          type="button"
          onClick={() => onCreateTextOnPath(layer.id)}
          className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-accent/40 bg-paper-accent/10 text-[12px] font-medium text-paper-ink hover:bg-paper-accent/20"
        >
          <Spline className="h-3.5 w-3.5 text-paper-accent" strokeWidth={1.75} />
          <span>Текст по контуру (вокруг)</span>
        </button>
      )}
    </div>
  );
}

const BOOLEAN_OPS: Array<{
  op: BooleanOp;
  title: string;
  Icon: typeof SquaresUnite;
}> = [
  { op: 'unite', title: 'Слить (Unite)', Icon: SquaresUnite },
  { op: 'subtract', title: 'Вычесть (Minus Front)', Icon: SquaresSubtract },
  { op: 'intersect', title: 'Пересечь (Intersect)', Icon: SquaresIntersect },
  { op: 'exclude', title: 'Исключить (Exclude)', Icon: SquaresExclude },
  { op: 'divide', title: 'Разделить (Divide)', Icon: Scissors },
];

export function InspectorMultiVectorOps({
  selectedIds,
  allSelectedArePaths,
  onBooleanOp,
  onCombineCompound,
}: {
  selectedIds: string[];
  allSelectedArePaths: boolean;
  onBooleanOp: (layerIds: string[], operation: BooleanOp) => void;
  onCombineCompound: (layerIds: string[]) => void;
}) {
  return (
    <div
      data-tour="inspector.vectorOps"
      className="flex flex-col gap-1.5 border-t border-paper-border pt-2.5"
    >
      <span className="text-[11px] font-medium text-paper-muted">
        Булевы операции и контуры
      </span>
      <div className="grid grid-cols-5 gap-1">
        {BOOLEAN_OPS.map(({ op, title, Icon }) => (
          <button
            key={op}
            type="button"
            disabled={!allSelectedArePaths}
            title={title}
            onClick={() => onBooleanOp(selectedIds, op)}
            className="flex h-7 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-ink hover:bg-paper-hover disabled:opacity-40"
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!allSelectedArePaths}
        onClick={() => onCombineCompound(selectedIds)}
        title="Объединить в составной контур (Ctrl+8)"
        className="flex h-7 items-center justify-center gap-1.5 rounded border border-paper-border bg-paper-bg text-[12px] text-paper-ink hover:bg-paper-hover disabled:opacity-40"
      >
        <Combine className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
        <span>Составной контур (Ctrl+8)</span>
      </button>
    </div>
  );
}
