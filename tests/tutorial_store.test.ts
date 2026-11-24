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
