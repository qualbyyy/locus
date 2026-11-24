export type ContextMenuArea = 'canvas' | 'app' | 'editable';

export type ContextMenuActionId =
  | 'paste'
  | 'selectAll'
  | 'deselect'
  | 'cut'
  | 'copy'
  | 'duplicate'
  | 'delete'
  | 'bringForward'
  | 'sendBackward'
  | 'ai';

export interface ContextMenuTarget {
  area: ContextMenuArea;
  layerIds: string[];
  hasCopiedLayers: boolean;
}

export interface ContextMenuItem {
  id: ContextMenuActionId;
  label: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  emphasis?: 'normal' | 'accent';
}

export type ContextMenuModel = ContextMenuItem[];

export type ContextMenuActionKind = 'clipboard' | 'scene' | 'selection' | 'ai';

export const CONTEXT_MENU_ACTION_KINDS: Record<ContextMenuActionId, ContextMenuActionKind> = {
  cut: 'clipboard',
  copy: 'clipboard',
  paste: 'clipboard',
  selectAll: 'selection',
  deselect: 'selection',
  duplicate: 'scene',
  delete: 'scene',
  bringForward: 'scene',
  sendBackward: 'scene',
  ai: 'ai',
};

export function isObjectContextAction(action: ContextMenuActionId): boolean {
  return CONTEXT_MENU_ACTION_KINDS[action] === 'scene' || action === 'ai';
}

export function buildContextMenuModel(target: ContextMenuTarget): ContextMenuModel {
  if (target.area === 'editable') {
    return [
      { id: 'cut', label: 'Вырезать' },
      { id: 'copy', label: 'Копировать' },
      { id: 'paste', label: 'Вставить' },
      { id: 'selectAll', label: 'Выделить всё', separatorBefore: true },
    ];
  }

  if (target.layerIds.length > 0) {
    return [
      { id: 'cut', label: 'Вырезать' },
      { id: 'copy', label: 'Копировать' },
      { id: 'duplicate', label: 'Дублировать' },
      { id: 'delete', label: 'Удалить', separatorBefore: true },
      { id: 'bringForward', label: 'Переместить вперёд', separatorBefore: true },
      { id: 'sendBackward', label: 'Переместить назад' },
      {
        id: 'ai',
        label: 'ИИ…',
        disabled: false,
        separatorBefore: true,
        emphasis: 'accent',
      },
    ];
  }

  return [
    { id: 'paste', label: 'Вставить', disabled: !target.hasCopiedLayers },
    { id: 'selectAll', label: 'Выделить всё', separatorBefore: true },
    { id: 'deselect', label: 'Снять выделение' },
  ];
}

type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

type TextAction = Extract<
  ContextMenuActionId,
  'cut' | 'copy' | 'paste' | 'selectAll'
>;

function isTextControl(element: EditableElement): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function replaceSelectedText(element: EditableElement, text: string): void {
  if (isTextControl(element)) {
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    element.value = `${element.value.slice(0, start)}${text}${element.value.slice(end)}`;
    const caret = start + text.length;
    element.setSelectionRange(caret, caret);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  document.execCommand('insertText', false, text);
}

export async function runTextContextAction(
  action: TextAction,
  element: EditableElement
): Promise<void> {
  element.focus();

  if (action === 'paste') {
    try {
      const text = await globalThis.navigator?.clipboard?.readText?.();
      if (typeof text === 'string') replaceSelectedText(element, text);
    } catch {
      // Clipboard permissions may be unavailable outside a user gesture.
    }
    return;
  }

  const command = action === 'selectAll' ? 'selectAll' : action;
  try {
    if (document.execCommand(command)) return;
  } catch {
    // Use the direct input fallback below.
  }

  if (action === 'selectAll' && isTextControl(element)) {
    element.select();
  }
}
