import type { AIConfig } from '../core/types';
import { useEditorStore } from '../core/store';
import { buildSceneContext, sceneContextToText } from './context';
import { createSendChat, getAiProviderIssue } from './providers';
import { TOOL_DEFINITIONS, TOOL_LABELS, executeTool } from './registry';
import type {
  AiConversationMessage,
  AiRunEvent,
  AiSendChat,
  AiToolCall,
} from './types';

export const MAX_TOOL_STEPS = 8;

export const SYSTEM_PROMPT = [
  'Ты — ИИ-ассистент векторного редактора Locus и работаешь как оператор его инструментов.',
  'Изменяй сцену ТОЛЬКО через вызовы инструментов (tool calls). Не придумывай id слоёв:',
  'используй только id из контекста сцены или из результатов инструментов.',
  '',
  'Система координат: (0, 0) — левый верхний угол артборда, +X вправо, +Y вниз, единицы — px.',
  'Для фигур x и y задают центр, для текста — верхнюю якорную точку с учётом align.',
  'Цвета — hex вида #rrggbb. Поворот — градусы по часовой стрелке.',
  '',
  'Правила:',
  '- Если для задачи нужны существующие слои, найди их в контексте по id, имени и типу.',
  '- Для сложной композиции допустимо несколько инструментов подряд в одном ответе.',
  '- Не вызывай инструменты с несуществующими id и не повторяй уже выполненное.',
  '- Если пользователь задаёт вопрос, не требующий изменений сцены, ответь текстом без инструментов.',
  '- В финальном ответе по-русски кратко перечисли, что сделано. Не показывай JSON и служебные детали.',
  '- Если творческая задача поставлена кратко, прими смелое и аккуратное решение сам, без лишних вопросов.',
  `- Не более ${MAX_TOOL_STEPS} шагов: планируй действия заранее.`,
  '',
  'Как строить сложные композиции (постер, обложка, афиша, иллюстрация):',
  '- Думай цельным образом, а не набором случайных фигур: фон или большая подложка, 1–2 опорные формы,',
  '  2–4 акцентные детали, заголовок и подпись/подзаголовок.',
  '- Соблюдай иерархию: заголовок в 2–3 раза крупнее подзаголовка; отступы от краёв артборда 6–10%.',
  '- Координаты считай от размеров артборда; элементы должны осознанно перекрываться, а не стоять в ряд.',
  '- Используй 2–4 цвета одной палитры и разные уровни прозрачности (0.15–0.35 для подложек).',
  '- Выравнивай через align_layers (artboard_center, left, distribute_*), комбинируй формы через boolean_op,',
  '  применяй set_clip_mask для необычных краёв, randomize_anchors — для живых органических силуэтов.',
  '- Для постера или обложки делай минимум 5–8 осмысленных элементов, а не 2–3 фигуры.',
  '- Порядок работы: крупные формы и фон → акценты и декор → текст → выравнивание и финальная правка.',
  '',
  'Детали и контраст (частая ошибка — невидимые детали):',
  '- Не рисуй детали цветом фона или цветом объекта под ними. На чёрной голове глаза делай светлыми,',
  '  нос — акцентным, усы — контрастной обводкой.',
  '- Тонкие линии (усы, брови, рот, прожилки, контуры) рисуй через create_line: это обводка,',
  '  а не залитая фигура.',
  '- Не включай в boolean_op детали, которые должны читаться отдельно. Объединяй только крупные',
  '  формы (например, голова + уши), а глаза, нос и усы оставляй отдельными слоями сверху.',
  '- Соблюдай масштаб: глаза — 8–15% ширины головы, нос — 5–10%, усы выходят за край морды.',
  '  Не делай детали крошечными в центре.',
  '- Симметричные элементы строй парами с координатами относительно центра (cx ± dx).',
  '- Пример морды: голова-клякса или эллипс + два уха, светлые глаза, нос, 4–6 усов линиями create_line.',
].join('\n');

export interface AiToolLogEntry {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  error?: string;
}

export interface AiRunResult {
  text: string;
  steps: number;
  toolCalls: AiToolLogEntry[];
}

export interface AiRunOptions {
  prompt: string;
  ai: AIConfig;
  signal?: AbortSignal;
  sendChat?: AiSendChat;
  onEvent?: (event: AiRunEvent) => void;
  maxSteps?: number;
}

function abortError(): Error {
  const error = new Error('Запрос отменён');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function toolContent(
  execution: ReturnType<typeof executeTool>,
  call: AiToolCall
): string {
  if (execution.ok) {
    return JSON.stringify({ tool: call.name, ...execution.result });
  }
  return JSON.stringify({ tool: call.name, error: execution.error });
}

export async function runAiCommand(options: AiRunOptions): Promise<AiRunResult> {
  const { prompt, ai, signal, onEvent, maxSteps = MAX_TOOL_STEPS } = options;
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('Введите задачу для ИИ');
  }

  const send = options.sendChat ?? createSendChat(ai);
  if (!options.sendChat) {
    const issue = getAiProviderIssue(ai);
    if (issue) throw new Error(issue);
  }

  const messages: AiConversationMessage[] = [
    { role: 'user', text: trimmedPrompt },
  ];

  const toolLog: AiToolLogEntry[] = [];
  let finalText = '';
  let steps = 0;

  const temporal = useEditorStore.temporal.getState();
  const initialScene = useEditorStore.getState().scene;
  const wasTracking = temporal.isTracking;
  if (wasTracking) temporal.pause();

  try {
    while (steps < maxSteps) {
      throwIfAborted(signal);
      steps += 1;
      onEvent?.({ type: 'step', step: steps, maxSteps });

      const current = useEditorStore.getState();
      const context = buildSceneContext(current.scene, current.selectedIds);
      const reply = await send({
        system: `${SYSTEM_PROMPT}\n\n${sceneContextToText(context)}`,
        messages,
        tools: TOOL_DEFINITIONS,
        signal,
      });
      throwIfAborted(signal);

      if (reply.text.trim()) {
        finalText = reply.text.trim();
        onEvent?.({ type: 'assistant', text: reply.text });
      }

      if (reply.toolCalls.length === 0) {
        break;
      }

      messages.push({
        role: 'assistant',
        text: reply.text,
        toolCalls: reply.toolCalls,
      });

      for (const call of reply.toolCalls) {
        throwIfAborted(signal);
        const execution = executeTool(call.name, call.args);
        const summary = execution.ok
          ? String(
              execution.result.summary ??
                TOOL_LABELS[call.name] ??
                `Инструмент ${call.name}`
            )
          : execution.error;
        const entry: AiToolLogEntry = {
          name: call.name,
          args: call.args,
          ok: execution.ok,
          summary,
          ...(execution.ok ? {} : { error: execution.error }),
        };
        toolLog.push(entry);
        onEvent?.({
          type: 'tool',
          name: call.name,
          args: call.args,
          ok: execution.ok,
          summary,
          ...(execution.ok ? {} : { error: execution.error }),
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: toolContent(execution, call),
        });
      }
    }
  } finally {
    const finalScene = useEditorStore.getState().scene;
    if (wasTracking) {
      if (finalScene !== initialScene) {
        useEditorStore.setState({ scene: initialScene });
        useEditorStore.temporal.getState().resume();
        useEditorStore.setState({ scene: finalScene, isDirty: true });
      } else {
        useEditorStore.temporal.getState().resume();
      }
    }
  }

  if (!finalText) {
    finalText =
      toolLog.length > 0
        ? `Готово. Выполнено действий: ${toolLog.length}.`
        : 'Модель не вернула ответ. Попробуйте переформулировать задачу.';
  }

  return { text: finalText, steps, toolCalls: toolLog };
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
