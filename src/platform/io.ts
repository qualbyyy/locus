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
  }

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
    const { BaseDirectory, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const parts = relPath.split('/').filter(Boolean);
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join('/');
      await mkdir(dir, { baseDir: BaseDirectory.AppConfig, recursive: true });
    }
    await writeTextFile(relPath, content, { baseDir: BaseDirectory.AppConfig });
    return;
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`locus:${relPath}`, content);
    return;
  }
  MEMORY_CONFIG_FALLBACK.set(relPath, content);
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
