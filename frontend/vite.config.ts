import react from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';

type ViteConfigWithTest = UserConfig & {
  test: {
    globals: boolean;
    environment: string;
    setupFiles: string;
  };
};

export default {
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/media': 'http://127.0.0.1:8080',
      '/upload': {
        target: 'http://127.0.0.1:8080',
        bypass: (request) => (request.method === 'POST' ? undefined : '/index.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
} satisfies ViteConfigWithTest;
