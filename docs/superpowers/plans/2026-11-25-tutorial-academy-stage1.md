# Обучение Locus — Этап 1 «Академия»: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в Locus рабочее окно обучения с 12 главами, поиском и сохраняемым прогрессом, открываемое из настроек, стартового окна, меню «Справка» и по `F1`.

**Architecture:** Содержание — типизированные данные в `src/tutorial/`, прогресс — поле `tutorial` в существующем `settings.json`, эфемерное состояние окна — отдельный Zustand-стор. UI — одно модальное окно в бумажной теме. Сцена редактора и история Undo не затрагиваются.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind CSS v4, lucide-react, Vitest.

## Global Constraints

- Никаких новых зависимостей.
- Бумажная тема: `bg-paper-panel`, `border-paper-border`, `text-paper-ink`, `text-paper-muted`, акцент `paper-accent`; без blur и тяжёлых теней.
- Прогресс хранится только в `$APPCONFIG/locus/settings.json` (через `useSettingsStore.updateSettings`), не в `.locus` и не в `zundo`.
- Сцена меняется только через команды; обучение сцену не мутирует.
- Работает в Tauri и в браузере.
- Все тексты интерфейса и обучения — на русском.
- `npx tsc --noEmit`, `npm test`, `npm run build` должны быть зелёными после каждого этапа.
- Этот план — только Этап 1. Туры (Этап 2) и песочница (Этап 3) планируются отдельно после приёмки Этапа 1.

---

## File Structure

**Create:**
- `src/tutorial/targets.ts` — тип и реестр целей подсветки (используется содержанием; DOM-атрибуты появятся на Этапе 2).
- `src/tutorial/content.ts` — 12 глав, 25 уроков, 75 шагов; индексы и статистика.
- `src/tutorial/progress.ts` — тип прогресса, санитизация, отметки, проценты.
- `src/tutorial/search.ts` — чистый поиск по содержанию.
- `src/tutorial/store.ts` — Zustand-стор окна и активного урока.
- `src/ui/tutorial/TutorialModal.tsx` — окно «Обучение Locus».

**Modify:**
- `src/core/settings.ts` — поле `tutorial`, санитизация, сохранение прогресса при общем сбросе.
- `src/core/shortcuts.ts` — действие `app.openTutorial` на `F1`.
- `src/ui/SettingsModal.tsx` — активная кнопка «Обучение» в футере.
- `src/ui/StartModal.tsx` — ссылка «Как это работает».
- `src/ui/MenuBar.tsx` — меню «Справка».
- `src/App.tsx` — рендер окна, входы, `F1`, защита шорткатов, подсказка первого запуска.

**Tests:**
- `tests/tutorial_progress.test.ts`
- `tests/tutorial_content.test.ts`
- `tests/tutorial_search.test.ts`
- `tests/tutorial_store.test.ts`
- `tests/tutorial_shortcuts.test.ts`

---

### Task 1: Прогресс и хранение в настройках

**Files:**
- Create: `src/tutorial/progress.ts`
- Modify: `src/core/settings.ts` (интерфейс, дефолты, `sanitizeSettings`, `resetSettings`)
- Test: `tests/tutorial_progress.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `interface TutorialProgress { version: 1; completedLessonIds: string[]; completedStepIds: string[]; lastLessonId: string | null; welcomeDismissed: boolean }`
  - `DEFAULT_TUTORIAL_PROGRESS`, `MAX_TUTORIAL_PROGRESS_IDS = 500`
  - `sanitizeTutorialProgress(raw: unknown): TutorialProgress`
  - `markStepCompleted(progress, stepId): TutorialProgress`
  - `markLessonCompleted(progress, lesson: { id: string; steps: Array<{ id: string }> }): TutorialProgress`
  - `dismissTutorialWelcome(progress): TutorialProgress`
  - `getLessonStats(progress, lesson)`, `getChapterStats(progress, chapter)`, `getOverallStats(progress, chapters)`
  - `resetTutorialProgress(): TutorialProgress`
  - `AppSettings.tutorial: TutorialProgress`

- [ ] **Step 1: Write the failing test**

Create `tests/tutorial_progress.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TUTORIAL_PROGRESS,
  MAX_TUTORIAL_PROGRESS_IDS,
  dismissTutorialWelcome,
  getChapterStats,
  getLessonStats,
  getOverallStats,
  markLessonCompleted,
  markStepCompleted,
  resetTutorialProgress,
  sanitizeTutorialProgress,
} from '../src/tutorial/progress';
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  useSettingsStore,
} from '../src/core/settings';

const lessonA = { id: 'a', steps: [{ id: 'a1' }, { id: 'a2' }] };
const lessonB = { id: 'b', steps: [{ id: 'b1' }] };
const chapter = { lessons: [lessonA, lessonB] };

describe('tutorial/progress', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: sanitizeSettings(DEFAULT_SETTINGS),
      loaded: true,
    });
  });

  it('sanitizes garbage, dedupes and caps ids', () => {
    const many = Array.from(
      { length: MAX_TUTORIAL_PROGRESS_IDS + 10 },
      (_, i) => `id-${i}`
    );
    const progress = sanitizeTutorialProgress({
      completedLessonIds: ['a', 'a', 7, '', 'b'],
      completedStepIds: many,
      lastLessonId: 42,
      welcomeDismissed: 'yes',
    });

    expect(progress.version).toBe(1);
    expect(progress.completedLessonIds).toEqual(['a', 'b']);
    expect(progress.completedStepIds).toHaveLength(MAX_TUTORIAL_PROGRESS_IDS);
    expect(progress.lastLessonId).toBeNull();
    expect(progress.welcomeDismissed).toBe(false);
  });

  it('adds a step once and marks a lesson with all its steps', () => {
    const once = markStepCompleted(DEFAULT_TUTORIAL_PROGRESS, 'a1');
    expect(once.completedStepIds).toEqual(['a1']);
    expect(markStepCompleted(once, 'a1').completedStepIds).toEqual(['a1']);

    const done = markLessonCompleted(once, lessonA);
    expect(done.completedLessonIds).toEqual(['a']);
    expect(done.completedStepIds).toEqual(['a1', 'a2']);
    expect(done.lastLessonId).toBe('a');
  });

  it('counts progress by steps and by lessons', () => {
    const partial = markStepCompleted(DEFAULT_TUTORIAL_PROGRESS, 'a1');
    expect(getLessonStats(partial, lessonA)).toEqual({
      totalSteps: 2,
      completedSteps: 1,
      percent: 50,
      completed: false,
    });

    const full = markLessonCompleted(partial, lessonA);
    expect(getLessonStats(full, lessonA).completed).toBe(true);
    expect(getChapterStats(full, chapter)).toEqual({
      totalLessons: 2,
      completedLessons: 1,
      totalSteps: 3,
      completedSteps: 2,
      percent: 50,
    });
    expect(getOverallStats(full, [chapter])).toMatchObject({
      totalLessons: 2,
      completedLessons: 1,
      percent: 50,
    });
  });

  it('dismisses the welcome hint and resets to a clean default', () => {
    const dismissed = dismissTutorialWelcome(DEFAULT_TUTORIAL_PROGRESS);
    expect(dismissed.welcomeDismissed).toBe(true);
    expect(dismissTutorialWelcome(dismissed)).toBe(dismissed);
    expect(resetTutorialProgress()).toEqual(DEFAULT_TUTORIAL_PROGRESS);
  });

  it('keeps tutorial progress when settings are reset', () => {
    const settings = sanitizeSettings(DEFAULT_SETTINGS);
    useSettingsStore.setState({
      settings: {
        ...settings,
        tutorial: {
          ...DEFAULT_TUTORIAL_PROGRESS,
          completedLessonIds: ['keep'],
        },
      },
      loaded: true,
    });

    const reset = useSettingsStore.getState().resetSettings();
    expect(reset.tutorial.completedLessonIds).toEqual(['keep']);
  });

  it('sanitizes the tutorial field inside settings', () => {
    const settings = sanitizeSettings({
      tutorial: {
        completedLessonIds: ['a', 'a', 5],
        completedStepIds: ['s1'],
        lastLessonId: 'a',
        welcomeDismissed: true,
      },
    });
    expect(settings.tutorial.completedLessonIds).toEqual(['a']);
    expect(settings.tutorial.completedStepIds).toEqual(['s1']);
    expect(settings.tutorial.lastLessonId).toBe('a');
    expect(settings.tutorial.welcomeDismissed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tutorial_progress.test.ts`

Expected: FAIL — `Failed to resolve import "../src/tutorial/progress"`.

- [ ] **Step 3: Implement `src/tutorial/progress.ts`**

```ts
export const MAX_TUTORIAL_PROGRESS_IDS = 500;

export interface TutorialProgress {
  version: 1;
  completedLessonIds: string[];
  completedStepIds: string[];
  lastLessonId: string | null;
  welcomeDismissed: boolean;
}

export interface TutorialLessonLike {
  id: string;
  steps: Array<{ id: string }>;
}

export interface TutorialChapterLike {
  lessons: TutorialLessonLike[];
}

export interface TutorialLessonStats {
  totalSteps: number;
  completedSteps: number;
  percent: number;
  completed: boolean;
}

export interface TutorialChapterStats {
  totalLessons: number;
  completedLessons: number;
  totalSteps: number;
  completedSteps: number;
  percent: number;
}

export const DEFAULT_TUTORIAL_PROGRESS: TutorialProgress = {
  version: 1,
  completedLessonIds: [],
  completedStepIds: [],
  lastLessonId: null,
  welcomeDismissed: false,
};

function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_TUTORIAL_PROGRESS_IDS) break;
  }
  return out;
}

export function sanitizeTutorialProgress(raw: unknown): TutorialProgress {
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const lastLessonId =
    typeof src.lastLessonId === 'string' && src.lastLessonId.trim()
      ? src.lastLessonId.trim()
      : null;
  return {
    version: 1,
    completedLessonIds: uniqueIds(src.completedLessonIds),
    completedStepIds: uniqueIds(src.completedStepIds),
    lastLessonId,
    welcomeDismissed: src.welcomeDismissed === true,
  };
}

function appendUnique(list: string[], id: string): string[] {
  if (list.includes(id)) return list;
  const next = [...list, id];
  return next.length > MAX_TUTORIAL_PROGRESS_IDS
    ? next.slice(next.length - MAX_TUTORIAL_PROGRESS_IDS)
    : next;
}

export function markStepCompleted(
  progress: TutorialProgress,
  stepId: string
): TutorialProgress {
  const completedStepIds = appendUnique(progress.completedStepIds, stepId);
  return completedStepIds === progress.completedStepIds
    ? progress
    : { ...progress, completedStepIds };
}

export function markLessonCompleted(
  progress: TutorialProgress,
  lesson: TutorialLessonLike
): TutorialProgress {
  let completedStepIds = progress.completedStepIds;
  for (const step of lesson.steps) {
    completedStepIds = appendUnique(completedStepIds, step.id);
  }
  return {
    ...progress,
    completedLessonIds: appendUnique(progress.completedLessonIds, lesson.id),
    completedStepIds,
    lastLessonId: lesson.id,
  };
}

export function dismissTutorialWelcome(
  progress: TutorialProgress
): TutorialProgress {
  return progress.welcomeDismissed
    ? progress
    : { ...progress, welcomeDismissed: true };
}

export function getLessonStats(
  progress: TutorialProgress,
  lesson: TutorialLessonLike
): TutorialLessonStats {
  const done = new Set(progress.completedStepIds);
  const completedSteps = lesson.steps.filter((step) => done.has(step.id)).length;
  const totalSteps = lesson.steps.length;
  const percent =
    totalSteps === 0 ? 100 : Math.round((completedSteps / totalSteps) * 100);
  return {
    totalSteps,
    completedSteps,
    percent,
    completed:
      progress.completedLessonIds.includes(lesson.id) ||
      (totalSteps > 0 && completedSteps === totalSteps),
  };
}

export function getChapterStats(
  progress: TutorialProgress,
  chapter: TutorialChapterLike
): TutorialChapterStats {
  const lessons = chapter.lessons.map((lesson) => getLessonStats(progress, lesson));
  const totalLessons = lessons.length;
  const completedLessons = lessons.filter((item) => item.completed).length;
  const totalSteps = lessons.reduce((sum, item) => sum + item.totalSteps, 0);
  const completedSteps = lessons.reduce(
    (sum, item) => sum + item.completedSteps,
    0
  );
  return {
    totalLessons,
    completedLessons,
    totalSteps,
    completedSteps,
    percent:
      totalLessons === 0
        ? 100
        : Math.round((completedLessons / totalLessons) * 100),
  };
}

export function getOverallStats(
  progress: TutorialProgress,
  chapters: TutorialChapterLike[]
): TutorialChapterStats {
  const lessons = chapters.flatMap((chapter) => chapter.lessons);
  const stats = lessons.map((lesson) => getLessonStats(progress, lesson));
  const totalLessons = stats.length;
  const completedLessons = stats.filter((item) => item.completed).length;
  const totalSteps = stats.reduce((sum, item) => sum + item.totalSteps, 0);
  const completedSteps = stats.reduce(
    (sum, item) => sum + item.completedSteps,
    0
  );
  return {
    totalLessons,
    completedLessons,
    totalSteps,
    completedSteps,
    percent:
      totalLessons === 0
        ? 100
        : Math.round((completedLessons / totalLessons) * 100),
  };
}

export function resetTutorialProgress(): TutorialProgress {
  return {
    version: 1,
    completedLessonIds: [],
    completedStepIds: [],
    lastLessonId: null,
    welcomeDismissed: false,
  };
}
```

- [ ] **Step 4: Wire progress into settings**

In `src/core/settings.ts`:

1. Add the import near the other `./` imports:

```ts
import {
  DEFAULT_TUTORIAL_PROGRESS,
  sanitizeTutorialProgress,
  type TutorialProgress,
} from '../tutorial/progress';
```

2. Add the field to `AppSettings` before `ai`:

```ts
  customShortcuts: Record<string, string>;
  tutorial: TutorialProgress;
  ai: AIConfig;
```

3. Add it to `DEFAULT_SETTINGS` before `ai`:

```ts
  customShortcuts: {},
  tutorial: { ...DEFAULT_TUTORIAL_PROGRESS },
  ai: { ...DEFAULT_AI_CONFIG },
```

4. Inside `sanitizeSettings`, just before `return {`, add:

```ts
  const tutorial = sanitizeTutorialProgress(src.tutorial);
```

5. In the returned object, after `customShortcuts,` add:

```ts
    tutorial,
```

6. Replace `resetSettings` with a version that preserves learning progress:

```ts
  resetSettings: () => {
    const preservedTutorial = get().settings.tutorial;
    const next = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      tutorial: preservedTutorial,
    });
    set({ settings: next, loaded: true });
    applyRuntimeSideEffects(next);
    persistSettingsAsync(next);
    return next;
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/tutorial_progress.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/tutorial/progress.ts src/core/settings.ts tests/tutorial_progress.test.ts
git commit -m "feat(tutorial): persist learning progress in settings"
```

---

### Task 2: Цели, содержание и поиск

**Files:**
- Create: `src/tutorial/targets.ts`
- Create: `src/tutorial/content.ts`
- Create: `src/tutorial/search.ts`
- Test: `tests/tutorial_content.test.ts`
- Test: `tests/tutorial_search.test.ts`

**Interfaces:**
- Consumes: `ShortcutActionId` из `src/core/shortcuts.ts`.
- Produces:
  - `TutorialTargetId`, `TUTORIAL_TARGETS`
  - `TutorialStep`, `TutorialLesson`, `TutorialChapter`, `TutorialChapterIcon`
  - `TUTORIAL_CHAPTERS`, `TUTORIAL_CHAPTER_BY_ID`, `TUTORIAL_LESSON_BY_ID`, `TUTORIAL_STEP_BY_ID`, `TUTORIAL_STATS`
  - `searchTutorial(chapters, query): TutorialSearchResult[]`

- [ ] **Step 1: Write the failing content test**

Create `tests/tutorial_content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_LESSON_BY_ID,
  TUTORIAL_STATS,
  TUTORIAL_STEP_BY_ID,
} from '../src/tutorial/content';
import { TUTORIAL_TARGETS } from '../src/tutorial/targets';
import { SHORTCUT_DEFINITIONS } from '../src/core/shortcuts';

describe('tutorial/content', () => {
  it('has 12 chapters, at least 24 lessons and 60 steps', () => {
    expect(TUTORIAL_CHAPTERS).toHaveLength(12);
    expect(TUTORIAL_STATS.lessons).toBeGreaterThanOrEqual(24);
    expect(TUTORIAL_STATS.steps).toBeGreaterThanOrEqual(60);
  });

  it('uses unique ids everywhere', () => {
    const chapterIds = new Set<string>();
    const lessonIds = new Set<string>();
    const stepIds = new Set<string>();

    for (const chapter of TUTORIAL_CHAPTERS) {
      expect(chapterIds.has(chapter.id)).toBe(false);
      chapterIds.add(chapter.id);
      expect(chapter.title.trim().length).toBeGreaterThan(0);
      expect(chapter.lessons.length).toBeGreaterThan(0);

      for (const lesson of chapter.lessons) {
        expect(lessonIds.has(lesson.id)).toBe(false);
        lessonIds.add(lesson.id);
        expect(lesson.title.trim().length).toBeGreaterThan(0);
        expect(lesson.summary.trim().length).toBeGreaterThan(0);
        expect(lesson.steps.length).toBeGreaterThanOrEqual(3);

        for (const step of lesson.steps) {
          expect(stepIds.has(step.id)).toBe(false);
          stepIds.add(step.id);
          expect(step.title.trim().length).toBeGreaterThan(0);
          expect(step.body.trim().length).toBeGreaterThan(0);
        }
      }
    }

    expect(Object.keys(TUTORIAL_LESSON_BY_ID)).toHaveLength(TUTORIAL_STATS.lessons);
    expect(Object.keys(TUTORIAL_STEP_BY_ID)).toHaveLength(TUTORIAL_STATS.steps);
  });

  it('references only known targets and shortcut actions', () => {
    const shortcutIds = new Set(SHORTCUT_DEFINITIONS.map((item) => item.id));
    for (const chapter of TUTORIAL_CHAPTERS) {
      for (const lesson of chapter.lessons) {
        for (const step of lesson.steps) {
          if (step.target) {
            expect(TUTORIAL_TARGETS[step.target]).toBeDefined();
          }
          if (step.shortcutActionId) {
            expect(shortcutIds.has(step.shortcutActionId)).toBe(true);
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the content test to verify it fails**

Run: `npx vitest run tests/tutorial_content.test.ts`

Expected: FAIL — `Failed to resolve import "../src/tutorial/content"`.

- [ ] **Step 3: Implement `src/tutorial/targets.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/tutorial/content.ts`**

Write the complete content below. Keep the ids exactly as shown; the tests and later tour targets depend on them.

```ts
import type { ShortcutActionId } from '../core/shortcuts';
import type { TutorialTargetId } from './targets';

export type TutorialChapterIcon =
  | 'start'
  | 'shapes'
  | 'select'
  | 'curves'
  | 'color'
  | 'text'
  | 'layers'
  | 'paths'
  | 'effects'
  | 'automation'
  | 'ai'
  | 'export';

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  tip?: string;
  target?: TutorialTargetId;
  shortcutActionId?: ShortcutActionId;
}

export interface TutorialLesson {
  id: string;
  title: string;
  summary: string;
  durationMin: number;
  steps: TutorialStep[];
}

export interface TutorialChapter {
  id: string;
  title: string;
  summary: string;
  icon: TutorialChapterIcon;
  lessons: TutorialLesson[];
}

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: 'start',
    title: 'Старт',
    summary: 'Артборд, панели, зум и первый документ.',
    icon: 'start',
    lessons: [
      {
        id: 'start.interface',
        title: 'Интерфейс за минуту',
        summary: 'Где холст, где инструменты и где свойства.',
        durationMin: 2,
        steps: [
          {
            id: 'start.interface.artboard',
            title: 'Артборд',
            body: 'Белый лист в центре — это артборд. Всё, что на нём, попадёт в экспорт; серое вокруг — рабочая область.',
            target: 'canvas.root',
          },
          {
            id: 'start.interface.panels',
            title: 'Три панели',
            body: 'Слева инструменты, справа слои и свойства, сверху меню и имя документа. Панели можно скрыть в меню «Окно».',
            target: 'toolbar.root',
          },
          {
            id: 'start.interface.inspector',
            title: 'Инспектор',
            body: 'Нижняя правая панель показывает свойства выделенного. Без выделения там настройки артборда.',
            target: 'inspector.root',
          },
        ],
      },
      {
        id: 'start.navigate',
        title: 'Зум и панорама',
        summary: 'Двигаться по холсту, не теряя артборд.',
        durationMin: 2,
        steps: [
          {
            id: 'start.navigate.pan',
            title: 'Панорама',
            body: 'Зажми Space и потяни мышью. Средняя кнопка мыши работает так же.',
            target: 'canvas.root',
          },
          {
            id: 'start.navigate.zoom',
            title: 'Зум',
            body: 'Крути колесо над холстом. Масштаб меняется к курсору, интерфейс остаётся на месте.',
            target: 'canvas.root',
          },
          {
            id: 'start.navigate.fit',
            title: 'Вписать артборд',
            body: 'Ctrl+0 вписывает артборд в окно, Ctrl+1 возвращает масштаб 100%.',
            shortcutActionId: 'view.fitArtboard',
            target: 'toolbar.fit',
          },
        ],
      },
    ],
  },
  {
    id: 'shapes',
    title: 'Фигуры',
    summary: 'Пять умных примитивов с живыми параметрами.',
    icon: 'shapes',
    lessons: [
      {
        id: 'shapes.create',
        title: 'Нарисовать фигуру',
        summary: 'Инструмент B, протягивание и Shift.',
        durationMin: 3,
        steps: [
          {
            id: 'shapes.create.tool',
            title: 'Инструмент B',
            body: 'Нажми B или выбери «Умная фигура» на панели слева.',
            shortcutActionId: 'tool.blob',
            target: 'tool.blob',
          },
          {
            id: 'shapes.create.drag',
            title: 'Протяни',
            body: 'Зажми кнопку на холсте и протяни. Фигура создаётся сразу и остаётся редактируемой.',
            target: 'canvas.root',
          },
          {
            id: 'shapes.create.shift',
            title: 'Shift',
            body: 'С зажатым Shift эллипс становится кругом, а прямоугольник — квадратом.',
          },
        ],
      },
      {
        id: 'shapes.tune',
        title: 'Настроить фигуру',
        summary: 'Пресеты, ползунки и заливка в инспекторе.',
        durationMin: 3,
        steps: [
          {
            id: 'shapes.tune.presets',
            title: 'Пять пресетов',
            body: 'В инспекторе переключай кляксу, эллипс, прямоугольник, многоугольник и звезду.',
            target: 'inspector.root',
          },
          {
            id: 'shapes.tune.params',
            title: 'Живые параметры',
            body: 'Ползунки точек, волны, скругления и внутреннего радиуса меняют фигуру без перерисовки.',
          },
          {
            id: 'shapes.tune.fill',
            title: 'Заливка',
            body: 'Цвет заливки задаётся здесь же. Кнопка «Без заливки» оставляет только контур.',
            target: 'inspector.appearance',
          },
        ],
      },
    ],
  },
  {
    id: 'select',
    title: 'Выделение',
    summary: 'Выбирать, двигать, масштабировать и дублировать.',
    icon: 'select',
    lessons: [
      {
        id: 'select.basics',
        title: 'Выделять и двигать',
        summary: 'Клик, рамка и Shift.',
        durationMin: 3,
        steps: [
          {
            id: 'select.basics.pick',
            title: 'Клик',
            body: 'Инструментом V кликни по фигуре. Shift добавляет или убирает слой из выделения.',
            shortcutActionId: 'tool.select',
            target: 'tool.select',
          },
          {
            id: 'select.basics.marquee',
            title: 'Рамка',
            body: 'Протяни по пустому месту, чтобы выделить всё в рамке.',
            target: 'canvas.root',
          },
          {
            id: 'select.basics.move',
            title: 'Двигать',
            body: 'Тяни выделенное мышью или сдвигай стрелками. Shift+стрелка двигает крупнее.',
          },
        ],
      },
      {
        id: 'select.transform',
        title: 'Масштаб и поворот',
        summary: 'Ручки, поворот и дублирование.',
        durationMin: 3,
        steps: [
          {
            id: 'select.transform.scale',
            title: 'Ручки',
            body: 'Тяни угловую ручку. Shift сохраняет пропорции.',
          },
          {
            id: 'select.transform.rotate',
            title: 'Поворот',
            body: 'Наведи на угол и потяни за круглую ручку. Shift фиксирует угол по 45°.',
          },
          {
            id: 'select.transform.duplicate',
            title: 'Дублировать',
            body: 'Ctrl+D копирует выделение со сдвигом. Ctrl+C и Ctrl+V работают как обычно.',
            shortcutActionId: 'edit.duplicate',
          },
        ],
      },
    ],
  },
  {
    id: 'curves',
    title: 'Кривые',
    summary: 'Перо, узлы и усики.',
    icon: 'curves',
    lessons: [
      {
        id: 'curves.pen',
        title: 'Перо P',
        summary: 'Построить контур по точкам.',
        durationMin: 4,
        steps: [
          {
            id: 'curves.pen.start',
            title: 'Первый узел',
            body: 'Нажми P и кликни по холсту. Контур начался.',
            shortcutActionId: 'tool.pen',
            target: 'tool.pen',
          },
          {
            id: 'curves.pen.handles',
            title: 'Усики',
            body: 'Потяни при клике — появятся усики. Они задают изгиб кривой.',
            target: 'canvas.root',
          },
          {
            id: 'curves.pen.close',
            title: 'Замкнуть',
            body: 'Клик по первой точке замыкает контур. Enter или Escape завершает открытый.',
          },
        ],
      },
      {
        id: 'curves.nodes',
        title: 'Узлы A',
        summary: 'Прямое редактирование контура.',
        durationMin: 4,
        steps: [
          {
            id: 'curves.nodes.select',
            title: 'Прямое выделение',
            body: 'Нажми A и кликни по контуру: видны узлы и усики.',
            shortcutActionId: 'tool.node',
            target: 'tool.node',
          },
          {
            id: 'curves.nodes.move',
            title: 'Двигать узел',
            body: 'Тяни узел или усик. Shift фиксирует угол.',
          },
          {
            id: 'curves.nodes.smooth',
            title: 'Сгладить',
            body: 'Двойной клик по узлу переключает сглаживание. Delete удаляет узел, если их больше двух.',
          },
        ],
      },
    ],
  },
  {
    id: 'color',
    title: 'Цвет',
    summary: 'Заливка, обводка, пипетка и палитра.',
    icon: 'color',
    lessons: [
      {
        id: 'color.paint',
        title: 'Заливка и обводка',
        summary: 'Стиль слоя без палитр и градиентов.',
        durationMin: 3,
        steps: [
          {
            id: 'color.paint.fill',
            title: 'Заливка',
            body: 'В инспекторе выбери цвет заливки или сними её кнопкой «Без заливки».',
            target: 'inspector.appearance',
          },
          {
            id: 'color.paint.stroke',
            title: 'Обводка',
            body: 'Задай цвет, толщину и окончания линии. «Без обводки» убирает контур.',
          },
          {
            id: 'color.paint.opacity',
            title: 'Прозрачность',
            body: 'Ползунок прозрачности работает для всего слоя.',
          },
        ],
      },
      {
        id: 'color.pick',
        title: 'Пипетка E',
        summary: 'Брать цвет с холста и из палитры.',
        durationMin: 3,
        steps: [
          {
            id: 'color.pick.tool',
            title: 'Пипетка',
            body: 'Нажми E и кликни по любому месту холста.',
            shortcutActionId: 'tool.eyedropper',
            target: 'tool.eyedropper',
          },
          {
            id: 'color.pick.apply',
            title: 'Куда',
            body: 'Пипетка берёт цвет в заливку или обводку — смотри подсказку внизу.',
          },
          {
            id: 'color.pick.palette',
            title: 'Палитра документа',
            body: 'В инспекторе собраны цвета текущего макета. Клик применяет цвет.',
          },
        ],
      },
    ],
  },
  {
    id: 'text',
    title: 'Текст',
    summary: 'Шесть шрифтов, трекинг и перевод в кривые.',
    icon: 'text',
    lessons: [
      {
        id: 'text.create',
        title: 'Текст T',
        summary: 'Создать и отредактировать надпись.',
        durationMin: 3,
        steps: [
          {
            id: 'text.create.create',
            title: 'Клик',
            body: 'Нажми T и кликни по холсту. Появится текст «Новый текст» и поле редактирования.',
            shortcutActionId: 'tool.text',
            target: 'tool.text',
          },
          {
            id: 'text.create.edit',
            title: 'Правка',
            body: 'Пиши прямо на холсте. Ctrl+Enter или Escape завершает, клик мимо — тоже.',
          },
          {
            id: 'text.create.align',
            title: 'Выравнивание',
            body: 'В инспекторе выбери слева, по центру или справа.',
            target: 'inspector.text',
          },
        ],
      },
      {
        id: 'text.style',
        title: 'Шрифт и трекинг',
        summary: 'Семейство, вес, межбуквенное расстояние.',
        durationMin: 3,
        steps: [
          {
            id: 'text.style.family',
            title: 'Шесть шрифтов',
            body: 'В списке шесть семейств с кириллицей. Вес — Regular или Bold.',
          },
          {
            id: 'text.style.tracking',
            title: 'Трекинг',
            body: 'Межбуквенное расстояние меняется ползунком.',
          },
          {
            id: 'text.style.outlines',
            title: 'В кривые',
            body: 'Ctrl+Shift+O превращает текст в редактируемый контур. Обратно в текст уже нельзя.',
            shortcutActionId: 'vector.textToOutlines',
          },
        ],
      },
    ],
  },
  {
    id: 'layers',
    title: 'Слои и маски',
    summary: 'Порядок, видимость, блокировка и Clipping Mask.',
    icon: 'layers',
    lessons: [
      {
        id: 'layers.stack',
        title: 'Порядок слоёв',
        summary: 'Кто выше и кто кого перекрывает.',
        durationMin: 3,
        steps: [
          {
            id: 'layers.stack.panel',
            title: 'Панель слоёв',
            body: 'Верхняя строка списка — самый верхний слой. Меняй порядок стрелками или перетаскиванием.',
            target: 'layers.root',
          },
          {
            id: 'layers.stack.visibility',
            title: 'Глаз и замок',
            body: 'Глаз скрывает слой, замок запрещает выделение и правку.',
          },
          {
            id: 'layers.stack.rename',
            title: 'Имя',
            body: 'Двойной клик по имени переименовывает слой.',
          },
        ],
      },
      {
        id: 'layers.mask',
        title: 'Обтравочная маска',
        summary: 'Показать только то, что попадает в контур.',
        durationMin: 4,
        steps: [
          {
            id: 'layers.mask.create',
            title: 'Создать',
            body: 'Выдели маску и слой под ней, затем нажми «Создать обтравочную маску».',
            target: 'inspector.vectorOps',
          },
          {
            id: 'layers.mask.behavior',
            title: 'Как работает',
            body: 'Маска показывает только то, что попадает в её контур. Её собственная заливка не рисуется.',
          },
          {
            id: 'layers.mask.release',
            title: 'Снять',
            body: 'Кнопка «Снять маску» возвращает слой к обычному виду.',
          },
        ],
      },
    ],
  },
  {
    id: 'paths',
    title: 'Контуры',
    summary: 'Булевы операции и составные контуры.',
    icon: 'paths',
    lessons: [
      {
        id: 'paths.boolean',
        title: 'Булевы операции',
        summary: 'Объединить, вычесть, пересечь и разделить.',
        durationMin: 4,
        steps: [
          {
            id: 'paths.boolean.unite',
            title: 'Объединить',
            body: 'Выдели два контура и нажми Unite — получится один.',
            target: 'inspector.vectorOps',
          },
          {
            id: 'paths.boolean.subtract',
            title: 'Вычесть',
            body: 'Subtract вырезает верхний контур из нижнего.',
          },
          {
            id: 'paths.boolean.other',
            title: 'Остальные',
            body: 'Intersect оставляет общее, Exclude — необщее, Divide делит на части.',
          },
        ],
      },
      {
        id: 'paths.compound',
        title: 'Составной контур',
        summary: 'Собрать части и сохранить дырки.',
        durationMin: 4,
        steps: [
          {
            id: 'paths.compound.combine',
            title: 'Ctrl+8',
            body: 'Собери выделенные контуры в один составной.',
            shortcutActionId: 'vector.combineCompound',
          },
          {
            id: 'paths.compound.holes',
            title: 'Дырки',
            body: 'Внутренний контур становится отверстием. Правило заливки переключается в инспекторе.',
          },
          {
            id: 'paths.compound.split',
            title: 'Ctrl+Shift+8',
            body: 'Разбивает составной контур обратно на части, сохраняя дырки в буквах.',
            shortcutActionId: 'vector.splitCompound',
          },
        ],
      },
    ],
  },
  {
    id: 'effects',
    title: 'Эффекты',
    summary: 'Деформация, объём, тень и размытие.',
    icon: 'effects',
    lessons: [
      {
        id: 'effects.warp',
        title: 'Деформация',
        summary: 'Живые искажения контура.',
        durationMin: 3,
        steps: [
          {
            id: 'effects.warp.menu',
            title: 'Эффекты → Деформация',
            body: 'Выбери стиль: флаг, волна, дуга, арка, выпуклость и другие.',
            target: 'menu.effects',
          },
          {
            id: 'effects.warp.dialog',
            title: 'Настройки',
            body: 'В окне задай силу и примени. Эффект остаётся живым, пока не разобрать оформление.',
          },
          {
            id: 'effects.warp.expand',
            title: 'Разобрать',
            body: 'Expand превращает эффект в обычные узлы контура.',
          },
        ],
      },
      {
        id: 'effects.depth',
        title: 'Объём и свет',
        summary: '3D, тень и свечение.',
        durationMin: 3,
        steps: [
          {
            id: 'effects.depth.3d',
            title: '3D',
            body: 'Поворот и выдавливание добавляют перспективу.',
          },
          {
            id: 'effects.depth.shadow',
            title: 'Тень',
            body: 'Падающая тень настраивается в «Эффекты → Стилизация».',
          },
          {
            id: 'effects.depth.glow',
            title: 'Свечение и размытие',
            body: 'Внешнее свечение и размытие по Гауссу — там же.',
          },
        ],
      },
    ],
  },
  {
    id: 'automation',
    title: 'Автоматика',
    summary: 'Выравнивание, повтор и привязки.',
    icon: 'automation',
    lessons: [
      {
        id: 'automation.align',
        title: 'Выравнивание',
        summary: 'Края, центры и промежутки.',
        durationMin: 3,
        steps: [
          {
            id: 'automation.align.align',
            title: 'Кнопки',
            body: 'Выдели несколько слоёв и выровняй по левому, центру или правому краю.',
            target: 'inspector.root',
          },
          {
            id: 'automation.align.distribute',
            title: 'Распределение',
            body: 'Распределение уравнивает промежутки по горизонтали или вертикали.',
          },
          {
            id: 'automation.align.artboard',
            title: 'По артборду',
            body: 'Отдельный режим центрирует выделение на артборде.',
          },
        ],
      },
      {
        id: 'automation.repeat',
        title: 'Повтор и зеркало',
        summary: 'Ряды, сетки, кольца и симметрия.',
        durationMin: 3,
        steps: [
          {
            id: 'automation.repeat.repeat',
            title: 'Повтор',
            body: 'Сделай ряд, столбец, сетку или кольцо копий с заданным шагом.',
          },
          {
            id: 'automation.repeat.mirror',
            title: 'Зеркало',
            body: 'Зеркальная копия относительно оси артборда — для симметричных пар.',
          },
          {
            id: 'automation.repeat.rotate',
            title: 'Поворот',
            body: 'Поверни каждый слой на точный угол, а не только на 90°.',
          },
        ],
      },
      {
        id: 'automation.guides',
        title: 'Привязки',
        summary: 'Smart Guides, сетка и каркас.',
        durationMin: 3,
        steps: [
          {
            id: 'automation.guides.smart',
            title: 'Smart Guides',
            body: 'При перетаскивании появляются подсказки по краям и центрам соседних слоёв.',
          },
          {
            id: 'automation.guides.grid',
            title: 'Сетка',
            body: 'Включи сетку и привязку к ней в настройках или на панели.',
            shortcutActionId: 'view.toggleGrid',
          },
          {
            id: 'automation.guides.outline',
            title: 'Каркас',
            body: 'Ctrl+Y показывает только контуры — удобно проверять геометрию.',
          },
        ],
      },
    ],
  },
  {
    id: 'ai',
    title: 'ИИ',
    summary: 'Командная строка и контроль результата.',
    icon: 'ai',
    lessons: [
      {
        id: 'ai.chat',
        title: 'Командная строка',
        summary: 'Промпт вместо ручной рутины.',
        durationMin: 3,
        steps: [
          {
            id: 'ai.chat.open',
            title: 'Ctrl+K',
            body: 'Открой командную строку и напиши, что сделать.',
            shortcutActionId: 'app.commandBar',
            target: 'topbar.commandBar',
          },
          {
            id: 'ai.chat.describe',
            title: 'Промпт',
            body: 'Опиши результат словами: «сделай стикер с обводкой» или «выровняй по центру».',
          },
          {
            id: 'ai.chat.result',
            title: 'Результат',
            body: 'ИИ вызывает инструменты редактора. Всё остаётся вектором и редактируется.',
          },
        ],
      },
      {
        id: 'ai.control',
        title: 'Контроль',
        summary: 'Провайдеры, вложения и откат.',
        durationMin: 3,
        steps: [
          {
            id: 'ai.control.providers',
            title: 'Провайдеры',
            body: 'Gemini, Anthropic, Ollama или OpenAI-совместимый API. Ключ хранится в настройках.',
            target: 'topbar.settings',
          },
          {
            id: 'ai.control.attachments',
            title: 'Вложения',
            body: 'Прикрепи PNG или JPEG, если модель понимает изображения.',
          },
          {
            id: 'ai.control.undo',
            title: 'Один Ctrl+Z',
            body: 'Серия действий ИИ откатывается одним шагом. «Стоп» прерывает задачу.',
          },
        ],
      },
    ],
  },
  {
    id: 'export',
    title: 'Экспорт',
    summary: 'Проект, вектор, растр и PSD.',
    icon: 'export',
    lessons: [
      {
        id: 'export.vector',
        title: 'Векторный экспорт',
        summary: 'SVG, AI и рабочий файл.',
        durationMin: 3,
        steps: [
          {
            id: 'export.vector.svg',
            title: 'SVG',
            body: 'Файл → Экспорт → SVG. Контуры, текст и маски остаются векторными.',
            target: 'menu.file',
          },
          {
            id: 'export.vector.ai',
            title: 'AI',
            body: 'Экспорт в .ai — это PDF-поток с кривыми, текстом и масками.',
          },
          {
            id: 'export.vector.project',
            title: 'Проект',
            body: 'Ctrl+S сохраняет .locus со сценой и картинками. Это не экспорт, а рабочий файл.',
            shortcutActionId: 'file.save',
          },
        ],
      },
      {
        id: 'export.raster',
        title: 'Растр и PSD',
        summary: 'PNG, JPG и многослойный Photoshop.',
        durationMin: 3,
        steps: [
          {
            id: 'export.raster.png',
            title: 'PNG',
            body: 'Быстрый экспорт PNG или окно экспорта в растр с масштабом.',
          },
          {
            id: 'export.raster.jpg',
            title: 'JPG',
            body: 'Для фото и превью без прозрачности.',
          },
          {
            id: 'export.raster.psd',
            title: 'PSD',
            body: 'Многослойный PSD открывается в Photoshop со слоями и текстом.',
          },
        ],
      },
    ],
  },
];

export const TUTORIAL_CHAPTER_BY_ID: Record<string, TutorialChapter> =
  Object.fromEntries(TUTORIAL_CHAPTERS.map((chapter) => [chapter.id, chapter]));

export const TUTORIAL_LESSON_BY_ID: Record<string, TutorialLesson> =
  Object.fromEntries(
    TUTORIAL_CHAPTERS.flatMap((chapter) =>
      chapter.lessons.map((lesson) => [lesson.id, lesson])
    )
  );

export const TUTORIAL_STEP_BY_ID: Record<string, TutorialStep> = Object.fromEntries(
  TUTORIAL_CHAPTERS.flatMap((chapter) =>
    chapter.lessons.flatMap((lesson) =>
      lesson.steps.map((step) => [step.id, step])
    )
  )
);

export const TUTORIAL_LESSONS_BY_CHAPTER: Record<string, TutorialLesson[]> =
  Object.fromEntries(
    TUTORIAL_CHAPTERS.map((chapter) => [chapter.id, chapter.lessons])
  );

export const TUTORIAL_STATS = {
  chapters: TUTORIAL_CHAPTERS.length,
  lessons: Object.keys(TUTORIAL_LESSON_BY_ID).length,
  steps: Object.keys(TUTORIAL_STEP_BY_ID).length,
};
```

- [ ] **Step 5: Run the content test to verify it passes**

Run: `npx vitest run tests/tutorial_content.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing search test**

Create `tests/tutorial_search.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TutorialChapter } from '../src/tutorial/content';
import { TUTORIAL_CHAPTERS } from '../src/tutorial/content';
import { searchTutorial } from '../src/tutorial/search';

const chapters: TutorialChapter[] = [
  {
    id: 'shapes',
    title: 'Фигуры',
    summary: 'Примитивы',
    icon: 'shapes',
    lessons: [
      {
        id: 'shapes.blob',
        title: 'Клякса',
        summary: 'Органическая форма',
        durationMin: 3,
        steps: [
          { id: 'shapes.blob.tool', title: 'Инструмент', body: 'Нажми B' },
          { id: 'shapes.blob.drag', title: 'Протяни', body: 'Зажми и тяни' },
        ],
      },
    ],
  },
  {
    id: 'layers',
    title: 'Слои',
    summary: 'Маски и порядок',
    icon: 'layers',
    lessons: [
      {
        id: 'layers.mask',
        title: 'Маска',
        summary: 'Обтравка',
        durationMin: 4,
        steps: [
          { id: 'layers.mask.create', title: 'Создать', body: 'Выдели маску и слой' },
        ],
      },
    ],
  },
];

describe('tutorial/search', () => {
  it('returns nothing for an empty query', () => {
    expect(searchTutorial(chapters, '   ')).toEqual([]);
  });

  it('matches lesson titles, step titles and bodies case-insensitively', () => {
    expect(searchTutorial(chapters, 'клякса')[0].lesson.id).toBe('shapes.blob');
    expect(searchTutorial(chapters, 'b')[0].matchedStepIds).toEqual([
      'shapes.blob.tool',
    ]);
    expect(searchTutorial(chapters, 'тяни')[0].matchedStepIds).toEqual([
      'shapes.blob.drag',
    ]);
  });

  it('ranks title matches above body-only matches', () => {
    const results = searchTutorial(chapters, 'маска');
    expect(results[0].lesson.id).toBe('layers.mask');
  });

  it('finds real content by a Russian word', () => {
    const results = searchTutorial(TUTORIAL_CHAPTERS, 'маска');
    expect(results.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 7: Run the search test to verify it fails**

Run: `npx vitest run tests/tutorial_search.test.ts`

Expected: FAIL — `Failed to resolve import "../src/tutorial/search"`.

- [ ] **Step 8: Implement `src/tutorial/search.ts`**

```ts
import type { TutorialChapter, TutorialLesson } from './content';

export interface TutorialSearchResult {
  chapter: TutorialChapter;
  lesson: TutorialLesson;
  matchedStepIds: string[];
  score: number;
}

export function searchTutorial(
  chapters: TutorialChapter[],
  rawQuery: string
): TutorialSearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const results: TutorialSearchResult[] = [];
  for (const chapter of chapters) {
    const chapterHaystack = `${chapter.title} ${chapter.summary}`.toLowerCase();
    for (const lesson of chapter.lessons) {
      const lessonHaystack = `${lesson.title} ${lesson.summary}`.toLowerCase();
      const matchedStepIds = lesson.steps
        .filter((step) =>
          `${step.title} ${step.body} ${step.tip ?? ''}`
            .toLowerCase()
            .includes(query)
        )
        .map((step) => step.id);

      let score = 0;
      if (lessonHaystack.includes(query)) score += 3;
      if (chapterHaystack.includes(query)) score += 1;
      score += matchedStepIds.length * 2;

      if (score > 0) {
        results.push({ chapter, lesson, matchedStepIds, score });
      }
    }
  }

  return results.sort(
    (a, b) =>
      b.score - a.score ||
      a.lesson.title.localeCompare(b.lesson.title, 'ru')
  );
}
```

- [ ] **Step 9: Run both tests and typecheck**

Run:

```bash
npx vitest run tests/tutorial_content.test.ts tests/tutorial_search.test.ts
npx tsc --noEmit
```

Expected: PASS, 7 tests total; `tsc` exits 0.

- [ ] **Step 10: Commit**

```bash
git add src/tutorial/targets.ts src/tutorial/content.ts src/tutorial/search.ts tests/tutorial_content.test.ts tests/tutorial_search.test.ts
git commit -m "feat(tutorial): add typed content, targets and search"
```

---

### Task 3: Стор окна обучения

**Files:**
- Create: `src/tutorial/store.ts`
- Test: `tests/tutorial_store.test.ts`

**Interfaces:**
- Consumes: `TUTORIAL_CHAPTERS`, `TUTORIAL_LESSON_BY_ID`, `TUTORIAL_CHAPTER_BY_ID`; `useSettingsStore`.
- Produces: `useTutorialStore` with:
  - state: `isAcademyOpen`, `activeChapterId`, `activeLessonId`, `search`
  - actions: `openAcademy(opts?)`, `closeAcademy()`, `selectChapter(id)`, `openLesson(id)`, `backToChapter()`, `setSearch(query)`

- [ ] **Step 1: Write the failing test**

Create `tests/tutorial_store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, useSettingsStore } from '../src/core/settings';
import { TUTORIAL_CHAPTERS } from '../src/tutorial/content';
import { useTutorialStore } from '../src/tutorial/store';

describe('tutorial/store', () => {
  beforeEach(() => {
    useTutorialStore.setState({
      isAcademyOpen: false,
      activeChapterId: null,
      activeLessonId: null,
      search: '',
    });
    useSettingsStore.setState({
      settings: sanitizeSettings(DEFAULT_SETTINGS),
      loaded: true,
    });
  });

  it('opens on the first chapter when there is no history', () => {
    useTutorialStore.getState().openAcademy();
    expect(useTutorialStore.getState().isAcademyOpen).toBe(true);
    expect(useTutorialStore.getState().activeChapterId).toBe(
      TUTORIAL_CHAPTERS[0].id
    );
    expect(useTutorialStore.getState().activeLessonId).toBeNull();
  });

  it('opens a lesson, selects its chapter and remembers it', () => {
    useTutorialStore.getState().openLesson('layers.mask');
    expect(useTutorialStore.getState().activeChapterId).toBe('layers');
    expect(useTutorialStore.getState().activeLessonId).toBe('layers.mask');
    expect(useSettingsStore.getState().settings.tutorial.lastLessonId).toBe(
      'layers.mask'
    );
  });

  it('reopens on the last lesson and can go back to the chapter', () => {
    useTutorialStore.getState().openLesson('paths.compound');
    useTutorialStore.getState().closeAcademy();
    useTutorialStore.getState().openAcademy();
    expect(useTutorialStore.getState().activeLessonId).toBe('paths.compound');
    expect(useTutorialStore.getState().activeChapterId).toBe('paths');

    useTutorialStore.getState().backToChapter();
    expect(useTutorialStore.getState().activeLessonId).toBeNull();
    expect(useTutorialStore.getState().activeChapterId).toBe('paths');
  });

  it('resets search when selecting a chapter and stores the query otherwise', () => {
    useTutorialStore.getState().openLesson('layers.mask');
    useTutorialStore.getState().setSearch('маска');
    expect(useTutorialStore.getState().search).toBe('маска');

    useTutorialStore.getState().selectChapter('shapes');
    expect(useTutorialStore.getState().search).toBe('');
    expect(useTutorialStore.getState().activeChapterId).toBe('shapes');
    expect(useTutorialStore.getState().activeLessonId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tutorial_store.test.ts`

Expected: FAIL — `Failed to resolve import "../src/tutorial/store"`.

- [ ] **Step 3: Implement `src/tutorial/store.ts`**

```ts
import { create } from 'zustand';
import { useSettingsStore } from '../core/settings';
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_CHAPTER_BY_ID,
  TUTORIAL_LESSON_BY_ID,
} from './content';

interface OpenAcademyOptions {
  chapterId?: string;
  lessonId?: string;
}

export interface TutorialStoreState {
  isAcademyOpen: boolean;
  activeChapterId: string | null;
  activeLessonId: string | null;
  search: string;
  openAcademy: (options?: OpenAcademyOptions) => void;
  closeAcademy: () => void;
  selectChapter: (chapterId: string) => void;
  openLesson: (lessonId: string) => void;
  backToChapter: () => void;
  setSearch: (search: string) => void;
}

function chapterForLesson(lessonId: string): string | null {
  for (const chapter of TUTORIAL_CHAPTERS) {
    if (chapter.lessons.some((lesson) => lesson.id === lessonId)) {
      return chapter.id;
    }
  }
  return null;
}

function lastChapterId(): string | null {
  const lastLessonId = useSettingsStore.getState().settings.tutorial.lastLessonId;
  if (!lastLessonId) return null;
  return chapterForLesson(lastLessonId);
}

export const useTutorialStore = create<TutorialStoreState>((set, get) => ({
  isAcademyOpen: false,
  activeChapterId: null,
  activeLessonId: null,
  search: '',

  openAcademy: (options) => {
    const state = get();
    const lessonId = options?.lessonId ?? state.activeLessonId ?? null;
    const chapterId =
      options?.chapterId ??
      (lessonId ? chapterForLesson(lessonId) : null) ??
      state.activeChapterId ??
      lastChapterId() ??
      TUTORIAL_CHAPTERS[0]?.id ??
      null;

    set({
      isAcademyOpen: true,
      activeChapterId: chapterId,
      activeLessonId: lessonId,
      search: '',
    });
  },

  closeAcademy: () => set({ isAcademyOpen: false }),

  selectChapter: (chapterId) => {
    if (!TUTORIAL_CHAPTER_BY_ID[chapterId]) return;
    set({ activeChapterId: chapterId, activeLessonId: null, search: '' });
  },

  openLesson: (lessonId) => {
    const lesson = TUTORIAL_LESSON_BY_ID[lessonId];
    const chapterId = chapterForLesson(lessonId);
    if (!lesson || !chapterId) return;

    set({ activeChapterId: chapterId, activeLessonId: lessonId, search: '' });

    const tutorial = useSettingsStore.getState().settings.tutorial;
    if (tutorial.lastLessonId !== lessonId) {
      useSettingsStore.getState().updateSettings({
        tutorial: { ...tutorial, lastLessonId: lessonId },
      });
    }
  },

  backToChapter: () => set({ activeLessonId: null }),

  setSearch: (search) => set({ search }),
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/tutorial_store.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/tutorial/store.ts tests/tutorial_store.test.ts
git commit -m "feat(tutorial): add academy window store"
```

---

### Task 4: Окно «Обучение Locus»

**Files:**
- Create: `src/ui/tutorial/TutorialModal.tsx`
- Modify: `src/App.tsx` (import and render only in this task)
- Test: no DOM test; verification is `tsc`, `build`, and manual.

**Interfaces:**
- Consumes: `useTutorialStore`, `useSettingsStore`, `TUTORIAL_CHAPTERS`, `TUTORIAL_CHAPTER_BY_ID`, `TUTORIAL_LESSON_BY_ID`, `searchTutorial`, progress helpers, `getEffectiveShortcut`, `formatShortcutCombo`.
- Produces: `export function TutorialModal(): JSX.Element | null`.

- [ ] **Step 1: Create `src/ui/tutorial/TutorialModal.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  BookOpen,
  Bot,
  Check,
  ChevronLeft,
  Download,
  Layers,
  MousePointer2,
  Palette,
  PenTool,
  Rocket,
  RotateCcw,
  Search,
  Shapes,
  Sparkles,
  Spline,
  Type,
  Wand2,
  X,
} from 'lucide-react';
import { useSettingsStore } from '../../core/settings';
import { formatShortcutCombo, getEffectiveShortcut } from '../../core/shortcuts';
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_LESSON_BY_ID,
  type TutorialChapter,
  type TutorialChapterIcon,
  type TutorialLesson,
} from '../../tutorial/content';
import {
  getChapterStats,
  getLessonStats,
  getOverallStats,
  markLessonCompleted,
  resetTutorialProgress,
  type TutorialProgress,
} from '../../tutorial/progress';
import { searchTutorial } from '../../tutorial/search';
import { useTutorialStore } from '../../tutorial/store';

const CHAPTER_ICONS: Record<
  TutorialChapterIcon,
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  start: Rocket,
  shapes: Shapes,
  select: MousePointer2,
  curves: Spline,
  color: Palette,
  text: Type,
  layers: Layers,
  paths: PenTool,
  effects: Wand2,
  automation: Sparkles,
  ai: Bot,
  export: Download,
};

function ProgressBar({ percent }: { percent: number }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-paper-border/70">
      <span
        className="block h-full rounded-full bg-paper-accent transition-[width]"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </span>
  );
}

function LessonView({
  chapter,
  lesson,
  progress,
  customShortcuts,
  onBack,
  onComplete,
}: {
  chapter: TutorialChapter;
  lesson: TutorialLesson;
  progress: TutorialProgress;
  customShortcuts: Record<string, string>;
  onBack: () => void;
  onComplete: () => void;
}) {
  const stats = getLessonStats(progress, lesson);

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1 text-[11px] text-paper-muted hover:text-paper-ink"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        К главе «{chapter.title}»
      </button>

      <div>
        <h3 className="text-[15px] font-semibold text-paper-ink">{lesson.title}</h3>
        <p className="mt-1 text-[12px] text-paper-muted">{lesson.summary}</p>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-paper-muted">
          <span>{lesson.durationMin} мин</span>
          <span>
            {stats.completedSteps} из {stats.totalSteps} шагов
          </span>
          {stats.completed && (
            <span className="flex items-center gap-1 text-paper-accent">
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              Пройдено
            </span>
          )}
        </div>
        <div className="mt-2">
          <ProgressBar percent={stats.percent} />
        </div>
      </div>

      <ol className="flex flex-col gap-2">
        {lesson.steps.map((step, index) => {
          const done = progress.completedStepIds.includes(step.id);
          const combo = step.shortcutActionId
            ? formatShortcutCombo(
                getEffectiveShortcut(step.shortcutActionId, customShortcuts)
              )
            : null;

          return (
            <li
              key={step.id}
              className="flex gap-2.5 rounded border border-paper-border bg-paper-bg/60 px-3 py-2.5"
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium ${
                  done
                    ? 'border-paper-accent bg-paper-accent text-white'
                    : 'border-paper-border text-paper-muted'
                }`}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-medium text-paper-ink">
                    {step.title}
                  </span>
                  {combo && (
                    <kbd className="rounded border border-paper-border bg-paper-panel px-1.5 py-0.5 font-display text-[10px] text-paper-muted">
                      {combo}
                    </kbd>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-paper-muted">
                  {step.body}
                </p>
                {step.tip && (
                  <p className="mt-1 text-[11px] text-paper-accent">{step.tip}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-between gap-3 border-t border-paper-border pt-3">
        <span className="text-[11px] text-paper-muted">
          {stats.completed
            ? 'Урок пройден — можно вернуться в любой момент.'
            : 'Отметь урок, когда закончишь.'}
        </span>
        {stats.completed ? (
          <span className="flex items-center gap-1.5 rounded border border-paper-accent/40 bg-paper-accent/10 px-2.5 py-1 text-[11px] text-paper-accent">
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
            Пройдено
          </span>
        ) : (
          <button
            type="button"
            onClick={onComplete}
            className="h-7 rounded bg-paper-accent px-3 text-[12px] font-medium text-white hover:bg-paper-accent-hover"
          >
            Отметить пройденным
          </button>
        )}
      </div>
    </div>
  );
}

function ChapterView({
  chapter,
  progress,
  onOpenLesson,
}: {
  chapter: TutorialChapter;
  progress: TutorialProgress;
  onOpenLesson: (lessonId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[15px] font-semibold text-paper-ink">{chapter.title}</h3>
        <p className="mt-1 text-[12px] text-paper-muted">{chapter.summary}</p>
      </div>

      <div className="flex flex-col gap-2">
        {chapter.lessons.map((lesson) => {
          const stats = getLessonStats(progress, lesson);
          return (
            <button
              key={lesson.id}
              type="button"
              onClick={() => onOpenLesson(lesson.id)}
              className="flex flex-col gap-1.5 rounded border border-paper-border bg-paper-bg/60 px-3 py-2.5 text-left transition-colors hover:bg-paper-hover"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-medium text-paper-ink">
                  {lesson.title}
                </span>
                <span className="shrink-0 text-[11px] text-paper-muted">
                  {stats.completed ? (
                    <Check className="h-3.5 w-3.5 text-paper-accent" strokeWidth={2} />
                  ) : (
                    `${stats.completedSteps}/${stats.totalSteps}`
                  )}
                </span>
              </div>
              <span className="text-[11px] text-paper-muted">{lesson.summary}</span>
              <ProgressBar percent={stats.percent} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TutorialModal() {
  const isOpen = useTutorialStore((state) => state.isAcademyOpen);
  const activeChapterId = useTutorialStore((state) => state.activeChapterId);
  const activeLessonId = useTutorialStore((state) => state.activeLessonId);
  const search = useTutorialStore((state) => state.search);
  const closeAcademy = useTutorialStore((state) => state.closeAcademy);
  const selectChapter = useTutorialStore((state) => state.selectChapter);
  const openLesson = useTutorialStore((state) => state.openLesson);
  const backToChapter = useTutorialStore((state) => state.backToChapter);
  const setSearch = useTutorialStore((state) => state.setSearch);

  const settings = useSettingsStore((state) => state.settings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const progress = settings.tutorial;

  const searchRef = useRef<HTMLInputElement | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeAcademy();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [closeAcademy, isOpen]);

  useEffect(() => {
    if (!isOpen) setConfirmReset(false);
  }, [isOpen]);

  const overall = useMemo(
    () => getOverallStats(progress, TUTORIAL_CHAPTERS),
    [progress]
  );
  const results = useMemo(
    () => searchTutorial(TUTORIAL_CHAPTERS, search),
    [search]
  );

  if (!isOpen) return null;

  const activeChapter =
    (activeChapterId && TUTORIAL_CHAPTERS.find((item) => item.id === activeChapterId)) ||
    TUTORIAL_CHAPTERS[0];
  const activeLesson = activeLessonId
    ? TUTORIAL_LESSON_BY_ID[activeLessonId] ?? null
    : null;
  const isSearching = search.trim().length > 0;

  const handleCompleteLesson = (lesson: TutorialLesson) => {
    updateSettings({ tutorial: markLessonCompleted(progress, lesson) });
  };

  return (
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAcademy();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper-ink/30 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        className="animate-rise flex h-[min(640px,82vh)] w-full max-w-4xl flex-col overflow-hidden rounded border border-paper-border bg-paper-panel"
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-paper-border px-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-paper-accent" strokeWidth={1.75} />
            <span id="tutorial-title" className="text-[14px] font-semibold text-paper-ink">
              Обучение Locus
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-paper-muted">
              {overall.completedLessons} из {overall.totalLessons} уроков ·{' '}
              {overall.percent}%
            </span>
            <button
              type="button"
              onClick={closeAcademy}
              title="Закрыть (Esc)"
              className="flex h-7 w-7 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav className="flex w-56 shrink-0 flex-col border-r border-paper-border bg-paper-bg/60 p-2">
            <label className="flex items-center gap-1.5 rounded border border-paper-border bg-paper-panel px-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-paper-muted" strokeWidth={1.75} />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по обучению"
                className="h-7 min-w-0 flex-1 bg-transparent text-[12px] text-paper-ink outline-none placeholder:text-paper-muted"
              />
            </label>

            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {TUTORIAL_CHAPTERS.map((chapter) => {
                const stats = getChapterStats(progress, chapter);
                const active = chapter.id === activeChapter?.id;
                const Icon = CHAPTER_ICONS[chapter.icon];
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    onClick={() => selectChapter(chapter.id)}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                      active
                        ? 'bg-paper-accent/15 text-paper-ink'
                        : 'text-paper-ink hover:bg-paper-hover'
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        active ? 'text-paper-accent' : 'text-paper-muted'
                      }`}
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">
                        {chapter.title}
                      </span>
                      <span className="block text-[10px] text-paper-muted">
                        {stats.completedLessons}/{stats.totalLessons} уроков
                      </span>
                    </span>
                    {stats.completedLessons === stats.totalLessons && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-paper-accent" strokeWidth={2} />
                    )}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {isSearching ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-paper-muted">
                  Найдено уроков: {results.length}
                </p>
                {results.length === 0 && (
                  <div className="rounded border border-paper-border bg-paper-bg/60 px-3 py-6 text-center text-[12px] text-paper-muted">
                    Ничего не найдено. Попробуй «маска», «шрифт» или «экспорт».
                  </div>
                )}
                {results.map((result) => (
                  <button
                    key={result.lesson.id}
                    type="button"
                    onClick={() => openLesson(result.lesson.id)}
                    className="flex flex-col gap-1 rounded border border-paper-border bg-paper-bg/60 px-3 py-2.5 text-left transition-colors hover:bg-paper-hover"
                  >
                    <span className="text-[10px] uppercase tracking-wide text-paper-muted">
                      {result.chapter.title}
                    </span>
                    <span className="text-[12px] font-medium text-paper-ink">
                      {result.lesson.title}
                    </span>
                    <span className="text-[11px] text-paper-muted">
                      {result.matchedStepIds.length > 0
                        ? `Совпадений в шагах: ${result.matchedStepIds.length}`
                        : 'Совпадение в названии урока'}
                    </span>
                  </button>
                ))}
              </div>
            ) : activeLesson && activeChapter ? (
              <LessonView
                chapter={activeChapter}
                lesson={activeLesson}
                progress={progress}
                customShortcuts={settings.customShortcuts}
                onBack={backToChapter}
                onComplete={() => handleCompleteLesson(activeLesson)}
              />
            ) : activeChapter ? (
              <ChapterView
                chapter={activeChapter}
                progress={progress}
                onOpenLesson={openLesson}
              />
            ) : null}
          </div>
        </div>

        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-paper-border px-4">
          {confirmReset ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-paper-ink">Сбросить весь прогресс?</span>
              <button
                type="button"
                onClick={() => {
                  updateSettings({ tutorial: resetTutorialProgress() });
                  setConfirmReset(false);
                }}
                className="h-7 rounded bg-paper-danger px-2.5 text-[11px] font-medium text-white hover:opacity-90"
              >
                Сбросить
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="h-7 rounded border border-paper-border bg-paper-bg px-2.5 text-[11px] text-paper-ink hover:bg-paper-hover"
              >
                Отмена
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex h-7 items-center gap-1.5 rounded border border-paper-border bg-paper-bg px-2.5 text-[11px] text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Сбросить прогресс
            </button>
          )}
          <span className="text-[11px] text-paper-muted">
            Прогресс хранится в настройках Locus
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it from `App.tsx`**

Add the import:

```ts
import { TutorialModal } from './ui/tutorial/TutorialModal';
```

Render it next to the other modals, after `SettingsModal`:

```tsx
      <TutorialModal />
```

At this point there is no way to open it yet; the next task adds the entry points. The component compiles and is inert.

- [ ] **Step 3: Typecheck and build**

Run:

```bash
npx tsc --noEmit
npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/ui/tutorial/TutorialModal.tsx src/App.tsx
git commit -m "feat(tutorial): add academy window"
```

---

### Task 5: Входы, `F1`, меню «Справка» и защита шорткатов

**Files:**
- Modify: `src/core/shortcuts.ts`
- Modify: `src/ui/SettingsModal.tsx`
- Modify: `src/ui/StartModal.tsx`
- Modify: `src/ui/MenuBar.tsx`
- Modify: `src/App.tsx`
- Test: `tests/tutorial_shortcuts.test.ts`

**Interfaces:**
- Consumes: `useTutorialStore`, `TutorialModal`.
- Produces: working entry points; `ShortcutActionId` includes `'app.openTutorial'`.

- [ ] **Step 1: Write the failing shortcut test**

Create `tests/tutorial_shortcuts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  findShortcutConflict,
  getEffectiveShortcut,
  matchShortcut,
  SHORTCUT_DEFINITIONS,
} from '../src/core/shortcuts';

const f1 = {
  code: 'F1',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};

describe('tutorial shortcuts', () => {
  it('binds F1 to opening the tutorial', () => {
    expect(getEffectiveShortcut('app.openTutorial')).toBe('F1');
    expect(matchShortcut(f1)).toBe('app.openTutorial');
  });

  it('does not conflict with existing actions', () => {
    expect(findShortcutConflict('app.openTutorial', 'F1')).toBeNull();
  });

  it('is not user-editable', () => {
    const definition = SHORTCUT_DEFINITIONS.find(
      (item) => item.id === 'app.openTutorial'
    );
    expect(definition?.editable).toBe(false);
    expect(definition?.category).toBe('view');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tutorial_shortcuts.test.ts`

Expected: FAIL — `getEffectiveShortcut` returns `''` for an unknown id, so the first assertion fails.

- [ ] **Step 3: Add the shortcut definition**

In `src/core/shortcuts.ts`:

1. Add to `ShortcutActionId`:

```ts
  | 'app.openSettings'
  | 'app.commandBar'
  | 'app.openTutorial'
```

2. Add a definition after `app.commandBar`:

```ts
  {
    id: 'app.openTutorial',
    label: 'Открыть обучение',
    category: 'view',
    defaultCombo: 'F1',
    editable: false,
  },
```

- [ ] **Step 4: Activate the settings footer button**

In `src/ui/SettingsModal.tsx`:

1. Add the prop to `SettingsModalProps`:

```ts
  onRestoreDraft?: (scene: Scene) => void;
  initialTab?: SettingsTabId | null;
  onOpenTutorial?: () => void;
```

2. Destructure it in the component signature:

```ts
export function SettingsModal({
  isOpen,
  onClose,
  onRestoreDraft,
  initialTab = null,
  onOpenTutorial,
}: SettingsModalProps) {
```

3. Replace the disabled footer button with:

```tsx
            <button
              type="button"
              onClick={onOpenTutorial}
              disabled={!onOpenTutorial}
              title="Открыть обучение (F1)"
              className="h-7 rounded border border-paper-border bg-paper-bg px-2.5 text-[12px] text-paper-ink hover:bg-paper-hover disabled:cursor-not-allowed disabled:text-paper-muted disabled:opacity-60"
            >
              Обучение
            </button>
```

- [ ] **Step 5: Add the StartModal link**

In `src/ui/StartModal.tsx`:

1. Add to `StartModalProps`:

```ts
  onOpenProject: () => void;
  onOpenTutorial?: () => void;
```

2. Destructure:

```ts
export function StartModal({
  isOpen,
  onClose,
  onCreateDocument,
  onOpenProject,
  onOpenTutorial,
}: StartModalProps) {
```

3. Replace the footer's left button block with a group that includes the link:

```tsx
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onOpenProject}
                className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded border border-paper-border bg-paper-bg px-3 text-[12px] text-paper-ink hover:bg-paper-hover"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-paper-muted" strokeWidth={1.75} />
                <span>Открыть .locus</span>
              </button>
              {onOpenTutorial && (
                <button
                  type="button"
                  onClick={onOpenTutorial}
                  className="text-[11px] text-paper-muted underline-offset-2 hover:text-paper-ink hover:underline"
                >
                  Впервые в Locus? Как это работает
                </button>
              )}
            </div>
```

- [ ] **Step 6: Add the «Справка» menu**

In `src/ui/MenuBar.tsx`:

1. Add to `MenuBarActions`:

```ts
  onOpenSettings: () => void;
  onOpenTutorial: () => void;
  onOpenShortcuts: () => void;
  onOpenAbout: () => void;
```

2. Add the menu after the `view` menu group (before `window` or after it, but keep it last):

```ts
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
```

- [ ] **Step 7: Wire App and keyboard**

In `src/App.tsx`:

1. Import the store:

```ts
import { useTutorialStore } from './tutorial/store';
```

2. Read open state near the other modal state:

```ts
  const isAcademyOpen = useTutorialStore((state) => state.isAcademyOpen);
```

3. Add the opener near `openSettingsTab`:

```ts
  const openTutorial = useCallback(() => {
    setIsStartModalOpen(false);
    setIsSettingsModalOpen(false);
    setSettingsInitialTab(null);
    useTutorialStore.getState().openAcademy();
  }, []);
```

4. In the keydown handler, handle `app.openTutorial` before the settings check:

```ts
      if (action === 'app.openTutorial') {
        event.preventDefault();
        if (isCommandBarOpen || rasterExportOpen || activeEffectModal) return;
        openTutorial();
        return;
      }
```

5. Add `isAcademyOpen` to the modal guard:

```ts
        isStartModalOpen ||
        isSettingsModalOpen ||
        isAcademyOpen ||
        isCommandBarOpen ||
```

6. Add the new menu actions to `menuActions`:

```ts
      onOpenSettings: () => openSettingsTab(null),
      onOpenTutorial: openTutorial,
      onOpenShortcuts: () => openSettingsTab('shortcuts'),
      onOpenAbout: () => openSettingsTab('about'),
```

7. Add `openTutorial` to the `menuActions` dependency array.

8. Pass the prop to `StartModal`:

```tsx
        onOpenTutorial={openTutorial}
```

9. Pass the prop to `SettingsModal`:

```tsx
        onOpenTutorial={openTutorial}
```

- [ ] **Step 8: Run the tests and typecheck**

Run:

```bash
npx vitest run tests/tutorial_shortcuts.test.ts
npx tsc --noEmit
```

Expected: PASS, 3 tests; `tsc` exits 0.

- [ ] **Step 9: Commit**

```bash
git add src/core/shortcuts.ts src/ui/SettingsModal.tsx src/ui/StartModal.tsx src/ui/MenuBar.tsx src/App.tsx tests/tutorial_shortcuts.test.ts
git commit -m "feat(tutorial): open academy from settings, start, help and F1"
```

---

### Task 6: Подсказка первого запуска, полировка и полная проверка

**Files:**
- Modify: `src/App.tsx`
- Test: `tests/tutorial_progress.test.ts` (welcome test already added in Task 1)

**Interfaces:**
- Consumes: `dismissTutorialWelcome` (already implemented in Task 1), `openTutorial`.
- Produces: one-time bottom hint; final green verification.

- [ ] **Step 1: Add the first-run hint state to App**

In `src/App.tsx`:

1. Add the lucide import at the top:

```ts
import { BookOpen, X } from 'lucide-react';
```

2. Add state near the other `useState` calls:

```ts
  const [showTutorialHint, setShowTutorialHint] = useState(false);
```

3. Import the helper:

```ts
import { dismissTutorialWelcome } from './tutorial/progress';
```

4. In `handleCreateDocument`, after `resetDocument(opts);`, add:

```ts
    const settingsState = useSettingsStore.getState();
    if (settingsState.loaded && !settingsState.settings.tutorial.welcomeDismissed) {
      settingsState.updateSettings({
        tutorial: dismissTutorialWelcome(settingsState.settings.tutorial),
      });
      setShowTutorialHint(true);
    }
```

5. Render the hint before `{notice && (...)}`:

```tsx
      {showTutorialHint && (
        <div className="animate-rise fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-32px)] items-center gap-2 rounded border border-paper-border bg-paper-panel px-3 py-2 text-[12px] text-paper-ink">
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-paper-accent" strokeWidth={1.75} />
          <span className="whitespace-nowrap">Не знаете с чего начать?</span>
          <button
            type="button"
            onClick={() => {
              setShowTutorialHint(false);
              openTutorial();
            }}
            className="shrink-0 font-medium text-paper-accent hover:underline"
          >
            Открыть обучение
          </button>
          <button
            type="button"
            onClick={() => setShowTutorialHint(false)}
            title="Скрыть"
            className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-paper-muted hover:bg-paper-hover hover:text-paper-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}
```

- [ ] **Step 2: Ensure single-letter shortcuts are blocked while the academy is open**

The guard added in Task 5 already returns early for `isAcademyOpen`. Verify by reading the handler: no tool shortcut can run while the modal is open. `Escape` is handled inside `TutorialModal` with `stopPropagation` in the capture phase.

- [ ] **Step 3: Ensure `Ctrl+K` and `Ctrl+,` do not stack windows**

In the keydown handler:

- For `app.commandBar`, add `!isAcademyOpen` to the condition.
- For `app.openSettings`, close the academy before toggling settings:

```ts
      if (action === 'app.openSettings' && !isStartModalOpen && !editable) {
        event.preventDefault();
        useTutorialStore.getState().closeAcademy();
        setSettingsInitialTab(null);
        setIsSettingsModalOpen((open) => !open);
        return;
      }
```

- [ ] **Step 4: Run the full verification**

```bash
npx tsc --noEmit
npm test
npm run build
```

Expected:
- `tsc` exits 0.
- `vitest` reports all suites green, including the five new tutorial suites.
- `vite build` exits 0.

- [ ] **Step 5: Manual verification in the running app**

Run: `npm run dev` (or `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`).

Check:
1. Настройки → «Обучение» открывает окно.
2. «Справка → Обучение» и `F1` открывают то же окно.
3. В стартовом окне ссылка «Как это работает» закрывает старт и открывает обучение.
4. Поиск «маска» находит урок про Clipping Mask; «экспорт» — главу экспорта.
5. «Отметить пройденным» закрашивает урок и увеличивает общий процент.
6. Перезапуск приложения сохраняет прогресс.
7. «Сбросить прогресс» требует подтверждения и обнуляет проценты.
8. После создания первого документа один раз появляется нижняя подсказка; крестик её скрывает, повторно она не появляется.
9. Пока окно обучения открыто, `V`, `B`, `Space` и `Delete` не срабатывают на холсте; `Escape` закрывает только обучение.
10. Общий сброс настроек в настройках не стирает прогресс обучения.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(tutorial): add first-run hint and finalize academy"
```

---

## Self-Review

**1. Spec coverage (Этап 1):**
- Окно с 12 главами, уроками и шагами — Task 2.
- Поиск — Task 2 (pure) + Task 4 (UI).
- Прогресс в `settings.json` — Task 1.
- «Отметить пройденным» и проценты — Task 1 + Task 4.
- Сброс прогресса — Task 4.
- Вход из настроек — Task 5.
- Вход из стартового окна — Task 5.
- Меню «Справка» — Task 5.
- `F1` — Task 5.
- Подсказка первого запуска — Task 6.
- Защита шорткатов и `Escape` — Task 4 + Task 5 + Task 6.
- Общий сброс настроек не стирает прогресс — Task 1.
- Прогресс не попадает в `.locus` и Undo — по построению (отдельное поле настроек).

**2. Placeholder scan:** план содержит полный код всех новых файлов и точные правки существующих. Тексты 75 шагов заданы в `content.ts` Task 2. Незаполненных мест нет.

**3. Type consistency:**
- `TutorialProgress` живёт в `progress.ts` и импортируется в `settings.ts` и `TutorialModal.tsx`.
- `TutorialChapter`, `TutorialLesson`, `TutorialStep`, `TutorialChapterIcon` определены в `content.ts`.
- `TutorialTargetId` — в `targets.ts`, используется в `content.ts`.
- `useTutorialStore` API совпадает между Task 3, Task 4 и Task 5.
- `getChapterStats` / `getLessonStats` / `getOverallStats` возвращают поля `totalLessons`, `completedLessons`, `totalSteps`, `completedSteps`, `percent`, `completed`; UI использует именно их.
- `app.openTutorial` добавлен в `ShortcutActionId` и `SHORTCUT_DEFINITIONS` в Task 5, тест Task 5 проверяет оба.

---

## Execution Handoff

Всё готово к реализации Этапа 1. После его приёмки пишутся отдельные планы для Этапа 2 (подсветка и `data-tour`) и Этапа 3 (песочница).
