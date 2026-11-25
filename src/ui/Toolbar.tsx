import type { ComponentType } from 'react';
import {
  Combine,
  Grid3x3,
  ImagePlus,
  Magnet,
  Maximize2,
  MousePointer,
  MousePointer2,
  PenTool,
  Pencil,
  Pipette,
  Scissors,
  Shapes,
  Type,
} from 'lucide-react';
import type { ToolType } from '../core/types';

interface ToolbarProps {
  activeTool: ToolType;
  showGrid: boolean;
  snapEnabled: boolean;
  onSelectTool: (tool: ToolType) => void;
  onPlaceImage: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onFitArtboard: () => void;
}

interface ToolButtonDef {
  id: ToolType;
  label: string;
  shortcut: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

const TOOLS: ToolButtonDef[] = [
  { id: 'select', label: 'Выделение (Select)', shortcut: 'V', Icon: MousePointer2 },
  { id: 'node', label: 'Прямое выделение (Direct Select)', shortcut: 'A', Icon: MousePointer },
  { id: 'pen', label: 'Перо (Pen)', shortcut: 'P', Icon: PenTool },
  { id: 'pencil', label: 'Карандаш (Freehand)', shortcut: 'N', Icon: Pencil },
  { id: 'blob', label: 'Умная фигура (Smart Shape)', shortcut: 'B', Icon: Shapes },
  { id: 'shapeBuilder', label: 'Конструктор фигур (Shape Builder)', shortcut: '⇧M', Icon: Combine },
  { id: 'knife', label: 'Нож / Ножницы (Knife / Scissors)', shortcut: 'C', Icon: Scissors },
  { id: 'text', label: 'Текст (Type)', shortcut: 'T', Icon: Type },
  { id: 'eyedropper', label: 'Пипетка (Eyedropper)', shortcut: 'E', Icon: Pipette },
];

export function Toolbar({
  activeTool,
  showGrid,
  snapEnabled,
  onSelectTool,
  onPlaceImage,
  onToggleGrid,
  onToggleSnap,
  onFitArtboard,
}: ToolbarProps) {
  return (
    <aside
      data-tour="toolbar.root"
      className="flex w-11 shrink-0 flex-col items-center justify-between border-r border-paper-border bg-paper-panel py-2"
    >
      <div className="flex flex-col items-center gap-1">
        {TOOLS.map(({ id, label, shortcut, Icon }) => {
          const active = activeTool === id;
          return (
            <button
              key={id}
              type="button"
              data-tour={`tool.${id}`}
              onClick={() => onSelectTool(id)}
              title={`${label} [${shortcut}]`}
              className={`relative flex h-8 w-8 items-center justify-center rounded border transition-colors ${
                active
                  ? 'border-paper-accent bg-paper-accent text-white'
                  : 'border-transparent text-paper-ink hover:bg-paper-hover'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              <span
                className={`pointer-events-none absolute bottom-0.5 right-0.5 font-display text-[8px] leading-none ${
                  active ? 'text-white/85' : 'text-paper-muted'
                }`}
              >
                {shortcut}
              </span>
            </button>
          );
        })}

        <span className="my-1 h-px w-6 bg-paper-border" />

        <button
          type="button"
          onClick={onPlaceImage}
          title="Вставить изображение [I]"
          className="relative flex h-8 w-8 items-center justify-center rounded border border-transparent text-paper-ink hover:bg-paper-hover"
        >
          <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
          <span className="pointer-events-none absolute bottom-0.5 right-0.5 font-display text-[8px] leading-none text-paper-muted">
            I
          </span>
        </button>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="my-1 h-px w-6 bg-paper-border" />
        <button
          type="button"
          data-tour="toolbar.grid"
          onClick={onToggleGrid}
          title="Сетка артборда (Ctrl+')"
          className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${
            showGrid
              ? 'border-paper-accent bg-paper-accent/15 text-paper-accent'
              : 'border-transparent text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
          }`}
        >
          <Grid3x3 className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          data-tour="toolbar.snap"
          onClick={onToggleSnap}
          title="Привязка и направляющие (Ctrl+Shift+')"
          className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${
            snapEnabled
              ? 'border-paper-accent bg-paper-accent/15 text-paper-accent'
              : 'border-transparent text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
          }`}
        >
          <Magnet className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          data-tour="toolbar.fit"
          onClick={onFitArtboard}
          title="Вписать артборд (Ctrl+0)"
          className="flex h-8 w-8 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
        >
          <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </aside>
  );
}
