import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const devProxyTarget = (() => {
      const explicit = String(env.VITE_DEV_PROXY_TARGET || '').trim();
      if (explicit) return explicit;
      const portRaw = String(env.VITE_BACKEND_PORT || '').trim();
      const port = portRaw ? Number(portRaw) : NaN;
      if (Number.isFinite(port) && port > 0) return `http://localhost:${port}`;
      return 'http://localhost:5000';
    })();

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: devProxyTarget,
            changeOrigin: true,
          },
          '^/admin(/.*)?$': {
            target: devProxyTarget,
            changeOrigin: true,
          },
          '/test-ticket': {
            target: devProxyTarget,
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
