import type { AIConfig, AIProviderType } from './types';
import { httpFetch } from '../platform/io';

export interface OpenAICompatiblePreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
}

export const OPENAI_COMPATIBLE_PRESETS: OpenAICompatiblePreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4', 'deepseek/deepseek-chat'],
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    models: [],
  },
];

export const PROVIDER_QUICK_MODELS: Record<AIProviderType, string[]> = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
  ollama: ['qwen2.5-coder:7b', 'llama3.2', 'gemma3:4b'],
  openai: ['gpt-4o-mini', 'deepseek-chat', 'gpt-4.1'],
};

export function normalizeBaseUrl(raw: string, fallback: string): string {
  const cleaned = raw.trim().replace(/\/+$/, '');
  return cleaned || fallback;
}

export function normalizeOllamaBaseUrl(raw: string): string {
  return normalizeBaseUrl(raw, 'http://localhost:11434').replace(/\/v1$/i, '');
}

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(
    url
  );
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function parseGeminiModels(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];

  const result: string[] = [];
  for (const entry of models) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { name?: unknown; supportedGenerationMethods?: unknown };
    if (typeof record.name !== 'string') continue;
    if (
      Array.isArray(record.supportedGenerationMethods) &&
      record.supportedGenerationMethods.length > 0 &&
      !record.supportedGenerationMethods.includes('generateContent')
    ) {
      continue;
    }
    result.push(record.name.replace(/^models\//, ''));
  }
  return dedupeStrings(result);
}

export function parseOpenAIModels(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as { data?: unknown; models?: unknown };
  const list = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.models)
      ? obj.models
      : [];

  const result: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      result.push(entry);
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { id?: unknown; name?: unknown };
    if (typeof record.id === 'string') {
      result.push(record.id);
    } else if (typeof record.name === 'string') {
      result.push(record.name);
    }
  }
  return dedupeStrings(result);
}

export function parseOllamaModels(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];

  const result: string[] = [];
  for (const entry of models) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === 'string') {
      result.push(name);
    }
  }
  return dedupeStrings(result);
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return `HTTP ${response.status}`;
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === 'string') return json.error;
    if (json.error && typeof json.error.message === 'string') return json.error.message;
    if (typeof json.message === 'string') return json.message;
    return `HTTP ${response.status}: ${text.slice(0, 120)}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await httpFetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    return await response.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Таймаут запроса (10 сек)');
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function fetchProviderModels(ai: AIConfig): Promise<string[]> {
  if (ai.provider === 'gemini') {
    const key = ai.geminiApiKey.trim();
    if (!key) {
      throw new Error('Укажите Gemini API Key для загрузки моделей');
    }
    const payload = await fetchJsonWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
    );
    const models = parseGeminiModels(payload);
    if (models.length === 0) {
      throw new Error('Провайдер не вернул доступных моделей');
    }
    return models;
  }

  if (ai.provider === 'anthropic') {
    const key = ai.anthropicApiKey.trim();
    if (!key) {
      throw new Error('Укажите Anthropic API Key для загрузки моделей');
    }
    const payload = await fetchJsonWithTimeout('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    const models = parseOpenAIModels(payload);
    if (models.length === 0) {
      throw new Error('Anthropic не вернул список моделей');
    }
    return models;
  }

  if (ai.provider === 'ollama') {
    const base = normalizeOllamaBaseUrl(ai.ollamaBaseUrl);
    const payload = await fetchJsonWithTimeout(`${base}/api/tags`);
    const models = parseOllamaModels(payload);
    if (models.length === 0) {
      throw new Error('В Ollama не найдено установленных моделей');
    }
    return models;
  }

  const base = normalizeBaseUrl(ai.openaiBaseUrl, 'https://api.openai.com/v1');
  const key = ai.openaiApiKey.trim();
  if (!key && !isLocalUrl(base)) {
    throw new Error('Укажите API Key для загрузки моделей');
  }
  const headers: Record<string, string> = {};
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  const payload = await fetchJsonWithTimeout(`${base}/models`, { headers });
  const models = parseOpenAIModels(payload);
  if (models.length === 0) {
    throw new Error('Провайдер не вернул доступных моделей');
  }
  return models;
}
