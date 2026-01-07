import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: 'http://localhost:5000',
            changeOrigin: true,
          },
          '^/admin(/.*)?$': {
            target: 'http://localhost:5000',
            changeOrigin: true,
          },
          '/test-ticket': {
            target: 'http://localhost:5000',
            changeOrigin: true,
          }
        }
      },
      plugins: [react()],
      esbuild: {
        drop: process.env.NODE_ENV === 'production' ? (['console', 'debugger'] as ('console' | 'debugger')[]) : undefined,
      },
      build: {
        sourcemap: false,
        minify: true,
        cssMinify: true,
        target: 'es2020',
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      }
    };
});
