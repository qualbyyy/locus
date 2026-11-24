# Global Context Menu, Canvas Zoom & About Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser context menus globally, keep `Ctrl/Cmd + wheel` and trackpad pinch zoom scoped to the Paper canvas, and add the revised About/settings footer UI.

**Architecture:** Add small pure modules for context-menu models, zoom-event handling, and application diagnostics so behavior can be tested without a React renderer. Integrate them through a fixed-position `ContextMenu` rendered by `App`, a Paper.js hit-test callback from `PaperCanvas`, and a new About tab/footer in `SettingsModal`.

**Tech Stack:** React 19, TypeScript, Zustand, Paper.js (`paper-core`), Vitest, Tailwind CSS v4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-24-custom-context-menu-canvas-zoom-about-design.md`

## Global Constraints

- Do not add dependencies.
- Zustand and existing commands remain the only way to mutate the scene.
- Paper.js remains responsible for canvas hit-testing; React owns the menu and settings UI.
- Use the existing paper theme: 1px borders, flat surfaces, no heavy shadows or blur.
- Only `Ctrl/Cmd + wheel` and pinch-gesture events zoom; ordinary wheel does not zoom.
- Diagnostics must never include API keys, project contents, or asset bytes.
- Do not invent missing license or contact values; show neutral unavailable text until supplied.

## Review Focus

- A right-click on every non-input area must suppress the browser menu and open the app menu without breaking Escape/outside-click closing; test the pure menu model and exercise the root integration manually in the final verification.
- A right-click over a locked/hidden canvas object must resolve the correct layer context without mutating selection; test hit-test callback wiring and verify manually with a locked layer.
- A text field must keep copy/cut/paste/select-all usable through the custom menu; test the text-action dispatcher with a jsdom input/textarea selection.
- A trackpad pinch (`WheelEvent.ctrlKey === true`) over a panel must not resize the WebView, while the same gesture over the canvas changes only Paper view zoom; test the zoom predicate and run the end-to-end UI scenario.
- Malformed or unavailable runtime metadata must render safely and diagnostics must exclude secret settings; test the formatter with missing fields and an AI API key in settings.

---

### Task 1: Pure context-menu model and text actions

**Files:**
- Create: `src/core/contextMenu.ts`
- Test: `tests/ui_features.test.ts`

**Interfaces:**
- Consumes: `Layer` data, current selection IDs, clipboard availability, and an editable-target flag.
- Produces: `ContextMenuItem`, `ContextMenuModel`, `buildContextMenuModel(target)`, and `runTextContextAction(action, element)` used by `App`/`ContextMenu`.

- [ ] **Step 1: Write the failing tests**

  Add tests named:
  - `builds object actions and an AI action for a layer context` — assert the model contains `copy`, `cut`, `duplicate`, `delete`, `ai`, and reorder actions for a non-empty layer context, with `ai` enabled.
  - `builds empty-area actions without object-only actions` — assert empty canvas has paste/select-all/deselect and no delete or AI action.
  - `builds text editing actions for an editable target` — assert `cut`, `copy`, `paste`, and `selectAll` are available and scene actions are absent.
  - `runs text actions against the active selection` — use jsdom `input` and `textarea` elements to verify select-all and copy/cut behavior through the exported dispatcher.

- [ ] **Step 2: Run the focused tests to verify they fail**

  Run: `npm test -- tests/ui_features.test.ts`

  Expected: FAIL because `src/core/contextMenu.ts` does not exist.

- [ ] **Step 3: Implement `src/core/contextMenu.ts`**

  Define:
  ```ts
  export type ContextMenuArea = 'canvas' | 'app' | 'editable';
  export type ContextMenuActionId =
    | 'paste' | 'selectAll' | 'deselect' | 'cut' | 'copy'
    | 'duplicate' | 'delete' | 'bringForward' | 'sendBackward' | 'ai';
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
  export function buildContextMenuModel(target: ContextMenuTarget): ContextMenuItem[];
  export function runTextContextAction(
    action: Extract<ContextMenuActionId, 'cut' | 'copy' | 'paste' | 'selectAll'>,
    element: HTMLInputElement | HTMLTextAreaElement | HTMLElement
  ): Promise<void>;
  ```
  Use existing `navigator.clipboard` when available and a safe `document.execCommand` fallback for copy/cut/select-all. For paste, use `navigator.clipboard.readText()` and replace the active selection; failures resolve without throwing.

- [ ] **Step 4: Run the focused tests to verify they pass**

  Run: `npm test -- tests/ui_features.test.ts`

  Expected: PASS for all context-menu model and text-action tests.

---

### Task 2: Zoom event helpers and application diagnostics

**Files:**
- Create: `src/engine/zoom.ts`
- Create: `src/core/appInfo.ts`
- Modify: `tests/ui_features.test.ts`

**Interfaces:**
- Consumes: wheel modifier flags, wheel delta, `wheelZoomSpeed`, package metadata, and injected runtime values.
- Produces: `isCanvasZoomWheel`, `getWheelZoomFactor`, `APP_INFO`, `RuntimeDiagnostics`, and `formatDiagnostics` for UI and tests.

- [ ] **Step 1: Write the failing tests**

  Add tests named:
  - `recognizes ctrl and meta wheel gestures but not ordinary wheel` — assert the predicate is true for `ctrlKey` and `metaKey`, false otherwise.
  - `computes a stable zoom factor from wheel delta and speed` — assert `deltaY > 0` zooms out, `deltaY < 0` zooms in, and both results are finite.
  - `formats safe diagnostic information without secrets` — pass a runtime object plus settings containing a fake API key and assert the output includes app/version/platform but not the key.
  - `uses neutral labels when license or contacts are unavailable` — assert the exported About metadata has non-empty fallback text.

- [ ] **Step 2: Run the focused tests to verify they fail**

  Run: `npm test -- tests/ui_features.test.ts`

  Expected: FAIL because the zoom and app-info exports do not exist.

- [ ] **Step 3: Implement `src/engine/zoom.ts` and `src/core/appInfo.ts`**

  Define:
  ```ts
  export function isCanvasZoomWheel(event: Pick<WheelEvent, 'ctrlKey' | 'metaKey'>): boolean;
  export function getWheelZoomFactor(deltaY: number, wheelZoomSpeed: number): number;
  ```
  Use the existing exponential behavior with the `Ctrl/Cmd` sensitivity `0.01 * wheelZoomSpeed`.

  Define `APP_INFO` from the project version (`package.json`, with `Locus` as the display name), neutral values for missing license/creator/contact data, and a short description. Export:
  ```ts
  export interface RuntimeDiagnostics { appVersion: string; platform: string; userAgent: string; mode: string; }
  export function getRuntimeDiagnostics(): RuntimeDiagnostics;
  export function formatDiagnostics(runtime: RuntimeDiagnostics): string;
  ```
  `formatDiagnostics` must only use its input fields and never read AI settings or scene data.

- [ ] **Step 4: Run the focused tests to verify they pass**

  Run: `npm test -- tests/ui_features.test.ts`

  Expected: PASS for zoom and diagnostics tests.

---

### Task 3: Global fixed-position context-menu component

**Files:**
- Create: `src/ui/ContextMenu.tsx`
- Modify: `src/index.css` only if a reusable focus style is required

**Interfaces:**
- Consumes: fixed viewport position, `ContextMenuItem[]`, and action/close callbacks.
- Produces: a keyboard- and pointer-dismissible custom menu rendered by `App`.

- [ ] **Step 1: Implement `ContextMenu.tsx`**

  Define:
  ```ts
  export interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onAction: (action: ContextMenuActionId) => void;
    onClose: () => void;
  }
  export function ContextMenu(props: ContextMenuProps): JSX.Element;
  ```
  Render a `role="menu"` with `role="menuitem"` buttons, the accent style for the AI item, and a fixed position clamped to `window.innerWidth/innerHeight`. Add an effect that closes on `Escape` and pointer-down outside. Keep the existing border/paper palette and avoid browser-native menu behavior.

- [ ] **Step 2: Run type-checking**

  Run: `npx tsc --noEmit`

  Expected: PASS; the component is not integrated yet but its exported types compile.

---

### Task 4: Wire the menu to App, canvas hit-testing, and existing commands

**Files:**
- Modify: `src/engine/PaperCanvas.tsx`
- Modify: `src/App.tsx`
- Modify: `src/ui/LayersPanel.tsx`
- Modify: `tests/ui_features.test.ts`

**Interfaces:**
- Consumes: `findTopLayerAtPoint` from `engine/tools/selectTool`, `ContextMenu`, existing clipboard/command callbacks, and `runTextContextAction`.
- Produces: global `contextmenu` handling, object-aware layer IDs, and the visible `ИИ…` menu action wired to the current CommandBar notice callback.

- [ ] **Step 1: Add the failing integration-oriented assertions**

  Extend the pure tests with:
  - a target containing a layer ID always receives the accent `ai` item;
  - a target with no layer IDs never dispatches object deletion/ordering actions;
  - a `ContextMenu` action mapping table covers `copy`, `cut`, `duplicate`, `delete`, `bringForward`, `sendBackward`, and `ai`.

- [ ] **Step 2: Add the PaperCanvas callback and hit-test**

  Add an optional prop:
  ```ts
  onOpenContextMenu?: (payload: { x: number; y: number; layerId: string | null }) => void;
  ```
  Install a native `contextmenu` listener with the existing canvas lifecycle. Convert the event to project coordinates, call `findTopLayerAtPoint(buildToolContext(rig), point, undefined, { includeLocked: true })`, prevent the browser menu, and report the hit layer without changing selection. Update refs/dependencies consistently with the current effect.

- [ ] **Step 3: Add global App state and dispatch**

  Add `contextMenu` state containing `x`, `y`, `area`, and `layerIds`. Add a root `onContextMenu` handler that always calls `preventDefault`, ignores canvas events already handled by `PaperCanvas`, detects `[data-layer-id]` rows and editable elements, and otherwise uses current selection. Render `ContextMenu` when state is present.

  Map menu actions to existing functions: `copySelectedLayers`, `deleteLayers`, `duplicateLayers`, `pasteLayers`, `selectAllLayers`, `deselectAllLayers`, `reorderLayer`, and the existing `showNotice('ИИ CommandBar (Ctrl+K) появится на Этапе 5')` callback for `ai`. Close the menu after every action. Do not call store setters from the menu other than through existing commands/selection APIs.

- [ ] **Step 4: Mark layer rows for object-aware context**

  Add `data-layer-id={layer.id}` to each `LayersPanel` row and stop propagation only for existing row controls, so the root handler can identify the row target without changing selection behavior.

- [ ] **Step 5: Run focused tests and type-checking**

  Run: `npm test -- tests/ui_features.test.ts && npx tsc --noEmit`

  Expected: PASS with no TypeScript errors.

---

### Task 5: Scope wheel/pinch zoom to PaperCanvas

**Files:**
- Modify: `src/engine/PaperCanvas.tsx`
- Modify: `src/App.tsx`
- Modify: `tests/ui_features.test.ts`

**Interfaces:**
- Consumes: `isCanvasZoomWheel` and `getWheelZoomFactor` from `engine/zoom.ts`.
- Produces: canvas-only zoom for modifier wheel/pinch events and blocked WebView zoom elsewhere.

- [ ] **Step 1: Add the failing behavior assertion**

  Add a test named `uses modifier-only wheel zoom semantics` asserting that ordinary wheel is not a canvas zoom event and a `Ctrl/Cmd` event is.

- [ ] **Step 2: Update PaperCanvas wheel handling**

  In `handleWheel`, return without preventing default for ordinary wheel. For `Ctrl/Cmd` wheel, prevent default, calculate the factor with `getWheelZoomFactor`, clamp to `MIN_ZOOM/MAX_ZOOM`, preserve the point under the cursor, redraw overlays, and notify `onZoomChange` exactly as current zoom helpers do.

- [ ] **Step 3: Update App WebView protection**

  Keep the window-level non-passive wheel guard only for `Ctrl/Cmd` events outside the canvas, so panels cannot trigger WebView zoom. Retain the existing gesture cancellation. Do not block ordinary wheel scrolling globally.

- [ ] **Step 4: Run verification**

  Run: `npm test -- tests/ui_features.test.ts && npx tsc --noEmit`

  Expected: PASS. Manually verify `Ctrl + wheel` over the canvas changes only the canvas, while the same gesture over the top bar/panels leaves UI scale unchanged.

---

### Task 6: Add revised About tab and bottom Training button

**Files:**
- Modify: `src/ui/SettingsModal.tsx`
- Modify: `tests/ui_features.test.ts`

**Interfaces:**
- Consumes: `APP_INFO`, `getRuntimeDiagnostics`, and `formatDiagnostics`.
- Produces: an About tab without a capabilities section, safe diagnostic copy, and a bottom `Обучение` placeholder button.

- [ ] **Step 1: Add pure metadata assertions**

  Extend tests to assert the About view data contains the app name/version and no capabilities list, and that diagnostics formatting remains secret-free when settings include API keys.

- [ ] **Step 2: Add the About tab**

  Add `Info` to the tab icon imports, extend `SettingsTabId` with `'about'`, and add the tab after the AI tab. Render identity, description, license/creator/contact fallback values, links as unavailable placeholders until URLs are supplied, third-party component note, and a `Скопировать сведения о системе` button using the Clipboard API with a safe notice/error path.

- [ ] **Step 3: Add the bottom Training button**

  Add a bottom border-separated footer inside the modal, below the tab content, with a disabled `Обучение` button and a short “раздел будет добавлен позже” hint. Keep the footer visible regardless of the active tab.

- [ ] **Step 4: Run focused tests and type-checking**

  Run: `npm test -- tests/ui_features.test.ts && npx tsc --noEmit`

  Expected: PASS with no unused imports/locals.

---

### Task 7: Full verification and workspace hygiene

**Files:**
- Modify: any files required by failures only; do not add unrelated changes.

- [ ] **Step 1: Run the complete project checks**

  Run: `npm test && npm run build`

  Expected: all Vitest tests pass and TypeScript/Vite build exits with code `0`.

- [ ] **Step 2: Review the delivered behavior manually**

  Verify:
  - right-click in the canvas, panels, top bar, and text inputs opens the custom menu;
  - object context menu includes the AI item and does not change selection just by opening;
  - `Escape` and outside click close the menu;
  - `Ctrl/Cmd + wheel` and trackpad pinch zoom only the canvas to the cursor;
  - ordinary wheel does not zoom;
  - Settings → About has no capabilities block, includes the metadata/diagnostics, and has the bottom Training placeholder.

- [ ] **Step 3: Inspect the final diff and generated files**

  Run: `git status --short && git diff --stat && git diff --check`

  Expected: only the intended source, test, and design/plan files are changed; no test logs or build artifacts are added.
