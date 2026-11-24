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
