import { create } from 'zustand';
import { undoCommand } from '../core/commands';
import { useSettingsStore } from '../core/settings';
import { useEditorStore } from '../core/store';
import type { Scene } from '../core/types';
import { isAbortError, runAiCommand, type AiToolLogEntry } from './executor';
import { getAiProviderIssue } from './providers';
import type { AiImageAttachment, AiRunEvent } from './types';

export type AiTaskStatus = 'idle' | 'running' | 'done' | 'error' | 'stopped';

export interface AiTaskStep {
  step: number;
  maxSteps: number;
}

interface AiTaskState {
  status: AiTaskStatus;
  prompt: string;
  log: AiToolLogEntry[];
  answer: string;
  streamText: string;
  error: string | null;
  step: AiTaskStep | null;
  minimized: boolean;
  canUndo: boolean;
  attachments: AiImageAttachment[];
  addAttachment: (attachment: AiImageAttachment) => void;
  updateAttachmentPalette: (id: string, extractedPalette: string[]) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  start: (rawPrompt: string) => Promise<void>;
  stop: () => void;
  revertLastRun: () => void;
  minimize: () => void;
  restore: () => void;
  reset: () => void;
}

let currentController: AbortController | null = null;
let runId = 0;
let lastAiResultScene: Scene | null = null;
let lastAiSessionId: number | null = null;

useEditorStore.subscribe((state) => {
  if (
    lastAiResultScene !== null &&
    (state.scene !== lastAiResultScene || state.documentSessionId !== lastAiSessionId)
  ) {
    lastAiResultScene = null;
    lastAiSessionId = null;
    if (useAiTaskStore.getState().canUndo) {
      useAiTaskStore.setState({ canUndo: false });
    }
  }
});

export const useAiTaskStore = create<AiTaskState>((set, get) => ({
  status: 'idle',
  prompt: '',
  log: [],
  answer: '',
  streamText: '',
  error: null,
  step: null,
  minimized: false,
  canUndo: false,
  attachments: [],

  addAttachment: (attachment) =>
    set((state) =>
      state.attachments.length >= 4 ||
      state.attachments.some((item) => item.id === attachment.id)
        ? state
        : { attachments: [...state.attachments, attachment] }
    ),

  updateAttachmentPalette: (id, extractedPalette) =>
    set((state) => ({
      attachments: state.attachments.map((item) =>
        item.id === id ? { ...item, extractedPalette } : item
      ),
    })),

  removeAttachment: (id) =>
    set((state) => ({
      attachments: state.attachments.filter((item) => item.id !== id),
    })),

  clearAttachments: () => set({ attachments: [] }),

  start: async (rawPrompt) => {
    const prompt = rawPrompt.trim();
    if (!prompt || get().status === 'running') return;

    const ai = useSettingsStore.getState().settings.ai;
    const attachments = [...get().attachments];
    const initialEditorState = useEditorStore.getState();
    const sceneBefore = initialEditorState.scene;
    const sessionBefore = initialEditorState.documentSessionId;
    const issue = getAiProviderIssue(ai);
    if (issue) {
      set({
        status: 'error',
        prompt,
        error: issue,
        step: null,
        minimized: false,
        canUndo: false,
      });
      return;
    }
    runId += 1;
    const id = runId;
    lastAiResultScene = null;
    lastAiSessionId = null;
    currentController?.abort();
    const controller = new AbortController();
    currentController = controller;

    let lastStepNumber = 0;
    let needsStreamSeparator = false;

    const computeCanUndo = (): boolean => {
      const cur = useEditorStore.getState();
      const ok =
        cur.documentSessionId === sessionBefore &&
        cur.scene !== sceneBefore &&
        useEditorStore.temporal.getState().pastStates.length > 0;
      if (ok) {
        lastAiResultScene = cur.scene;
        lastAiSessionId = cur.documentSessionId;
      }
      return ok;
    };

    set({
      status: 'running',
      prompt,
      log: [],
      answer: '',
      streamText: '',
      error: null,
      step: null,
      minimized: false,
      canUndo: false,
      attachments: [],
    });

    try {
      const result = await runAiCommand({
        prompt,
        ai,
        signal: controller.signal,
        ...(attachments.length > 0 ? { attachments } : {}),
        onEvent: (event: AiRunEvent) => {
          if (runId !== id) return;
          if (event.type === 'step') {
            if (
              event.step > lastStepNumber &&
              lastStepNumber > 0 &&
              get().streamText.length > 0
            ) {
              needsStreamSeparator = true;
            }
            lastStepNumber = Math.max(lastStepNumber, event.step);
            set({ step: { step: event.step, maxSteps: event.maxSteps } });
          } else if (event.type === 'tool') {
            set((state) => ({
              log: [
                ...state.log,
                {
                  name: event.name,
                  args: event.args,
                  ok: event.ok,
                  summary: event.summary,
                  ...(event.error ? { error: event.error } : {}),
                },
              ],
            }));
          } else if (event.type === 'assistant-delta') {
            if (!event.text) return;
            const sep = needsStreamSeparator;
            needsStreamSeparator = false;
            set((state) => {
              const prefix =
                sep && state.streamText.trim().length > 0
                  ? state.streamText.endsWith('\n')
                    ? '\n'
                    : '\n\n'
                  : '';
              return { streamText: state.streamText + prefix + event.text };
            });
          } else if (event.type === 'assistant' && event.text.trim()) {
            set({ answer: event.text.trim() });
          }
        },
      });
      if (runId !== id) return;
      set({
        answer: result.text,
        status: 'done',
        step: null,
        streamText: '',
        canUndo: computeCanUndo(),
      });
    } catch (err) {
      if (runId !== id) return;
      if (controller.signal.aborted || isAbortError(err)) {
        set({
          status: 'stopped',
          error: null,
          step: null,
          streamText: '',
          canUndo: computeCanUndo(),
        });
      } else {
        set((state) => ({
          status: 'error',
          error: describeAiError(
            err instanceof Error ? err.message : 'Не удалось выполнить команду'
          ),
          step: null,
          streamText: '',
          canUndo: computeCanUndo(),
          attachments:
            state.attachments.length === 0 && attachments.length > 0
              ? attachments
              : state.attachments,
        }));
      }
    } finally {
      if (currentController === controller) {
        currentController = null;
      }
      if (runId === id) {
        set({ step: null });
      }
    }
  },

  stop: () => {
    currentController?.abort();
  },

  revertLastRun: () => {
    const cur = useEditorStore.getState();
    if (
      !get().canUndo ||
      lastAiResultScene === null ||
      cur.scene !== lastAiResultScene ||
      cur.documentSessionId !== lastAiSessionId
    ) {
      lastAiResultScene = null;
      lastAiSessionId = null;
      set({ canUndo: false });
      return;
    }
    lastAiResultScene = null;
    lastAiSessionId = null;
    undoCommand();
    set({ canUndo: false });
  },

  minimize: () => set({ minimized: true }),

  restore: () => set({ minimized: false }),

  reset: () => {
    runId += 1;
    lastAiResultScene = null;
    lastAiSessionId = null;
    currentController?.abort();
    currentController = null;
    set({
      status: 'idle',
      prompt: '',
      log: [],
      answer: '',
      streamText: '',
      error: null,
      step: null,
      minimized: false,
      canUndo: false,
      attachments: [],
    });
  },
}));

function describeAiError(message: string): string {
  if (/(image|vision|multimodal|inlineData|inline_data)/i.test(message)) {
    return `Модель не приняла изображение: ${message}`;
  }
  return message;
}

export function isAiTaskRunning(): boolean {
  return useAiTaskStore.getState().status === 'running';
}
