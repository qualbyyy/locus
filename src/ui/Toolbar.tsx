import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Circle,
  Combine,
  Grid3x3,
  Hexagon,
  ImagePlus,
  Magnet,
  Maximize2,
  MoreHorizontal,
  MousePointer,
  MousePointer2,
  PenTool,
  Pencil,
  Pipette,
  Scissors,
  Shapes,
  Spline,
  Split,
  Square,
  Squircle,
  Star,
  Type,
} from 'lucide-react';
import type { SmartShapePreset, ToolType } from '../core/types';

type ToolbarIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export interface ToolbarProps {
  activeTool: ToolType;
  showGrid: boolean;
  snapEnabled: boolean;
  smartShapePreset?: SmartShapePreset;
  textToolMode?: 'point' | 'path';
  knifeToolMode?: 'knife' | 'scissors';
  onSelectTool: (tool: ToolType) => void;
  onSelectShapePreset?: (preset: SmartShapePreset) => void;
  onSelectTextMode?: (mode: 'point' | 'path') => void;
  onCreateCircleText?: () => void;
  onSelectKnifeMode?: (mode: 'knife' | 'scissors') => void;
  onPlaceImage: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onFitArtboard: () => void;
}

interface ToolButtonDef {
  id: ToolType;
  label: string;
  shortcut: string;
  Icon: ToolbarIcon;
}

interface SubToolAction {
  id: string;
  label: string;
  shortcut?: string;
  Icon: ToolbarIcon;
  active?: boolean;
  onSelect: () => void;
}

const SHAPE_PRESET_ICONS: Record<SmartShapePreset, { Icon: ToolbarIcon; label: string }> = {
  ellipse: { Icon: Circle, label: 'Круг / Эллипс' },
  rect: { Icon: Square, label: 'Прямоугольник' },
  polygon: { Icon: Hexagon, label: 'Многоугольник' },
  star: { Icon: Star, label: 'Звезда' },
  capsule: { Icon: Squircle, label: 'Капсула' },
  blob: { Icon: Shapes, label: 'Клякса' },
};

const VISIBLE_SHAPE_PRESETS: SmartShapePreset[] = [
  'ellipse',
  'rect',
  'polygon',
  'star',
  'capsule',
];

const TOOLS: ToolButtonDef[] = [
  { id: 'select', label: 'Выделение (Select)', shortcut: 'V', Icon: MousePointer2 },
  { id: 'node', label: 'Прямое выделение (Direct Select)', shortcut: 'A', Icon: MousePointer },
  { id: 'pen', label: 'Перо (Pen)', shortcut: 'P', Icon: PenTool },
  { id: 'pencil', label: 'Карандаш (Freehand)', shortcut: 'N', Icon: Pencil },
  { id: 'blob', label: 'Фигура (Shape)', shortcut: 'B', Icon: Circle },
  { id: 'shapeBuilder', label: 'Конструктор фигур (Shape Builder)', shortcut: 'M', Icon: Combine },
  { id: 'knife', label: 'Нож / Ножницы (Knife / Scissors)', shortcut: 'C', Icon: Scissors },
  { id: 'text', label: 'Текст (Type)', shortcut: 'T', Icon: Type },
  { id: 'eyedropper', label: 'Пипетка (Eyedropper)', shortcut: 'E', Icon: Pipette },
];

const HOLD_DELAY_MS = 280;
const VIEWPORT_PADDING = 8;

function clampPopoverPosition(anchorRect: DOMRect, panelWidth: number, panelHeight: number) {
  const left = Math.min(
    window.innerWidth - panelWidth - VIEWPORT_PADDING,
    anchorRect.right + 6
  );
  const top = Math.max(
    VIEWPORT_PADDING,
    Math.min(window.innerHeight - panelHeight - VIEWPORT_PADDING, anchorRect.top)
  );
  return { left, top };
}

export function Toolbar({
  activeTool,
  showGrid,
  snapEnabled,
  smartShapePreset = 'ellipse',
  textToolMode = 'point',
  knifeToolMode = 'knife',
  onSelectTool,
  onSelectShapePreset,
  onSelectTextMode,
  onCreateCircleText,
  onSelectKnifeMode,
  onPlaceImage,
  onToggleGrid,
  onToggleSnap,
  onFitArtboard,
}: ToolbarProps) {
  const [flyoutTool, setFlyoutTool] = useState<ToolType | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [popoverCoords, setPopoverCoords] = useState<{ left: number; top: number } | null>(null);

  const buttonRefs = useRef<Partial<Record<ToolType | 'more', HTMLButtonElement | null>>>({});
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const openedByHoldRef = useRef(false);

  const closeMenus = useCallback(() => {
    setFlyoutTool(null);
    setDrawerOpen(false);
  }, []);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const subToolsByTool = useMemo((): Partial<Record<ToolType, SubToolAction[]>> => {
    const selectShape = (preset: SmartShapePreset) => {
      onSelectShapePreset?.(preset);
      onSelectTool('blob');
    };
    const selectTextMode = (mode: 'point' | 'path') => {
      onSelectTextMode?.(mode);
      onSelectTool('text');
    };
    const selectKnifeMode = (mode: 'knife' | 'scissors') => {
      onSelectKnifeMode?.(mode);
      onSelectTool('knife');
    };

    return {
      blob: VISIBLE_SHAPE_PRESETS.map(
        (preset) => ({
          id: `shape:${preset}`,
          label: SHAPE_PRESET_ICONS[preset].label,
          shortcut: 'B',
          Icon: SHAPE_PRESET_ICONS[preset].Icon,
          active: activeTool === 'blob' && smartShapePreset === preset,
          onSelect: () => selectShape(preset),
        })
      ),
      text: [
        {
          id: 'text:point',
          label: 'Обычный текст',
          shortcut: 'T',
          Icon: Type,
          active: activeTool === 'text' && textToolMode === 'point',
          onSelect: () => selectTextMode('point'),
        },
        {
          id: 'text:path',
          label: 'Текст по контуру (вокруг фигуры)',
          shortcut: 'T',
          Icon: Spline,
          active: activeTool === 'text' && textToolMode === 'path',
          onSelect: () => selectTextMode('path'),
        },
        ...(onCreateCircleText
          ? [
              {
                id: 'text:circle',
                label: 'Создать текст по кругу',
                Icon: Circle,
                onSelect: () => onCreateCircleText(),
              },
            ]
          : []),
      ],
      knife: [
        {
          id: 'knife:knife',
          label: 'Нож (срез линией)',
          shortcut: 'C',
          Icon: Scissors,
          active: activeTool === 'knife' && knifeToolMode === 'knife',
          onSelect: () => selectKnifeMode('knife'),
        },
        {
          id: 'knife:scissors',
          label: 'Ножницы (разрез точки контура)',
          shortcut: 'C',
          Icon: Split,
          active: activeTool === 'knife' && knifeToolMode === 'scissors',
          onSelect: () => selectKnifeMode('scissors'),
        },
      ],
    };
  }, [
    activeTool,
    knifeToolMode,
    onCreateCircleText,
    onSelectKnifeMode,
    onSelectShapePreset,
    onSelectTextMode,
    onSelectTool,
    smartShapePreset,
    textToolMode,
  ]);

  const activeFlyoutItems = flyoutTool ? subToolsByTool[flyoutTool] ?? null : null;
  const anyMenuOpen = Boolean(activeFlyoutItems || drawerOpen);

  useLayoutEffect(() => {
    if (!anyMenuOpen) {
      setPopoverCoords(null);
      return;
    }
    const anchorKey: ToolType | 'more' | null = drawerOpen ? 'more' : flyoutTool;
    const anchorEl = anchorKey ? buttonRefs.current[anchorKey] : null;
    if (!anchorEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const popRect = popoverRef.current?.getBoundingClientRect();
    setPopoverCoords(
      clampPopoverPosition(
        anchorRect,
        popRect?.width ?? (drawerOpen ? 236 : 220),
        popRect?.height ?? (drawerOpen ? 360 : 180)
      )
    );
  }, [anyMenuOpen, drawerOpen, flyoutTool]);

  useEffect(() => {
    if (!anyMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeMenus();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      const anchorKey: ToolType | 'more' | null = drawerOpen ? 'more' : flyoutTool;
      if (anchorKey && buttonRefs.current[anchorKey]?.contains(target)) return;
      closeMenus();
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!openedByHoldRef.current) return;
      openedByHoldRef.current = false;
      const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const itemBtn = el?.closest('[data-flyout-select="true"]') as HTMLButtonElement | null;
      if (itemBtn) {
        itemBtn.click();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
    };
  }, [anyMenuOpen, closeMenus, drawerOpen, flyoutTool]);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  const handleToolPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: ToolType,
    hasFlyout: boolean
  ) => {
    if (!hasFlyout || event.button !== 0) return;
    clearHoldTimer();
    openedByHoldRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      openedByHoldRef.current = true;
      setDrawerOpen(false);
      setFlyoutTool(id);
    }, HOLD_DELAY_MS);
  };

  const resolveDynamicIcon = (def: ToolButtonDef): { Icon: ToolbarIcon; title: string } => {
    if (def.id === 'blob') {
      const preset = SHAPE_PRESET_ICONS[smartShapePreset];
      return {
        Icon: preset.Icon,
        title: `${preset.label} [${def.shortcut}] — удерживайте для выбора фигуры`,
      };
    }
    if (def.id === 'text') {
      return textToolMode === 'path'
        ? {
            Icon: Spline,
            title: `Текст по контуру [${def.shortcut}] — удерживайте для выбора режима`,
          }
        : {
            Icon: Type,
            title: `${def.label} [${def.shortcut}] — удерживайте для выбора режима`,
          };
    }
    if (def.id === 'knife') {
      return knifeToolMode === 'scissors'
        ? {
            Icon: Split,
            title: `Ножницы (разрез точки) [${def.shortcut}] — удерживайте для смены`,
          }
        : {
            Icon: Scissors,
            title: `${def.label} [${def.shortcut}] — удерживайте для смены`,
          };
    }
    return { Icon: def.Icon, title: `${def.label} [${def.shortcut}]` };
  };

  const extendedSections: Array<{ title: string; items: SubToolAction[] }> = useMemo(
    () => [
      {
        title: 'Фигуры (B)',
        items: subToolsByTool.blob ?? [],
      },
      {
        title: 'Текст и кривые (T)',
        items: subToolsByTool.text ?? [],
      },
      {
        title: 'Резка и рисование',
        items: [
          ...(subToolsByTool.knife ?? []),
          {
            id: 'extra:shapeBuilder',
            label: 'Конструктор фигур',
            shortcut: 'M',
            Icon: Combine,
            active: activeTool === 'shapeBuilder',
            onSelect: () => onSelectTool('shapeBuilder'),
          },
          {
            id: 'extra:pen',
            label: 'Перо (кривые Безье)',
            shortcut: 'P',
            Icon: PenTool,
            active: activeTool === 'pen',
            onSelect: () => onSelectTool('pen'),
          },
          {
            id: 'extra:pencil',
            label: 'Карандаш (от руки)',
            shortcut: 'N',
            Icon: Pencil,
            active: activeTool === 'pencil',
            onSelect: () => onSelectTool('pencil'),
          },
          {
            id: 'extra:eyedropper',
            label: 'Пипетка (взять стиль)',
            shortcut: 'E',
            Icon: Pipette,
            active: activeTool === 'eyedropper',
            onSelect: () => onSelectTool('eyedropper'),
          },
        ],
      },
    ],
    [activeTool, onSelectTool, subToolsByTool]
  );

  return (
    <aside
      data-tour="toolbar.root"
      className="flex w-11 shrink-0 flex-col items-center justify-between border-r border-paper-border bg-paper-panel py-2"
    >
      <div className="flex flex-col items-center gap-1">
        {TOOLS.map((def) => {
          const { id } = def;
          const active = activeTool === id;
          const hasFlyout = Boolean(subToolsByTool[id]);
          const { Icon, title } = resolveDynamicIcon(def);
          return (
            <button
              key={id}
              ref={(el) => {
                buttonRefs.current[id] = el;
              }}
              type="button"
              data-tour={`tool.${id}`}
              onPointerDown={(e) => handleToolPointerDown(e, id, hasFlyout)}
              onPointerUp={clearHoldTimer}
              onPointerCancel={clearHoldTimer}
              onClick={() => {
                clearHoldTimer();
                if (openedByHoldRef.current) {
                  openedByHoldRef.current = false;
                  return;
                }
                closeMenus();
                onSelectTool(id);
              }}
              onContextMenu={
                hasFlyout
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearHoldTimer();
                      openedByHoldRef.current = false;
                      setDrawerOpen(false);
                      setFlyoutTool((prev) => (prev === id ? null : id));
                    }
                  : undefined
              }
              title={title}
              aria-haspopup={hasFlyout ? 'menu' : undefined}
              aria-expanded={hasFlyout ? flyoutTool === id : undefined}
              className={`relative flex h-8 w-8 items-center justify-center rounded border transition-colors ${
                active
                  ? 'border-paper-accent bg-paper-accent text-white'
                  : 'border-transparent text-paper-ink hover:bg-paper-hover'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {hasFlyout && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 6 6"
                  className={`pointer-events-none absolute bottom-0.5 left-0.5 h-1.5 w-1.5 ${
                    active ? 'text-white/90' : 'text-paper-muted'
                  }`}
                >
                  <polygon points="0,0 0,6 6,6" fill="currentColor" />
                </svg>
              )}
              <span
                className={`pointer-events-none absolute bottom-0.5 right-0.5 font-display text-[8px] leading-none ${
                  active ? 'text-white/85' : 'text-paper-muted'
                }`}
              >
                {def.shortcut}
              </span>
            </button>
          );
        })}

        <span className="my-1 h-px w-6 bg-paper-border" />

        <button
          type="button"
          onClick={() => {
            closeMenus();
            onPlaceImage();
          }}
          title="Вставить изображение [I]"
          className="relative flex h-8 w-8 items-center justify-center rounded border border-transparent text-paper-ink hover:bg-paper-hover"
        >
          <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
          <span className="pointer-events-none absolute bottom-0.5 right-0.5 font-display text-[8px] leading-none text-paper-muted">
            I
          </span>
        </button>

        <button
          ref={(el) => {
            buttonRefs.current.more = el;
          }}
          type="button"
          data-tour="toolbar.more"
          aria-label="Расширенные инструменты"
          aria-haspopup="menu"
          aria-expanded={drawerOpen}
          onClick={() => {
            setFlyoutTool(null);
            setDrawerOpen((prev) => !prev);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setFlyoutTool(null);
            setDrawerOpen((prev) => !prev);
          }}
          title="Все инструменты и режимы (…)"
          className={`flex h-7 w-8 items-center justify-center rounded border transition-colors ${
            drawerOpen
              ? 'border-paper-accent bg-paper-accent/15 text-paper-accent'
              : 'border-transparent text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
          }`}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
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

      {anyMenuOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            aria-label={drawerOpen ? 'Расширенные инструменты' : 'Варианты инструмента'}
            data-toolbar-popover="true"
            style={{
              left: popoverCoords ? `${popoverCoords.left}px` : '-9999px',
              top: popoverCoords ? `${popoverCoords.top}px` : '-9999px',
            }}
            className="animate-fade-in fixed z-[80] min-w-[228px] max-w-[264px] rounded-md border border-paper-border bg-paper-panel p-1.5 text-[12px] text-paper-ink shadow-xl"
          >
            {drawerOpen ? (
              <div className="flex flex-col gap-2">
                {extendedSections.map((section, sectionIdx) => (
                  <div
                    key={section.title}
                    className={sectionIdx > 0 ? 'border-t border-paper-border pt-1.5' : ''}
                  >
                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-paper-muted">
                      {section.title}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {section.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            item.onSelect();
                            closeMenus();
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                            item.active
                              ? 'bg-paper-accent/15 font-medium text-paper-accent'
                              : 'text-paper-ink hover:bg-paper-hover'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <item.Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.shortcut && (
                            <span className="shrink-0 font-display text-[10px] text-paper-muted">
                              {item.shortcut}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {activeFlyoutItems?.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    data-flyout-select="true"
                    onClick={() => {
                      item.onSelect();
                      closeMenus();
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                      item.active
                        ? 'bg-paper-accent/15 font-medium text-paper-accent'
                        : 'text-paper-ink hover:bg-paper-hover'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <item.Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.shortcut && (
                      <span className="shrink-0 font-display text-[10px] text-paper-muted">
                        {item.shortcut}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </aside>
  );
}
