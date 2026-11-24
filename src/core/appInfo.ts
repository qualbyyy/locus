import packageJson from '../../package.json';

export interface AppInfo {
  name: string;
  version: string;
  build: string;
  license: string;
  creator: string;
  contacts: string;
  description: string;
  documentation: string;
  repository: string;
  issues: string;
  thirdParty: string;
}

const unavailable = 'Не указано';
const packageMetadata = packageJson as { version?: string; license?: string };

export const APP_INFO: AppInfo = {
  name: 'Locus',
  version: packageMetadata.version || unavailable,
  build: 'Tauri / React',
  license: packageMetadata.license || unavailable,
  creator: unavailable,
  contacts: unavailable,
  description: 'Локальный редактор векторной графики с автоматизацией рутинных задач.',
  documentation: unavailable,
  repository: unavailable,
  issues: unavailable,
  thirdParty: 'React, Paper.js, Zustand, Tauri и другие компоненты проекта.',
};

export interface RuntimeDiagnostics {
  appVersion: string;
  platform: string;
  userAgent: string;
  mode: string;
}

export function getRuntimeDiagnostics(): RuntimeDiagnostics {
  const nav = globalThis.navigator;
  const win = globalThis.window as (Window & { __TAURI_INTERNALS__?: unknown }) | undefined;
  return {
    appVersion: APP_INFO.version,
    platform: nav?.platform || unavailable,
    userAgent: nav?.userAgent || unavailable,
    mode: win && '__TAURI_INTERNALS__' in win ? 'Tauri' : 'Browser',
  };
}

export function formatDiagnostics(runtime: RuntimeDiagnostics): string {
  return [
    `Locus ${runtime.appVersion}`,
    `Платформа: ${runtime.platform}`,
    `Режим: ${runtime.mode}`,
    `User agent: ${runtime.userAgent}`,
  ].join('\n');
}
