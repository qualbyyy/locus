import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchProviderModels,
  normalizeOllamaBaseUrl,
  OPENAI_COMPATIBLE_PRESETS,
  parseGeminiModels,
  parseOllamaModels,
  parseOpenAIModels,
} from '../src/core/aiModels';
import { DEFAULT_AI_CONFIG, sanitizeSettings } from '../src/core/settings';

describe('AI providers and model fetching', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes anthropic, ollama, and openai providers with defaults', () => {
    const anthropic = sanitizeSettings({
      ai: { provider: 'anthropic', anthropicApiKey: 'sk-ant-1' },
    });
    expect(anthropic.ai.provider).toBe('anthropic');
    expect(anthropic.ai.anthropicApiKey).toBe('sk-ant-1');
    expect(anthropic.ai.anthropicModel).toBe(DEFAULT_AI_CONFIG.anthropicModel);

    const ollama = sanitizeSettings({
      ai: { provider: 'ollama', ollamaBaseUrl: ' http://127.0.0.1:11434 ' },
    });
    expect(ollama.ai.provider).toBe('ollama');
    expect(ollama.ai.ollamaBaseUrl).toBe('http://127.0.0.1:11434');
    expect(ollama.ai.ollamaModel).toBe(DEFAULT_AI_CONFIG.ollamaModel);

    const fallback = sanitizeSettings({ ai: { provider: 'unknown' } });
    expect(fallback.ai.provider).toBe('openai');
  });

  it('includes DeepSeek preset with valid baseUrl and default model', () => {
    const deepseek = OPENAI_COMPATIBLE_PRESETS.find((p) => p.id === 'deepseek');
    expect(deepseek).toBeDefined();
    expect(deepseek?.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(deepseek?.defaultModel).toBe('deepseek-chat');
  });

  it('parses provider payloads and normalizes Ollama URL', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434/v1/')).toBe(
      'http://localhost:11434'
    );

    expect(
      parseGeminiModels({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/embedding-001',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      })
    ).toEqual(['gemini-2.5-flash']);

    expect(
      parseOpenAIModels({
        data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
      })
    ).toEqual(['deepseek-chat', 'deepseek-reasoner']);

    expect(
      parseOllamaModels({
        models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3.2:latest' }],
      })
    ).toEqual(['qwen2.5-coder:7b', 'llama3.2:latest']);
  });

  it('validates required API keys and fetches Anthropic/Ollama models', async () => {
    await expect(
      fetchProviderModels({ ...DEFAULT_AI_CONFIG, provider: 'anthropic', anthropicApiKey: '' })
    ).rejects.toThrow('API-ключа');

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 'claude-sonnet-4-5' }] }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }),
          { status: 200 }
        )
      );

    const anthropicModels = await fetchProviderModels({
      ...DEFAULT_AI_CONFIG,
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-test',
    });
    expect(anthropicModels).toEqual(['claude-sonnet-4-5']);

    const ollamaModels = await fetchProviderModels({
      ...DEFAULT_AI_CONFIG,
      provider: 'ollama',
      ollamaBaseUrl: 'http://localhost:11434/v1',
    });
    expect(ollamaModels).toEqual(['qwen2.5-coder:7b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://localhost:11434/api/tags');
  });
});
