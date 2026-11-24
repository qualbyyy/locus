import { beforeEach, describe, expect, it, vi } from 'vitest';

const ioMocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(async () => {}),
}));

vi.mock('../src/platform/io', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/platform/io')>();
  return {
    ...actual,
    readAppConfigText: ioMocks.read,
    writeAppConfigText: ioMocks.write,
  };
});

import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  useSettingsStore,
} from '../src/core/settings';
import { DEFAULT_TUTORIAL_PROGRESS } from '../src/tutorial/progress';

function resetSettingsStore() {
  useSettingsStore.setState({
    settings: sanitizeSettings(DEFAULT_SETTINGS),
    loaded: false,
    lastAutosaveAt: null,
    tutorialTouchedBeforeLoad: false,
  });
}

describe('settings load race', () => {
  beforeEach(() => {
    resetSettingsStore();
    ioMocks.read.mockReset();
    ioMocks.write.mockReset().mockResolvedValue(undefined);
  });

  it('loads tutorial progress from the file when untouched', async () => {
    ioMocks.read.mockResolvedValue(
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        tutorial: {
          ...DEFAULT_TUTORIAL_PROGRESS,
          completedLessonIds: ['from.file'],
        },
      })
    );
    const loaded = await useSettingsStore.getState().loadSettings();
    expect(loaded.tutorial.completedLessonIds).toEqual(['from.file']);
  });

  it('preserves tutorial progress written while the load is in flight', async () => {
    let resolveRead: (value: string | null) => void = () => {};
    ioMocks.read.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRead = resolve;
        })
    );

    const loading = useSettingsStore.getState().loadSettings();
    useSettingsStore.getState().updateSettings({
      tutorial: {
        ...DEFAULT_TUTORIAL_PROGRESS,
        completedLessonIds: ['local.write'],
        lastLessonId: 'start.interface',
      },
    });

    resolveRead(
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        tutorial: {
          ...DEFAULT_TUTORIAL_PROGRESS,
          completedLessonIds: ['from.file'],
        },
      })
    );
    await loading;

    const tutorial = useSettingsStore.getState().settings.tutorial;
    expect(tutorial.completedLessonIds).toEqual(['local.write']);
    expect(tutorial.lastLessonId).toBe('start.interface');
  });
});
