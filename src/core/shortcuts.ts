export type ShortcutCategory = 'file' | 'tools' | 'edit' | 'view' | 'vector';

export type ShortcutActionId =
  | 'file.open'
  | 'file.save'
  | 'file.saveAs'
  | 'tool.select'
  | 'tool.node'
  | 'tool.pen'
  | 'tool.blob'
  | 'tool.text'
  | 'tool.eyedropper'
  | 'tool.shapeBuilder'
  | 'tool.pencil'
  | 'tool.knife'
  | 'action.placeImage'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copy'
  | 'edit.copySvg'
  | 'edit.paste'
  | 'edit.pasteInPlace'
  | 'edit.copyStyle'
  | 'edit.pasteStyle'
  | 'edit.duplicate'
  | 'view.fitArtboard'
  | 'view.zoomToSelection'
  | 'view.zoom100'
  | 'view.toggleGrid'
  | 'view.toggleRulers'
  | 'view.toggleSnap'
  | 'app.openSettings'
  | 'app.commandBar'
  | 'app.openTutorial'
  | 'vector.textToOutlines'
  | 'vector.combineCompound'
  | 'vector.splitCompound'
  | 'layer.backward'
  | 'layer.forward'
  | 'layer.group'
  | 'layer.ungroup'
  | 'layer.toggleLock';

export interface ShortcutDefinition {
  id: ShortcutActionId;
  label: string;
  category: ShortcutCategory;
  defaultCombo: string;
  altCombos?: string[];
  editable?: boolean;
  note?: string;
}

export const SHORTCUT_CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  file: 'Файл',
  tools: 'Инструменты и вставка',
  edit: 'Правка и буфер',
  view: 'Вид и настройки',
  vector: 'Контуры и слои',
};

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'file.open',
    label: 'Открыть проект (.locus)',
    category: 'file',
    defaultCombo: 'Ctrl+KeyO',
  },
  {
    id: 'file.save',
    label: 'Сохранить проект',
    category: 'file',
    defaultCombo: 'Ctrl+KeyS',
  },
  {
    id: 'file.saveAs',
    label: 'Сохранить проект как…',
    category: 'file',
    defaultCombo: 'Ctrl+Shift+KeyS',
  },
  {
    id: 'tool.select',
    label: 'Выделение (Select)',
    category: 'tools',
    defaultCombo: 'KeyV',
  },
  {
    id: 'tool.node',
    label: 'Прямое выделение (Узлы)',
    category: 'tools',
    defaultCombo: 'KeyA',
  },
  {
    id: 'tool.pen',
    label: 'Перо (Pen)',
    category: 'tools',
    defaultCombo: 'KeyP',
  },
  {
    id: 'tool.blob',
    label: 'Умная фигура (Smart Shape)',
    category: 'tools',
    defaultCombo: 'KeyB',
  },
  {
    id: 'tool.text',
    label: 'Текст (Type)',
    category: 'tools',
    defaultCombo: 'KeyT',
  },
  {
    id: 'tool.eyedropper',
    label: 'Пипетка (Eyedropper)',
    category: 'tools',
    defaultCombo: 'KeyE',
  },
  {
    id: 'tool.shapeBuilder',
    label: 'Конструктор фигур (Shape Builder)',
    category: 'tools',
    defaultCombo: 'KeyM',
    altCombos: ['Shift+KeyM'],
  },
  {
    id: 'tool.pencil',
    label: 'Карандаш (Pencil)',
    category: 'tools',
    defaultCombo: 'KeyN',
  },
  {
    id: 'tool.knife',
    label: 'Нож / Ножницы (Knife & Scissors)',
    category: 'tools',
    defaultCombo: 'KeyC',
  },
  {
    id: 'action.placeImage',
    label: 'Вставить изображение',
    category: 'tools',
    defaultCombo: 'KeyI',
  },
  {
    id: 'edit.undo',
    label: 'Отменить действие',
    category: 'edit',
    defaultCombo: 'Ctrl+KeyZ',
  },
  {
    id: 'edit.redo',
    label: 'Повторить действие',
    category: 'edit',
    defaultCombo: 'Ctrl+Shift+KeyZ',
    altCombos: ['Ctrl+KeyY'],
  },
  {
    id: 'edit.copy',
    label: 'Копировать слои',
    category: 'edit',
    defaultCombo: 'Ctrl+KeyC',
  },
  {
    id: 'edit.paste',
    label: 'Вставить слои (+16 px)',
    category: 'edit',
    defaultCombo: 'Ctrl+KeyV',
  },
  {
    id: 'edit.pasteInPlace',
    label: 'Вставить на то же место',
    category: 'edit',
    defaultCombo: 'Ctrl+Shift+KeyV',
  },
  {
    id: 'edit.copyStyle',
    label: 'Копировать стиль слоя',
    category: 'edit',
    defaultCombo: 'Ctrl+Alt+KeyC',
  },
  {
    id: 'edit.copySvg',
    label: 'Копировать как SVG',
    category: 'edit',
    defaultCombo: 'Ctrl+Shift+KeyC',
  },
  {
    id: 'edit.pasteStyle',
    label: 'Вставить стиль слоя',
    category: 'edit',
    defaultCombo: 'Ctrl+Alt+KeyV',
  },
  {
    id: 'edit.duplicate',
    label: 'Дублировать выделение',
    category: 'edit',
    defaultCombo: 'Ctrl+KeyD',
  },
  {
    id: 'view.fitArtboard',
    label: 'Вписать артборд в экран',
    category: 'view',
    defaultCombo: 'Ctrl+Digit0',
  },
  {
    id: 'view.zoomToSelection',
    label: 'Приблизить к выделению',
    category: 'view',
    defaultCombo: 'Ctrl+Digit2',
  },
  {
    id: 'view.zoom100',
    label: 'Масштаб 100%',
    category: 'view',
    defaultCombo: 'Ctrl+Digit1',
  },
  {
    id: 'view.toggleGrid',
    label: 'Показать / скрыть сетку',
    category: 'view',
    defaultCombo: 'Ctrl+Quote',
  },
  {
    id: 'view.toggleRulers',
    label: 'Показать / скрыть линейки',
    category: 'view',
    defaultCombo: 'Ctrl+KeyR',
  },
  {
    id: 'view.toggleSnap',
    label: 'Включить / выключить привязку',
    category: 'view',
    defaultCombo: 'Ctrl+Shift+Quote',
  },
  {
    id: 'app.openSettings',
    label: 'Открыть настройки',
    category: 'view',
    defaultCombo: 'Ctrl+Comma',
  },
  {
    id: 'app.commandBar',
    label: 'Командная строка ИИ',
    category: 'view',
    defaultCombo: 'Ctrl+KeyK',
    editable: false,
    note: 'Этап 5',
  },
  {
    id: 'app.openTutorial',
    label: 'Открыть обучение',
    category: 'view',
    defaultCombo: 'F1',
    editable: false,
  },
  {
    id: 'vector.textToOutlines',
    label: 'Перевести текст в кривые',
    category: 'vector',
    defaultCombo: 'Ctrl+Shift+KeyO',
  },
  {
    id: 'vector.combineCompound',
    label: 'Собрать составной контур',
    category: 'vector',
    defaultCombo: 'Ctrl+Digit8',
  },
  {
    id: 'vector.splitCompound',
    label: 'Разбить составной контур',
    category: 'vector',
    defaultCombo: 'Ctrl+Shift+Digit8',
    altCombos: ['Ctrl+Alt+Digit8'],
  },
  {
    id: 'layer.backward',
    label: 'Опустить слой ниже',
    category: 'vector',
    defaultCombo: 'BracketLeft',
  },
  {
    id: 'layer.forward',
    label: 'Поднять слой выше',
    category: 'vector',
    defaultCombo: 'BracketRight',
  },
  {
    id: 'layer.group',
    label: 'Сгруппировать',
    category: 'vector',
    defaultCombo: 'Ctrl+KeyG',
  },
  {
    id: 'layer.ungroup',
    label: 'Разгруппировать',
    category: 'vector',
    defaultCombo: 'Ctrl+Shift+KeyG',
  },
  {
    id: 'layer.toggleLock',
    label: 'Заблокировать / разблокировать',
    category: 'vector',
    defaultCombo: 'Ctrl+KeyL',
  },
];

const BARE_MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

const CODE_LABELS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
};

export type ShortcutKeyEventLike = Pick<
  KeyboardEvent,
  'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

export function eventToShortcutCombo(
  event: ShortcutKeyEventLike
): string | null {
  if (!event.code || BARE_MODIFIER_CODES.has(event.code)) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(event.code);
  return parts.join('+');
}

export function formatShortcutCombo(combo: string): string {
  if (!combo) return '—';
  return combo
    .split('+')
    .map((part) => {
      if (part.startsWith('Key')) return part.slice(3);
      if (part.startsWith('Digit')) return part.slice(5);
      return CODE_LABELS[part] ?? part;
    })
    .join('+');
}

export function getEffectiveShortcut(
  actionId: ShortcutActionId,
  overrides?: Record<string, string>
): string {
  const def = SHORTCUT_DEFINITIONS.find((d) => d.id === actionId);
  if (!def) return '';
  if (def.editable === false) return def.defaultCombo;
  const custom = overrides?.[actionId];
  return typeof custom === 'string' && custom.length > 0 ? custom : def.defaultCombo;
}

export function matchShortcut(
  event: ShortcutKeyEventLike,
  overrides?: Record<string, string>
): ShortcutActionId | null {
  const combo = eventToShortcutCombo(event);
  if (!combo) return null;

  for (const def of SHORTCUT_DEFINITIONS) {
    const primary = getEffectiveShortcut(def.id, overrides);
    if (primary === combo) {
      return def.id;
    }
    const isOverridden =
      def.editable !== false && Boolean(overrides?.[def.id]);
    if (!isOverridden && def.altCombos?.includes(combo)) {
      return def.id;
    }
  }
  return null;
}

export function findShortcutConflict(
  actionId: ShortcutActionId,
  combo: string,
  overrides?: Record<string, string>
): ShortcutDefinition | null {
  if (!combo) return null;
  for (const def of SHORTCUT_DEFINITIONS) {
    if (def.id === actionId) continue;
    const primary = getEffectiveShortcut(def.id, overrides);
    if (primary === combo) {
      return def;
    }
    const isOverridden =
      def.editable !== false && Boolean(overrides?.[def.id]);
    if (!isOverridden && def.altCombos?.includes(combo)) {
      return def;
    }
  }
  return null;
}
