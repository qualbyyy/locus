import { create } from 'zustand';
import { undoCommand } from '../core/commands';
import { useSettingsStore } from '../core/settings';
import { useEditorStore } from '../core/store';
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
    const sceneBefore = useEditorStore.getState().scene;
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
    currentController?.abort();
    const controller = new AbortController();
    currentController = controller;

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
            set((state) => ({ streamText: state.streamText + event.text }));
          } else if (event.type === 'assistant' && event.text.trim()) {
            set({ answer: event.text.trim() });
          }
        },
      });
      if (runId !== id) return;
      const canUndo =
        useEditorStore.getState().scene !== sceneBefore &&
        useEditorStore.temporal.getState().pastStates.length > 0;
      set({
        answer: result.text,
        status: 'done',
        step: null,
        streamText: '',
        canUndo,
      });
    } catch (err) {
      if (runId !== id) return;
      if (controller.signal.aborted || isAbortError(err)) {
        const canUndo =
          useEditorStore.getState().scene !== sceneBefore &&
          useEditorStore.temporal.getState().pastStates.length > 0;
        set({ status: 'stopped', error: null, step: null, canUndo });
      } else {
        set((state) => ({
          status: 'error',
          error: describeAiError(
            err instanceof Error ? err.message : 'Не удалось выполнить команду'
          ),
          step: null,
          canUndo: false,
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
    if (!get().canUndo) return;
    undoCommand();
    set({ canUndo: false });
  },

  minimize: () => set({ minimized: true }),

  restore: () => set({ minimized: false }),

  reset: () => {
    runId += 1;
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
