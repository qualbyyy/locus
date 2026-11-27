import { normalizeOllamaBaseUrl } from '../../core/aiModels';
import type { AIConfig } from '../../core/types';
import type {
  AiChatRequest,
  AiConversationMessage,
  AiProviderReply,
  AiSendChat,
  AiToolCall,
} from '../types';
import {
  extractPayloadError,
  isRecord,
  parseArgsObject,
  readHttpError,
  readJsonResponse,
  type FetchLike,
} from './http';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  tool_name?: string;
}

function toOllamaMessages(
  system: string,
  messages: AiConversationMessage[]
): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: 'system', content: system }];
  for (const message of messages) {
    if (message.role === 'user') {
      const images = (message.images ?? []).map((image) => image.dataBase64);
      out.push({
        role: 'user',
        content: message.text,
        ...(images.length > 0 ? { images } : {}),
      });
    } else if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: message.text,
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                function: { name: call.name, arguments: call.args },
              })),
            }
          : {}),
      });
    } else {
      out.push({
        role: 'tool',
        content: message.content,
        tool_name: message.name,
      });
    }
  }
  return out;
}

export function createOllamaSend(
  ai: AIConfig,
  fetchImpl: FetchLike
): AiSendChat {
  return async ({ system, messages, tools, signal }: AiChatRequest) => {
    const baseUrl = normalizeOllamaBaseUrl(ai.ollamaBaseUrl);
    const model = ai.ollamaModel.trim() || 'qwen3.8';

    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        messages: toOllamaMessages(system, messages),
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        stream: false,
        options: { temperature: 0.4 },
      }),
    });

    if (!response.ok) {
      throw new Error(await readHttpError(response));
    }

    const payload = await readJsonResponse(response, 'Ollama');
    if (!isRecord(payload)) {
      throw new Error('Ollama вернул неожиданный ответ');
    }
    const payloadError = extractPayloadError(payload);
    if (payloadError) {
      throw new Error(payloadError);
    }
    if (payload.done_reason === 'length') {
      throw new Error(
        'Ответ Ollama оборвался по лимиту токенов (max_tokens). Попробуйте упростить задачу.'
      );
    }

    const message = isRecord(payload.message) ? payload.message : null;
    if (!message) {
      throw new Error('Ollama вернул пустой ответ');
    }

    const text = typeof message.content === 'string' ? message.content : '';
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls: AiToolCall[] = [];
    rawCalls.forEach((rawCall, index) => {
      if (!isRecord(rawCall)) return;
      const fn = isRecord(rawCall.function) ? rawCall.function : null;
      if (!fn || typeof fn.name !== 'string') return;
      toolCalls.push({
        id: `ollama_call_${index}`,
        name: fn.name,
        args: parseArgsObject(fn.arguments, fn.name),
      });
    });

    if (text.trim() === '' && toolCalls.length === 0) {
      throw new Error('Ollama вернул пустой ответ');
    }

    return { text: text.trim(), toolCalls } satisfies AiProviderReply;
  };
}
