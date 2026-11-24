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

  const chapterStats = useMemo(
    () =>
      TUTORIAL_CHAPTERS.map((chapter) => getChapterStats(progress, chapter)),
    [progress]
  );
  const completedChapters = chapterStats.filter(
    (stats) => stats.totalLessons > 0 && stats.completedLessons === stats.totalLessons
  ).length;
  const chapterPercent =
    TUTORIAL_CHAPTERS.length === 0
      ? 100
      : Math.round((completedChapters / TUTORIAL_CHAPTERS.length) * 100);
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
              {completedChapters} из {TUTORIAL_CHAPTERS.length} глав · {chapterPercent}%
            </span>
            <button
              type="button"
              onClick={closeAcademy}
              title="Закрыть (Esc)"
              aria-label="Закрыть обучение"
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
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="mt-2 rounded border border-paper-border bg-paper-panel px-2.5 py-1 text-[11px] text-paper-ink hover:bg-paper-hover"
                    >
                      Очистить поиск
                    </button>
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
