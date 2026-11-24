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
