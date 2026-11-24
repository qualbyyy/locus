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
