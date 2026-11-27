import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  fetchProviderModels,
  normalizeBaseUrl,
  OPENAI_COMPATIBLE_PRESETS,
  PROVIDER_QUICK_MODELS,
} from '../../core/aiModels';
import { DEFAULT_SETTINGS } from '../../core/settings';
import type { AIConfig, AIProviderType } from '../../core/types';
import { SegmentedButton } from '../InspectorControls';
import { AIModelField } from './AIModelField';

interface AiTabProps {
  ai: AIConfig;
  updateAi: (patch: Partial<AIConfig>) => void;
  fetchedModelsMap: Partial<Record<AIProviderType, string[]>>;
  setFetchedModelsMap: Dispatch<
    SetStateAction<Partial<Record<AIProviderType, string[]>>>
  >;
}

export function AiTab({
  ai,
  updateAi,
  fetchedModelsMap,
  setFetchedModelsMap,
}: AiTabProps) {
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelsFetchError, setModelsFetchError] = useState<string | null>(null);

  const fetchModelsAbortRef = useRef<AbortController | null>(null);
  const fetchModelsRequestIdRef = useRef(0);

  const abortFetchModels = () => {
    fetchModelsAbortRef.current?.abort();
    fetchModelsAbortRef.current = null;
    fetchModelsRequestIdRef.current += 1;
    setIsFetchingModels(false);
  };

  useEffect(() => {
    return () => {
      fetchModelsAbortRef.current?.abort();
      fetchModelsAbortRef.current = null;
    };
  }, []);

  const handleFetchModels = async () => {
    const aiSnapshot = ai;
    const provider = aiSnapshot.provider;
    fetchModelsAbortRef.current?.abort();
    const controller = new AbortController();
    fetchModelsAbortRef.current = controller;
    fetchModelsRequestIdRef.current += 1;
    const requestId = fetchModelsRequestIdRef.current;

    setIsFetchingModels(true);
    setModelsFetchError(null);
    try {
      const models = await fetchProviderModels(aiSnapshot, controller.signal);
      if (
        controller.signal.aborted ||
        fetchModelsRequestIdRef.current !== requestId
      ) {
        return;
      }
      setFetchedModelsMap((prev) => ({ ...prev, [provider]: models }));
    } catch (err) {
      if (
        controller.signal.aborted ||
        fetchModelsRequestIdRef.current !== requestId ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return;
      }
      setModelsFetchError(
        err instanceof Error ? err.message : 'Не удалось загрузить список моделей'
      );
    } finally {
      if (fetchModelsRequestIdRef.current === requestId) {
        if (fetchModelsAbortRef.current === controller) {
          fetchModelsAbortRef.current = null;
        }
        setIsFetchingModels(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-paper-border bg-paper-bg/70 px-3 py-2 text-[11px] text-paper-muted">
        Параметры сохраняются в <span className="font-display text-paper-ink">settings.json</span> и не попадают в файл проекта. Панель команд открывается по{' '}
        <span className="font-display text-paper-ink">Ctrl+K</span>.
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-paper-muted">Провайдер</span>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <SegmentedButton
            active={ai.provider === 'openai'}
            label="OpenAI / API"
            onClick={() => {
              abortFetchModels();
              setModelsFetchError(null);
              updateAi({ provider: 'openai' });
            }}
          />
          <SegmentedButton
            active={ai.provider === 'anthropic'}
            label="Anthropic"
            onClick={() => {
              abortFetchModels();
              setModelsFetchError(null);
              updateAi({ provider: 'anthropic' });
            }}
          />
          <SegmentedButton
            active={ai.provider === 'gemini'}
            label="Google Gemini"
            onClick={() => {
              abortFetchModels();
              setModelsFetchError(null);
              updateAi({ provider: 'gemini' });
            }}
          />
          <SegmentedButton
            active={ai.provider === 'ollama'}
            label="Ollama"
            onClick={() => {
              abortFetchModels();
              setModelsFetchError(null);
              updateAi({ provider: 'ollama' });
            }}
          />
        </div>
      </div>

      {ai.provider === 'gemini' && (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-paper-muted">
              Gemini API Key
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type={showGeminiKey ? 'text' : 'password'}
                value={ai.geminiApiKey}
                autoComplete="off"
                spellCheck={false}
                placeholder="AIza..."
                onChange={(e) => {
                  setModelsFetchError(null);
                  updateAi({ geminiApiKey: e.target.value });
                }}
                className="h-8 flex-1 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
              />
              <button
                type="button"
                onClick={() => setShowGeminiKey((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:text-paper-ink"
              >
                {showGeminiKey ? (
                  <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
              </button>
            </div>
          </label>

          <AIModelField
            value={ai.geminiModel}
            placeholder={DEFAULT_SETTINGS.ai.geminiModel}
            quickModels={PROVIDER_QUICK_MODELS.gemini}
            fetchedModels={fetchedModelsMap.gemini ?? []}
            isFetching={isFetchingModels}
            fetchError={modelsFetchError}
            onChange={(geminiModel) => updateAi({ geminiModel })}
            onFetch={() => void handleFetchModels()}
          />
        </div>
      )}

      {ai.provider === 'anthropic' && (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-paper-muted">
              Anthropic API Key
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type={showAnthropicKey ? 'text' : 'password'}
                value={ai.anthropicApiKey}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-ant-..."
                onChange={(e) => {
                  setModelsFetchError(null);
                  updateAi({ anthropicApiKey: e.target.value });
                }}
                className="h-8 flex-1 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
              />
              <button
                type="button"
                onClick={() => setShowAnthropicKey((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:text-paper-ink"
              >
                {showAnthropicKey ? (
                  <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
              </button>
            </div>
          </label>

          <AIModelField
            value={ai.anthropicModel}
            placeholder={DEFAULT_SETTINGS.ai.anthropicModel}
            quickModels={PROVIDER_QUICK_MODELS.anthropic}
            fetchedModels={fetchedModelsMap.anthropic ?? []}
            isFetching={isFetchingModels}
            fetchError={modelsFetchError}
            onChange={(anthropicModel) => updateAi({ anthropicModel })}
            onFetch={() => void handleFetchModels()}
          />
        </div>
      )}

      {ai.provider === 'ollama' && (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-paper-muted">
              Ollama Server URL
            </span>
            <input
              type="text"
              value={ai.ollamaBaseUrl}
              spellCheck={false}
              placeholder={DEFAULT_SETTINGS.ai.ollamaBaseUrl}
              onChange={(e) => {
                setModelsFetchError(null);
                updateAi({ ollamaBaseUrl: e.target.value });
              }}
              className="h-8 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
            />
          </label>

          <AIModelField
            value={ai.ollamaModel}
            placeholder={DEFAULT_SETTINGS.ai.ollamaModel}
            quickModels={PROVIDER_QUICK_MODELS.ollama}
            fetchedModels={fetchedModelsMap.ollama ?? []}
            isFetching={isFetchingModels}
            fetchError={modelsFetchError}
            onChange={(ollamaModel) => updateAi({ ollamaModel })}
            onFetch={() => void handleFetchModels()}
          />
        </div>
      )}

      {ai.provider === 'openai' && (() => {
        const currentBase = normalizeBaseUrl(
          ai.openaiBaseUrl,
          DEFAULT_SETTINGS.ai.openaiBaseUrl
        );
        const activePreset = OPENAI_COMPATIBLE_PRESETS.find(
          (preset) => preset.baseUrl === currentBase
        );
        return (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-paper-muted">
                Пресеты провайдеров
              </span>
              <div className="flex flex-wrap gap-1.5">
                {OPENAI_COMPATIBLE_PRESETS.map((preset) => {
                  const active = activePreset?.id === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        abortFetchModels();
                        setModelsFetchError(null);
                        setFetchedModelsMap((prev) => {
                          const next = { ...prev };
                          delete next.openai;
                          return next;
                        });
                        updateAi({
                          openaiBaseUrl: preset.baseUrl,
                          openaiModel: preset.defaultModel,
                        });
                      }}
                      className={`h-7 rounded border px-2.5 text-[11px] transition-colors ${
                        active
                          ? 'border-paper-accent bg-paper-accent/15 font-medium text-paper-ink'
                          : 'border-paper-border bg-paper-bg text-paper-muted hover:bg-paper-hover hover:text-paper-ink'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-paper-muted">Base URL</span>
              <input
                type="text"
                value={ai.openaiBaseUrl}
                spellCheck={false}
                placeholder={DEFAULT_SETTINGS.ai.openaiBaseUrl}
                onChange={(e) => {
                  setModelsFetchError(null);
                  updateAi({ openaiBaseUrl: e.target.value });
                }}
                className="h-8 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-paper-muted">API Key</span>
              <div className="flex items-center gap-1.5">
                <input
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={ai.openaiApiKey}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-..."
                  onChange={(e) => {
                    setModelsFetchError(null);
                    updateAi({ openaiApiKey: e.target.value });
                  }}
                  className="h-8 flex-1 rounded border border-paper-border bg-paper-bg px-2.5 font-display text-[12px] text-paper-ink outline-none focus:border-paper-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenaiKey((v) => !v)}
                  className="flex h-8 w-8 items-center justify-center rounded border border-paper-border bg-paper-bg text-paper-muted hover:text-paper-ink"
                >
                  {showOpenaiKey ? (
                    <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                  ) : (
                    <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            </label>

            <AIModelField
              value={ai.openaiModel}
              placeholder={
                activePreset?.defaultModel ??
                DEFAULT_SETTINGS.ai.openaiModel
              }
              quickModels={
                activePreset?.models.length
                  ? activePreset.models
                  : PROVIDER_QUICK_MODELS.openai
              }
              fetchedModels={fetchedModelsMap.openai ?? []}
              isFetching={isFetchingModels}
              fetchError={modelsFetchError}
              onChange={(openaiModel) => updateAi({ openaiModel })}
              onFetch={() => void handleFetchModels()}
            />
          </div>
        );
      })()}
    </div>
  );
}
