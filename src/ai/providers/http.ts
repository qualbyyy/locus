export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractPayloadError(payload: Record<string, unknown>): string | null {
  const error = payload.error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  if (
    payload.type === 'error' &&
    typeof payload.message === 'string' &&
    payload.message.trim()
  ) {
    return payload.message.trim();
  }
  return null;
}

export async function readJsonResponse(
  response: Response,
  providerLabel: string
): Promise<unknown> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`${providerLabel} вернул пустой ответ`);
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(
      `${providerLabel} вернул некорректный JSON: ${trimmed.slice(0, 160)}`
    );
  }
}

export async function readHttpError(response: Response): Promise<string> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return `HTTP ${response.status}`;
  }
  if (!text) return `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text) as unknown;
    if (isRecord(payload)) {
      const error = payload.error;
      if (typeof error === 'string' && error.trim()) return error;
      if (isRecord(error) && typeof error.message === 'string') {
        return error.message;
      }
      if (typeof payload.message === 'string') return payload.message;
    }
  } catch {
    // Fall through to the plain text excerpt.
  }
  return `HTTP ${response.status}: ${text.slice(0, 240)}`;
}

export function parseArgsObject(
  raw: unknown,
  toolName: string
): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (isRecord(raw)) return raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Reported as a readable error below.
    }
  }
  throw new Error(
    `Модель вернула некорректные аргументы инструмента «${toolName}» (ожидался JSON-объект)`
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}
