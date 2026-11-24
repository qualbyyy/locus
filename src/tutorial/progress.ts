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
