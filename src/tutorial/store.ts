import { create } from 'zustand';
import { useSettingsStore } from '../core/settings';
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_CHAPTER_BY_ID,
  TUTORIAL_LESSON_BY_ID,
} from './content';
import type { TutorialTargetId } from './targets';

interface OpenAcademyOptions {
  chapterId?: string;
  lessonId?: string;
}

export interface TutorialHighlight {
  targetId: TutorialTargetId;
  stepId?: string;
}

export interface TutorialStoreState {
  isAcademyOpen: boolean;
  activeChapterId: string | null;
  activeLessonId: string | null;
  search: string;
  highlight: TutorialHighlight | null;
  openAcademy: (options?: OpenAcademyOptions) => void;
  closeAcademy: () => void;
  selectChapter: (chapterId: string) => void;
  openLesson: (lessonId: string) => void;
  backToChapter: () => void;
  setSearch: (search: string) => void;
  highlightTarget: (targetId: TutorialTargetId, stepId?: string) => void;
  clearHighlight: () => void;
}

function chapterForLesson(lessonId: string): string | null {
  for (const chapter of TUTORIAL_CHAPTERS) {
    if (chapter.lessons.some((lesson) => lesson.id === lessonId)) {
      return chapter.id;
    }
  }
  return null;
}

function persistedLessonId(): string | null {
  const lessonId = useSettingsStore.getState().settings.tutorial.lastLessonId;
  return lessonId && TUTORIAL_LESSON_BY_ID[lessonId] ? lessonId : null;
}

export const useTutorialStore = create<TutorialStoreState>((set, get) => ({
  isAcademyOpen: false,
  activeChapterId: null,
  activeLessonId: null,
  search: '',
  highlight: null,

  openAcademy: (options) => {
    const state = get();
    const requestedLessonId = options?.lessonId;
    const lessonId = requestedLessonId
      ? TUTORIAL_LESSON_BY_ID[requestedLessonId]
        ? requestedLessonId
        : null
      : options
        ? null
        : state.activeLessonId && TUTORIAL_LESSON_BY_ID[state.activeLessonId]
          ? state.activeLessonId
          : persistedLessonId();
    const requestedChapterId = options?.chapterId;
    const chapterId = lessonId
      ? chapterForLesson(lessonId)
      : requestedChapterId && TUTORIAL_CHAPTER_BY_ID[requestedChapterId]
        ? requestedChapterId
        : state.activeChapterId && TUTORIAL_CHAPTER_BY_ID[state.activeChapterId]
          ? state.activeChapterId
          : TUTORIAL_CHAPTERS[0]?.id ?? null;

    set({
      isAcademyOpen: true,
      activeChapterId: chapterId,
      activeLessonId: lessonId,
      search: '',
      highlight: null,
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

  highlightTarget: (targetId, stepId) =>
    set({
      isAcademyOpen: false,
      highlight: { targetId, stepId },
    }),

  clearHighlight: () => set({ highlight: null }),
}));
