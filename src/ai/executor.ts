import type { AIConfig } from '../core/types';
import { pauseHistory, resumeHistory, useEditorStore } from '../core/store';
import { buildSceneContext, sceneContextToText } from './context';
import { createSendChat, getAiProviderIssue } from './providers';
import { TOOL_DEFINITIONS, TOOL_LABELS, executeTool } from './registry';
import type {
  AiConversationMessage,
  AiImageAttachment,
  AiRunEvent,
  AiSendChat,
  AiToolCall,
} from './types';

export const MAX_TOOL_STEPS = 8;
export const MAX_PLANNED_STEPS = 12;

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
  '- Первым действием вызови report_plan: steps — сколько всего ответов с инструментами понадобится',
  '  (2–10, без запаса прочности), summary — план одной строкой. Это план, а не действие над сценой.',
  `- Не более ${MAX_PLANNED_STEPS} шагов: планируй действия заранее.`,
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
  '- Симметричные элементы строй один раз и копируй через mirror_duplicate (axis=horizontal):',
  '  не пересчитывай координаты второй половины вручную.',
  '- Пример морды: голова-клякса или эллипс + два уха, светлые глаза, нос, 4–6 усов линиями create_line.',
  '',
  'Инструменты для сложных идей (используй их, а не набор однотипных фигур):',
  '- offset_path — подложки, тени, стикер-обводки, утолщение силуэта (copyBehind=true оставляет исходник).',
  '- repeat_layer — ряды, сетки, кольца, точки, зубцы, чешуя, рамки.',
  '- place_in_bounds — точная посадка объекта в прямоугольник без ручного пересчёта scale.',
  '- round_corners — мягкие углы многоугольников, звёзд и ломаных; кривые не портит.',
  '- get_layer_geometry — прочитай anchors существующей фигуры, прежде чем дорабатывать её.',
  '- combine_compound / split_compound / outline_stroke — собери контур с дырками, разбей слово,',
  '  преврати обводку в заливку перед булевыми операциями.',
  '- set_artboard — размер, DPI и цвет фона холста.',
  '- recolor_palette — перекраска макета в гармоничную палитру с сохранением контраста текста.',
  '- preflight_check — проверка контраста текста, кегля (для 300 dpi) и границ артборда.',
  '- Не меняй метаданные файла (название проекта/документа); менять имя документа запрещено.',
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
  attachments?: AiImageAttachment[];
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
  const { prompt, ai, attachments, signal, onEvent } = options;
  let maxSteps = options.maxSteps ?? MAX_TOOL_STEPS;
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error('Введите задачу для ИИ');
  }

  const send = options.sendChat ?? createSendChat(ai);
  if (!options.sendChat) {
    const issue = getAiProviderIssue(ai);
    if (issue) throw new Error(issue);
  }

  const paletteHints = (attachments ?? [])
    .filter((att) => att.extractedPalette && att.extractedPalette.length > 0)
    .map(
      (att) =>
        `Палитра референса (${att.name}): ${att.extractedPalette!.join(', ')}`
    );
  const userText =
    paletteHints.length > 0
      ? `${trimmedPrompt}\n\n${paletteHints.join('\n')}`
      : trimmedPrompt;

  const messages: AiConversationMessage[] = [
    {
      role: 'user',
      text: userText,
      ...(attachments && attachments.length > 0 ? { images: attachments } : {}),
    },
  ];

  const toolLog: AiToolLogEntry[] = [];
  let finalText = '';
  let steps = 0;

  const startState = useEditorStore.getState();
  const initialScene = startState.scene;
  const startSessionId = startState.documentSessionId;
  const wasIdle = pauseHistory();

  try {
    while (steps < maxSteps) {
      throwIfAborted(signal);
      if (useEditorStore.getState().documentSessionId !== startSessionId) {
        throw new Error('Документ изменился во время выполнения ИИ');
      }
      steps += 1;
      onEvent?.({ type: 'step', step: steps, maxSteps });

      const current = useEditorStore.getState();
      const context = buildSceneContext(current.scene, current.selectedIds);
      const reply = await send({
        system: `${SYSTEM_PROMPT}\n\n${sceneContextToText(context)}`,
        messages,
        tools: TOOL_DEFINITIONS,
        signal,
        onToken: (delta) => onEvent?.({ type: 'assistant-delta', text: delta }),
      });
      throwIfAborted(signal);
      if (useEditorStore.getState().documentSessionId !== startSessionId) {
        throw new Error('Документ изменился во время выполнения ИИ');
      }

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
        if (execution.ok && call.name === 'report_plan') {
          const planned = Number(execution.result.plannedSteps);
          if (Number.isFinite(planned)) {
            maxSteps = Math.min(
              MAX_PLANNED_STEPS,
              Math.max(2, steps + 1, Math.round(planned) + 1)
            );
            onEvent?.({ type: 'step', step: steps, maxSteps });
          }
        }
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
    const curState = useEditorStore.getState();
    const finalScene = curState.scene;
    if (curState.documentSessionId === startSessionId && wasIdle && finalScene !== initialScene) {
      useEditorStore.setState({ scene: initialScene });
      resumeHistory();
      useEditorStore.setState({ scene: finalScene, isDirty: true });
    } else {
      resumeHistory();
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
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
