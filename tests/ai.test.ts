import { beforeEach, describe, expect, it } from 'vitest';
import { buildSceneContext } from '../src/ai/context';
import { isAbortError, runAiCommand } from '../src/ai/executor';
import {
  createSendChat,
  getAiModelLabel,
  getAiProviderIssue,
} from '../src/ai/providers';
import { TOOL_DEFINITIONS, executeTool } from '../src/ai/registry';
import type { AiProviderReply, AiRunEvent, AiSendChat } from '../src/ai/types';
import { resetDocument, undoCommand } from '../src/core/commands';
import { DEFAULT_AI_CONFIG } from '../src/core/settings';
import { useEditorStore } from '../src/core/store';
import { computeLayerWorldBBox } from '../src/core/math';
import type { PathLayer, TextLayer } from '../src/core/types';

function sceneLayers() {
  return useEditorStore.getState().scene.layers;
}

function exec(name: string, args: Record<string, unknown>) {
  const result = executeTool(name, args);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.result;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AI tool registry', () => {
  beforeEach(() => {
    resetDocument();
  });

  it('exposes exactly 12 unique tool definitions', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(12);
    expect(new Set(TOOL_DEFINITIONS.map((tool) => tool.name)).size).toBe(12);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.parameters.type).toBe('object');
    }
  });

  it('creates shapes, text and updates layers', () => {
    const shape = exec('create_shape', {
      preset: 'ellipse',
      x: 540,
      y: 540,
      width: 200,
      height: 120,
      fill: '#ff0000',
      rotation: 15,
    });
    const shapeId = String(shape.layerId);
    const path = sceneLayers().find((layer) => layer.id === shapeId) as PathLayer;
    expect(path.type).toBe('path');
    expect(path.x).toBe(540);
    expect(path.y).toBe(540);
    expect(path.fill).toBe('#ff0000');
    expect(path.rotation).toBe(15);
    expect(path.subpaths).toHaveLength(1);

    const text = exec('create_text', {
      content: 'Locus',
      x: 100,
      y: 80,
      fontSize: 64,
      fontFamily: 'Unbounded',
      align: 'center',
    });
    const textId = String(text.layerId);
    const textLayer = sceneLayers().find((layer) => layer.id === textId) as TextLayer;
    expect(textLayer.content).toBe('Locus');
    expect(textLayer.fontFamily).toBe('Unbounded');
    expect(textLayer.fontSize).toBe(64);
    expect(textLayer.align).toBe('center');

    exec('update_layers', {
      layerIds: [shapeId],
      patch: { name: 'Круг', fill: '#00ff88', opacity: 0.5, stroke: { color: '#000000', width: 3 } },
    });
    const updated = sceneLayers().find((layer) => layer.id === shapeId) as PathLayer;
    expect(updated.name).toBe('Круг');
    expect(updated.fill).toBe('#00ff88');
    expect(updated.opacity).toBe(0.5);
    expect(updated.stroke).toEqual({ color: '#000000', width: 3 });
  });

  it('reports readable validation errors without touching the scene', () => {
    const badShape = executeTool('create_shape', { preset: 'star', x: 10, y: 10 });
    expect(badShape.ok).toBe(false);
    if (!badShape.ok) {
      expect(badShape.error).toContain('width');
    }

    exec('create_shape', {
      preset: 'rect',
      x: 100,
      y: 100,
      width: 50,
      height: 50,
    });
    const badFill = executeTool('update_layers', {
      layerIds: ['missing_id'],
      patch: { fill: '#fff' },
    });
    expect(badFill.ok).toBe(false);
    if (!badFill.ok) {
      expect(badFill.error).toContain('не найден');
    }

    expect(sceneLayers()).toHaveLength(1);
  });

  it('randomizes anchors, aligns, paints a palette and duplicates', () => {
    const first = exec('create_shape', {
      preset: 'ellipse',
      x: 300,
      y: 300,
      width: 200,
      height: 200,
    });
    const second = exec('create_shape', {
      preset: 'star',
      x: 900,
      y: 500,
      width: 200,
      height: 200,
      fill: '#123456',
    });
    const firstId = String(first.layerId);
    const secondId = String(second.layerId);

    const before = sceneLayers().find((layer) => layer.id === firstId) as PathLayer;
    const beforeAnchors = JSON.stringify(before.subpaths);

    exec('randomize_anchors', { layerIds: [firstId], intensity: 8, seed: 42 });
    const after = sceneLayers().find((layer) => layer.id === firstId) as PathLayer;
    expect(JSON.stringify(after.subpaths)).not.toBe(beforeAnchors);
    expect(after.subpaths[0].anchors.length).toBe(before.subpaths[0].anchors.length);

    exec('align_layers', { layerIds: [firstId, secondId], mode: 'top' });
    const boxA = computeLayerWorldBBox(
      sceneLayers().find((layer) => layer.id === firstId)!
    );
    const boxB = computeLayerWorldBBox(
      sceneLayers().find((layer) => layer.id === secondId)!
    );
    expect(Math.round(boxA.y)).toBe(Math.round(boxB.y));

    exec('apply_palette', {
      colors: ['#da7756', '#2f5d62'],
      includeBackground: true,
    });
    expect((sceneLayers().find((layer) => layer.id === firstId) as PathLayer).fill).toBe(
      '#da7756'
    );
    expect((sceneLayers().find((layer) => layer.id === secondId) as PathLayer).fill).toBe(
      '#2f5d62'
    );
    expect(useEditorStore.getState().scene.background).toBe('#da7756');

    const copies = exec('duplicate_layers', { layerIds: [firstId], offsetX: 20, offsetY: 20 });
    expect(Array.isArray(copies.createdLayerIds)).toBe(true);
    expect(sceneLayers()).toHaveLength(3);

    exec('delete_layers', { layerIds: [firstId, secondId] });
    expect(sceneLayers()).toHaveLength(1);
  });

  it('applies clip masks and boolean operations', () => {
    const base = exec('create_shape', {
      preset: 'rect',
      x: 540,
      y: 540,
      width: 400,
      height: 300,
    });
    const mask = exec('create_shape', {
      preset: 'ellipse',
      x: 500,
      y: 500,
      width: 200,
      height: 200,
    });
    const baseId = String(base.layerId);
    const maskId = String(mask.layerId);

    exec('set_clip_mask', { maskLayerId: maskId, targetLayerIds: [baseId] });
    let masked = sceneLayers().find((layer) => layer.id === baseId)!;
    expect(masked.clipMaskId).toBe(maskId);
    const maskLayer = sceneLayers().find((layer) => layer.id === maskId) as PathLayer;
    expect(maskLayer.isClipMask).toBe(true);

    exec('set_clip_mask', { maskLayerId: null, targetLayerIds: [baseId] });
    masked = sceneLayers().find((layer) => layer.id === baseId)!;
    expect(masked.clipMaskId).toBeUndefined();

    const union = exec('boolean_op', {
      layerIds: [baseId, maskId],
      operation: 'unite',
    });
    expect(sceneLayers()).toHaveLength(1);
    expect(String(union.layerId)).not.toBe(baseId);
  });
});

describe('AI provider adapters', () => {
  const baseMessages = [{ role: 'user' as const, text: 'Сделай круг' }];

  it('builds Gemini requests and parses function calls', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const send = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'gemini', geminiApiKey: 'gem-key' },
      async (input, init) => {
        calls.push({ url: String(input), init });
        return jsonResponse({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Создаю ' },
                  {
                    functionCall: {
                      name: 'create_shape',
                      args: { preset: 'ellipse', x: 10, y: 20, width: 30, height: 40 },
                    },
                  },
                ],
              },
            },
          ],
        });
      }
    );

    const reply = await send({
      system: 'system',
      messages: baseMessages,
      tools: TOOL_DEFINITIONS,
    });

    expect(reply.text).toBe('Создаю');
    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0].name).toBe('create_shape');
    expect(reply.toolCalls[0].args.width).toBe(30);

    const body = JSON.parse(String(calls[0].init?.body));
    expect(calls[0].url).toContain('gemini-2.5-flash:generateContent');
    expect((calls[0].init?.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'gem-key'
    );
    expect(body.tools[0].functionDeclarations).toHaveLength(12);
    expect(body.systemInstruction.parts[0].text).toBe('system');
  });

  it('builds OpenAI-compatible requests and parses tool_calls', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const send = createSendChat(
      {
        ...DEFAULT_AI_CONFIG,
        provider: 'openai',
        openaiBaseUrl: 'https://api.example.com/v1/',
        openaiApiKey: 'sk-test',
      },
      async (input, init) => {
        calls.push({ url: String(input), init });
        return jsonResponse({
          choices: [
            {
              message: {
                content: 'Готово',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'create_text',
                      arguments: '{"content":"Locus","x":10,"y":20}',
                    },
                  },
                ],
              },
            },
          ],
        });
      }
    );

    const reply = await send({
      system: 'system',
      messages: [
        ...baseMessages,
        {
          role: 'assistant',
          text: '',
          toolCalls: [
            {
              id: 'prev_1',
              name: 'create_text',
              args: { content: 'Locus', x: 10, y: 20 },
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'prev_1',
          name: 'create_text',
          content: '{"ok":true}',
        },
      ],
      tools: TOOL_DEFINITIONS,
    });

    expect(reply.text).toBe('Готово');
    expect(reply.toolCalls[0].args.content).toBe('Locus');
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test'
    );
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.tools[0].type).toBe('function');
    expect(body.messages.at(-1).tool_call_id).toBe('prev_1');
  });

  it('builds Anthropic requests and parses tool_use blocks', async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const send = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'anthropic', anthropicApiKey: 'ant-key' },
      async (input, init) => {
        captured.url = String(input);
        captured.init = init;
        return jsonResponse({
          content: [
            { type: 'text', text: 'Сейчас' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'align_layers',
              input: { mode: 'artboard_center' },
            },
          ],
        });
      }
    );

    const reply = await send({
      system: 'system',
      messages: baseMessages,
      tools: TOOL_DEFINITIONS,
    });

    expect(reply.text).toBe('Сейчас');
    expect(reply.toolCalls[0].name).toBe('align_layers');
    expect(reply.toolCalls[0].args.mode).toBe('artboard_center');
    const body = JSON.parse(String(captured.init?.body));
    expect(body.tools[0].input_schema.type).toBe('object');
    expect(body.system).toBe('system');
    expect((captured.init?.headers as Record<string, string>)['x-api-key']).toBe(
      'ant-key'
    );
  });

  it('builds Ollama requests and parses message tool calls', async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const send = createSendChat(
      {
        ...DEFAULT_AI_CONFIG,
        provider: 'ollama',
        ollamaBaseUrl: 'http://localhost:11434/v1',
        ollamaModel: 'qwen2.5-coder:7b',
      },
      async (input, init) => {
        captured.url = String(input);
        captured.init = init;
        return jsonResponse({
          message: {
            content: '',
            tool_calls: [
              {
                function: {
                  name: 'create_blob',
                  arguments: { x: 100, y: 100, radius: 80 },
                },
              },
            ],
          },
        });
      }
    );

    const reply = await send({
      system: 'system',
      messages: baseMessages,
      tools: TOOL_DEFINITIONS,
    });

    expect(reply.toolCalls[0].name).toBe('create_blob');
    expect(reply.toolCalls[0].args.radius).toBe(80);
    expect(captured.url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(String(captured.init?.body));
    expect(body.stream).toBe(false);
    expect(body.tools[0].function.name).toBe('create_blob');
  });

  it('surfaces provider error messages', async () => {
    const send = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'gemini', geminiApiKey: 'bad-key' },
      async () => jsonResponse({ error: { message: 'API key not valid' } }, 400)
    );

    await expect(
      send({ system: 's', messages: baseMessages, tools: TOOL_DEFINITIONS })
    ).rejects.toThrow('API key not valid');
  });

  it('validates provider configuration', () => {
    expect(getAiProviderIssue({ ...DEFAULT_AI_CONFIG, provider: 'gemini' })).toContain(
      'Gemini API Key'
    );
    expect(
      getAiProviderIssue({
        ...DEFAULT_AI_CONFIG,
        provider: 'openai',
        openaiBaseUrl: 'http://localhost:1234/v1',
        openaiApiKey: '',
      })
    ).toBeNull();
    expect(
      getAiProviderIssue({ ...DEFAULT_AI_CONFIG, provider: 'ollama' })
    ).toBeNull();
    expect(getAiModelLabel({ ...DEFAULT_AI_CONFIG, provider: 'ollama' })).toContain(
      'Ollama'
    );
  });
});

describe('AI executor', () => {
  beforeEach(() => {
    resetDocument();
  });

  it('runs a multi-step tool loop and collapses it into one undo step', async () => {
    const before = useEditorStore.getState().scene;
    const replies: AiProviderReply[] = [
      {
        text: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'create_shape',
            args: { preset: 'ellipse', x: 540, y: 540, width: 300, height: 300 },
          },
        ],
      },
      {
        text: 'Дальше добавлю текст',
        toolCalls: [
          {
            id: 'c2',
            name: 'create_text',
            args: { content: 'Locus', x: 300, y: 200, fontSize: 72 },
          },
        ],
      },
      { text: 'Готово: круг и заголовок.', toolCalls: [] },
    ];
    const seen: number[] = [];
    const sendChat: AiSendChat = async (request) => {
      seen.push(request.messages.length);
      const next = replies.shift();
      if (!next) throw new Error('Сценарий закончился');
      return next;
    };
    const events: AiRunEvent[] = [];

    const result = await runAiCommand({
      prompt: 'Сделай круг и заголовок',
      ai: DEFAULT_AI_CONFIG,
      sendChat,
      onEvent: (event) => events.push(event),
    });

    expect(result.text).toBe('Готово: круг и заголовок.');
    expect(result.steps).toBe(3);
    expect(result.toolCalls).toHaveLength(2);
    expect(sceneLayers()).toHaveLength(2);
    expect(events.filter((event) => event.type === 'tool')).toHaveLength(2);
    expect(seen).toEqual([1, 3, 5]);

    const temporal = useEditorStore.temporal.getState();
    expect(temporal.pastStates).toHaveLength(1);

    undoCommand();
    expect(useEditorStore.getState().scene).toBe(before);
  });

  it('stops on abort without recording history', async () => {
    const controller = new AbortController();
    controller.abort();
    const sendChat: AiSendChat = async () => {
      throw new Error('не должен вызываться');
    };

    let caught: unknown = null;
    try {
      await runAiCommand({
        prompt: 'Сделай что-нибудь',
        ai: DEFAULT_AI_CONFIG,
        sendChat,
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }

    expect(isAbortError(caught)).toBe(true);
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(0);
  });

  it('records failed tool calls and still returns the assistant answer', async () => {
    const sendChat: AiSendChat = async () => ({
      text: '',
      toolCalls: [
        {
          id: 'bad',
          name: 'update_layers',
          args: { layerIds: ['missing'], patch: { fill: '#ffffff' } },
        },
      ],
    });

    const result = await runAiCommand({
      prompt: 'Покрась слой',
      ai: DEFAULT_AI_CONFIG,
      sendChat,
      maxSteps: 1,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].ok).toBe(false);
    expect(result.text).toContain('Готово');
  });
});

describe('AI scene context', () => {
  beforeEach(() => {
    resetDocument();
  });

  it('describes layers with world bboxes and text metrics', () => {
    exec('create_text', {
      content: 'Привет',
      x: 200,
      y: 100,
      fontSize: 48,
      fill: '#1c1b1a',
    });
    const layer = sceneLayers()[0] as TextLayer;
    const context = buildSceneContext(useEditorStore.getState().scene, [layer.id]);

    expect(context.artboard.width).toBe(1080);
    expect(context.selectedIds).toEqual([layer.id]);
    expect(context.layers[0]).toMatchObject({
      id: layer.id,
      type: 'text',
      content: 'Привет',
      fontSize: 48,
      fill: '#1c1b1a',
    });
    expect(context.layers[0].bbox.width).toBeGreaterThan(0);
    expect(context.layers[0].bbox.height).toBeGreaterThan(0);
  });
});
