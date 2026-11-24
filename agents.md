# Project Specification: Locus — Automated Vector Editor (Illustrator Alternative)

## 1. Общее описание и границы MVP

**Locus** — локальное десктопное приложение (Tauri v2), быстрый и лёгкий аналог Adobe Illustrator с упором на автоматизацию рутины и светлую «бумажную» эстетику.

Редактор объединяет:
* **Полноценный векторный инструментарий:** кривые Безье, составные контуры (`CompoundPath` через `subpaths[]`), опорные точки (`anchors`) и усики (`handles`), перо, булевы операции, Clipping Mask в 1 клик.
* **Автоматику и процедурные инструменты:** умные примитивы (клякса, круг/эллипс, скруглённый прямоугольник, многоугольник на $N$ точек, звезда), быстрые модификаторы (сглаживание, шум/wobble), авто-выравнивание и распределение.
* **ИИ-ассистента через Tool Calling (BYOK):** ИИ выступает оператором встроенных инструментов редактора — вызывает атомарные команды над сценой и выделенными слоями, оставляя результат полностью редактируемым вектором и с полной поддержкой одного шага `Ctrl+Z`.
* **Совместимость с Adobe и переносимость:** нативный формат проекта `.locus` (ZIP с ресурсами) + честный векторный экспорт в `.ai`, `.svg` и многослойный `.psd`.

### Границы релиза

| Входит в MVP | Вынесено в Post-MVP |
| :--- | :--- |
| 1 артборд на документ (фиксированный размер по пресету или custom) | Несколько артбордов в одном документе |
| 6 встроенных статических шрифтов (Regular 400 + Bold 700) с кириллицей | Сканирование системных шрифтов через Rust `fontdb` |
| Плоские цвета заливки/обводки (`hex` / `null`) + `opacity` | Линейные/радиальные градиенты, режимы наложения слоёв |
| Smart Shape (`B`): `blob`, `ellipse`, `rect`, `polygon`, `star` | Кисти переменной толщины, градиентные сетки |
| Pen (`P`), Select (`V`), Direct Select (`A`), Type (`T`), Image (`I`) | Импорт и разбор сторонних `.svg` / `.ai` в редактируемые слои |
| Экспорт `.locus`, `.ai` (PDF-поток), `.svg`, `.psd` | Стриминг ответов ИИ в `CommandBar` и мультимодальный ввод (референсы) |
| ИИ Tool Calling через Gemini API и OpenAI-compatible (вкл. локальные Ollama/LM Studio) | Локальные модели в процессе без HTTP-сервера |

---

## 2. Визуальный стиль и интерфейс (UI/UX)

### Эстетика («Бумажная» светлая тема)

Строгое правило оформления: **никаких тяжёлых теней, декоративных градиентов и `backdrop-filter` / Gaussian blur**. Визуальная иерархия строится за счёт контраста тёплых бумажных поверхностей и чётких границ `1px solid #dfd9ce`.

Готовая конфигурация темы для Tailwind CSS v4 (`src/index.css`):

```css
@import "tailwindcss";

@theme {
  --color-paper-bg: #f5f2eb;         /* Основной фон интерфейса */
  --color-paper-canvas: #ebe6dc;     /* Рабочая область вокруг артборда */
  --color-paper-panel: #faf8f4;      /* Фон панелей, карточек и модалок */
  --color-paper-hover: #f0ece3;      /* Ховер кнопок и строк списка */
  --color-paper-border: #dfd9ce;     /* Четкие границы 1px */
  --color-paper-accent: #da7756;     /* Терракотовый акцент, выделение, узлы */
  --color-paper-accent-hover: #c86443;
  --color-paper-ink: #1c1b1a;        /* Основной текст и иконки */
  --color-paper-muted: #6b665e;      /* Вторичный текст, подписи, шорткаты */
  --color-paper-danger: #b83b2e;     /* Ошибки валидации и удаление */

  --font-ui: "Golos Text", "Manrope", system-ui, sans-serif;
  --font-display: "Manrope", "Golos Text", system-ui, sans-serif;
}
```

Шрифты интерфейса задаются пресетами в `src/core/typography.ts` (раздел «Темы и цвета» → «Шрифты интерфейса»): каждая тема использует дизайнерские пары UI/акцентных шрифтов из встроенного каталога, плюс режим «Свой шрифт» с загрузкой `.ttf/.otf/.woff` и сохранением в `$APPCONFIG/locus/ui-font.json`. Моноширинные шрифты в интерфейсе не используются (JetBrains Mono остаётся только в каталоге текстовых слоёв).

### Компоновка окна (минимальный размер `1024 × 680`)

* **Верхняя панель (`TopBar`, высота `40px`):**
  * Слева: лого/название, имя документа (клик переименовывает), индикатор несохранённых изменений (`•`), кнопки Новый (`StartModal`), Открыть (`.locus`), Сохранить (`.locus`), Экспорт (выпадающее меню `.ai` / `.svg` / `.psd`).
  * Центр: кнопки `Undo` / `Redo`, быстрый вызов `CommandBar` (`Ctrl+K`).
  * Справа: текущий масштаб в процентах (клик сбрасывает к `Fit Artboard`), кнопка `SettingsModal` (иконка шестерёнки).
* **Левая панель (`Toolbar`, ширина `44px`):** вертикальный стек инструментов с тултипами и указанием горячих клавиш: `V`, `A`, `P`, `B`, `T`, `I`, плюс быстрая кнопка `Fit` (`Ctrl+0`).
* **Центр (`PaperCanvas`, `flex-1`):** бесконечная рабочая область `#ebe6dc` с фиксированным артбордом (`scene.background`), плавным зумом колёсиком к курсору и панорамированием (`Space + Drag` или средняя кнопка мыши).
* **Правая колонка (ширина `280px`):**
  * Верх (`LayersPanel`, `~45%` высоты): дерево слоёв (отрисовывается в интуитивном порядке: верхний слой списка лежит поверх нижнего, т.е. обратный обход `scene.layers`), иконка типа, индикатор маски `↳ Mask`, видимость (`Eye`), блокировка (`Lock`), двойной клик для переименования, перемещение вверх/вниз и удаление.
  * Низ (`Inspector`, `~55%` высоты): контекстные свойства в зависимости от выделения:
    * Нет выделения: параметры артборда (`width`, `height`, `dpi`, `background`).
    * Выделен `PathLayer`: координаты/трансформация (`x, y, rotation, scale`), `fill` (цвет + кнопка «Без заливки»), `stroke` (цвет, ширина, `lineCap`, `lineJoin`), `opacity`, `fillRule`, процедурные ползунки (`Smooth`, `Wobble`) или параметры пресета при активном `Smart Shape (B)`, кнопка `Make/Release Clipping Mask`.
    * Выделено $2+$ слоёв: кнопки булевых операций (`Unite`, `Subtract`, `Intersect` — активны, если все выделенные слои типа `path`), выравнивание (`left`, `center`, `right`, `top`, `middle`, `bottom`) и распределение (`distribute_h`, `distribute_v`), кнопка `Create Clipping Mask` (верхний выделенный `PathLayer` маскирует остальные выделенные слои).
    * Выделен `TextLayer`: выбор из 6 встроенных шрифтов, вес (`400` / `700`), размер, межстрочный интервал (`lineHeight`), выравнивание (`left` / `center` / `right`), цвет.
    * Выделен `ImageLayer`: позиция, масштаб, прозрачность, кнопка «Заменить изображение».
* **Модальные и оверлейные окна:**
  * `StartModal`: выбор пресета документа, ввод своих размеров/DPI или кнопка «Открыть `.locus`».
  * `CommandBar` (`Ctrl+K`): командная строка для текстовых промптов к ИИ и быстрого запуска встроенных действий (выравнивание, экспорт, очистка выделения), с показом статуса выполнения, лога вызванных инструментов, кнопкой отмены (`AbortController`) и человекочитаемыми ошибками.
  * `SettingsModal`: переключение провайдера (`Gemini` / `OpenAI-compatible`), поля API-ключа, модели и `baseURL`, кнопка проверки подключения.

### Инструменты `Smart Shape (B)` и `Type (T)`

* **Smart Shape (`B`):** в контекстной панели над холстом или в верхней секции `Inspector` доступны 5 пресетов:
  1. `blob` — органическая клякса (`points`: 3..24, `radius`, `wobble`: 0..1).
  2. `ellipse` — круг/овал (`radiusX`, `radiusY`; с `Shift` — идеальный круг).
  3. `rect` — прямоугольник со скруглением (`width`, `height`, `cornerRadius`; с `Shift` — квадрат).
  4. `polygon` — правильный многоугольник (`points`: 3..24, `radius`).
  5. `star` — звезда (`points`: 3..24, `radius`, `innerRadiusRatio`: 0.1..0.9).
  Протягивание мышью по холсту сразу создаёт векторный `PathLayer` с пересчётом узлов в локальные координаты.
* **Type (`T`):** клик по пустому месту создаёт `TextLayer` с текстом по умолчанию (`«Новый текст»`) и сразу переводит его в режим редактирования. Двойной клик по существующему `TextLayer` инструментом `V` или `T` открывает позиционированный `<textarea>` ровно поверх объекта в экранных координатах (с теми же `fontFamily`, `fontWeight`, `fontSize * zoom`, `lineHeight`, `textAlign`, `color`). Выход из редактирования — по `Blur` или `Ctrl+Enter` / `Escape`; коммит выполняется одной командой `updateLayers`.

### Таблица горячих клавиш

> **Строгое правило ввода:** все однобуквенные шорткаты и `Space` / `Delete` / `Backspace` **игнорируются**, если `document.activeElement` — это `INPUT`, `TEXTAREA`, `SELECT` или элемент с `isContentEditable`. Модификатор `Ctrl` на Linux/Windows соответствует `Cmd` на macOS (`e.ctrlKey || e.metaKey`).

| Клавиша | Действие |
| :--- | :--- |
| `V` | Инструмент Select (перемещение, масштаб, поворот рамки) |
| `A` | Инструмент Direct Select (редактирование `anchors` и `handles`) |
| `P` | Инструмент Pen (пошаговое построение Безье; `Enter`/`Escape` или клик по 1-й точке завершает контур) |
| `B` | Инструмент Smart Shape (`blob`, `ellipse`, `rect`, `polygon`, `star`) |
| `T` | Инструмент Type (создание и редактирование текста) |
| `I` | Place Image (открывает нативный диалог выбора PNG/JPEG/WebP/SVG) |
| `Space + Drag` | Временное панорамирование холста (возвращает предыдущий инструмент при отпускании) |
| `Ctrl + Z` | Undo (откат последнего коммита сцены) |
| `Ctrl + Shift + Z` / `Ctrl + Y` | Redo |
| `Ctrl + S` | Сохранить проект `.locus` (или «Сохранить как…», если путь ещё не задан) |
| `Ctrl + O` | Открыть проект `.locus` |
| `Ctrl + K` | Открыть/закрыть `CommandBar` |
| `Ctrl + D` | Дублировать выделенные слои со сдвигом `+16, +16` |
| `Ctrl + Shift + O` | Перевести выделенный текст в кривые Безье (`Create Outlines`) |
| `Ctrl + 8` | Собрать выделенные `PathLayer` в составной контур (`Compound Path`) |
| `Ctrl + Shift + 8` | Разбить составной контур на отдельные части / буквы |
| `Delete` / `Backspace` | Удалить выделенные слои (или выделенный узел в режиме `A`, если узлов $> 2$) |
| `Ctrl + 0` | Вписать артборд в видимую область (`Fit Artboard`) |
| `Ctrl + 1` | Сбросить масштаб в `100%` |
| `[` / `]` | Опустить / поднять выделенный слой на 1 позицию в порядке отрисовки |
| `Escape` | Закрыть открытую модалку / завершить построение пером / снять выделение |
| `Shift` (удерживать) | Пропорциональный масштаб и квадрат/круг; при перетаскивании узла/усика — фиксация угла с шагом $45^\circ$ |

---

## 3. Стек технологий, зависимости и конфигурация Tauri v2

### Подтверждённое окружение разработки (Linux / EndeavourOS)
* **Toolchain:** `node v26.13.0`, `npm 12.2.1`, `rustc 1.99.1`, `cargo 1.99.1`.
* **Системные пакеты Tauri v2 (проверены через `pkg-config`):** `webkit2gtk-4.1` (2.54.2), `gtk+-3.0` (3.24.52), `librsvg-2.0` (2.63.4), `libsoup-3.0` (3.8.1), `javascriptcoregtk-4.1` (2.54.2), `openssl` (3.6.5), `ayatana-appindicator3-0.1` (0.6.1).
* **Пакетный менеджер:** `npm` (включая локальный `@tauri-apps/cli` в `devDependencies` — не требуется глобальный `cargo-tauri`).

### Пакеты NPM (`package.json`)

* **`dependencies`:**
  * `react`, `react-dom` (React 19)
  * `zustand` (v5), `zundo` (Undo/Redo через `temporal`)
  * `paper` (Paper.js — импортируется строго как `paper/dist/paper-core`)
  * `jszip` (упаковка/распаковка `.locus`)
  * `pdf-lib`, `@pdf-lib/fontkit` (векторный PDF-поток для `.ai` с поддержкой кириллицы)
  * `ag-psd` (генерация многослойного `.psd`)
  * `lucide-react` (иконки интерфейса в едином тонком штриховом стиле)
  * `@tauri-apps/api`, `@tauri-apps/plugin-http`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`
* **`devDependencies`:**
  * `typescript`, `vite`, `@vitejs/plugin-react`
  * `tailwindcss`, `@tailwindcss/vite`
  * `@types/react`, `@types/react-dom`, `@types/paper`
  * `@tauri-apps/cli`
  * `vitest`, `jsdom`
* **Скрипты `package.json`:**
  * `dev`: `vite`
  * `build`: `tsc --noEmit && vite build`
  * `test`: `vitest run`
  * `tauri`: `tauri`

### Конфигурация Vite (`vite.config.ts`)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
```

### Конфигурация Rust и плагинов (`src-tauri/`)

1. **`src-tauri/Cargo.toml`:** подключить зависимости:
   * `tauri = { version = "2", features = [] }`
   * `tauri-plugin-http = "2"`
   * `tauri-plugin-fs = "2"`
   * `tauri-plugin-dialog = "2"`
   * `serde = { version = "1", features = ["derive"] }`
   * `serde_json = "1"`
2. **`src-tauri/src/lib.rs`:** зарегистрировать все три плагина при сборке `tauri::Builder`:
   ```rust
   tauri::Builder::default()
       .plugin(tauri_plugin_http::init())
       .plugin(tauri_plugin_fs::init())
       .plugin(tauri_plugin_dialog::init())
       .run(tauri::generate_context!())
       .expect("error while running Locus");
   ```
3. **`src-tauri/capabilities/default.json`:**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities for Locus main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "fs:default",
    {
      "identifier": "fs:allow-exists",
      "allow": [{ "path": "$APPCONFIG/**" }]
    },
    {
      "identifier": "fs:allow-mkdir",
      "allow": [{ "path": "$APPCONFIG/**" }]
    },
    {
      "identifier": "fs:allow-read-file",
      "allow": [{ "path": "$APPCONFIG/**" }]
    },
    {
      "identifier": "fs:allow-write-file",
      "allow": [{ "path": "$APPCONFIG/**" }]
    },
    {
      "identifier": "http:default",
      "allow": [
        { "url": "https://*" },
        { "url": "http://*" },
        { "url": "https://*:*" },
        { "url": "http://*:*" }
      ]
    }
  ]
}
```

> **Примечание по доступу к файлам в Tauri v2:** файлы, выбранные пользователем через нативный диалог `@tauri-apps/plugin-dialog` (`open` / `save`) или перетащенные в окно через `onDragDropEvent`, автоматически добавляются Tauri в runtime-scope для чтения/записи через `plugin-fs` — поэтому открывать `$HOME/**` статически в `capabilities` не нужно. Статический скоуп `$APPCONFIG/**` нужен для чтения и записи конфига `locus/settings.json`.

4. **`src-tauri/tauri.conf.json` (ключевые поля):**
   * `build.devUrl`: `"http://localhost:1420"`, `build.frontendDist`: `"../dist"`, `build.beforeDevCommand`: `"npm run dev"`, `build.beforeBuildCommand`: `"npm run build"`.
   * `app.windows[0]`: `title: "Locus"`, `width: 1360`, `height: 860`, `minWidth: 1024`, `minHeight: 680`, `dragDropEnabled: true`.
   * `app.security.csp`:
     ```text
     default-src 'self'; img-src 'self' asset: http://asset.localhost blob: data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost
     ```
     *Обоснование:* `blob:` и `data:` в `img-src` обязательны для `ImageLayer` из `AssetRegistry` и превью; `http://ipc.localhost` / `ipc:` — для Tauri IPC (при этом запросы к ИИ идут из Rust через `plugin-http`, поэтому внешние URL не нужны в `connect-src`).

### Встроенные статические шрифты (MVP)

В MVP используются **ровно 6 семейств**, каждое в двух статических начертаниях (`Regular 400` и `Bold 700` = **12 файлов `.ttf`**) в папке `public/fonts/`:

| Семейство (`fontFamily`) | Файл Regular (`400`) | Файл Bold (`700`) |
| :--- | :--- | :--- |
| `Inter` | `/fonts/Inter-Regular.ttf` | `/fonts/Inter-Bold.ttf` |
| `Manrope` | `/fonts/Manrope-Regular.ttf` | `/fonts/Manrope-Bold.ttf` |
| `Golos Text` | `/fonts/GolosText-Regular.ttf` | `/fonts/GolosText-Bold.ttf` |
| `Playfair Display` | `/fonts/PlayfairDisplay-Regular.ttf` | `/fonts/PlayfairDisplay-Bold.ttf` |
| `JetBrains Mono` | `/fonts/JetBrainsMono-Regular.ttf` | `/fonts/JetBrainsMono-Bold.ttf` |
| `Unbounded` | `/fonts/Unbounded-Regular.ttf` | `/fonts/Unbounded-Bold.ttf` |

**Техническое ограничение (строго):** использовать только **статические `.ttf` с поддержкой кириллицы** — не `.woff2` и не variable-шрифты. `@pdf-lib/fontkit` не поддерживает `.woff2` и не умеет инстанцировать оси вариативности variable-шрифтов (сбросит вес в мастер по умолчанию). Статические `.ttf` подключаются через `@font-face` в `src/index.css` (для Canvas/Paper.js и UI) и загружаются по тем же URL как `ArrayBuffer` в `pdf-lib.embedFont()` (для `.ai`). При сборке каждый файл проверяется командой `file public/fonts/*.ttf` (должно выводить `TrueType Font data`).

---

## 4. Пресеты документов и система координат

### Пресеты документов (`StartModal`)

| Пресет | Ширина (`px`) | Высота (`px`) | `dpi` |
| :--- | :--- | :--- | :--- |
| **Square Post (Telegram / Instagram)** | `1080` | `1080` | `72` |
| **Stories / Reels** | `1080` | `1920` | `72` |
| **Desktop / YouTube** | `1920` | `1080` | `72` |
| **A4 Print (300 DPI)** | `2480` | `3508` | `300` |
| **Custom** | Произвольная | Произвольная | `72` (настраивается) |

### Система координат и трансформаций (обязательна для всех модулей)

1. **Пространство артборда:** точка `(0, 0)` — **левый верхний угол** артборда, ось `+X` направлена вправо, ось `+Y` направлена вниз. Единица измерения — `px` артборда.
2. **Порядок аффинной трансформации слоя:**
   $$\mathbf{M} = \mathbf{T}(x, y) \cdot \mathbf{R}(\text{rotation}^\circ) \cdot \mathbf{S}(\text{scaleX}, \text{scaleY})$$
   где `rotation` измеряется в градусах **по часовой стрелке** в экранных координатах (`+Y` вниз). То есть мировая координата локальной точки $(l_x, l_y)$ равна:
   $$s_x = l_x \cdot \text{scaleX}, \quad s_y = l_y \cdot \text{scaleY}$$
   $$w_x = x + s_x \cos\theta - s_y \sin\theta, \quad w_y = y + s_x \sin\theta + s_y \cos\theta \quad (\theta = \text{rotation} \cdot \frac{\pi}{180})$$
   **Важно для Paper.js:** у `paper.Item` в `sync.ts` обязательно выставлять `item.applyMatrix = false`, чтобы `item.position`, `item.rotation`, `item.scaling` задавались независимо от геометрии и в точности соответствовали матрице $\mathbf{M}$ (в Paper.js по умолчанию `applyMatrix = true`, что запекает матрицу прямо в сегменты и ломает SSOT).
3. **Опорная точка `(x, y)` для каждого типа слоя:**
   * **`PathLayer`:** `(0, 0)` — центр локального ограничивающего прямоугольника (`bbox`) всех `subpaths` в пространстве слоя.
     * *Формула нормализации без «прыжка» повёрнутой/масштабированной фигуры:* когда меняются локальные узлы (редактирование в `nodeTool`, модификаторы `Smooth`/`Wobble` или результат булевой операции), вычисляется центр локального `bbox` `c_local = (minX + maxX)/2, (minY + maxY)/2`. Если `|c_local.x| > 1e-4` или `|c_local.y| > 1e-4`, вычисляется новая мировая позиция `c_world = localToWorld(layer, c_local)`, из всех `anchor.x, anchor.y` вычитается `c_local`, а `layer.x = c_world.x`, `layer.y = c_world.y`. `handleIn` и `handleOut` хранятся относительно своей точки `anchor`, поэтому при сдвиге не меняются.
   * **`ImageLayer`:** `(x, y)` — геометрический центр картинки. Локальный прямоугольник картинки всегда `[-width/2, -height/2] .. [+width/2, +height/2]`, что совпадает с `paper.Raster.position`.
   * **`TextLayer`:** `(x, y)` — верхняя якорная точка текстового блока с учётом выравнивания `align`:
     * `left`: `(0, 0)` в локальных координатах — левый верхний угол текста;
     * `center`: `(0, 0)` — верхний центр блока;
     * `right`: `(0, 0)` — правый верхний угол блока.
     * **Единая метрика строк** во всех рендерерах (Canvas, SVG, PDF/AI, PSD): $i$-я строка (`i = 0, 1, ...`) имеет базовую линию:
       $$\text{baselineY}(i) = \text{fontSize} \cdot 0.85 + i \cdot \text{fontSize} \cdot \text{lineHeight}$$
       где `lineHeight` по умолчанию `1.2`. Разброс позиционирования между Paper.js, SVG и PDF исключается.

---

## 5. Критические архитектурные правила (соблюдать строго)

1. **Единый источник правды (SSOT):** Zustand хранит сериализуемую модель `Scene`. Paper.js отвечает только за рендер, `hitTest` и интерактивные жесты. Пользовательский UI и ИИ изменяют сцену **исключительно** через атомарные функции в `src/core/commands.ts` (прямая мутация стора из компонентов или инструментов запрещена).
2. **Локальные координаты и Compound Paths:** геометрия `PathLayer` всегда хранится в `subpaths: SubPath[]` в локальных координатах относительно `(0, 0)`. Это позволяет без потерь представлять фигуры с «дырками» и составные контуры после булевых операций `subtract` / `unite` / `intersect`. Позиция и трансформация задаются только через `x, y, rotation, scaleX, scaleY`.
3. **Плавность 60 FPS и чистая история Undo/Redo:**
   * Во время перетаскивания (`onMouseDrag`) объекта, узла или усика изменения применяются напрямую в `Paper.js` без вызова `setState` в Zustand. Коммит итоговых координат в стор происходит **только в `onMouseUp`**.
   * `zundo` оборачивает стор с опцией `partialize: (state) => ({ scene: state.scene })` (в историю **не попадают** `selectedIds`, `activeTool`, `zoom`, `pan`, состояние модалок) и `equality` по ссылке `scene`.
   * Пакет из нескольких tool calls за один запрос ИИ объединяется в **один** шаг Undo через `useEditorStore.temporal.getState().pause()` до начала цикла и `resume()` с записью финального кадра после цикла.
4. **Изоляция бинарников картинок (`AssetRegistry`):**
   * Запрещено хранить `base64` или `Blob` внутри Zustand и истории `zundo`. Все изображения живут в `AssetRegistry` (`Map<assetId, AssetEntry>`), а `ImageLayer` хранит только `assetId: string`, `width` и `height`.
   * **Важно для Undo:** при удалении `ImageLayer` нельзя сразу вызывать `URL.revokeObjectURL` — слой может вернуться по `Ctrl+Z`. Object URL освобождаются только при закрытии/смене документа (`clear()`), а неиспользуемые ассеты отфильтровываются при сохранении `.locus`.
5. **Отсутствие CORS и платформенная абстракция (`src/platform/io.ts`):**
   * Все HTTP-запросы к Gemini API и OpenAI-compatible эндпоинтам выполняются через `fetch` из `@tauri-apps/plugin-http`.
   * Взаимодействие с ОС (файлы, диалоги, `settings.json`, HTTP `fetch`) изолируется в `src/platform/io.ts` с проверкой `isTauri()` (`typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window`) и браузерным/тестовым фолбэком, чтобы `npm test` (Vitest) и `npm run dev` в обычном браузере не падали.
6. **Изоляция Paper.js под React 19 StrictMode:**
   * Импортировать `import paper from 'paper/dist/paper-core'` (исключает тяжёлый парсер PaperScript/Acorn).
   * В `PaperCanvas.tsx` создавать **локальный экземпляр** `const scope = new paper.PaperScope(); scope.setup(canvas);`, а в `useEffect` cleanup выполнять `scope.project.remove()` (защита от двойного монтирования React 19 StrictMode и утечки глобального состояния).
   * На холсте поддерживаются ровно 3 внутренних слоя Paper.js: `artboardLayer` (фон артборда и рамка), `sceneLayer` (слои из `Scene`), `overlayLayer` (рамка выделения, узлы, усики, направляющие). Элементы `overlayLayer` масштабируются обратно пропорционально зуму (`1 / scope.view.zoom`), не попадают в `hitTest` для выделения слоёв и никогда не участвуют в экспорте.
7. **Clipping Mask (модель Illustrator/Figma):**
   * Слой-маска (`PathLayer`) привязывается к одному или нескольким целевым слоям через `targetLayer.clipMaskId = maskLayer.id` (и помечается `maskLayer.isClipMask = true`).
   * Пока `PathLayer` является маской (на него ссылается хотя бы один слой или `isClipMask === true`), его собственная заливка и обводка **не рисуются** — на холсте отображается только его тонкий контур при наведении или выделении.
   * На холсте (Paper.js) и при экспорте (`.svg`, `.ai`, `.psd`) все слои с одинаковым `clipMaskId` помещаются в общую clipped-группу (`clipped = true` в Paper.js, `<clipPath>` в SVG, `W n` / `W* n` в PDF/AI, clipping-группа в PSD).
   * Запрещены циклические ссылки и самомаскирование; команда `releaseClipMask(maskId)` снимает маску в 1 клик, возвращая дефолтную видимую обводку/заливку контуру; при удалении маски в `deleteLayers` у зависимых слоёв автоматически очищается `clipMaskId`.
8. **Нативный Drag & Drop (Tauri v2):**
   * В `tauri.conf.json` включено `dragDropEnabled: true`. Поэтому HTML5 `onDrop` в WebView перехватывается нативным обработчиком. Импорт перетаскиванием реализуется через `getCurrentWebview().onDragDropEvent(...)`: файлы `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg` (как растр) добавляются как `ImageLayer`, файл `.locus` открывается как проект.
9. **Однонаправленная синхронизация:** `engine/sync.ts` строит и обновляет `sceneLayer` исключительно на основе `Scene` и `AssetRegistry`, не вызывая экшены стора во время рендера. Для `PathLayer` и `ImageLayer` сохранён mapping `layerId -> paper.Item` (`item.data.layerId`) для быстрого `hitTest` и 60 FPS интеракций.

---

## 6. Структура проекта

```text
locus/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── fonts/                          # 12 статических .ttf файлов (Regular + Bold для 6 семейств)
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json                # Права на http, fs ($APPCONFIG/**), dialog
│   └── src/
│       ├── main.rs
│       └── lib.rs                      # Регистрация tauri_plugin_http, fs, dialog
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css                       # @import "tailwindcss"; @theme; @font-face (6 семейств × 2 веса)
│   ├── platform/
│   │   └── io.ts                       # Единая обертка Tauri/Browser для httpFetch, fs, dialog, drag&drop
│   ├── core/
│   │   ├── types.ts                    # Интерфейсы Scene, Layer, SubPath, AnchorPoint, AIConfig
│   │   ├── fonts.ts                    # Каталог 6 встроенных шрифтов, пути к .ttf и предзагрузка кэша байтов
│   │   ├── math.ts                     # Матрицы M, localToWorld, worldToLocal, worldBBox, нормализация
│   │   ├── assets.ts                   # AssetRegistry (Blob, ObjectURL, mime, dataURL для экспорта)
│   │   ├── store.ts                    # Zustand v5 + zundo (partialize: scene)
│   │   └── commands.ts                 # Атомарные команды изменения сцены (для UI, инструментов и ИИ)
│   ├── engine/
│   │   ├── PaperCanvas.tsx             # Изолированный PaperScope, зум, панорамирование, текстовый <textarea>
│   │   ├── sync.ts                     # Однонаправленная синхронизация Scene -> Paper.js sceneLayer
│   │   ├── overlay.ts                  # Рендер рамки выделения, anchors и handles в overlayLayer
│   │   ├── geometry.ts                 # Генератор Smart Shapes (blob, ellipse, rect, polygon, star), smooth/wobble
│   │   ├── booleans.ts                 # Обертка над paper.PathItem (unite, subtract, intersect) + пересчет SubPath[]
│   │   └── tools/
│   │       ├── selectTool.ts           # Черная стрелка (V): выделение, перемещение, масштаб, поворот
│   │       ├── nodeTool.ts             # Белая стрелка (A): anchors, handles, добавление/удаление/smooth
│   │       ├── penTool.ts              # Перо (P): пошаговое построение Безье с live-превью
│   │       ├── blobTool.ts             # Smart Shape (B): рисование пресетов протягиванием
│   │       └── textTool.ts             # Текст (T): создание и активация inline-редактирования
│   ├── ai/
│   │   ├── config.ts                   # Чтение/запись $APPCONFIG/locus/settings.json
│   │   ├── context.ts                  # Компактный снимок сцены (метаданные + мировой bbox)
│   │   ├── registry.ts                 # JSON Schema 14 инструментов и валидатор аргументов
│   │   ├── executor.ts                 # Tool-calling loop (до 5 шагов), батчинг Undo, AbortController
│   │   └── providers/
│   │       ├── gemini.ts               # Адаптер Gemini API (generateContent + functionDeclarations)
│   │       └── openai.ts               # Адаптер OpenAI-compatible (/chat/completions + tool_calls)
│   ├── export/
│   │   ├── projectFile.ts              # Сохранение и открытие .locus (ZIP) со сборкой мусора ассетов
│   │   ├── toSvg.ts                    # Чистый детерминированный SVG-сериализатор напрямую из Scene
│   │   ├── toAi.ts                     # Векторный PDF-поток (pdf-lib + @pdf-lib/fontkit) с расширением .ai
│   │   ├── rasterize.ts                # Общий offscreen-рендерер слоя и всей сцены в HTMLCanvasElement
│   │   └── toPsd.ts                    # Сборка многослойного .psd через ag-psd
│   └── ui/
│       ├── TopBar.tsx                  # Документ, Открыть/Сохранить/Экспорт, Undo/Redo, зум, настройки
│       ├── StartModal.tsx              # Выбор пресета, custom-размер или открытие .locus
│       ├── Toolbar.tsx                 # Левая панель инструментов
│       ├── LayersPanel.tsx             # Правая верхняя панель слоёв
│       ├── Inspector.tsx               # Правая нижняя панель свойств, масок, булевых и выравнивания
│       ├── CommandBar.tsx              # ИИ-командная строка (Ctrl+K)
│       └── SettingsModal.tsx           # Настройка провайдера и API-ключей
└── tests/
    ├── math.test.ts                    # Трансформации, нормализация без «прыжка»
    ├── commands.test.ts                # Команды, маски, zundo Undo/Redo
    ├── geometry.test.ts                # Smart Shapes, smooth, randomizeAnchors
    ├── export.test.ts                  # .locus round-trip, валидность SVG, PDF/AI-операторы, PSD-структура
    └── ai.test.ts                      # Парсинг/цикл tool calls и 1-step Undo батчинг
```

---

## 7. Модель данных (`src/core/types.ts`)

```ts
export type ToolType = 'select' | 'node' | 'pen' | 'blob' | 'text';

export type SmartShapePreset = 'blob' | 'ellipse' | 'rect' | 'polygon' | 'star';

export interface SmartShapeOptions {
  preset: SmartShapePreset;
  points: number;           // 3..24 (для blob, polygon, star)
  wobble: number;           // 0..1 (для blob)
  cornerRadius: number;     // px (для rect)
  innerRadiusRatio: number; // 0.1..0.9 (для star)
}

export interface Point2D {
  x: number;
  y: number;
}

export interface AnchorPoint {
  x: number;
  y: number;
  handleIn: Point2D;  // Смещение относительно (x, y)
  handleOut: Point2D; // Смещение относительно (x, y)
  smooth: boolean;
}

export interface SubPath {
  closed: boolean;
  anchors: AnchorPoint[]; // В локальных координатах относительно центра (0, 0) PathLayer
}

export interface StrokeStyle {
  color: string;
  width: number;
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
}

export interface BaseLayer {
  id: string;
  name: string;
  type: 'path' | 'text' | 'image';
  visible: boolean;
  locked: boolean;
  x: number;
  y: number;
  rotation: number;   // Градусы по часовой стрелке
  scaleX: number;
  scaleY: number;
  opacity: number;    // 0..1
  clipMaskId?: string; // ID PathLayer, который обрезает этот слой
}

export interface PathLayer extends BaseLayer {
  type: 'path';
  subpaths: SubPath[];
  fillRule: 'nonzero' | 'evenodd';
  fill: string | null;
  stroke: StrokeStyle | null;
  isClipMask?: boolean;
}

export type BuiltinFontFamily =
  | 'Inter'
  | 'Manrope'
  | 'Golos Text'
  | 'Playfair Display'
  | 'JetBrains Mono'
  | 'Unbounded';

export interface TextLayer extends BaseLayer {
  type: 'text';
  content: string;
  fontSize: number;
  fontFamily: BuiltinFontFamily;
  fontWeight: 400 | 700;
  lineHeight: number;     // По умолчанию 1.2
  letterSpacing?: number; // px, по умолчанию 0
  fill: string;
  align: 'left' | 'center' | 'right';
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  assetId: string; // Ключ в AssetRegistry
  width: number;
  height: number;
}

export type Layer = PathLayer | TextLayer | ImageLayer;

export interface Scene {
  version: 1;
  name: string;
  width: number;
  height: number;
  dpi: number;       // 72 по умолчанию, 300 для A4 Print
  background: string;
  layers: Layer[];   // Порядок отрисовки: снизу вверх (0 = самый нижний слой)
}

export interface DocumentPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  dpi: number;
}

export interface AssetEntry {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

export type AIProviderType = 'gemini' | 'openai';

export interface AIConfig {
  provider: AIProviderType;
  geminiApiKey: string;
  geminiModel: string;     // по умолчанию 'gemini-4-neon'
  openaiBaseUrl: string;   // например 'https://api.openai.com/v1' или 'http://localhost:11434/v1'
  openaiApiKey: string;
  openaiModel: string;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

---

## 8. Форматы файлов и экспорт

### 1. Нативный проект (`.locus`) — `src/export/projectFile.ts`
* **Формат:** ZIP-архив (`jszip`), содержащий:
  * `scene.json` — сериализованный объект `Scene` (`version: 1`).
  * `assets/<assetId>.<ext>` — только реально используемые в `scene.layers` изображения (неиспользуемые ассеты отбрасываются при сохранении, чтобы архив не раздувался после Undo/удалений).
* **Загрузка:** проверка `scene.version === 1` и обязательных полей, полная очистка старого `AssetRegistry` перед загрузкой нового, восстановление `Blob`, `objectUrl` и размеров картинок из `assets/`, сброс истории `zundo` (`temporal.getState().clear()`).

### 2. Чистый векторный экспорт в `.svg` — `src/export/toSvg.ts`
* Собирается **напрямую из `Scene` + `AssetRegistry`** (не через `paper.project.exportSVG()`, что исключает утечку оверлеев, обратных зумов и лишних Paper-атрибутов).
* Корневой `<svg xmlns="http://www.w3.org/2000/svg" width="..." height="..." viewBox="0 0 W H">`, фоновый `<rect>` с `scene.background`.
* Слои-маски выводятся в `<defs><clipPath id="clip-<maskId>">...</clipPath></defs>` с применением матрицы трансформации маски.
* Для каждого видимого слоя генерируется `<g id="<safeLayerId>" data-name="<layer.name>" opacity="...">` (группировка или оборачивание `clip-path="url(#clip-...)"` при наличии `clipMaskId`):
  * `PathLayer`: `<path d="..." fill-rule="nonzero|evenodd" fill="..." stroke="..." stroke-width="..." stroke-linecap="..." stroke-linejoin="..."/>` (кривые строятся по `M` / `C` / `L` / `Z`).
  * `TextLayer`: `<text>` и построчные `<tspan>` по формуле `baselineY(i)`, `font-family`, `font-weight`, `font-size`, `text-anchor` (`start` / `middle` / `end`).
  * `ImageLayer`: `<image href="data:<mime>;base64,..." x="-w/2" y="-h/2" width="w" height="h" transform="..."/>`.

### 3. Векторный экспорт в `.ai` (PDF-поток) — `src/export/toAi.ts`
* Библиотеки: `pdf-lib` + `@pdf-lib/fontkit`.
* Пересчёт пикселей артборда в PDF points: `ptPerPx = 72 / scene.dpi`, размер страницы `[scene.width * ptPerPx, scene.height * ptPerPx]`.
* Пересчёт экранных координат в PDF (ось Y снизу вверх):
  $$\text{pdfX} = w_x \cdot \text{ptPerPx}, \qquad \text{pdfY} = (\text{scene.height} - w_y) \cdot \text{ptPerPx}$$
* Прозрачность (`opacity < 1`): создаётся `PDFExtGState` (`ca` для заливки, `CA` для обводки) и применяется через `setGraphicsState`.
* `PathLayer` (не являющийся скрытой маской):
  * Все `subpaths` и контрольные точки переводятся в мировые PDF-координаты через `localToWorld` до записи операторов — никакой путаницы с порядком матриц в PDF.
  * Операторы: `pushGraphicsState()`, `moveTo`, `appendBezierCurve` для каждой кривой Безье, `closePath` для замкнутых `subpath`, затем `fill` (`f`) / `fillEvenOdd` (`f*`) / `stroke` (`S`) или комбинированный `fillAndStroke` (`B` / `B*`).
* Маски (`clipMaskId`): перед группой маскируемых слоёв выполняется `pushGraphicsState()`, рисуется контур маски и вызывается `clip` + `endPath` (`W n` для `nonzero` или `W* n` для `evenodd`), после группы — `popGraphicsState()`.
* `TextLayer`:
  * Через `pdfDoc.registerFontkit(fontkit)` и `src/core/fonts.ts` подгружаются байты статического `.ttf` нужного семейства и веса (`400` / `700`), встраиваются через `pdfDoc.embedFont(fontBytes)`.
  * Строки рисуются через `page.drawText(...)` с учётом `align`, `rotate` и формулы `baselineY(i)`. Кириллица и латиница сохраняются как редактируемый текст.
* `ImageLayer`: PNG и JPEG встраиваются напрямую (`embedPng` / `embedJpg`); WebP или другие форматы предварительно перекодируются в PNG на offscreen `<canvas>` через `canvas.toBlob('image/png')`.

### 4. Многослойный экспорт в `.psd` — `src/export/toPsd.ts` + `src/export/rasterize.ts`
* Библиотека: `ag-psd`.
* Общий модуль `src/export/rasterize.ts` умеет:
  1. Отрисовать отдельный слой на offscreen `HTMLCanvasElement` (для `PathLayer`, `TextLayer`, `ImageLayer` с учётом трансформаций, стилей и единой `baselineY`).
  2. Собрать полный композитный `HTMLCanvasElement` всего документа (включая фон, порядок слоёв и клиппинг-маски), который передаётся в корень `Psd.canvas` — это нужно для корректного превью файла `.psd` в ОС и Adobe Photoshop.
* Для каждого слоя в `Psd.children` заполняются `name`, `hidden: !layer.visible`, `opacity: layer.opacity` (в `ag-psd` диапазон `0..1`), `canvas` и смещения `left` / `top`.
* Для `TextLayer` дополнительно заполняется структура `text: { text, transform, style: { font, fontSize, fillColor } }` для редактируемости в Photoshop, а запись выполняется с опциями:
  ```ts
  writePsd(psd, {
    generateThumbnail: true,
    invalidateTextLayers: true,
  });
  ```

---

## 9. ИИ-слой (BYOK + Tool Calling)

### Хранение настроек (`src/ai/config.ts`)
* Настройки хранятся в `$APPCONFIG/locus/settings.json` через `src/platform/io.ts` (никогда не записываются в `.locus` и не попадают в репозиторий).
* Провайдер по умолчанию — OpenAI-compatible (`gpt-6-luna`); порядок в настройках: OpenAI / API → Anthropic → Google Gemini → Ollama. Быстрые модели актуализированы в `src/core/aiModels.ts`: OpenAI `gpt-6-luna` / `gpt-6.2-sol` / `gpt-6.2-astra`, Anthropic `claude-sonnet-5-5` / `claude-opus-5-5` / `claude-haiku-5-5`, Gemini `gemini-4-carbon` / `gemini-4-neon` / `gemini-4-argon` / `gemini-3.8-flash`, DeepSeek `deepseek-flash` / `deepseek-v4-pro`, Ollama `qwen3.8` / `gpt-oss:20b` / `deepseek-v4.1-flash` / `gemma4`. Для OpenAI-compatible поддерживаются облачные эндпоинты и локальные серверы (Ollama `http://localhost:11434/v1`, LM Studio и т.п.).
* Если API-ключ не задан, окно ИИ показывает ошибку и открывает вкладку «ИИ» настроек (`initialTab` у `SettingsModal`).
* Возможности vision не определяются эвристикой приложения: изображения отправляются модели всегда, а сообщение о неподдержке приходит от провайдера и показывается как «Модель не приняла изображение: …».

### Компактный контекст сцены (`src/ai/context.ts`)
В каждый запрос ИИ передаётся не вся сырая геометрия и не картинки, а компактный JSON-снимок `SceneContext`:
* `artboard`: `{ width, height, dpi, background }`
* `selectedIds`: массив выделенных ID
* `layers`: список слоёв в порядке отрисовки (`id`, `name`, `type`, `visible`, `locked`, `opacity`, `clipMaskId`, `isClipMask`, вычисленный мировой `bbox: { x, y, width, height }`, для `path` — `fill`, `stroke`, число контуров/узлов; для `text` — `content`, `fontFamily`, `fontSize`, `fill`; для `image` — `width`, `height`).

### Провайдеры
1. **Gemini API (`src/ai/providers/gemini.ts`):**
   * `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
   * Заголовок: `x-goog-api-key: <apiKey>` (ключ не светится в URL).
   * Передаются `systemInstruction`, `contents` (история сообщений `user` / `model` / `function`), `tools: [{ functionDeclarations }]`.
2. **OpenAI-compatible (`src/ai/providers/openai.ts`):**
   * `POST {baseURL}/chat/completions` (нормализация завершающего `/`), заголовок `Authorization: Bearer <apiKey>`.
   * Передаются `messages`, `tools` в формате `type: "function"`, цикл обработки `message.tool_calls` с возвратом `role: "tool"`.

### Исполнитель и жизненный цикл (`src/ai/executor.ts`)
1. При запуске промпта создаётся `AbortController` (кнопка «Стоп» в `CommandBar`).
2. ИИ работает в цикле до **5 шагов** (`MAX_TOOL_ITERATIONS = 5`), пока модель возвращает `tool_calls` / `functionCall`.
3. Каждый вызов валидируется по схеме (`src/ai/registry.ts`) — неверные параметры возвращают модели структурированную ошибку без краша сцены.
4. Перед серией tool calls история `zundo` ставится на паузу (`pause()`), после выполнения всей цепочки команд в `src/core/commands.ts` фиксируется **ровно один шаг Undo** (`resume()` + commit), чтобы пользователь мог отменить весь результат ИИ одним `Ctrl+Z`.

### Базовый реестр инструментов (`src/ai/registry.ts` — 14 инструментов)

| Инструмент | Назначение |
| :--- | :--- |
| `create_blob` | Создать органическую кляксу (`name, points, radius, wobble, fill, x, y`) |
| `create_shape` | Создать примитив (`name, preset: 'ellipse'\|'rect'\|'polygon'\|'star', width, height, cornerRadius?, points?, innerRadiusRatio?, fill, stroke?, x, y`) |
| `create_text` | Добавить текстовый слой (`name, content, fontSize, fontFamily, fontWeight?, align?, fill, x, y`) |
| `create_line` | Нарисовать линию/открытый контур по точкам с обводкой (`points, closed?, smooth?, stroke, fill?, name?`) — усы, брови, рот, контуры |
| `report_plan` | Зафиксировать план и бюджет шагов (`steps`, `summary`); исполнитель подстраивает прогресс под план |
| `update_layers` | Изменить свойства слоёв (`layerIds, patch`: `name, visible, locked, x, y, rotation, scaleX, scaleY, opacity, fill, stroke, content, fontSize, fontFamily, fontWeight, align`) |
| `delete_layers` | Удалить указанные слои с очисткой зависимых `clipMaskId` (`layerIds`) |
| `duplicate_layers` | Дублировать слои со сдвигом (`layerIds, offsetX?, offsetY?`) |
| `reorder_layers` | Изменить Z-порядок (`layerId, mode: 'front'\|'back'\|'forward'\|'backward'\|'index', index?`) |
| `set_clip_mask` | Назначить или снять маску (`maskLayerId: string \| null, targetLayerIds`) |
| `randomize_anchors` | Добавить органическое искажение точкам фигур (`layerIds, intensity`) |
| `align_layers` | Выровнять или распределить слои (`layerIds, mode`: `left`, `center`, `right`, `top`, `middle`, `bottom`, `distribute_h`, `distribute_v`, `artboard_center`) |
| `apply_palette` | Перекрасить указанные слои или всю сцену в палитру (`colors: string[], layerIds?, includeBackground?`) |
| `boolean_op` | Выполнить булеву операцию над `PathLayer` (`layerIds, operation: 'unite'\|'subtract'\|'intersect'`) |

---

## 10. Поэтапный план сборки (Roadmap) и ворота верификации

Каждый этап считается завершённым только после прохождения всех автоматических и ручных проверок из его блока верификации.

### Этап 1. Инициализация, каркас UI, шрифты и холст — **ВЫПОЛНЕНО**
* [x] Инициализировать `git`, `package.json`, TypeScript, Vite (`@tailwindcss/vite`), Vitest и `src-tauri/` (Tauri v2 с `plugin-http`, `plugin-fs`, `plugin-dialog`, `capabilities/default.json`, `csp` в `tauri.conf.json`). Дополнительно добавлены `.gitignore`, `src/vite-env.d.ts`, `src/paper-core.d.ts`.
* [x] Поместить 12 валидных статических `.ttf`-файлов в `public/fonts/`, настроить `@font-face` и `@theme` в `src/index.css`, описать каталог в `src/core/fonts.ts`.
* [x] Реализовать `src/platform/io.ts` (абстракция Tauri / Browser) и `src/core/types.ts`.
* [x] Сверстать каркас бумажной темы (`TopBar`, `Toolbar`, `LayersPanel`, `Inspector`, `StartModal`) с защитой хоткеев от срабатывания в полях ввода и SVG-иконкой `public/icon.svg`.
* [x] Настроить `PaperCanvas.tsx` с изолированным `PaperScope`, слоями `artboardLayer` / `sceneLayer` / `overlayLayer`, плавным зумом к курсору и панорамированием (`Space + Drag`, средняя кнопка мыши).
* [x] Сгенерировать набор иконок `src-tauri/icons/*` через `npx tauri icon` из утверждённой иконки `3C`.
* **Критерии готовности и проверка:**
  * [x] `file public/fonts/*.ttf` подтверждает формат `TrueType Font data` для всех 12 файлов (`fc-query`: `variable=False`, веса `80`/`200`, поддержка `ru`).
  * [x] `npx tsc --noEmit` и `npm run build` завершаются с кодом `0`.
  * [x] `cargo check --manifest-path src-tauri/Cargo.toml -j 2` завершается без ошибок.
  * [ ] Ручная проверка окна: `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev` (запускается пользователем вручную).

### Этап 2. Стор, математика, векторные примитивы и редактирование узлов — **ВЫПОЛНЕНО**
* [x] Реализовать `src/core/types.ts`, `src/core/math.ts` (матрицы, `localToWorld`, нормализация без «прыжка»), `src/core/store.ts` (Zustand v5 + `zundo` с `partialize: scene`) и базовые команды `src/core/commands.ts`.
* [x] Реализовать `src/engine/geometry.ts` (все 5 пресетов `Smart Shape`, `smooth`, `randomizeAnchors`) и `src/engine/sync.ts` (однонаправленный рендер с `applyMatrix = false`).
* [x] Реализовать `src/engine/overlay.ts` и инструменты `selectTool.ts` (`V`), `nodeTool.ts` (`A`), `penTool.ts` (`P`), `blobTool.ts` (`B`): 60 FPS перетаскивание в Paper.js → коммит в стор только в `onMouseUp`, добавление точки кликом по контуру, переключение `smooth` двойным кликом, удаление узла.
* **Критерии готовности и проверка:**
  * [x] Юнит-тесты `tests/math.test.ts`, `tests/geometry.test.ts` и `tests/commands.test.ts` (`npm test`) проходят на 100% (14/14).
  * [ ] Проверка в UI: нарисованная фигура после поворота на $37^\circ$ и редактирования узла в `A` не смещается («не прыгает»); во время драга история `zundo` не копится, `Ctrl+Z` откатывает всё перетаскивание за 1 шаг (запускается пользователем вручную).

### Этап 3. Текст, картинки, булевы операции, маски и автоматика — **ВЫПОЛНЕНО**
* [x] Реализовать `textTool.ts` (`T`) и inline-редактирование через `<textarea>` поверх холста (поддержка всех 6 встроенных шрифтов, весов 400/700, кириллицы, `align`).
* [x] Реализовать `src/core/assets.ts` (`AssetRegistry`), добавление `ImageLayer` через кнопку `I` (`plugin-dialog`) и нативный Drag & Drop (`onDragDropEvent`).
* [x] Реализовать `src/engine/booleans.ts` (`unite`, `subtract`, `intersect`) с поддержкой `CompoundPath` (`subpaths[]`, `fillRule`) и обязательной нормализацией в локальные координаты.
* [x] Реализовать Clipping Mask (`setClipMask`, `releaseClipMask`, `createClipMaskFromSelection`) и полные действия в `LayersPanel` / `Inspector` (порядок слоёв, `Smooth`/`Wobble`, выравнивание и распределение, кастомный выбор шрифта).
* **Критерии готовности и проверка:**
  * [x] Булево вычитание (`subtract`) меньшего круга из большего создаёт фигуру с реальным отверстием (2 `subpath`, `evenodd`/`nonzero`), корректно поворачивается и откатывается по `Ctrl+Z` (`tests/stage3.test.ts`).
  * [x] Удаление `ImageLayer` и последующий `Ctrl+Z` восстанавливает картинку без сломанного `ObjectURL` (`tests/stage3.test.ts`).
  * [x] Clipping Mask скрывает заливку маскирующего контура и корректно обрезает 1+ слоёв, снимается кнопкой снятия маски (`tests/stage3.test.ts`).
  * [x] `npx tsc --noEmit`, `npm test` (19/19) и `npm run build` — зелёные.

### Этап 3.5. Векторизация текста и полноценные векторные операции Illustrator — **ВЫПОЛНЕНО**
* [x] Реализовать `src/engine/textOutlines.ts` (`@pdf-lib/fontkit`) и команду `convertTextLayersToOutlines` (`Ctrl+Shift+O`): перевод `TextLayer` (6 шрифтов, кириллица, `letterSpacing`, `align`, повороты/масштаб) в редактируемый `PathLayer` с сохранением 1 шага `Ctrl+Z`.
* [x] Расширить `TextLayer` поддержкой трекинга (`letterSpacing`) во всех модулях (`types.ts`, `math.ts`, `sync.ts`, `PaperCanvas.tsx`) и сменой регистра `transformTextCase` (`UPPER` / `lower` / `Title`).
* [x] Расширить `src/engine/booleans.ts` и `src/core/commands.ts`: булевы `exclude` и `divide` (полное разбиение на непересекающиеся части), умное разбиение `splitCompoundPathLayers` (сохранение дырок в буквах при разбиении слова на буквы, повторное разбиение одиночной буквы на субконтуры), сборка `combineCompoundPathLayers` (`Ctrl+8`), `offsetPathLayers` (параллельный контур/подложка), `outlineStrokeLayers` (обводка в кривые), `simplifyPathLayers` (упрощение узлов) и `flipLayers` (отражение H/V).
* [x] Вынести базовые контролы в `src/ui/InspectorControls.tsx`, обновить `Inspector.tsx` и горячие клавиши в `App.tsx`.
* **Критерии готовности и проверка:**
  * [x] `tests/stage3_5.test.ts` проверяет векторизацию кириллицы на реальных `.ttf`, разбиение слова на буквы с сохранением отверстий, `Ctrl+8`, `exclude`, `divide`, `offset`, `outlineStroke`, `simplify`, `flip` и регистр текста.
  * [x] `npx tsc --noEmit`, `npm test` (23/23), `npm run build` и `cargo check -j 2` — зелёные.

### Этап 3.6. Настройки, темы, пипетка, привязки и декомпозиция архитектуры — **ВЫПОЛНЕНО**
* [x] Реализовать `src/core/themes.ts` (4 темы: `paper`, `studio`, `graphite`, `midnight`, акцентные цвета, свой фон рабочего стола) и `src/core/settings.ts` (`useSettingsStore` с сохранением в `$APPCONFIG/locus/settings.json` / `localStorage`, автосохранение черновика `autosave-draft.json`, динамический лимит Undo в `store.ts`).
* [x] Реализовать полноценное окно `src/ui/SettingsModal.tsx` (`Ctrl+,`, вкладки «Темы и цвета», «Холст и привязки», «Технические», «Горячие клавиши», «ИИ») и вынести реестр команд в `src/core/shortcuts.ts` с проверкой конфликтов (пипетка `E` не конфликтует с вставкой изображения `I`).
* [x] Добавить пипетку (`src/engine/tools/eyedropperTool.ts`, `E`), буфер обмена слоёв и стилей (`src/core/clipboard.ts`, `Ctrl+C`/`Ctrl+V`/`Ctrl+Shift+V`/`Ctrl+Alt+C`/`Ctrl+Alt+V`), сетку артборда и Smart Guides (`src/engine/snapping.ts`, `src/engine/overlay.ts`, `selectTool.ts`), сдвиг стрелками (`nudgeLayers`) и палитру «Цвета документа».
* [x] Перевести правила заливки (`Сплошная` / `С вырезами`) и параметры обводки (`Плоский` / `Круглый` / `Квадратный`, `Острый` / `Круглый` / `Скошенный`) на русский язык.
* [x] Декомпозировать `src/core/commands.ts` в модули `src/core/commands/{helpers,document,layers,vector,text,index}.ts` с общим фасадом реэкспорта и разбить `src/ui/Inspector.tsx` на подкомпоненты `src/ui/inspector/{InspectorTransform,InspectorAppearance,InspectorVectorOps,InspectorText}.tsx`.
* **Критерии готовности и проверка:**
  * [x] `tests/stage3_6.test.ts` проверяет темы и CSS-переменные, санитизацию и сохранение настроек, динамический `undoLimit`, отсутствие конфликтов хоткеев (`I`/`E`), буфер обмена/стили, привязки/Smart Guides, пипетку, сдвиг стрелками и реэкспорт `commands.ts`.
  * [x] `npx tsc --noEmit`, `npm test` (29/29), `npm run build` и `cargo check -j 2` — зелёные.

### Этап 4. Сохранение проекта и экспорт (`.locus`, `.ai`, `.svg`, `.psd`)
* Реализовать `src/export/projectFile.ts`: сохранение и открытие `.locus` (ZIP) со сборкой неиспользуемых ассетов.
* Реализовать `src/export/toSvg.ts`: прямой чистый SVG с `<clipPath>`, `subpaths`, текстом и картинками.
* Реализовать `src/export/toAi.ts`: векторный PDF-поток через `pdf-lib` + `@pdf-lib/fontkit` с кривыми Безье, масками, картинками и кириллическими `.ttf` шрифтами.
* Реализовать `src/export/rasterize.ts` и `src/export/toPsd.ts`: послойный и композитный offscreen-рендер через `ag-psd`.
* **Критерии готовности и проверка:**
  * `tests/export.test.ts` проверяет: round-trip `.locus` (сцена + бинарник картинки восстанавливаются без потерь), валидность XML/структуры `.svg`, непустые PDF-байты `%PDF-` для `.ai` с кириллицей, кривыми и маской, чтение обратно через `readPsd` из `ag-psd` для `.psd`.
  * Ручная проверка открытием экспортированных `.svg`, `.ai` и `.psd` во внешнем просмотрщике / векторном редакторе.

### Этап 5. Подключение ИИ (Gemini + OpenAI-compatible) — **ВЫПОЛНЕНО**
* [x] Реализовать хранение настроек ИИ в `$APPCONFIG/locus/settings.json` (вкладка «ИИ» в `SettingsModal.tsx`): Gemini, Anthropic, Ollama и OpenAI-compatible провайдеры.
* [x] Реализовать `src/ai/types.ts`, `src/ai/context.ts`, `src/ai/registry.ts` (14 инструментов + валидация аргументов), `src/ai/providers/{gemini,openai,anthropic,ollama,index}.ts`, `src/ai/executor.ts` и `src/ui/CommandBar.tsx` (`Ctrl+K`, контекстное меню «ИИ…», меню и верхняя панель).
* [x] Батчинг Undo: серия tool calls выполняется при `temporal.pause()`, после чего история схлопывается в ровно один шаг `Ctrl+Z`; `AbortController` останавливает выполнение (кнопка «Стоп»). Сворачивание окна не прерывает задачу: прогресс показывается в индикаторе внутри артборда.
* [x] Вложения-изображения (PNG/JPEG/WebP, до 4 шт.) с превью; поддержка vision проверяется по модели, для неподдерживающих выводится явное сообщение. `report_plan` задаёт число шагов по плану модели.
* **Критерии готовности и проверка:**
  * [x] `tests/ai.test.ts` проверяет реестр и валидацию 14 инструментов, выполнение команд, контекст сцены, адаптеры четырёх провайдеров (мок fetch), цикл tool calling, ошибки аргументов, `AbortController` и слияние серии из 2+ команд ИИ в ровно 1 шаг `Ctrl+Z`.
  * [x] `npx tsc --noEmit`, `npm test` (75/75) и `npm run build` — зелёные.
  * [ ] Интеграционная проверка в запущенном приложении: выделение слоёв → команда в `Ctrl+K` → вызов инструментов ИИ → живое обновление холста → полный откат по `Ctrl+Z` (запускается пользователем вручную).
  * [ ] Финальный релизный прогон `npm run tauri build` (запускается пользователем вручную).

---

## 11. Чеклист запуска при старте разработки

1. Инициализировать Git в корне проекта (`git init`) перед первым коммитом каркаса.
2. После установки пакетов и создания `src-tauri/` сразу убедиться, что `npm run tauri dev` запускает окно на данном Linux-окружении. *(Примечание для Linux + Wayland/NVIDIA/WebKitGTK 2.54+: если при первом запуске окно отрисует чёрный/пустой холст, запускать dev-режим с переменной окружения `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`.)*
3. Хранить все API-ключи только в `$APPCONFIG/locus/settings.json` через `SettingsModal` — не коммитить их в проект.

---

## 12. Передача контекста в следующий диалог (Handoff)

Проект в харнесе организован по этапам/диалогам внутри папки `locus`:
* `препродакшн` — исходная проработка архитектуры, дизайна, иконки `3C` и спецификации.
* `продакшн этап 1` — реализация и верификация Этапа 1 (фундамент, шрифты, Tauri v2, каркас UI, `PaperCanvas`).
* `продакшн этап 2` — реализация и верификация Этапа 2 (`math.ts`, `store.ts` + `zundo`, `commands.ts`, `geometry.ts`, `sync.ts`, `overlay.ts`, инструменты `V`/`A`/`P`/`B`, интеграция `App`/`LayersPanel`/`Inspector`, 14 юнит-тестов).
* `продакшн этап 3` — реализация и верификация Этапа 3 (`assets.ts`, `booleans.ts`, `textTool.ts`, inline `<textarea>`, растры в `sync.ts`, нативный Drag & Drop, булевы/маски/выравнивание/типографика в `Inspector`/`LayersPanel`, 19 юнит-тестов).
* `продакшн этап 3.5` — реализация и верификация Этапа 3.5 (`textOutlines.ts`, `letterSpacing`, регистр, `Ctrl+Shift+O`, `Ctrl+8`/`Ctrl+Shift+8`, `exclude`/`divide`, `offset`/`outlineStroke`/`simplify`/`flip`, `InspectorControls.tsx`, 23 юнит-теста).
* `продакшн этап 3.6` — реализация и верификация Этапа 3.6 (`themes.ts`, `settings.ts`, `shortcuts.ts`, `clipboard.ts`, `snapping.ts`, `eyedropperTool.ts`, `SettingsModal.tsx`, декомпозиция `commands/` и `inspector/`, русские названия заливок/обводок, палитра документа, 29 юнит-тестов).

### Что передавать при старте нового диалога (Этап 4 и далее)
1. **Текущее состояние репозитория (`/home/qualbyy/Проекты/locus`):**
   * Этапы 1, 2, 3, 3.5 и 3.6 выполнены и проверены (`tsc --noEmit`, `npm test` 29/29, `npm run build`, `cargo check -j 2`).
   * Работают: `src/core/{types,fonts,assets,math,store,themes,settings,shortcuts,clipboard,commands}.ts` (`src/core/commands/*`), `src/platform/io.ts`, `src/engine/{PaperCanvas,geometry,booleans,textOutlines,snapping,sync,overlay}.ts`, `src/engine/tools/{types,selectTool,nodeTool,penTool,blobTool,textTool,eyedropperTool}.ts`, `src/ui/{TopBar,Toolbar,LayersPanel,Inspector,InspectorControls,StartModal,SettingsModal}.tsx` (`src/ui/inspector/*`), `src/App.tsx`, `src/index.css`.
2. **Первая точка входа для следующего этапа (Этап 4):**
   * Реализовать `src/export/projectFile.ts`: сохранение и открытие `.locus` (ZIP) со сборкой неиспользуемых ассетов (включая подключение кнопок Открыть/Сохранить и `.locus` в `App.tsx` / `onDragDropEvent`).
   * Реализовать `src/export/toSvg.ts`, `src/export/toAi.ts` (`pdf-lib` + `@pdf-lib/fontkit` с кривыми Безье, масками, картинками и кириллическими `.ttf`), `src/export/rasterize.ts` и `src/export/toPsd.ts` (`ag-psd`).
   * Добавить `tests/export.test.ts` (round-trip `.locus`, валидность `.svg`, PDF-байты `%PDF-` для `.ai`, обратное чтение `.psd` через `readPsd`).
3. **Инварианты среды и сборки (не повторять отладку):**
   * Для `cargo check` / `cargo build` на этой машине (3.6 GiB RAM) использовать `-j 2`.
   * Для запуска окна на Linux/Wayland при проблемах с DMA-BUF использовать `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`.
   * Paper.js импортировать строго как `paper/dist/paper-core` с `applyMatrix = false`, `pivot = (0, 0)` и прямой матрицей из `getLayerMatrix()`, а для headless boolean-операций использовать `new scope.Project(undefined as unknown as HTMLCanvasElement)` и `compound.reorient(false, true)` для `evenodd`.
   * В `loadScene` не очищать `AssetRegistry` — сначала наполнить его из `.locus`, а очищать только в `clearAssets()` при `resetDocument()` или перед загрузкой нового `.locus`.
   * В новом диалоге достаточно сослаться на `@[agents.md]` и указать номер этапа (например: «Продолжаем по `@[agents.md]`, начинаем Этап 4»).
