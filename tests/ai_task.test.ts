import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiRunEvent } from '../src/ai/types';

const runMock = vi.hoisted(() => vi.fn());

vi.mock('../src/ai/executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai/executor')>();
  return { ...actual, runAiCommand: runMock };
});

import { AI_STATUS_WORDS, pickStatusWordIndex } from '../src/ai/statusWords';
import { useAiTaskStore } from '../src/ai/taskStore';
import { useSettingsStore } from '../src/core/settings';

interface RunOptions {
  signal?: AbortSignal;
  onEvent?: (event: AiRunEvent) => void;
}

function setKey(key: string): void {
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.setState({
    settings: {
      ...settings,
      ai: { ...settings.ai, provider: 'gemini', geminiApiKey: key },
    },
  });
}

describe('AI background task store', () => {
  beforeEach(() => {
    useAiTaskStore.getState().reset();
    runMock.mockReset();
    setKey('test-key');
  });

  it('keeps running when minimized and finishes in background', async () => {
    let resolveRun: ((value: unknown) => void) | null = null;
    let signal: AbortSignal | undefined;
    runMock.mockImplementation((options: RunOptions) => {
      signal = options.signal;
      options.onEvent?.({ type: 'step', step: 1, maxSteps: 8 });
      options.onEvent?.({
        type: 'tool',
        name: 'create_shape',
        args: {},
        ok: true,
        summary: 'Создана фигура «Эллипс 1»',
      });
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    });

    const run = useAiTaskStore.getState().start('Сделай эллипс');
    expect(useAiTaskStore.getState().status).toBe('running');
    expect(useAiTaskStore.getState().step).toEqual({ step: 1, maxSteps: 8 });

    useAiTaskStore.getState().minimize();
    expect(useAiTaskStore.getState().minimized).toBe(true);
    expect(useAiTaskStore.getState().status).toBe('running');
    expect(signal?.aborted).toBe(false);
    expect(useAiTaskStore.getState().log[0].summary).toContain('Эллипс');

    resolveRun!({ text: 'Готово', steps: 2, toolCalls: [] });
    await run;

    expect(useAiTaskStore.getState().status).toBe('done');
    expect(useAiTaskStore.getState().minimized).toBe(true);
    expect(useAiTaskStore.getState().answer).toBe('Готово');
    expect(useAiTaskStore.getState().step).toBeNull();
  });

  it('stops only on an explicit stop request', async () => {
    runMock.mockImplementation(
      (options: RunOptions) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const run = useAiTaskStore.getState().start('Долгая задача');
    useAiTaskStore.getState().minimize();
    expect(useAiTaskStore.getState().status).toBe('running');

    useAiTaskStore.getState().stop();
    await run;

    expect(useAiTaskStore.getState().status).toBe('stopped');
    expect(useAiTaskStore.getState().minimized).toBe(true);
  });

  it('sends images to the model and surfaces the provider vision error', async () => {
    useAiTaskStore.getState().addAttachment({
      id: 'img_1',
      name: 'ref.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,QUJD',
      dataBase64: 'QUJD',
    });
    runMock.mockRejectedValue(new Error('This model does not support image input'));

    await useAiTaskStore.getState().start('Опиши картинку');

    const options = runMock.mock.calls[0]?.[0] as { attachments?: unknown[] };
    expect(options.attachments).toHaveLength(1);
    expect(useAiTaskStore.getState().status).toBe('error');
    expect(useAiTaskStore.getState().error).toContain('Модель не приняла изображение');
    expect(useAiTaskStore.getState().attachments).toHaveLength(1);
  });

  it('reports a missing API key without starting a run', async () => {
    setKey('');

    await useAiTaskStore.getState().start('Сделай круг');

    expect(runMock).not.toHaveBeenCalled();
    expect(useAiTaskStore.getState().status).toBe('error');
    expect(useAiTaskStore.getState().error).toContain('API-ключа');
    expect(useAiTaskStore.getState().minimized).toBe(false);
  });

  it('uses rotating Russian status words instead of step numbers', () => {
    expect(AI_STATUS_WORDS.length).toBeGreaterThan(6);
    expect(new Set(AI_STATUS_WORDS).size).toBe(AI_STATUS_WORDS.length);
    expect(AI_STATUS_WORDS.every((word) => /^[А-ЯЁ][а-яё]+$/.test(word))).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      const index = i % AI_STATUS_WORDS.length;
      expect(pickStatusWordIndex(index)).not.toBe(index);
    }
  });
});
