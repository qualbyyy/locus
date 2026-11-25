import { ReadableStream } from 'node:stream/web';

if (typeof globalThis.ReadableStream === 'undefined') {
  (globalThis as unknown as { ReadableStream: typeof ReadableStream }).ReadableStream =
    ReadableStream;
}
