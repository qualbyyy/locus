# Locus — Automated Vector Editor (Illustrator Alternative)

## 1. Продукт и границы MVP

Locus — локальный десктопный векторный редактор (Tauri v2 + React 19 + Paper.js) со светлой «бумажной» эстетикой, автоматизацией рутины и ИИ-оператором через tool calling (BYOK). Геометрия всегда остаётся редактируемым вектором, серия правок ИИ откатывается одним `Ctrl+Z`.

**В MVP:** 1 артборд на документ; 6 встроенных статических шрифтов (400/700, кириллица); плоские заливки/обводки + `opacity`; Smart Shape (`blob`, `ellipse`, `rect`, `polygon`, `star`); инструменты `V`/`A`/`P`/`B`/`T`/`I`/`E`; булевы операции, Compound Path, Clipping Mask; экспорт `.locus` / `.ai` / `.svg` / `.psd`; ИИ через Gemini, OpenAI-compatible, Anthropic, Ollama.

**Post-MVP:** несколько артбордов, системные шрифты, градиенты и режимы наложения, импорт SVG/AI в редактируемые слои, обучение этапы 2–3 (подсветка, песочница).

## 2. Визуальный стиль и интерфейс (UI/UX)

### Эстетика («Бумажная» светлая тема)

Строгое правило оформления: **никаких тяжёлых теней, декоративных градиентов и `backdrop-filter` / Gaussian blur**. Иерархия строится на контрасте тёплых бумажных поверхностей и чётких границ `1px solid #dfd9ce`. Конфигурация Tailwind CSS v4 (`src/index.css`):

```css
@theme {
  --color-paper-bg: #f5f2eb;         /* фон интерфейса */
  --color-paper-canvas: #ebe6dc;     /* область вокруг артборда */
  --color-paper-panel: #faf8f4;      /* панели, карточки, модалки */
  --color-paper-hover: #f0ece3;      /* ховер кнопок и строк */
  --color-paper-border: #dfd9ce;     /* границы 1px */
  --color-paper-accent: #da7756;     /* терракотовый акцент, узлы */
  --color-paper-accent-hover: #c86443;
  --color-paper-ink: #1c1b1a;        /* текст и иконки */
  --color-paper-muted: #6b665e;      /* вторичный текст, шорткаты */
  --color-paper-danger: #b83b2e;     /* ошибки, удаление */
  --font-ui: "Golos Text", "Manrope", system-ui, sans-serif;
  --font-display: "Manrope", "Golos Text", system-ui, sans-serif;
}
```

Шрифты интерфейса — пресеты в `src/core/typography.ts` (дизайнерские пары UI/акцентных шрифтов из встроенного каталога) + режим «Свой шрифт» (`.ttf/.otf/.woff` → `$APPCONFIG/locus/ui-font.json`). Моноширинные в интерфейсе не используются (JetBrains Mono — только в каталоге текстовых слоёв).

### Компоновка окна (минимальный размер `1024 × 680`)

- **`TopBar` 40px:** слева лого/имя документа (клик — переименование), индикатор несохранённого `•`, Новый (`StartModal`), Открыть, Сохранить, Экспорт (`.ai`/`.svg`/`.psd`); центр — Undo/Redo и `CommandBar` (`Ctrl+K`); справа — масштаб в процентах (клик — Fit Artboard) и настройки.
- **`Toolbar` 44px:** вертикальный стек `V`, `A`, `P`, `B`, `T`, `I` с тултипами и хоткеями + быстрый `Fit` (`Ctrl+0`).
- **`PaperCanvas` (`flex-1`):** бесконечная область `#ebe6dc`, фиксированный артборд (`scene.background`), плавный зум колёсиком к курсору, панорама `Space+Drag` или средняя кнопка.
- **Правая колонка 280px:**
  - `LayersPanel` ~45%: дерево в обратном порядке `scene.layers` (верхний в списке = верхний по Z), иконка типа, `↳ Mask`, Eye, Lock, двойной клик — переименование, перемещение вверх/вниз, удаление.
  - `Inspector` ~55%, контекст выделения:
    - нет выделения — артборд: `width`, `height`, `dpi`, `background`;
    - `PathLayer` — `x, y, rotation, scale`, `fill` (+«Без заливки»), `stroke` (`color`, `width`, `lineCap`, `lineJoin`), `opacity`, `fillRule`, ползунки `Smooth`/`Wobble` или параметры Smart Shape, Make/Release Clipping Mask;
    - 2+ слоёв — булевы `Unite`/`Subtract`/`Intersect` (если все `path`), выравнивание `left/center/right/top/middle/bottom`, распределение `distribute_h/distribute_v`, `Create Clipping Mask` (верхний `PathLayer` маскирует остальные);
    - `TextLayer` — 6 шрифтов, вес 400/700, размер, `lineHeight`, выравнивание, цвет;
    - `ImageLayer` — позиция, масштаб, прозрачность, «Заменить изображение».
- **Модалки:** `StartModal` (пресет/свой размер/`dpi` или открыть `.locus`), `CommandBar` (`Ctrl+K`: промпт, статус, лог вызванных инструментов, «Стоп» через `AbortController`, человекочитаемые ошибки), `SettingsModal` (`Ctrl+,`: провайдер, ключи, модели, `baseURL`, проверка подключения), `UnsavedChangesModal`, `TutorialModal`.

### Smart Shape (B) и Type (T)

- `blob` — `points` 3..24, `radius`, `wobble` 0..1; `ellipse` — `radiusX`/`radiusY` (Shift — круг); `rect` — `width`/`height`/`cornerRadius` (Shift — квадрат); `polygon` — `points` 3..24, `radius`; `star` — `points` 3..24, `radius`, `innerRadiusRatio` 0.1..0.9. Протягивание мышью по холсту сразу создаёт `PathLayer` с пересчётом узлов в локальные координаты.
- `T`: клик по пустому месту создаёт `TextLayer` («Новый текст») и сразу включает редактирование. Двойной клик (`V`/`T`) открывает `<textarea>` ровно поверх объекта с теми же `fontFamily`, `fontWeight`, `fontSize * zoom`, `lineHeight`, `textAlign`, `color`; выход — Blur, `Ctrl+Enter` или `Escape`; коммит одной командой `updateLayers`.

### Горячие клавиши

**Правило ввода:** все однобуквенные шорткаты и `Space`/`Delete`/`Backspace` игнорируются, если `document.activeElement` — `INPUT`, `TEXTAREA`, `SELECT` или `isContentEditable`. `Ctrl` ≡ `Cmd` на macOS.

| Клавиши | Действие |
| :--- | :--- |
| `V` / `A` / `P` / `B` / `T` / `I` / `E` | Select / Direct Select / Pen / Smart Shape / Type / Place Image / Eyedropper |
| `Space+Drag` | временная панорама |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+S` / `Ctrl+O` / `Ctrl+K` | Сохранить / Открыть / CommandBar |
| `Ctrl+D` / `Ctrl+Shift+O` | Дублировать (+16,+16) / текст в кривые |
| `Ctrl+8` / `Ctrl+Shift+8` | Compound Path / разбить на части |
| `Ctrl+C` `Ctrl+V` `Ctrl+Shift+V` `Ctrl+Alt+C` `Ctrl+Alt+V` | копия слоёв / вставка / вставка на место / копия стиля / вставка стиля |
| `Delete`/`Backspace` | удалить слои (в `A` — узел, если узлов > 2) |
| `Ctrl+0` / `Ctrl+1` | Fit Artboard / масштаб 100% |
| `[` / `]` | слой вниз / вверх на 1 позицию |
| `Escape` / `Shift` | закрыть/завершить/снять выделение / пропорции, квадрат-круг, угол 45° |

## 3. Стек, зависимости, конфигурация Tauri v2

- **Окружение (Linux/EndeavourOS):** `node 26.x`, `npm 12.x`, `rustc/cargo 1.99`, локальный `@tauri-apps/cli`; системные `webkit2gtk-4.1`, `gtk+-3.0`, `librsvg-2.0`, `libsoup-3.0`, `openssl`.
- **Скрипты:** `dev` = `vite`, `build` = `tsc --noEmit && vite build`, `test` = `vitest run`, `install:linux` = `node scripts/install-linux-launcher.mjs <binary>`, `tauri` = `tauri`. Установщик кладёт бинарник в `~/.local/opt/locus/locus`, иконку в `~/.local/share/icons/hicolor/128x128/apps/locus.png` и ярлык `~/.local/share/applications/locus.desktop` (без root, идемпотентно).
- **`dependencies`:** `react`/`react-dom` 19, `zustand` 5, `zundo`, `paper` (импорт строго `paper/dist/paper-core`), `jszip`, `pdf-lib` + `@pdf-lib/fontkit`, `ag-psd`, `lucide-react`, `@tauri-apps/api`, `@tauri-apps/plugin-http`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`.
- **`devDependencies`:** `typescript`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `@types/react`, `@types/react-dom`, `@types/paper`, `@tauri-apps/cli`, `vitest`, `jsdom`.
- **Vite:** `react()` + `tailwindcss()`, порт 1420, `strictPort: true`, `watch.ignored: ['**/src-tauri/**']`, `clearScreen: false`.
- **Rust (`src-tauri/`):** `tauri = "2"`, `tauri-plugin-http`, `tauri-plugin-fs`, `tauri-plugin-dialog` = `"2"`, `serde`, `serde_json`; в `lib.rs` — `Builder::default().plugin(tauri_plugin_http::init()).plugin(tauri_plugin_fs::init()).plugin(tauri_plugin_dialog::init())`.
- **`capabilities/default.json`:** `core:default`, `dialog:default`, `fs:default` + `fs:allow-{exists,mkdir,read-file,write-file}` для `$APPCONFIG/**`; `http:default` c `https://*`, `http://*`, `https://*:*`, `http://*:*`.
- **`tauri.conf.json`:** `devUrl http://localhost:1420`, `frontendDist ../dist`, `beforeDevCommand npm run dev`, `beforeBuildCommand npm run build`; окно `1360×860`, min `1024×680`, `dragDropEnabled: true`.
- **CSP:** `default-src 'self'; img-src 'self' asset: http://asset.localhost blob: data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost`. `blob:`/`data:` нужны для `ImageLayer` и превью, `ipc:` — для Tauri IPC; запросы к ИИ идут из Rust через `plugin-http`, поэтому внешние URL в `connect-src` не нужны. Файлы из диалогов и drag&drop попадают в runtime-scope автоматически.

### Встроенные статические шрифты (MVP)

Ровно 6 семейств × 2 начертания (`Regular 400` + `Bold 700` = 12 `.ttf`) в `public/fonts/`:

| Семейство | Regular | Bold |
| :--- | :--- | :--- |
| Inter | `/fonts/Inter-Regular.ttf` | `/fonts/Inter-Bold.ttf` |
| Manrope | `/fonts/Manrope-Regular.ttf` | `/fonts/Manrope-Bold.ttf` |
| Golos Text | `/fonts/GolosText-Regular.ttf` | `/fonts/GolosText-Bold.ttf` |
| Playfair Display | `/fonts/PlayfairDisplay-Regular.ttf` | `/fonts/PlayfairDisplay-Bold.ttf` |
| JetBrains Mono | `/fonts/JetBrainsMono-Regular.ttf` | `/fonts/JetBrainsMono-Bold.ttf` |
| Unbounded | `/fonts/Unbounded-Regular.ttf` | `/fonts/Unbounded-Bold.ttf` |

**Ограничение:** только статические `.ttf` с кириллицей — не `.woff2` и не variable: fontkit не умеет их инстанцировать. `<@font-face>` в `index.css` для Canvas/UI, те же URL грузятся как `ArrayBuffer` в `pdf-lib.embedFont()` для `.ai`. Проверка: `file public/fonts/*.ttf` → `TrueType Font data`.

## 4. Пресеты и система координат

| Пресет | W×H | dpi |
| :--- | :--- | :--- |
| Square Post | 1080×1080 | 72 |
| Stories / Reels | 1080×1920 | 72 |
| Desktop / YouTube | 1920×1080 | 72 |
| A4 Print | 2480×3508 | 300 |
| Custom | любая | 72+ |

1. `(0,0)` — левый верхний угол артборда, `+X` вправо, `+Y` вниз, единицы — px артборда.
2. Матрица слоя `M = T(x,y) · R(rotation°) · S(scaleX, scaleY)`; поворот по часовой в экранных координатах. Мировая точка: `w = (x,y) + (l_x·sx·cosθ − l_y·sy·sinθ, l_x·sx·sinθ + l_y·sy·cosθ)`.
3. Опорные точки: `PathLayer` — центр локального bbox; `ImageLayer` — центр картинки (локально `±w/2, ±h/2`); `TextLayer` — верхняя точка блока с учётом `align` (left/center/right).
4. Единая метрика строк во всех рендерах: `baselineY(i) = fontSize·0.85 + i·fontSize·lineHeight`, `lineHeight = 1.2` по умолчанию.
5. Нормализация без «прыжка»: при изменении локальных узлов считается `c_local` = центр локального bbox; если он не в нуле — `c_world = localToWorld(layer, c_local)`, из всех `anchor` вычитается `c_local`, `layer.x/y = c_world`. `handleIn/Out` хранятся относительно anchor и не меняются.

## 5. Критические архитектурные правила

1. **SSOT:** Zustand хранит сериализуемую `Scene`; Paper.js — только рендер, `hitTest`, жесты. Любые изменения (UI, инструменты, ИИ) — только через атомарные функции `src/core/commands.ts` (фасад `src/core/commands/{helpers,document,layers,vector,text,index}.ts`); прямая мутация стора запрещена.
2. **Локальные координаты:** `PathLayer` хранит `subpaths[]` относительно `(0,0)`; позиция/трансформация — только `x,y,rotation,scaleX,scaleY`. Compound Path = несколько `subpaths` + `fillRule`.
3. **60 FPS и чистая история:** во время drag изменения идут в Paper.js без `setState`, коммит — в `onMouseUp`. `zundo` c `partialize: (state) => ({ scene })`, история не включает selection/tool/zoom/модалки. Серия tool calls ИИ = ровно 1 шаг: `temporal.pause()` → команды → `resume()` + commit.
4. **AssetRegistry:** бинарники картинок (`Map<assetId, AssetEntry>`) вне Zustand и истории; `ImageLayer` хранит только `assetId/width/height`. `URL.revokeObjectURL` при удалении слоя запрещён (нужен Undo); освобождение — в `clearAssets()` при смене документа, неиспользуемые ассеты отбрасываются при сохранении `.locus`.
5. **Платформа и CORS:** весь HTTP — через `fetch` из `@tauri-apps/plugin-http`; файлы, диалоги, `settings.json`, drag&drop — в `src/platform/io.ts` с `isTauri()` и браузерным/тестовым фолбэком (`npm test` и `npm run dev` в браузере не падают).
6. **Paper.js под React 19 StrictMode:** локальный `new paper.PaperScope()` в `PaperCanvas`, cleanup `scope.project.remove()`. Три внутренних слоя: `artboardLayer`, `sceneLayer`, `overlayLayer` (overlay масштабируется на `1/zoom`, не участвует в `hitTest` и экспорте). У элементов `applyMatrix = false`, `pivot = (0,0)`, матрица из `getLayerMatrix()`.
7. **Clipping Mask (модель Illustrator):** `targetLayer.clipMaskId = mask.id`, `mask.isClipMask = true`; заливка/обводка маски не рисуется. Рендер — clipped-группа (`clipped` в Paper.js, `<clipPath>` в SVG, `W n`/`W* n` в PDF, clipping-группа в PSD). Циклы и самомаскирование запрещены; `releaseClipMask` возвращает контур в обычное состояние; удаление маски очищает зависимые `clipMaskId`.
8. **Drag & Drop:** нативный `onDragDropEvent` (HTML5 `onDrop` перехвачен); PNG/JPEG/WebP/SVG → `ImageLayer`, `.locus` → открыть проект.
9. **Однонаправленная синхронизация:** `src/engine/sync.ts` строит `sceneLayer` из `Scene` + `AssetRegistry` без вызовов экшенов; `item.data.layerId` — mapping для `hitTest`.
10. **Инварианты Paper.js/загрузки (накопленные):** headless-булевы операции — `new scope.Project(undefined as unknown as HTMLCanvasElement)`, для `evenodd` — `compound.reorient(false, true)`. В `loadScene` не очищать `AssetRegistry` до наполнения из `.locus`; очистка только в `clearAssets()` при `resetDocument()`/перед новой загрузкой.

## 6. Структура проекта

```text
src/
├── main.tsx, App.tsx, index.css        # @import "tailwindcss"; @theme; @font-face (6×2)
├── platform/io.ts                      # Tauri/Browser: http, fs, dialog, drag&drop, settings
├── core/
│   ├── types.ts fonts.ts math.ts assets.ts
│   ├── store.ts                        # Zustand + zundo (partialize: scene)
│   ├── themes.ts settings.ts shortcuts.ts typography.ts canvasBackdrop.ts
│   ├── clipboard.ts contextMenu.ts aiModels.ts
│   └── commands.ts + commands/         # helpers, document, layers, vector, text, index
├── engine/
│   ├── PaperCanvas.tsx sync.ts overlay.ts geometry.ts booleans.ts
│   ├── textOutlines.ts snapping.ts zoom.ts
│   └── tools/                          # select, node, pen, blob, text, eyedropper
├── ai/
│   ├── types.ts context.ts registry.ts executor.ts statusWords.ts taskStore.ts
│   └── providers/                      # gemini, openai, anthropic, ollama, index
├── tutorial/                           # content, targets, progress, search, store
├── export/                             # projectFile, toSvg, toAi, rasterize, toPsd
└── ui/                                 # TopBar, Toolbar, LayersPanel, Inspector(+inspector/*),
                                        # StartModal, CommandBar, SettingsModal, MenuBar,
                                        # controls.tsx, ContextMenu, UnsavedChangesModal,
                                        # tutorial/TutorialModal
src-tauri/
├── Cargo.toml, tauri.conf.json
├── capabilities/default.json
└── src/main.rs, src/lib.rs             # регистрация плагинов http/fs/dialog
scripts/install-linux-launcher.mjs      # per-user launcher: binary + icon + .desktop
tests/                                  # math, commands, geometry, stage3, stage3_5, stage3_6,
                                        # export, ai, ai_tools_smoke, tutorial_*, linuxLauncher
public/fonts/*.ttf                      # 12 файлов
```

## 7. Модель данных (`src/core/types.ts`)

```ts
type ToolType = 'select' | 'node' | 'pen' | 'blob' | 'text';   // + eyedropper
type SmartShapePreset = 'blob' | 'ellipse' | 'rect' | 'polygon' | 'star';
interface SmartShapeOptions { preset; points; wobble; cornerRadius; innerRadiusRatio }
interface Point2D { x; y }
interface AnchorPoint { x; y; handleIn: Point2D; handleOut: Point2D; smooth } // handle* — от anchor
interface SubPath { closed: boolean; anchors: AnchorPoint[] }                   // локально от центра
interface StrokeStyle { color; width; lineCap?; lineJoin? }
interface BaseLayer {
  id; name; type: 'path' | 'text' | 'image'; visible; locked;
  x; y; rotation; scaleX; scaleY; opacity; clipMaskId?;
}
interface PathLayer extends BaseLayer { subpaths; fillRule: 'nonzero'|'evenodd';
  fill: string | null; stroke: StrokeStyle | null; isClipMask? }
type BuiltinFontFamily = 'Inter'|'Manrope'|'Golos Text'|'Playfair Display'|'JetBrains Mono'|'Unbounded';
interface TextLayer extends BaseLayer { content; fontSize; fontFamily: BuiltinFontFamily;
  fontWeight: 400|700; lineHeight; letterSpacing?; fill; align: 'left'|'center'|'right' }
interface ImageLayer extends BaseLayer { assetId; width; height }
type Layer = PathLayer | TextLayer | ImageLayer;
interface Scene { version: 1; name; width; height; dpi; background; layers: Layer[] } // снизу вверх
interface AssetEntry { id; name; mimeType; blob: Blob; objectUrl; naturalWidth; naturalHeight }
interface AIConfig { provider; geminiApiKey; geminiModel; openaiBaseUrl; openaiApiKey; openaiModel }
```

## 8. Форматы и экспорт

- **`.locus`** (`src/export/projectFile.ts`): ZIP = `scene.json` + `assets/<assetId>.<ext>` только используемых картинок. Загрузка: `version === 1`, полная очистка старого реестра, восстановление Blob/ObjectURL/размеров, `temporal.clear()`.
- **`.svg`** (`toSvg.ts`): строится напрямую из `Scene` + `AssetRegistry` (не `paper.exportSVG`), `<svg viewBox="0 0 W H">`, фон, `<defs><clipPath>` для масок, `<g>` на слой с `opacity`/`clip-path`, path `M/C/L/Z`, text `<tspan>` по `baselineY`, image через data URL.
- **`.ai`** (`toAi.ts`): PDF через `pdf-lib` + fontkit; `ptPerPx = 72/dpi`; `pdfX = w_x·ptPerPx`, `pdfY = (H − w_y)·ptPerPx`; opacity через `PDFExtGState` (`ca`/`CA`); кривые — `moveTo`/`appendBezierCurve`/`closePath`, заливка `f`/`f*`, обводка `S`, комбинированно `B`/`B*`; маски — `pushGraphicsState` + `W n`/`W* n` + `pop`; текст встраивается `.ttf` и остаётся редактируемым; WebP перекодируется в PNG.
- **`.psd`** (`toPsd.ts` + `rasterize.ts`): offscreen-рендер каждого слоя и полного композита (`Psd.canvas`), дети с `name/hidden/opacity/canvas/left/top`, текстовая структура для Photoshop; запись `{ generateThumbnail: true, invalidateTextLayers: true }`.

## 9. ИИ-слой (BYOK + Tool Calling)

- **Настройки** — `$APPCONFIG/locus/settings.json` через `platform/io.ts`, никогда в `.locus`/репозитории. Провайдеры: OpenAI-compatible (по умолчанию `gpt-6-luna`), Anthropic (`claude-haiku-5-5`), Gemini (`gemini-4-hydrogen`), Ollama (`http://localhost:11434/v1`). Каталог моделей — `src/core/aiModels.ts` (+ DeepSeek, OpenRouter, Groq). Без ключа — ошибка и вкладка «ИИ» настроек. Vision не угадывается: картинки отправляются всегда, отказ провайдера показывается как «Модель не приняла изображение: …».
- **Контекст** (`context.ts`): компактный `SceneContext` — артборд, `selectedIds`, слои с мировым bbox и ключевыми свойствами; без сырой геометрии и картинок.
- **Провайдеры:** Gemini `generateContent` + `x-goog-api-key`; OpenAI-compatible `{baseURL}/chat/completions` + `Bearer`, SSE-стриминг текста через `onToken`/`assistant-delta`, tool calls из дельт. Anthropic и Ollama — отдельные адаптеры.
- **Исполнитель:** `AbortController` («Стоп» → статус `stopped` с текстом «Команда остановлена пользователем», даже при не-`AbortError` отклонении), цикл до 8 шагов (после `report_plan` — до 12), валидация аргументов по JSON-схемам с возвратом структурированной ошибки модели, `temporal.pause()`/`resume()` для одного шага Undo, кнопка «Откатить» в `CommandBar`. В `CommandBar` промпт и вложения очищаются при отправке (при ошибке восстанавливаются), поддерживаются `Ctrl+V` и Drag & Drop картинок, план выводится без `(N шаг.)` со сворачиваемым логом действий.
- **29 инструментов** (`registry.ts`; новые добавлять в `TOOL_HANDLERS`, `TOOL_LABELS`, обновлять счётчики в `tests/ai.test.ts` и smoke-сценарий):
  - создание: `create_blob`, `create_shape`, `create_text`, `create_line`, `report_plan`;
  - изменение: `update_layers`, `delete_layers`, `duplicate_layers`, `reorder_layers`, `rotate_layers`, `select_layers`, `set_artboard` (только `width/height/dpi/background`, менять `name`/метаданные запрещено), `apply_palette`, `text_case`;
  - вектор: `boolean_op`, `combine_compound`, `split_compound`, `simplify_path`, `round_corners`, `offset_path`, `outline_stroke`;
  - компоновка: `align_layers`, `flip_layers`, `mirror_duplicate`, `repeat_layer`, `place_in_bounds`, `randomize_anchors`, `set_clip_mask`, `get_layer_geometry`.

## 10. Статус этапов

1. **Фундамент** — выполнено: Vite/TS/Vitest, Tauri v2, 12 `.ttf`, `io.ts`, каркас UI, `PaperCanvas`, иконки. Проверено: `file public/fonts/*.ttf`, `tsc --noEmit`, `npm run build`, `cargo check -j 2`; ручной запуск окна — за пользователем.
2. **Стор, математика, примитивы, узлы** — выполнено: `math/store/commands/geometry/sync/overlay`, инструменты `V/A/P/B`. Тесты `math/geometry/commands` (14/14); вручную: поворот + узел без «прыжка», drag = 1 шаг Undo.
3. **Текст, картинки, булевы, маски, автоматика** — выполнено. `tests/stage3.test.ts`: `subtract` с реальным отверстием (2 `subpath`), удаление `ImageLayer` + `Ctrl+Z` без сломанного `ObjectURL`, Clipping Mask обрезает и снимается. Тесты 19/19, tsc/build зелёные.
4. **Этап 3.5** — выполнено: `textOutlines`, `letterSpacing`, регистр, `exclude`/`divide`, `offset`/`outlineStroke`/`simplify`/`flip`, `Ctrl+Shift+O`, `Ctrl+8`. `tests/stage3_5.test.ts` на реальных `.ttf`: кириллица, разбиение слова с сохранением дырок, все операции, 23/23.
5. **Этап 3.6** — выполнено: темы, настройки (`settings.json`, автодамп), пипетка `E`, буфер, сетка/Smart Guides, `nudge`, палитра документа, декомпозиция `commands/` и `inspector/`. `tests/stage3_6.test.ts`: темы/CSS-переменные, санитизация настроек, `undoLimit`, отсутствие конфликта `I`/`E`, буфер, привязки, 29/29.
6. **Этап 4** — выполнено: `.locus`/`.ai`/`.svg`/`.psd`. `tests/export.test.ts`: round-trip `.locus` с бинарником, валидный SVG, `%PDF-` с кириллицей и маской, `readPsd` обратно. Ручная проверка внешними просмотрщиками — за пользователем.
7. **Этап 5** — выполнено: 4 провайдера, `CommandBar`, вложения, батчинг Undo, фон задачи. `tests/ai.test.ts` (реестр, валидация, 4 адаптера на мок-fetch, ошибки аргументов, abort, 1 шаг Undo) + smoke всех 29 инструментов, 75/75; интеграция в окне — за пользователем.
8. **Этап 6** — выполнено: собственные меню/контролы, «О приложении», фон рабочей области, защита несохранённого, реестр ИИ расширен до 29. Проверено tests (mirror/repeat/place/round corners, smoke 29), 93/93; ручная проверка UI — за пользователем.
9. **Этап 7** — выполнено: обучение, этап 1 «Академия» (12 глав, 25 уроков, 75 шагов, поиск, прогресс, входы, `F1`; 28 тестов). Этапы 2 (подсветка через `data-tour`) и 3 (песочница) не начаты.

Текущий прогон: `npx tsc --noEmit`, `npm test` (128/128, 23 файла), `npm run build` — зелёные. Git: ветка `master`, последние коммиты `010ef60` и `0b4c912`; в рабочей копии — интеграция Linux-лаунчера (`scripts/install-linux-launcher.mjs`, `tests/linuxLauncher.test.ts`, `tests/node-builtins.d.ts`, `tauri.conf.json`) и доработки ИИ-панели/запрета метаданных; remote не настроен, push не выполнялся.

## 11. Handoff и инварианты среды

- Новый диалог: сослаться на этот файл и номер следующего этапа.
- Сборка на машине с 3.6 GiB RAM: `cargo check/build -j 2`; dev-окно при чёрном WebView: `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`.
- Возможные направления: обучение этап 2 (подсветка через `data-tour`) и этап 3 (песочница); ИИ-арт-директор; рецепты/стили/шаблоны; линейки и направляющие; пакетный экспорт; запись геометрии из ИИ (`set_path_anchors` поверх `updatePathSubpaths`).
- Секреты только в `settings.json`; не коммитить ключи.
