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
  extractPayloadError,
  isRecord,
  parseArgsObject,
  readHttpError,
  readJsonResponse,
  type FetchLike,
} from './http';

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
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
      const images = message.images ?? [];
      if (images.length > 0) {
        const content: OpenAIContentPart[] = [
          ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
          ...images.map((image) => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:${image.mimeType};base64,${image.dataBase64}`,
            },
          })),
        ];
        out.push({ role: 'user', content });
      } else {
        out.push({ role: 'user', content: message.text });
      }
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

function parseOpenAIJsonPayload(
  payload: unknown,
  onToken?: (delta: string) => void
): AiProviderReply {
  if (!isRecord(payload)) {
    throw new Error('Провайдер вернул неожиданный ответ');
  }
  const payloadError = extractPayloadError(payload);
  if (payloadError) {
    throw new Error(payloadError);
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  const finishReason =
    isRecord(first) && typeof first.finish_reason === 'string'
      ? first.finish_reason
      : null;
  if (finishReason === 'length' || finishReason === 'max_tokens') {
    throw new Error(
      'Ответ модели оборвался по лимиту токенов (max_tokens). Попробуйте упростить задачу.'
    );
  }
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

  const trimmed = text.trim();
  if (trimmed === '' && toolCalls.length === 0) {
    throw new Error('Провайдер вернул пустой ответ');
  }
  if (onToken && trimmed) {
    onToken(text);
  }

  return { text: trimmed, toolCalls } satisfies AiProviderReply;
}

async function readOpenAIStream(
  response: Response,
  onToken: (delta: string) => void
): Promise<AiProviderReply> {
  const textParts: string[] = [];
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let sawSseData = false;
  const nonSseLines: string[] = [];
  let finishReason: string | null = null;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('data:')) {
      if (!sawSseData && !/^(event:|id:|retry:|:)/.test(trimmed)) {
        nonSseLines.push(line);
      }
      return;
    }
    sawSseData = true;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(payload)) return;
    const streamError = extractPayloadError(payload);
    if (streamError) {
      throw new Error(streamError);
    }
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices[0];
    if (!isRecord(first)) return;
    if (typeof first.finish_reason === 'string' && first.finish_reason) {
      finishReason = first.finish_reason;
    }
    const delta = isRecord(first.delta) ? first.delta : null;
    if (!delta) return;

    if (typeof delta.content === 'string' && delta.content) {
      textParts.push(delta.content);
      onToken(delta.content);
    }

    const rawCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    rawCalls.forEach((rawCall, fallbackIndex) => {
      if (!isRecord(rawCall)) return;
      const index =
        typeof rawCall.index === 'number' ? rawCall.index : fallbackIndex;
      const current = calls.get(index) ?? { id: '', name: '', args: '' };
      if (typeof rawCall.id === 'string' && rawCall.id) {
        current.id = rawCall.id;
      }
      const fn = isRecord(rawCall.function) ? rawCall.function : null;
      if (fn) {
        if (typeof fn.name === 'string' && fn.name) current.name = fn.name;
        if (typeof fn.arguments === 'string') current.args += fn.arguments;
      }
      calls.set(index, current);
    });
  };

  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          consumeLine(line);
          newline = buffer.indexOf('\n');
        }
      }
      buffer += decoder.decode();
      if (buffer) {
        for (const line of buffer.split(/\r?\n/)) {
          consumeLine(line);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } else {
    const raw = await response.text();
    raw.split(/\r?\n/).forEach(consumeLine);
  }

  if (!sawSseData && nonSseLines.length > 0) {
    const rawFallback = nonSseLines.join('\n').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawFallback);
    } catch {
      throw new Error('Провайдер вернул некорректный ответ потока');
    }
    return parseOpenAIJsonPayload(parsed, onToken);
  }

  if (finishReason === 'length' || finishReason === 'max_tokens') {
    throw new Error(
      'Ответ модели оборвался по лимиту токенов (max_tokens). Попробуйте упростить задачу.'
    );
  }

  const text = textParts.join('').trim();
  const toolCalls: AiToolCall[] = [];
  [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([index, call]) => {
      if (!call.name) return;
      toolCalls.push({
        id: call.id || `openai_call_${index}`,
        name: call.name,
        args: parseArgsObject(call.args, call.name),
      });
    });

  if (!text && toolCalls.length === 0) {
    throw new Error('Провайдер вернул пустой ответ');
  }
  return { text, toolCalls };
}

export function createOpenAISend(
  ai: AIConfig,
  fetchImpl: FetchLike
): AiSendChat {
  return async ({ system, messages, tools, signal, onToken }: AiChatRequest) => {
    const baseUrl = normalizeBaseUrl(ai.openaiBaseUrl, 'https://api.openai.com/v1');
    const model = ai.openaiModel.trim() || 'gpt-6-luna';
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
        ...(onToken ? { stream: true } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(await readHttpError(response));
    }

    if (onToken) {
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (
        contentType.includes('application/json') &&
        !contentType.includes('text/event-stream')
      ) {
        const payload = await readJsonResponse(response, 'Провайдер');
        return parseOpenAIJsonPayload(payload, onToken);
      }
      return readOpenAIStream(response, onToken);
    }

    const payload = await readJsonResponse(response, 'Провайдер');
    return parseOpenAIJsonPayload(payload);
  };
}
