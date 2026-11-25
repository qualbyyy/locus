import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { TextCaseMode, TextSplitMode } from '../core/commands';
import type { ExportKind } from '../core/documentFile';
import type { WarpStyle } from '../core/types';
import type { BooleanOp } from '../engine/booleans';
import type { EffectTarget } from './inspector/InspectorEffects';

export interface MenuBarState {
  hasSelection: boolean;
  hasMultiSelection: boolean;
  hasPathSelection: boolean;
  hasTextSelection: boolean;
  hasImageSelection: boolean;
  hasGroupSelection: boolean;
  canAttachTextToPath: boolean;
  canDetachTextFromPath: boolean;
  canSplitTextChars: boolean;
  canSplitTextLines: boolean;
  hasEffects: boolean;
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  snapEnabled: boolean;
  snapToGuides: boolean;
  hasGuides: boolean;
  outlineMode: boolean;
  showToolbar: boolean;
  showLayers: boolean;
  showInspector: boolean;
}

export interface MenuBarActions {
  onNewDocument: () => void;
  onOpenDocument: () => void;
  onSaveDocument: () => void;
  onImportImage: () => void;
  onImportSvg: () => void;
  onQuickExportPng: () => void;
  onOpenRasterExport: (format?: 'png' | 'jpg') => void;
  onExportDocument: (format: ExportKind) => void;
  onExportSelectionSvg: () => void;
  onExportSelectionRaster: () => void;
  onAddArtboard: () => void;
  onOpenDocSetup: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onCopySvg: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onToggleLock: () => void;
  onUploadFont: () => void;
  onOpenSettings: () => void;
  onOpenTutorial: () => void;
  onOpenShortcuts: () => void;
  onOpenAbout: () => void;
  onRotateBy: (deg: number) => void;
  onFlip: (axis: 'horizontal' | 'vertical') => void;
  onReorder: (mode: 'front' | 'forward' | 'backward' | 'back') => void;
  onBooleanOp: (op: BooleanOp) => void;
  onOffsetPath: () => void;
  onOutlineStroke: () => void;
  onSimplifyPath: () => void;
  onCreateClipMask: () => void;
  onExpandAppearance: () => void;
  onTraceImage: () => void;
  onConvertToOutlines: () => void;
  onAttachTextToPath: () => void;
  onDetachTextFromPath: () => void;
  onCreateCircleText: () => void;
  onSplitText: (mode: TextSplitMode) => void;
  onTransformTextCase: (mode: TextCaseMode) => void;
  onSelectAll: () => void;
  onDeselect: () => void;
  onInvertSelection: () => void;
  onSelectSimilar: (criterion: 'fill' | 'stroke' | 'type') => void;
  onOpenEffect: (target: EffectTarget) => void;
  onClearEffects: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitArtboard: () => void;
  onZoomToSelection: () => void;
  onResetZoom100: () => void;
  onToggleGrid: () => void;
  onToggleRulers: () => void;
  onToggleGuides: () => void;
  onToggleSnap: () => void;
  onToggleSnapToGuides: () => void;
  onClearGuides: () => void;
  onToggleOutline: () => void;
  onToggleToolbar: () => void;
  onToggleLayers: () => void;
  onToggleInspector: () => void;
  onOpenCommandBar: () => void;
  onRunPreflight: () => void;
}

type MenuItem =
  | { type: 'sep' }
  | {
      type?: 'item';
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      onClick?: () => void;
      submenu?: MenuItem[];
    };

interface MenuGroup {
  id: string;
  label: string;
  items: MenuItem[];
}

const WARP_MENU_ITEMS: Array<{ style: WarpStyle; label: string }> = [
  { style: 'flag', label: 'Флаг (Flag)…' },
  { style: 'wave', label: 'Волна (Wave)…' },
  { style: 'arc', label: 'Дуга (Arc)…' },
  { style: 'arch', label: 'Арка (Arch)…' },
  { style: 'bulge', label: 'Выпуклость (Bulge)…' },
  { style: 'fisheye', label: 'Рыбий глаз (Fisheye)…' },
  { style: 'twist', label: 'Скручивание (Twist)…' },
  { style: 'squeeze', label: 'Сжатие (Squeeze)…' },
  { style: 'rise', label: 'Подъём (Rise)…' },
];

function MenuDropdown({
  items,
  onSelectDone,
  className = 'animate-rise absolute left-0 top-full z-50 mt-1 min-w-56 rounded-md border border-paper-border bg-paper-panel py-1 text-[12px] shadow-xl',
}: {
  items: MenuItem[];
  onSelectDone: () => void;
  className?: string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className={className}>
      {items.map((item, idx) => {
        if (item.type === 'sep') {
          return <div key={`sep-${idx}`} className="my-1 h-px bg-paper-border" />;
        }

        const hasSub = Boolean(item.submenu && item.submenu.length > 0);
        const subOpen = hasSub && !item.disabled && hoveredIdx === idx;
        return (
          <div
            key={item.label}
            className="relative"
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx((cur) => (cur === idx ? null : cur))}
          >
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (hasSub || item.disabled) return;
                item.onClick?.();
                onSelectDone();
              }}
              className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-paper-ink hover:bg-paper-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                {item.checked !== undefined && (
                  <span className="flex h-3.5 w-3.5 items-center justify-center text-paper-accent">
                    {item.checked && <Check className="h-3.5 w-3.5" strokeWidth={2.2} />}
                  </span>
                )}
                <span>{item.label}</span>
              </span>
              {hasSub ? (
                <ChevronRight className="h-3.5 w-3.5 text-paper-muted" strokeWidth={1.75} />
              ) : (
                item.shortcut && (
                  <span className="font-display text-[10px] text-paper-muted">
                    {item.shortcut}
                  </span>
                )
              )}
            </button>

            {subOpen && item.submenu && (
              <MenuDropdown
                items={item.submenu}
                onSelectDone={onSelectDone}
                className="animate-fade-in absolute left-full top-0 z-50 ml-0.5 min-w-52 rounded-md border border-paper-border bg-paper-panel py-1 text-[12px] shadow-xl"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MenuBar({
  state,
  actions,
}: {
  state: MenuBarState;
  actions: MenuBarActions;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenuId]);

  const menus: MenuGroup[] = useMemo(
    () => [
      {
        id: 'file',
        label: 'Файл',
        items: [
          { label: 'Новый…', shortcut: 'Ctrl+N', onClick: actions.onNewDocument },
          { label: 'Открыть…', shortcut: 'Ctrl+O', onClick: actions.onOpenDocument },
          { type: 'sep' },
          { label: 'Сохранить', shortcut: 'Ctrl+S', onClick: actions.onSaveDocument },
          { label: 'Импорт изображения…', onClick: actions.onImportImage },
          { label: 'Импорт SVG (вектор)…', onClick: actions.onImportSvg },
          { type: 'sep' },
          {
            label: 'Экспорт',
            submenu: [
              { label: 'Быстрый экспорт PNG', onClick: actions.onQuickExportPng },
              {
                label: 'Экспорт в растр (PNG / JPG)…',
                shortcut: 'Ctrl+Shift+E',
                onClick: () => actions.onOpenRasterExport('png'),
              },
              { type: 'sep' },
              { label: 'Вектор SVG (.svg)', onClick: () => actions.onExportDocument('svg') },
              { label: 'Photoshop PSD (.psd)', onClick: () => actions.onExportDocument('psd') },
              { label: 'Adobe Illustrator (.ai)', onClick: () => actions.onExportDocument('ai') },
              { type: 'sep' },
              {
                label: 'Выделенное в SVG…',
                disabled: !state.hasSelection,
                onClick: actions.onExportSelectionSvg,
              },
              {
                label: 'Выделенное в PNG/JPG…',
                disabled: !state.hasSelection,
                onClick: actions.onExportSelectionRaster,
              },
            ],
          },
          { type: 'sep' },
          { label: 'Добавить артборд', onClick: actions.onAddArtboard },
          { label: 'Параметры документа…', onClick: actions.onOpenDocSetup },
        ],
      },
      {
        id: 'edit',
        label: 'Правка',
        items: [
          { label: 'Отменить', shortcut: 'Ctrl+Z', disabled: !state.canUndo, onClick: actions.onUndo },
          { label: 'Повторить', shortcut: 'Ctrl+Shift+Z', disabled: !state.canRedo, onClick: actions.onRedo },
          { type: 'sep' },
          { label: 'Вырезать', shortcut: 'Ctrl+X', disabled: !state.hasSelection, onClick: actions.onCut },
          { label: 'Копировать', shortcut: 'Ctrl+C', disabled: !state.hasSelection, onClick: actions.onCopy },
          {
            label: 'Копировать как SVG',
            shortcut: 'Ctrl+Shift+C',
            disabled: !state.hasSelection,
            onClick: actions.onCopySvg,
          },
          { label: 'Вставить', shortcut: 'Ctrl+V', onClick: actions.onPaste },
          { label: 'Дублировать', shortcut: 'Ctrl+D', disabled: !state.hasSelection, onClick: actions.onDuplicate },
          { label: 'Удалить', shortcut: 'Del', disabled: !state.hasSelection, onClick: actions.onDelete },
          { type: 'sep' },
          { label: 'Настройки…', shortcut: 'Ctrl+,', onClick: actions.onOpenSettings },
        ],
      },
      {
        id: 'object',
        label: 'Объект',
        items: [
          {
            label: 'Трансформация',
            disabled: !state.hasSelection,
            submenu: [
              { label: 'Повернуть на 90° по час.', onClick: () => actions.onRotateBy(90) },
              { label: 'Повернуть на 90° против час.', onClick: () => actions.onRotateBy(-90) },
              { type: 'sep' },
              { label: 'Отразить по горизонтали', onClick: () => actions.onFlip('horizontal') },
              { label: 'Отразить по вертикали', onClick: () => actions.onFlip('vertical') },
            ],
          },
          {
            label: 'Порядок',
            disabled: !state.hasSelection,
            submenu: [
              { label: 'На передний план', shortcut: 'Ctrl+Shift+]', onClick: () => actions.onReorder('front') },
              { label: 'Вперёд', shortcut: 'Ctrl+]', onClick: () => actions.onReorder('forward') },
              { label: 'Назад', shortcut: 'Ctrl+[', onClick: () => actions.onReorder('backward') },
              { label: 'На задний план', shortcut: 'Ctrl+Shift+[', onClick: () => actions.onReorder('back') },
            ],
          },
          { type: 'sep' },
          { label: 'Сгруппировать', shortcut: 'Ctrl+G', disabled: !state.hasSelection, onClick: actions.onGroup },
          { label: 'Разгруппировать', shortcut: 'Ctrl+Shift+G', disabled: !state.hasGroupSelection, onClick: actions.onUngroup },
          { label: 'Заблокировать / разблокировать', shortcut: 'Ctrl+L', disabled: !state.hasSelection, onClick: actions.onToggleLock },
          { type: 'sep' },
          {
            label: 'Обработка контуров',
            disabled: !state.hasMultiSelection,
            submenu: [
              { label: 'Объединить (Unite)', onClick: () => actions.onBooleanOp('unite') },
              { label: 'Вычесть (Subtract)', onClick: () => actions.onBooleanOp('subtract') },
              { label: 'Пересечение (Intersect)', onClick: () => actions.onBooleanOp('intersect') },
              { label: 'Исключить (Exclude)', onClick: () => actions.onBooleanOp('exclude') },
              { label: 'Разделить (Divide)', onClick: () => actions.onBooleanOp('divide') },
            ],
          },
          { label: 'Сместить контур (+8 px)', disabled: !state.hasPathSelection, onClick: actions.onOffsetPath },
          { label: 'Преобразовать обводку в кривую', disabled: !state.hasPathSelection, onClick: actions.onOutlineStroke },
          { label: 'Упростить контур', disabled: !state.hasPathSelection, onClick: actions.onSimplifyPath },
          { type: 'sep' },
          { label: 'Создать обтравочную маску', disabled: !state.hasMultiSelection, onClick: actions.onCreateClipMask },
          { label: 'Разобрать оформление (Expand)', disabled: !state.hasPathSelection, onClick: actions.onExpandAppearance },
          { label: 'Векторизовать изображение (Image Trace)', disabled: !state.hasImageSelection, onClick: actions.onTraceImage },
        ],
      },
      {
        id: 'text',
        label: 'Текст',
        items: [
          { label: 'Создать текст по кругу', onClick: actions.onCreateCircleText },
          {
            label: 'Пустить текст по контуру',
            disabled: !state.canAttachTextToPath && !state.hasPathSelection,
            onClick: actions.onAttachTextToPath,
          },
          {
            label: 'Открепить текст от контура',
            disabled: !state.canDetachTextFromPath,
            onClick: actions.onDetachTextFromPath,
          },
          { type: 'sep' },
          { label: 'Разбить на буквы', disabled: !state.canSplitTextChars, onClick: () => actions.onSplitText('chars') },
          { label: 'Разбить на строки', disabled: !state.canSplitTextLines, onClick: () => actions.onSplitText('lines') },
          { label: 'Преобразовать в кривые', disabled: !state.hasTextSelection, onClick: actions.onConvertToOutlines },
          { type: 'sep' },
          {
            label: 'Регистр',
            disabled: !state.hasTextSelection,
            submenu: [
              { label: 'ВЕРХНИЙ РЕГИСТР', onClick: () => actions.onTransformTextCase('upper') },
              { label: 'нижний регистр', onClick: () => actions.onTransformTextCase('lower') },
              { label: 'Каждое Слово С Заглавной', onClick: () => actions.onTransformTextCase('title') },
            ],
          },
          { type: 'sep' },
          { label: 'Загрузить шрифт (.ttf, .otf, .woff2)…', onClick: actions.onUploadFont },
        ],
      },
      {
        id: 'select',
        label: 'Выделение',
        items: [
          { label: 'Выделить всё', shortcut: 'Ctrl+A', onClick: actions.onSelectAll },
          { label: 'Снять выделение', shortcut: 'Esc', disabled: !state.hasSelection, onClick: actions.onDeselect },
          { label: 'Инвертировать выделение', onClick: actions.onInvertSelection },
          { type: 'sep' },
          {
            label: 'Выделить похожие',
            disabled: !state.hasSelection,
            submenu: [
              { label: 'С тем же цветом заливки', onClick: () => actions.onSelectSimilar('fill') },
              { label: 'С тем же цветом обводки', onClick: () => actions.onSelectSimilar('stroke') },
              { label: 'Того же типа слоя', onClick: () => actions.onSelectSimilar('type') },
            ],
          },
        ],
      },
      {
        id: 'effect',
        label: 'Эффекты',
        items: [
          {
            label: 'Размытие',
            submenu: [
              { label: 'Размытие по Гауссу…', onClick: () => actions.onOpenEffect({ kind: 'blur' }) },
              { label: 'Размытие в движении (Motion)…', onClick: () => actions.onOpenEffect({ kind: 'motionBlur' }) },
            ],
          },
          {
            label: 'Свет и тень',
            submenu: [
              { label: 'Падающая тень (Drop Shadow)…', onClick: () => actions.onOpenEffect({ kind: 'dropShadow' }) },
              { label: 'Внутренняя тень (Inner Shadow)…', onClick: () => actions.onOpenEffect({ kind: 'innerShadow' }) },
              { label: 'Внешнее свечение (Outer Glow)…', onClick: () => actions.onOpenEffect({ kind: 'outerGlow' }) },
            ],
          },
          {
            label: 'Деформация и форма',
            submenu: [
              {
                label: 'Деформация (Warp)',
                submenu: WARP_MENU_ITEMS.map((w) => ({
                  label: w.label,
                  onClick: () => actions.onOpenEffect({ kind: 'warp', initialWarpStyle: w.style }),
                })),
              },
              { label: 'Зигзаг (Zig Zag)…', onClick: () => actions.onOpenEffect({ kind: 'zigzag' }) },
              { label: 'Загрубление (Roughen)…', onClick: () => actions.onOpenEffect({ kind: 'roughen' }) },
              { label: 'Скругление углов…', onClick: () => actions.onOpenEffect({ kind: 'roundCorners' }) },
              { label: 'Втягивание и раздувание…', onClick: () => actions.onOpenEffect({ kind: 'puckerBloat' }) },
            ],
          },
          {
            label: '3D и объём',
            submenu: [
              { label: '3D Поворот (перспектива)…', onClick: () => actions.onOpenEffect({ kind: '3d-rotate' }) },
              { label: '3D Выдавливание (Extrude)…', onClick: () => actions.onOpenEffect({ kind: '3d-extrude' }) },
            ],
          },
          {
            label: 'Цвет и фото',
            submenu: [
              { label: 'Цветокоррекция…', onClick: () => actions.onOpenEffect({ kind: 'colorAdjust' }) },
            ],
          },
          { type: 'sep' },
          { label: 'Очистить все эффекты слоя', disabled: !state.hasEffects, onClick: actions.onClearEffects },
        ],
      },
      {
        id: 'view',
        label: 'Просмотр',
        items: [
          { label: 'Увеличить', shortcut: 'Ctrl+=', onClick: actions.onZoomIn },
          { label: 'Уменьшить', shortcut: 'Ctrl+-', onClick: actions.onZoomOut },
          { label: 'Вписать артборд', shortcut: 'Ctrl+0', onClick: actions.onFitArtboard },
          { label: 'Приблизить к выделению', shortcut: 'Ctrl+2', disabled: !state.hasSelection, onClick: actions.onZoomToSelection },
          { label: 'Реальный размер (100%)', shortcut: 'Ctrl+1', onClick: actions.onResetZoom100 },
          { type: 'sep' },
          { label: 'Линейки', shortcut: 'Ctrl+R', checked: state.showRulers, onClick: actions.onToggleRulers },
          { label: 'Показать направляющие', checked: state.showGuides, onClick: actions.onToggleGuides },
          { label: 'Привязка к направляющим', checked: state.snapToGuides, onClick: actions.onToggleSnapToGuides },
          { label: 'Очистить направляющие', disabled: !state.hasGuides, onClick: actions.onClearGuides },
          { type: 'sep' },
          { label: 'Показать сетку', checked: state.showGrid, onClick: actions.onToggleGrid },
          { label: 'Привязка к объектам', checked: state.snapEnabled, onClick: actions.onToggleSnap },
          { label: 'Режим каркаса (Outline)', shortcut: 'Ctrl+Y', checked: state.outlineMode, onClick: actions.onToggleOutline },
        ],
      },
      {
        id: 'window',
        label: 'Окно',
        items: [
          { label: 'Панель инструментов', checked: state.showToolbar, onClick: actions.onToggleToolbar },
          { label: 'Слои', checked: state.showLayers, onClick: actions.onToggleLayers },
          { label: 'Инспектор', checked: state.showInspector, onClick: actions.onToggleInspector },
          { type: 'sep' },
          { label: 'Командная строка ИИ', shortcut: 'Ctrl+K', onClick: actions.onOpenCommandBar },
          { label: 'Проверить макет (Preflight)', onClick: actions.onRunPreflight },
        ],
      },
      {
        id: 'help',
        label: 'Справка',
        items: [
          { label: 'Обучение', shortcut: 'F1', onClick: actions.onOpenTutorial },
          { label: 'Горячие клавиши', onClick: actions.onOpenShortcuts },
          { type: 'sep' },
          { label: 'О приложении', onClick: actions.onOpenAbout },
        ],
      },
    ],
    [actions, state]
  );

  return (
    <nav ref={rootRef} className="flex items-center gap-0.5">
      {menus.map((menu) => {
        const isOpen = openMenuId === menu.id;
        return (
          <div key={menu.id} className="relative">
            <button
              type="button"
              data-tour={menu.id === 'effect' ? 'menu.effects' : `menu.${menu.id}`}
              onClick={() => setOpenMenuId((cur) => (cur === menu.id ? null : menu.id))}
              onMouseEnter={() => {
                if (openMenuId && openMenuId !== menu.id) {
                  setOpenMenuId(menu.id);
                }
              }}
              className={`h-7 whitespace-nowrap rounded px-2 text-[12px] transition-colors ${
                isOpen
                  ? 'bg-paper-hover font-medium text-paper-ink'
                  : 'text-paper-ink hover:bg-paper-hover'
              }`}
            >
              {menu.label}
            </button>

            {isOpen && (
              <MenuDropdown
                items={menu.items}
                onSelectDone={() => setOpenMenuId(null)}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
