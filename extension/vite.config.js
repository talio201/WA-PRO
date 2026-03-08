import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    css: {
        postcss: './postcss.config.js',
    },
    build: {
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'index.html'),
                options: resolve(__dirname, 'options.html'),
                background: resolve(__dirname, 'src/background/index.js'),
                content: resolve(__dirname, 'src/content/index.js')
            },
            output: {
                entryFileNames: 'src/[name]/index.js',
                chunkFileNames: 'assets/[name].[hash].js',
                assetFileNames: 'assets/[name].[hash].[ext]',
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        return id.toString().split('node_modules/')[1].split('/')[0].toString();
                    }
                }
            }
        },
        chunkSizeWarningLimit: 1000, // Ajusta o limite de tamanho do chunk para 1MB
        outDir: 'dist',
        emptyOutDir: true
    }
});
