import { normalizeBaseUrl } from '../../core/aiModels';
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

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function toOpenAIMessages(
  system: string,
  messages: AiConversationMessage[]
): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.text });
    } else if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: message.text || null,
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args),
                },
              })),
            }
          : {}),
      });
    } else {
      out.push({
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId,
      });
    }
  }
  return out;
}

export function createOpenAISend(
  ai: AIConfig,
  fetchImpl: FetchLike
): AiSendChat {
  return async ({ system, messages, tools, signal }: AiChatRequest) => {
    const baseUrl = normalizeBaseUrl(ai.openaiBaseUrl, 'https://api.openai.com/v1');
    const model = ai.openaiModel.trim() || 'gpt-4o-mini';
    const apiKey = ai.openaiApiKey.trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model,
        messages: toOpenAIMessages(system, messages),
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: 'auto',
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      throw new Error(await readHttpError(response));
    }

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) {
      throw new Error('Провайдер вернул неожиданный ответ');
    }
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices[0];
    const message = isRecord(first) && isRecord(first.message) ? first.message : null;
    if (!message) {
      throw new Error('Провайдер вернул пустой ответ');
    }

    const text = typeof message.content === 'string' ? message.content : '';
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls: AiToolCall[] = [];
    rawCalls.forEach((rawCall, index) => {
      if (!isRecord(rawCall)) return;
      const fn = isRecord(rawCall.function) ? rawCall.function : null;
      if (!fn || typeof fn.name !== 'string') return;
      toolCalls.push({
        id:
          typeof rawCall.id === 'string' && rawCall.id
            ? rawCall.id
            : `openai_call_${index}`,
        name: fn.name,
        args: parseArgsObject(fn.arguments, fn.name),
      });
    });

    if (text.trim() === '' && toolCalls.length === 0) {
      throw new Error('Провайдер вернул пустой ответ');
    }

    return { text: text.trim(), toolCalls } satisfies AiProviderReply;
  };
}
