export interface AiImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  dataBase64: string;
}

export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type AiConversationMessage =
  | { role: 'user'; text: string; images?: AiImageAttachment[] }
  | { role: 'assistant'; text: string; toolCalls: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

export interface AiChatRequest {
  system: string;
  messages: AiConversationMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
}

export interface AiProviderReply {
  text: string;
  toolCalls: AiToolCall[];
}

export type AiSendChat = (request: AiChatRequest) => Promise<AiProviderReply>;

export type AiRunEvent =
  | { type: 'step'; step: number; maxSteps: number }
  | { type: 'assistant-delta'; text: string }
  | { type: 'assistant'; text: string }
  | {
      type: 'tool';
      name: string;
      args: Record<string, unknown>;
      ok: boolean;
      summary: string;
      error?: string;
    };
