import { httpFetch } from '../../platform/io';
import type { AIConfig, AIProviderType } from '../../core/types';
import type { AiSendChat } from '../types';
import { createAnthropicSend } from './anthropic';
import { createGeminiSend } from './gemini';
import type { FetchLike } from './http';
import { createOllamaSend } from './ollama';
import { createOpenAISend } from './openai';

export const PROVIDER_LABELS: Record<AIProviderType, string> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(
    url
  );
}

export function createSendChat(
  ai: AIConfig,
  fetchImpl: FetchLike = httpFetch
): AiSendChat {
  switch (ai.provider) {
    case 'gemini':
      return createGeminiSend(ai, fetchImpl);
    case 'anthropic':
      return createAnthropicSend(ai, fetchImpl);
    case 'ollama':
      return createOllamaSend(ai, fetchImpl);
    case 'openai':
      return createOpenAISend(ai, fetchImpl);
  }
}

export function getAiProviderIssue(ai: AIConfig): string | null {
  if (ai.provider === 'gemini' && !ai.geminiApiKey.trim()) {
    return 'Нет API-ключа — укажите его в настройках (Ctrl+,)';
  }
  if (ai.provider === 'anthropic' && !ai.anthropicApiKey.trim()) {
    return 'Нет API-ключа — укажите его в настройках (Ctrl+,)';
  }
  if (
    ai.provider === 'openai' &&
    !ai.openaiApiKey.trim() &&
    !isLocalUrl(ai.openaiBaseUrl.trim())
  ) {
    return 'Нет API-ключа — укажите его или локальный baseURL в настройках (Ctrl+,)';
  }
  return null;
}

export function getAiModelLabel(ai: AIConfig): string {
  const model =
    ai.provider === 'gemini'
      ? ai.geminiModel
      : ai.provider === 'anthropic'
        ? ai.anthropicModel
        : ai.provider === 'ollama'
          ? ai.ollamaModel
          : ai.openaiModel;
  return `${PROVIDER_LABELS[ai.provider]} · ${model.trim() || 'модель не выбрана'}`;
}
