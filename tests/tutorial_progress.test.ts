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

  it('ignores blank ids in public mutators', () => {
    expect(markStepCompleted(DEFAULT_TUTORIAL_PROGRESS, '   ')).toBe(
      DEFAULT_TUTORIAL_PROGRESS
    );
    expect(
      markLessonCompleted(DEFAULT_TUTORIAL_PROGRESS, {
        id: '   ',
        steps: [{ id: '  ' }],
      })
    ).toBe(DEFAULT_TUTORIAL_PROGRESS);
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
