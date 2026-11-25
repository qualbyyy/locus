import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
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

  it('covers section 5 tools, live inspector effects, rulers, drafts, export and AI features', () => {
    const requiredLessons = [
      'start.drafts',
      'shapes.trace',
      'curves.pencil',
      'text.path',
      'paths.shapeBuilder',
      'paths.knife',
      'ai.tools',
      'export.selection',
    ];
    for (const id of requiredLessons) {
      expect(TUTORIAL_LESSON_BY_ID[id]).toBeDefined();
    }

    expect(TUTORIAL_TARGETS['tool.pencil']).toBeDefined();
    expect(TUTORIAL_TARGETS['tool.shapeBuilder']).toBeDefined();
    expect(TUTORIAL_TARGETS['tool.knife']).toBeDefined();
    expect(TUTORIAL_TARGETS['inspector.effects']).toBeDefined();

    const effectsLesson = TUTORIAL_LESSON_BY_ID['effects.warp'];
    expect(effectsLesson.steps.some((s) => s.target === 'inspector.effects')).toBe(
      true
    );

    const guidesLesson = TUTORIAL_LESSON_BY_ID['automation.guides'];
    expect(
      guidesLesson.steps.some((s) => s.shortcutActionId === 'view.toggleRulers')
    ).toBe(true);

    const copySvgLesson = TUTORIAL_LESSON_BY_ID['export.selection'];
    expect(
      copySvgLesson.steps.some((s) => s.shortcutActionId === 'edit.copySvg')
    ).toBe(true);
  });

  it('has matching data-tour attributes in UI components for every target', () => {
    const collectSources = (dir: string): string[] => {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) files.push(...collectSources(full));
        else if (full.endsWith('.tsx')) files.push(full);
      }
      return files;
    };

    const uiText = collectSources(path.resolve(__dirname, '../src'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    for (const id of Object.keys(TUTORIAL_TARGETS)) {
      if (id.startsWith('tool.')) {
        const toolName = id.slice('tool.'.length);
        expect(uiText).toContain(`id: '${toolName}'`);
        expect(uiText).toContain('data-tour={`tool.${id}`}');
      } else if (id.startsWith('menu.')) {
        const menuName = id.slice('menu.'.length);
        const menuId = menuName === 'effects' ? 'effect' : menuName;
        expect(uiText).toContain(`id: '${menuId}'`);
        expect(uiText).toContain("data-tour={menu.id === 'effect' ? 'menu.effects' : `menu.${menu.id}`}");
      } else {
        expect(uiText).toContain(`data-tour="${id}"`);
      }
    }
  });
});
