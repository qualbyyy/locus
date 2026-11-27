import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pickOpenFileMock = vi.hoisted(() => vi.fn());

vi.mock('../src/platform/io', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/platform/io')>();
  return {
    ...actual,
    pickOpenFile: (...args: Parameters<typeof actual.pickOpenFile>) =>
      pickOpenFileMock.getMockImplementation()
        ? pickOpenFileMock(...args)
        : actual.pickOpenFile(...args),
  };
});

import { runAiCommand } from '../src/ai/executor';
import { recolorSceneWithPalette } from '../src/ai/palette';
import { runPreflightCheck } from '../src/ai/preflight';
import { createSendChat } from '../src/ai/providers';
import { TOOL_DEFINITIONS, executeTool } from '../src/ai/registry';
import { useAiTaskStore } from '../src/ai/taskStore';
import type { AiProviderReply, AiSendChat } from '../src/ai/types';
import { fetchProviderModels } from '../src/core/aiModels';
import {
  addArtboard,
  createShapeLayer,
  createTextLayer,
  groupLayers,
  resetDocument,
  updateLayers,
} from '../src/core/commands';
import { DEFAULT_AI_CONFIG, useSettingsStore } from '../src/core/settings';
import { matchShortcut } from '../src/core/shortcuts';
import { useEditorStore } from '../src/core/store';
import type { Layer, PathLayer } from '../src/core/types';
import { CommandBar } from '../src/ui/CommandBar';
import {
  HexColorRow,
  NumberField,
  TextContentField,
} from '../src/ui/InspectorControls';
import { LayersPanel } from '../src/ui/LayersPanel';
import { MenuBar, type MenuBarActions, type MenuBarState } from '../src/ui/MenuBar';
import { SettingsModal } from '../src/ui/SettingsModal';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function mountUi(node: ReturnType<typeof createElement>): {
  container: HTMLDivElement;
  root: Root;
} {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

function makeMenuProps(): { state: MenuBarState; actions: MenuBarActions } {
  const noop = () => {};
  return {
    state: {
      hasSelection: false,
      hasMultiSelection: false,
      hasPathSelection: false,
      hasTextSelection: false,
      hasImageSelection: false,
      hasGroupSelection: false,
      canAttachTextToPath: false,
      canDetachTextFromPath: false,
      canSplitTextChars: false,
      canSplitTextLines: false,
      hasEffects: false,
      canUndo: false,
      canRedo: false,
      showGrid: false,
      showRulers: false,
      showGuides: false,
      snapEnabled: true,
      snapToGuides: false,
      hasGuides: false,
      outlineMode: false,
      showToolbar: true,
      showLayers: true,
      showInspector: true,
    },
    actions: {
      onNewDocument: noop,
      onOpenDocument: noop,
      onSaveDocument: noop,
      onImportImage: noop,
      onImportSvg: noop,
      onQuickExportPng: noop,
      onOpenRasterExport: noop,
      onExportDocument: noop,
      onExportSelectionSvg: noop,
      onExportSelectionRaster: noop,
      onAddArtboard: noop,
      onOpenDocSetup: noop,
      onUndo: noop,
      onRedo: noop,
      onCut: noop,
      onCopy: noop,
      onCopySvg: noop,
      onPaste: noop,
      onDuplicate: noop,
      onDelete: noop,
      onGroup: noop,
      onUngroup: noop,
      onToggleLock: noop,
      onUploadFont: noop,
      onOpenSettings: noop,
      onOpenTutorial: noop,
      onOpenShortcuts: noop,
      onOpenAbout: noop,
      onRotateBy: noop,
      onFlip: noop,
      onReorder: noop,
      onBooleanOp: noop,
      onOffsetPath: noop,
      onOutlineStroke: noop,
      onSimplifyPath: noop,
      onCreateClipMask: noop,
      onExpandAppearance: noop,
      onTraceImage: noop,
      onConvertToOutlines: noop,
      onAttachTextToPath: noop,
      onDetachTextFromPath: noop,
      onCreateCircleText: noop,
      onSplitText: noop,
      onTransformTextCase: noop,
      onSelectAll: noop,
      onDeselect: noop,
      onInvertSelection: noop,
      onSelectSimilar: noop,
      onOpenEffect: noop,
      onClearEffects: noop,
      onZoomIn: noop,
      onZoomOut: noop,
      onFitArtboard: noop,
      onZoomToSelection: noop,
      onResetZoom100: noop,
      onToggleGrid: noop,
      onToggleRulers: noop,
      onToggleGuides: noop,
      onToggleSnap: noop,
      onToggleSnapToGuides: noop,
      onClearGuides: noop,
      onToggleOutline: noop,
      onToggleToolbar: noop,
      onToggleLayers: noop,
      onToggleInspector: noop,
      onOpenCommandBar: noop,
      onRunPreflight: noop,
    },
  };
}

describe('Phase 4 regressions: AI providers, executor, registry, shortcuts, UI', () => {
  beforeEach(() => {
    resetDocument({
      name: 'Stage 4',
      width: 1080,
      height: 1080,
      dpi: 72,
      background: '#ffffff',
    });
    useAiTaskStore.getState().reset();
    useSettingsStore.getState().resetSettings();
    useEditorStore.getState().setDefaultFill('#1c1b1a');
    pickOpenFileMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('handles OpenAI JSON fallback with onToken, mid-stream error with reader.cancel, UTF-8 flush, and non-JSON 200', async () => {
    const baseMessages = [{ role: 'user' as const, text: 'Тест' }];

    // 1. JSON response with content-type application/json when onToken is provided
    const tokensA: string[] = [];
    const sendJsonFallback = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'openai', openaiApiKey: 'sk-test' },
      async () =>
        jsonResponse({
          choices: [{ message: { content: 'Обычный JSON' }, finish_reason: 'stop' }],
        })
    );
    const replyA = await sendJsonFallback({
      system: 's',
      messages: baseMessages,
      tools: TOOL_DEFINITIONS,
      onToken: (d) => tokensA.push(d),
    });
    expect(replyA.text).toBe('Обычный JSON');
    expect(tokensA.join('')).toBe('Обычный JSON');

    // 2. Non-SSE JSON body even with text/event-stream content-type
    const tokensB: string[] = [];
    const sendStreamJsonFallback = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'openai', openaiApiKey: 'sk-test' },
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'JSON без SSE' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
    );
    const replyB = await sendStreamJsonFallback({
      system: 's',
      messages: baseMessages,
      tools: TOOL_DEFINITIONS,
      onToken: (d) => tokensB.push(d),
    });
    expect(replyB.text).toBe('JSON без SSE');
    expect(tokensB.join('')).toBe('JSON без SSE');

    // 3. Mid-stream error cancels reader
    let cancelled = false;
    const encoder = new TextEncoder();
    const sendMidError = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'openai', openaiApiKey: 'sk-test' },
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode('data: {"choices":[{"delta":{"content":"Часть"}}]}\n\n')
              );
              controller.enqueue(
                encoder.encode('data: {"error":{"message":"Quota exceeded"}}\n\n')
              );
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
    );
    await expect(
      sendMidError({
        system: 's',
        messages: baseMessages,
        tools: TOOL_DEFINITIONS,
        onToken: () => {},
      })
    ).rejects.toThrow('Quota exceeded');
    expect(cancelled).toBe(true);

    // 4. Multibyte UTF-8 split across chunks without trailing newline flushes cleanly
    const sseLine = encoder.encode(
      'data: {"choices":[{"delta":{"content":"Привет мир"}}]}'
    );
    const splitAt = sseLine.indexOf(0xd0) + 1; // split inside multi-byte Cyrillic char
    const sendUtf8Split = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'openai', openaiApiKey: 'sk-test' },
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(sseLine.slice(0, splitAt));
              controller.enqueue(sseLine.slice(splitAt));
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
    );
    const replyUtf8 = await sendUtf8Split({
      system: 's',
      messages: baseMessages,
      tools: TOOL_DEFINITIONS,
      onToken: () => {},
    });
    expect(replyUtf8.text).toBe('Привет мир');

    // 5. HTML / non-JSON HTTP 200 gives readable error
    const sendHtml = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'openai', openaiApiKey: 'sk-test' },
      async () =>
        new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
    );
    await expect(
      sendHtml({
        system: 's',
        messages: baseMessages,
        tools: TOOL_DEFINITIONS,
      })
    ).rejects.toThrow('некорректный JSON');
  });

  it('rejects max_tokens truncation across OpenAI, Anthropic, and Gemini, and keeps Gemini model-fetch key in header', async () => {
    const baseMessages = [{ role: 'user' as const, text: 'Тест' }];

    const openaiTrunc = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'openai', openaiApiKey: 'k' },
      async () =>
        jsonResponse({
          choices: [{ message: { content: 'Неполный' }, finish_reason: 'length' }],
        })
    );
    await expect(
      openaiTrunc({ system: 's', messages: baseMessages, tools: TOOL_DEFINITIONS })
    ).rejects.toThrow('лимиту токенов');

    const anthropicTrunc = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'anthropic', anthropicApiKey: 'k' },
      async () =>
        jsonResponse({
          stop_reason: 'max_tokens',
          content: [{ type: 'text', text: 'Обрезано' }],
        })
    );
    await expect(
      anthropicTrunc({ system: 's', messages: baseMessages, tools: TOOL_DEFINITIONS })
    ).rejects.toThrow('лимиту токенов');

    const geminiTrunc = createSendChat(
      { ...DEFAULT_AI_CONFIG, provider: 'gemini', geminiApiKey: 'k' },
      async () =>
        jsonResponse({
          candidates: [
            { finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Обрезано' }] } },
          ],
        })
    );
    await expect(
      geminiTrunc({ system: 's', messages: baseMessages, tools: TOOL_DEFINITIONS })
    ).rejects.toThrow('лимиту токенов');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        models: [
          { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] },
        ],
      })
    );
    const models = await fetchProviderModels({
      ...DEFAULT_AI_CONFIG,
      provider: 'gemini',
      geminiApiKey: 'secret-gem-key',
    });
    expect(models).toEqual(['gemini-4-hydrogen']);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
    expect(String(calledUrl)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models'
    );
    expect(String(calledUrl)).not.toContain('secret-gem-key');
    expect((calledInit?.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'secret-gem-key'
    );

    const ac = new AbortController();
    ac.abort();
    await expect(
      fetchProviderModels(
        { ...DEFAULT_AI_CONFIG, provider: 'gemini', geminiApiKey: 'secret-gem-key' },
        ac.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('allows step 2 after report_plan({ steps: 1 }) and manages taskStore undo/streamText safely', async () => {
    const replies: AiProviderReply[] = [
      {
        text: '',
        toolCalls: [{ id: 'p1', name: 'report_plan', args: { steps: 1, summary: '1 шаг' } }],
      },
      {
        text: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'create_shape',
            args: { preset: 'rect', x: 200, y: 200, width: 100, height: 100 },
          },
        ],
      },
      { text: 'Готово', toolCalls: [] },
    ];
    const sendChat: AiSendChat = async () => replies.shift()!;
    const res = await runAiCommand({
      prompt: 'Сделай прямоугольник',
      ai: DEFAULT_AI_CONFIG,
      sendChat,
    });
    expect(res.steps).toBe(2);
    expect(useEditorStore.getState().scene.layers).toHaveLength(1);

    // taskStore: error after partial mutation preserves canUndo and reverts cleanly
    resetDocument({ name: 'TaskStore', width: 800, height: 600, dpi: 72 });
    const settings = useSettingsStore.getState().settings;
    useSettingsStore.setState({
      settings: {
        ...settings,
        ai: { ...settings.ai, provider: 'openai', openaiApiKey: 'sk-task' },
      },
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tc_1',
                    type: 'function',
                    function: {
                      name: 'create_shape',
                      arguments: '{"preset":"rect","x":120,"y":120,"width":80,"height":80}',
                    },
                  },
                ],
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Boom' } }, 500));

    await useAiTaskStore.getState().start('Нарисуй и упади');
    expect(useAiTaskStore.getState().status).toBe('error');
    expect(useAiTaskStore.getState().canUndo).toBe(true);
    expect(useEditorStore.getState().scene.layers).toHaveLength(1);

    useAiTaskStore.getState().revertLastRun();
    expect(useEditorStore.getState().scene.layers).toHaveLength(0);
    expect(useAiTaskStore.getState().canUndo).toBe(false);

    // Manual edit after AI completes clears canUndo and blocks revertLastRun
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tc_2',
                    type: 'function',
                    function: {
                      name: 'create_shape',
                      arguments: '{"preset":"ellipse","x":150,"y":150,"width":60,"height":60}',
                    },
                  },
                ],
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: 'Готово' }, finish_reason: 'stop' }],
        })
      );

    await useAiTaskStore.getState().start('Круг');
    expect(useAiTaskStore.getState().canUndo).toBe(true);
    createShapeLayer({ preset: 'rect', x: 300, y: 300, width: 40, height: 40 });
    expect(useAiTaskStore.getState().canUndo).toBe(false);
    useAiTaskStore.getState().revertLastRun();
    expect(useEditorStore.getState().scene.layers).toHaveLength(2);

    // streamText separates across steps without duplicating separator on report_plan
    resetDocument();
    const encoder = new TextEncoder();
    const streamSeen: string[] = [];
    const unsub = useAiTaskStore.subscribe((st) => {
      if (st.streamText) streamSeen.push(st.streamText);
    });
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"Думаю..."}}]}\n\n'
                )
              );
              c.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"rp","function":{"name":"report_plan","arguments":"{\\"steps\\":2,\\"summary\\":\\"План\\"}"}},{"index":1,"id":"cs","function":{"name":"create_shape","arguments":"{\\"preset\\":\\"rect\\",\\"x\\":100,\\"y\\":100,\\"width\\":50,\\"height\\":50}"}}]}}]}\n\n'
                )
              );
              c.enqueue(encoder.encode('data: [DONE]\n\n'));
              c.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"Делаю дальше"}}]}\n\n'
                )
              );
              c.enqueue(encoder.encode('data: [DONE]\n\n'));
              c.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
      );

    await useAiTaskStore.getState().start('Поток');
    unsub();
    expect(streamSeen.at(-1)).toBe('Думаю...\n\nДелаю дальше');
  });

  it('validates registry tools, group geometry, active artboard, hidden groups in preflight/palette, and defaultFill isolation', () => {
    const shape = createShapeLayer({
      preset: 'rect',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      fill: '#da7756',
    });
    const txt = createTextLayer({
      content: 'Привет',
      x: 100,
      y: 100,
      fontSize: 32,
      fill: '#1c1b1a',
    });

    // recolor_palette strict types
    expect(
      executeTool('recolor_palette', {
        palette: ['#ffffff', '#000000'],
        includeBackground: 'false',
      }).ok
    ).toBe(false);
    expect(
      executeTool('recolor_palette', {
        palette: ['#ffffff', '#000000'],
        layerIds: shape.id,
      }).ok
    ).toBe(false);

    // set_clip_mask clears on null / "null" / "" / "none"
    for (const clearVal of [null, 'null', '', 'none']) {
      expect(
        executeTool('set_clip_mask', { maskLayerId: shape.id, targetLayerIds: [txt.id] }).ok
      ).toBe(true);
      expect(
        executeTool('set_clip_mask', { maskLayerId: clearVal, targetLayerIds: [txt.id] }).ok
      ).toBe(true);
      expect(
        useEditorStore.getState().scene.layers.find((l) => l.id === txt.id)?.clipMaskId
      ).toBeUndefined();
    }

    // update_layers clamps scaleX: 0 via safeScale and rejects fill: null on TextLayer
    expect(
      executeTool('update_layers', { layerIds: [shape.id], patch: { scaleX: 0 } }).ok
    ).toBe(true);
    const scaled = useEditorStore.getState().scene.layers.find((l) => l.id === shape.id)!;
    expect(scaled.scaleX).not.toBe(0);
    expect(
      executeTool('update_layers', { layerIds: [txt.id], patch: { fill: null } }).ok
    ).toBe(false);

    // get_layer_geometry returns world bbox reflecting parent group transform
    const grp = groupLayers([shape.id])!;
    updateLayers([grp.id], { x: grp.x + 250, y: grp.y + 120 });
    const geomRes = executeTool('get_layer_geometry', { layerIds: [shape.id] });
    expect(geomRes.ok).toBe(true);
    if (geomRes.ok) {
      const layers = geomRes.result.layers as Array<{
        bbox: { x: number; y: number };
        world: { x: number; y: number };
      }>;
      expect(Math.round(layers[0].bbox.x)).toBeGreaterThan(250);
      expect(Math.round(layers[0].world.x)).toBe(350);
    }

    // set_artboard returns active artboard #2 dimensions
    const ab2 = addArtboard({ width: 1200, height: 900, background: '#f5f2eb' });
    expect(useEditorStore.getState().activeArtboardId).toBe(ab2.id);
    const abRes = executeTool('set_artboard', { width: 1400, background: '#112233' });
    expect(abRes.ok).toBe(true);
    if (abRes.ok) {
      expect((abRes.result.artboard as { width: number; background: string }).width).toBe(
        1400
      );
      expect(
        (abRes.result.artboard as { width: number; background: string }).background
      ).toBe('#112233');
    }

    // Lock and missing ID checks for apply_palette, randomize_anchors, text_case, round_corners
    updateLayers([shape.id, txt.id], { locked: true });
    expect(executeTool('apply_palette', { layerIds: ['missing'], colors: ['#111111'] }).ok).toBe(false);
    expect(executeTool('apply_palette', { layerIds: [shape.id], colors: ['#111111'] }).ok).toBe(false);
    expect(executeTool('randomize_anchors', { layerIds: [shape.id], intensity: 5 }).ok).toBe(false);
    expect(executeTool('text_case', { layerIds: [txt.id], mode: 'upper' }).ok).toBe(false);
    expect(executeTool('round_corners', { layerIds: [shape.id], radius: 4 }).ok).toBe(false);

    // Preflight ignores hidden group children (both outside bounds and as text background)
    resetDocument({ name: 'HiddenGroup', width: 800, height: 600, dpi: 72, background: '#ffffff' });
    const hiddenOutside = createShapeLayer({
      preset: 'rect',
      x: -500,
      y: -500,
      width: 100,
      height: 100,
      fill: '#000000',
    });
    const hiddenBg = createShapeLayer({
      preset: 'rect',
      x: 400,
      y: 300,
      width: 500,
      height: 300,
      fill: '#111111',
    });
    const hiddenGroup = groupLayers([hiddenOutside.id, hiddenBg.id])!;
    updateLayers([hiddenGroup.id], { visible: false });
    createTextLayer({
      content: 'Тест',
      x: 400,
      y: 280,
      fontSize: 32,
      align: 'center',
      fill: '#111111',
    });
    const report = runPreflightCheck(useEditorStore.getState().scene);
    expect(report.issues).toHaveLength(0);

    // recolorSceneWithPalette ignores hidden group bg and preserves defaultFill
    useEditorStore.getState().setDefaultFill('#da7756');
    recolorSceneWithPalette(['#ffffff', '#111111']);
    expect(useEditorStore.getState().defaultFill).toBe('#da7756');
  });

  it('assigns Ctrl+Y exclusively to view.toggleOutline and keeps Ctrl+Shift+Z for edit.redo', () => {
    expect(
      matchShortcut({
        code: 'KeyY',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      })
    ).toBe('view.toggleOutline');
    expect(
      matchShortcut({
        code: 'KeyZ',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      })
    ).toBe('edit.redo');
  });

  it('commits NumberField, HexColorRow, and TextContentField only on Enter/blur and cancels cleanly on Escape', () => {
    const onNumCommit = vi.fn();
    const { container: numBox, root: numRoot } = mountUi(
      createElement(NumberField, { value: 10, onCommit: onNumCommit })
    );
    const numInput = numBox.querySelector('input')!;
    act(() => {
      numInput.focus();
      setNativeValue(numInput, '25');
    });
    expect(onNumCommit).not.toHaveBeenCalled();

    act(() => {
      numInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      numInput.blur();
    });
    expect(onNumCommit).not.toHaveBeenCalled();
    expect(numInput.value).toBe('10');

    act(() => {
      numInput.focus();
      setNativeValue(numInput, '42');
      numInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      numInput.blur();
    });
    expect(onNumCommit).toHaveBeenCalledTimes(1);
    expect(onNumCommit).toHaveBeenCalledWith(42);
    act(() => numRoot.unmount());

    const onColorChange = vi.fn();
    const { container: hexBox, root: hexRoot } = mountUi(
      createElement(HexColorRow, { value: '#112233', onChange: onColorChange })
    );
    const hexInput = hexBox.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => {
      hexInput.focus();
      setNativeValue(hexInput, '#abcdef');
    });
    expect(onColorChange).not.toHaveBeenCalled();
    act(() => {
      hexInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      hexInput.blur();
    });
    expect(onColorChange).not.toHaveBeenCalled();
    act(() => {
      hexInput.focus();
      setNativeValue(hexInput, '#445566');
      hexInput.blur();
    });
    expect(onColorChange).toHaveBeenCalledTimes(1);
    expect(onColorChange).toHaveBeenCalledWith('#445566');
    act(() => hexRoot.unmount());

    const onTextCommit = vi.fn();
    const { container: txtBox, root: txtRoot } = mountUi(
      createElement(TextContentField, { value: 'Исходный', onCommit: onTextCommit })
    );
    const textarea = txtBox.querySelector('textarea')!;
    act(() => {
      textarea.focus();
      setNativeValue(textarea, 'Отменённый');
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      textarea.blur();
    });
    expect(onTextCommit).not.toHaveBeenCalled();
    act(() => {
      textarea.focus();
      setNativeValue(textarea, 'Финальный');
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
      );
      textarea.blur();
    });
    expect(onTextCommit).toHaveBeenCalledTimes(1);
    expect(onTextCommit).toHaveBeenCalledWith('Финальный');
    act(() => txtRoot.unmount());
  });

  it('fixes LayersPanel button double-click, cross-group mask detection, and Escape rename cancel', () => {
    const mask: PathLayer = {
      id: 'mask_top',
      name: 'Маска',
      type: 'path',
      visible: true,
      locked: false,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      subpaths: [],
      fillRule: 'nonzero',
      fill: '#000000',
      stroke: null,
    };
    const groupedTarget: Layer = {
      id: 'grp_1',
      name: 'Группа',
      type: 'group',
      visible: true,
      locked: false,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      children: [
        {
          id: 'child_1',
          name: 'Внутри',
          type: 'path',
          visible: true,
          locked: false,
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          clipMaskId: 'mask_top',
          subpaths: [],
          fillRule: 'nonzero',
          fill: '#da7756',
          stroke: null,
        },
      ],
    };

    const onRenameLayer = vi.fn();
    const { container, root } = mountUi(
      createElement(LayersPanel, {
        layers: [mask, groupedTarget],
        selectedIds: [],
        onSelectLayer: vi.fn(),
        onToggleVisible: vi.fn(),
        onToggleLocked: vi.fn(),
        onRenameLayer,
        onMoveLayer: vi.fn(),
        onDeleteLayer: vi.fn(),
        onReleaseMask: vi.fn(),
      })
    );

    const maskRow = container.querySelector('[data-layer-id="mask_top"]')!;
    expect(maskRow.textContent).toContain('Mask');

    const lockBtn = maskRow.querySelector('button[title="Заблокировать"]')!;
    act(() => {
      lockBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(maskRow.querySelector('input')).toBeNull();

    act(() => {
      maskRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const renameInput = maskRow.querySelector('input')!;
    expect(renameInput).not.toBeNull();
    act(() => {
      setNativeValue(renameInput, 'Новое имя');
      renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      renameInput.blur();
    });
    expect(onRenameLayer).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('closes MenuBar on Escape while stopping propagation', () => {
    const props = makeMenuProps();
    const { container, root } = mountUi(createElement(MenuBar, props));
    const windowEscape = vi.fn();
    window.addEventListener('keydown', windowEscape);

    const fileBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Файл')
    )!;
    act(() => {
      fileBtn.click();
    });
    expect(container.textContent).toContain('Новый…');

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(container.textContent).not.toContain('Новый…');
    expect(windowEscape).not.toHaveBeenCalled();

    window.removeEventListener('keydown', windowEscape);
    act(() => root.unmount());
  });

  it('resets SettingsModal key visibility on close, keeps modal open on child Escape, and drops stale model fetches', async () => {
    const onClose = vi.fn();
    let resolveFirstFetch: ((r: Response) => void) | null = null;
    let resolveSecondFetch: ((r: Response) => void) | null = null;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirstFetch = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecondFetch = resolve;
          })
      );

    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        ai: {
          ...useSettingsStore.getState().settings.ai,
          provider: 'openai',
          openaiApiKey: 'sk-visible-test',
        },
      },
    });

    const { container, root } = mountUi(
      createElement(SettingsModal, {
        isOpen: true,
        initialTab: 'ai',
        onClose,
      })
    );

    // Toggle API key visibility to text, then close modal -> resets back to password on reopen
    const keyInput = container.querySelector('input[placeholder="sk-..."]') as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    const eyeBtn = keyInput.parentElement!.querySelector('button')!;
    act(() => {
      eyeBtn.click();
    });
    expect(keyInput.type).toBe('text');

    // Race two fetchProviderModels requests across preset switch and ensure stale response does not overwrite newer one
    const refreshBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Обновить')
    )!;
    const deepseekBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === 'DeepSeek'
    )!;
    act(() => {
      refreshBtn.click();
    });
    act(() => {
      deepseekBtn.click();
    });
    act(() => {
      refreshBtn.click();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecondFetch!(jsonResponse({ data: [{ id: 'new-model' }] }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveFirstFetch!(jsonResponse({ data: [{ id: 'stale-model' }] }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('new-model');
    expect(container.textContent).not.toContain('stale-model');

    // Switch to Tech tab and press Escape inside NumberField -> modal stays open
    const techTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Технические')
    )!;
    act(() => {
      techTab.click();
    });
    const undoField = container.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    act(() => {
      undoField.focus();
      setNativeValue(undoField, '99');
      undoField.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    });
    expect(onClose).not.toHaveBeenCalled();

    // Close and reopen SettingsModal -> API key input resets to password
    act(() => {
      root.render(
        createElement(SettingsModal, {
          isOpen: false,
          initialTab: 'ai',
          onClose,
        })
      );
    });
    act(() => {
      root.render(
        createElement(SettingsModal, {
          isOpen: true,
          initialTab: 'ai',
          onClose,
        })
      );
    });
    const reopenedKey = container.querySelector(
      'input[placeholder="sk-..."]'
    ) as HTMLInputElement;
    expect(reopenedKey.type).toBe('password');
    act(() => root.unmount());
  });

  it('consumes CommandBar preflightTrigger once and drops late handleAttach after run starts', async () => {
    const onPreflightConsumed = vi.fn();
    let resolveFilePicker: ((file: { name: string; bytes: Uint8Array } | null) => void) | null =
      null;
    pickOpenFileMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFilePicker = resolve;
        })
    );

    const { container, root } = mountUi(
      createElement(CommandBar, {
        isOpen: true,
        preflightTrigger: 1,
        onPreflightConsumed,
        onClose: vi.fn(),
      })
    );
    expect(onPreflightConsumed).toHaveBeenCalledTimes(1);

    // Re-rendering with the same preflightTrigger does not re-trigger preflight
    act(() => {
      root.render(
        createElement(CommandBar, {
          isOpen: true,
          preflightTrigger: 1,
          onPreflightConsumed,
          onClose: vi.fn(),
        })
      );
    });
    expect(onPreflightConsumed).toHaveBeenCalledTimes(1);

    // Start file attach, transition taskStore to 'running' while picker awaits, then resolve picker
    const attachBtn = container.querySelector(
      'button[aria-label="Прикрепить изображение"]'
    ) as HTMLButtonElement;
    act(() => {
      attachBtn.click();
    });
    act(() => {
      useAiTaskStore.setState({ status: 'running' });
    });

    const tinyPng = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    await act(async () => {
      resolveFilePicker!({ name: 'late.png', bytes: tinyPng });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useAiTaskStore.getState().attachments).toHaveLength(0);
    act(() => root.unmount());
  });
});
