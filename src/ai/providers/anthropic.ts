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

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

function toAnthropicMessages(messages: AiConversationMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: message.text }] });
      continue;
    }

    if (message.role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      if (message.text.trim()) blocks.push({ type: 'text', text: message.text });
      for (const call of message.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.args,
        });
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: ' ' });
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    const block: AnthropicBlock = {
      type: 'tool_result',
      tool_use_id: message.toolCallId,
      content: message.content,
    };
    const last = out[out.length - 1];
    if (
      last &&
      last.role === 'user' &&
      last.content.every((item) => item.type === 'tool_result')
    ) {
      last.content.push(block);
    } else {
      out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

export function createAnthropicSend(
  ai: AIConfig,
  fetchImpl: FetchLike
): AiSendChat {
  return async ({ system, messages, tools, signal }: AiChatRequest) => {
    const apiKey = ai.anthropicApiKey.trim();
    if (!apiKey) {
      throw new Error('Укажите Anthropic API Key в настройках (Ctrl+,)');
    }
    const model = ai.anthropicModel.trim() || 'claude-sonnet-4-5';

    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal,
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.4,
        system,
        messages: toAnthropicMessages(messages),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(await readHttpError(response));
    }

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) {
      throw new Error('Anthropic вернул неожиданный ответ');
    }
    const blocks = Array.isArray(payload.content) ? payload.content : [];

    let text = '';
    const toolCalls: AiToolCall[] = [];
    blocks.forEach((rawBlock, index) => {
      if (!isRecord(rawBlock)) return;
      if (rawBlock.type === 'text' && typeof rawBlock.text === 'string') {
        text += rawBlock.text;
      }
      if (rawBlock.type === 'tool_use' && typeof rawBlock.name === 'string') {
        toolCalls.push({
          id:
            typeof rawBlock.id === 'string' && rawBlock.id
              ? rawBlock.id
              : `anthropic_call_${index}`,
          name: rawBlock.name,
          args: parseArgsObject(rawBlock.input, rawBlock.name),
        });
      }
    });

    if (text.trim() === '' && toolCalls.length === 0) {
      throw new Error('Anthropic вернул пустой ответ');
    }

    return { text: text.trim(), toolCalls } satisfies AiProviderReply;
  };
}
