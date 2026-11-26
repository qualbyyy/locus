import type { DragDropEvent } from '@tauri-apps/api/webview';

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  name: string;
  path?: string;
  bytes: Uint8Array;
}

export interface SaveFileOptions {
  defaultName: string;
  filters?: FileFilter[];
  currentPath?: string;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function httpFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return globalThis.fetch(input, init);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Поддерживаются только ссылки http и https');
  }
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  globalThis.open(url, '_blank', 'noopener,noreferrer');
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  if (!isTauri()) {
    throw new Error('Чтение локальных путей доступно только в приложении Locus');
  }
  const { readFile } = await import('@tauri-apps/plugin-fs');
  return readFile(path);
}

export async function pickOpenFile(options?: {
  title?: string;
  filters?: FileFilter[];
}): Promise<OpenedFile | null> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        title: options?.title,
        multiple: false,
        directory: false,
        filters: options?.filters,
      });
      if (typeof selected !== 'string') {
        return null;
      }
      const bytes = await readFileBytes(selected);
      const name = selected.split(/[\\/]/).pop() || 'file';
      return { name, path: selected, bytes };
    } catch (err) {
      console.warn(
        'Locus: не удалось прочитать файл через fs, пробуем file input',
        err
      );
      return pickOpenFileViaInput(options);
    }
  }

  return pickOpenFileViaInput(options);
}

async function pickOpenFileViaInput(options?: {
  title?: string;
  filters?: FileFilter[];
}): Promise<OpenedFile | null> {
  if (typeof document === 'undefined') {
    return null;
  }

  return new Promise<OpenedFile | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options?.filters?.length) {
      input.accept = options.filters
        .flatMap((filter) => filter.extensions.map((ext) => `.${ext}`))
        .join(',');
    }

    let settled = false;
    const finish = (value: OpenedFile | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', handleFocusBack);
      resolve(value);
    };

    const handleFocusBack = () => {
      setTimeout(() => {
        if (!settled && !input.files?.length) {
          finish(null);
        }
      }, 300);
    };

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      finish({ name: file.name, bytes });
    };

    window.addEventListener('focus', handleFocusBack, { once: true });
    input.click();
  });
}

export async function saveFileBytes(
  data: Uint8Array,
  options: SaveFileOptions
): Promise<string | null> {
  if (isTauri()) {
    let targetPath = options.currentPath;
    if (!targetPath) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const selected = await save({
        defaultPath: options.defaultName,
        filters: options.filters,
      });
      if (!selected) {
        return null;
      }
      targetPath = selected;
    }
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(targetPath, data);
    return targetPath;
  }

  if (typeof document !== 'undefined') {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const blob = new Blob([copy.buffer]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = options.defaultName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return options.defaultName;
}

const MEMORY_CONFIG_FALLBACK = new Map<string, string>();
const MEMORY_BYTES_FALLBACK = new Map<string, Uint8Array>();

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function readAppConfigBytes(relPath: string): Promise<Uint8Array | null> {
  if (isTauri()) {
    const { BaseDirectory, exists, readFile } = await import('@tauri-apps/plugin-fs');
    const found = await exists(relPath, { baseDir: BaseDirectory.AppConfig });
    if (!found) return null;
    return readFile(relPath, { baseDir: BaseDirectory.AppConfig });
  }

  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(`locus-bytes:${relPath}`);
    return raw ? base64ToBytes(raw) : null;
  }
  return MEMORY_BYTES_FALLBACK.get(relPath) ?? null;
}

async function ensureAppConfigDir(relPath: string): Promise<void> {
  const { BaseDirectory, mkdir } = await import('@tauri-apps/plugin-fs');
  const parts = relPath.split('/').filter(Boolean);
  const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  await mkdir(dir, { baseDir: BaseDirectory.AppConfig, recursive: true });
}

export async function writeAppConfigBytes(
  relPath: string,
  data: Uint8Array
): Promise<void> {
  if (isTauri()) {
    const { BaseDirectory, writeFile } = await import('@tauri-apps/plugin-fs');
    await ensureAppConfigDir(relPath);
    await writeFile(relPath, data, { baseDir: BaseDirectory.AppConfig });
    return;
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`locus-bytes:${relPath}`, bytesToBase64(data));
    return;
  }
  MEMORY_BYTES_FALLBACK.set(relPath, data);
}

export async function readAppConfigText(relPath: string): Promise<string | null> {
  if (isTauri()) {
    const { BaseDirectory, exists, readTextFile } = await import('@tauri-apps/plugin-fs');
    const found = await exists(relPath, { baseDir: BaseDirectory.AppConfig });
    if (!found) {
      return null;
    }
    return readTextFile(relPath, { baseDir: BaseDirectory.AppConfig });
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(`locus:${relPath}`);
  }
  return MEMORY_CONFIG_FALLBACK.get(relPath) ?? null;
}

export async function writeAppConfigText(
  relPath: string,
  content: string
): Promise<void> {
  if (isTauri()) {
    const { BaseDirectory, writeTextFile } = await import('@tauri-apps/plugin-fs');
    await ensureAppConfigDir(relPath);
    await writeTextFile(relPath, content, { baseDir: BaseDirectory.AppConfig });
    return;
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`locus:${relPath}`, content);
    return;
  }
  MEMORY_CONFIG_FALLBACK.set(relPath, content);
}

export async function removeAppConfigFile(relPath: string): Promise<void> {
  if (isTauri()) {
    const { BaseDirectory, remove } = await import('@tauri-apps/plugin-fs');
    await remove(relPath, { baseDir: BaseDirectory.AppConfig }).catch(() => {});
    return;
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(`locus:${relPath}`);
    return;
  }
  MEMORY_CONFIG_FALLBACK.delete(relPath);
}

export async function takeLaunchFile(): Promise<OpenedFile | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const payload = await invoke<{
      name: string;
      path: string;
      bytes: number[];
    } | null>('take_launch_file');
    if (!payload) return null;
    return {
      name: payload.name,
      path: payload.path,
      bytes: new Uint8Array(payload.bytes),
    };
  } catch {
    return null;
  }
}

export async function subscribeFileDrop(
  onDrop: (paths: string[]) => void,
  onHoverChange?: (hovering: boolean) => void
): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }

  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const unlisten = await getCurrentWebview().onDragDropEvent(
    (event: { payload: DragDropEvent }) => {
      const payload = event.payload;
      if (payload.type === 'enter' || payload.type === 'over') {
        onHoverChange?.(true);
      } else if (payload.type === 'leave') {
        onHoverChange?.(false);
      } else if (payload.type === 'drop') {
        onHoverChange?.(false);
        if (payload.paths.length > 0) {
          onDrop(payload.paths);
        }
      }
    }
  );
  return unlisten;
}
