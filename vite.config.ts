import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    setupFiles: ['./tests/setup.ts'],
    // Рабочая папка harness (артефакты запусков) не является частью проекта.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.zwork/**', '**/src-tauri/**'],
    // Тяжёлые тесты (fontkit, булевы операции, pdf-lib/ag-psd) на 3.6 GiB RAM
    // могут превышать дефолтные 5 с при параллельной загрузке.
    testTimeout: 20000,
  },
});
