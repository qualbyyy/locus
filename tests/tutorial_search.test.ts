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
