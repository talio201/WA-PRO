import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPages = path.resolve(__dirname, '../extension/src/pages');

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: '/usuarios/',
  build: {
    outDir: '../backend/public/app',
    emptyOutDir: true,
  },
  resolve: {
    // Intercept any import ending in /utils/api, /utils/runtimeConfig, /utils/realtime
    // from extension pages and redirect to our webapp implementations.
    alias: [
      {
        find: /.*\/utils\/api$/,
        replacement: path.resolve(__dirname, 'src/utils/api.js'),
      },
      {
        find: /.*\/utils\/runtimeConfig$/,
        replacement: path.resolve(__dirname, 'src/utils/runtimeConfig.js'),
      },
      {
        find: /.*\/utils\/realtime$/,
        replacement: path.resolve(__dirname, 'src/utils/realtime.js'),
      },
      // Expose extension pages under @pages alias
      { find: '@pages', replacement: extPages },
    ],
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
