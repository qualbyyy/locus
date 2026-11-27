import type { ToolDefinition } from '../types';
import { CREATE_TOOLS } from './createTools';
import { DOCUMENT_TOOLS } from './documentTools';
import { LAYER_TOOLS } from './layerTools';
import { TRANSFORM_TOOLS } from './transformTools';
import { type ToolHandler, type ToolSpec, isRecord, normalizeHexColor } from './validation';
import { VECTOR_TOOLS } from './vectorTools';

export { normalizeHexColor };

// report_plan держим первым элементом TOOL_DEFINITIONS — SYSTEM_PROMPT требует его вызова в начале.
const ALL_TOOLS: ToolSpec[] = [
  ...DOCUMENT_TOOLS,
  ...CREATE_TOOLS,
  ...LAYER_TOOLS,
  ...TRANSFORM_TOOLS,
  ...VECTOR_TOOLS,
];

export const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  ALL_TOOLS.map((spec) => [spec.definition.name, spec.label])
);

const TOOL_HANDLERS: Record<string, ToolHandler> = Object.fromEntries(
  ALL_TOOLS.map((spec) => [spec.definition.name, spec.handler])
);

export const TOOL_DEFINITIONS: ToolDefinition[] = ALL_TOOLS.map((spec) => spec.definition);

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name);
}

export type ToolExecutionResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

export function executeTool(
  name: string,
  rawArgs: Record<string, unknown>
): ToolExecutionResult {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { ok: false, error: `Неизвестный инструмент «${name}»` };
  }
  if (!isRecord(rawArgs)) {
    return { ok: false, error: `${name}: аргументы должны быть объектом` };
  }
  try {
    return { ok: true, result: handler(rawArgs) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Не удалось выполнить инструмент',
    };
  }
}
