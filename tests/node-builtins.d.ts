declare module 'node:fs/promises' {
  export function chmod(path: string, mode: number): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function stat(path: string): Promise<{ mode: number }>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  const pathApi: {
    join(...paths: string[]): string;
    dirname(p: string): string;
  };
  export default pathApi;
}
