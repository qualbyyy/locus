export type TutorialTargetId =
  | 'topbar.document'
  | 'topbar.undo'
  | 'topbar.redo'
  | 'topbar.commandBar'
  | 'topbar.export'
  | 'topbar.zoom'
  | 'topbar.settings'
  | 'menu.file'
  | 'menu.object'
  | 'menu.effects'
  | 'menu.view'
  | 'menu.help'
  | 'toolbar.root'
  | 'tool.select'
  | 'tool.node'
  | 'tool.pen'
  | 'tool.blob'
  | 'tool.text'
  | 'tool.eyedropper'
  | 'toolbar.fit'
  | 'toolbar.grid'
  | 'toolbar.snap'
  | 'canvas.root'
  | 'layers.root'
  | 'layers.list'
  | 'inspector.root'
  | 'inspector.transform'
  | 'inspector.appearance'
  | 'inspector.vectorOps'
  | 'inspector.text';

export interface TutorialTargetDefinition {
  selector: string;
  panel?: 'toolbar' | 'layers' | 'inspector';
}

export const TUTORIAL_TARGETS: Record<
  TutorialTargetId,
  TutorialTargetDefinition
> = {
  'topbar.document': { selector: '[data-tour="topbar.document"]' },
  'topbar.undo': { selector: '[data-tour="topbar.undo"]' },
  'topbar.redo': { selector: '[data-tour="topbar.redo"]' },
  'topbar.commandBar': { selector: '[data-tour="topbar.commandBar"]' },
  'topbar.export': { selector: '[data-tour="topbar.export"]' },
  'topbar.zoom': { selector: '[data-tour="topbar.zoom"]' },
  'topbar.settings': { selector: '[data-tour="topbar.settings"]' },
  'menu.file': { selector: '[data-tour="menu.file"]' },
  'menu.object': { selector: '[data-tour="menu.object"]' },
  'menu.effects': { selector: '[data-tour="menu.effects"]' },
  'menu.view': { selector: '[data-tour="menu.view"]' },
  'menu.help': { selector: '[data-tour="menu.help"]' },
  'toolbar.root': {
    selector: '[data-tour="toolbar.root"]',
    panel: 'toolbar',
  },
  'tool.select': { selector: '[data-tour="tool.select"]', panel: 'toolbar' },
  'tool.node': { selector: '[data-tour="tool.node"]', panel: 'toolbar' },
  'tool.pen': { selector: '[data-tour="tool.pen"]', panel: 'toolbar' },
  'tool.blob': { selector: '[data-tour="tool.blob"]', panel: 'toolbar' },
  'tool.text': { selector: '[data-tour="tool.text"]', panel: 'toolbar' },
  'tool.eyedropper': {
    selector: '[data-tour="tool.eyedropper"]',
    panel: 'toolbar',
  },
  'toolbar.fit': { selector: '[data-tour="toolbar.fit"]', panel: 'toolbar' },
  'toolbar.grid': { selector: '[data-tour="toolbar.grid"]', panel: 'toolbar' },
  'toolbar.snap': { selector: '[data-tour="toolbar.snap"]', panel: 'toolbar' },
  'canvas.root': { selector: '[data-tour="canvas.root"]' },
  'layers.root': { selector: '[data-tour="layers.root"]', panel: 'layers' },
  'layers.list': { selector: '[data-tour="layers.list"]', panel: 'layers' },
  'inspector.root': {
    selector: '[data-tour="inspector.root"]',
    panel: 'inspector',
  },
  'inspector.transform': {
    selector: '[data-tour="inspector.transform"]',
    panel: 'inspector',
  },
  'inspector.appearance': {
    selector: '[data-tour="inspector.appearance"]',
    panel: 'inspector',
  },
  'inspector.vectorOps': {
    selector: '[data-tour="inspector.vectorOps"]',
    panel: 'inspector',
  },
  'inspector.text': {
    selector: '[data-tour="inspector.text"]',
    panel: 'inspector',
  },
};
