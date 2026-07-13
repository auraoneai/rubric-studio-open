import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@auraone/proofline-oss/styles.css',
        replacement: fileURLToPath(
        new URL('./packages/proofline-oss/src/styles.css', import.meta.url),
        ),
      },
      {
        find: '@auraone/proofline-oss/tokens.css',
        replacement: fileURLToPath(
        new URL('./packages/proofline-oss/src/tokens.css', import.meta.url),
        ),
      },
      {
        find: '@auraone/aura-ide-kit/styles.css',
        replacement: fileURLToPath(
        new URL('./packages/aura-ide-kit/src/styles.css', import.meta.url),
        ),
      },
      {
        find: /^@auraone\/proofline-oss$/,
        replacement: fileURLToPath(
        new URL('./packages/proofline-oss/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@auraone\/aura-ide-kit$/,
        replacement: fileURLToPath(
        new URL('./packages/aura-ide-kit/src/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@auraone\/platform-contracts$/,
        replacement: fileURLToPath(
        new URL('./packages/platform-contracts/src/index.ts', import.meta.url),
        ),
      },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
  },
});
