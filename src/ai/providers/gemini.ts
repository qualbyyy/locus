import type { AIConfig } from '../../core/types';
import type {
  AiChatRequest,
  AiConversationMessage,
  AiProviderReply,
  AiSendChat,
  AiToolCall,
} from '../types';
import {
  isRecord,
  parseArgsObject,
  readHttpError,
  type FetchLike,
} from './http';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

function contentFromMessage(message: AiConversationMessage): GeminiContent {
  if (message.role === 'user') {
    return { role: 'user', parts: [{ text: message.text }] };
  }
  if (message.role === 'assistant') {
    const parts: GeminiPart[] = [];
    if (message.text.trim()) parts.push({ text: message.text });
    for (const call of message.toolCalls) {
      parts.push({ functionCall: { name: call.name, args: call.args } });
    }
    if (parts.length === 0) parts.push({ text: ' ' });
    return { role: 'model', parts };
  }

  let parsed: Record<string, unknown> = { result: message.content };
  try {
    const value = JSON.parse(message.content) as unknown;
    parsed = { result: value };
  } catch {
    // Keep the raw string result.
  }
  return {
    role: 'user',
    parts: [{ functionResponse: { name: message.name, response: parsed } }],
  };
}

function toGeminiContents(messages: AiConversationMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    const next = contentFromMessage(message);
    const last = contents[contents.length - 1];
    if (last && last.role === next.role) {
      last.parts.push(...next.parts);
    } else {
      contents.push(next);
    }
  }
  return contents;
}

export function createGeminiSend(
  ai: AIConfig,
  fetchImpl: FetchLike
): AiSendChat {
  return async ({ system, messages, tools, signal }: AiChatRequest) => {
    const apiKey = ai.geminiApiKey.trim();
    if (!apiKey) {
      throw new Error('Нет API-ключа — укажите его в настройках (Ctrl+,)');
    }
    const model = (ai.geminiModel.trim() || 'gemini-2.5-flash').replace(/^models\//, '');
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: toGeminiContents(messages),
          tools: [
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            },
          ],
          generationConfig: { temperature: 0.4 },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(await readHttpError(response));
    }

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) {
      throw new Error('Gemini вернул неожиданный ответ');
    }

    const error = payload.error;
    if (isRecord(error) && typeof error.message === 'string') {
      throw new Error(error.message);
    }

    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const first = candidates[0];
    const content = isRecord(first) && isRecord(first.content) ? first.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];

    let text = '';
    const toolCalls: AiToolCall[] = [];
    parts.forEach((rawPart, index) => {
      if (!isRecord(rawPart)) return;
      if (typeof rawPart.text === 'string') {
        text += rawPart.text;
      }
      const call = rawPart.functionCall;
      if (isRecord(call) && typeof call.name === 'string') {
        toolCalls.push({
          id: `gemini_call_${index}`,
          name: call.name,
          args: parseArgsObject(call.args, call.name),
        });
      }
    });

    if (text.trim() === '' && toolCalls.length === 0) {
      const feedback = isRecord(payload.promptFeedback) ? payload.promptFeedback : null;
      const reason =
        feedback && typeof feedback.blockReason === 'string'
          ? `Запрос заблокирован: ${feedback.blockReason}`
          : 'Gemini вернул пустой ответ';
      throw new Error(reason);
    }

    return { text: text.trim(), toolCalls } satisfies AiProviderReply;
  };
}
