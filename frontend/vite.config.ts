import react from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';

type ViteConfigWithTest = UserConfig & {
  test: {
    globals: boolean;
    environment: string;
    setupFiles: string;
  };
};

type NodeLikeProcess = {
  env?: Record<string, string | undefined>;
};

const nodeProcess = (globalThis as typeof globalThis & { process?: NodeLikeProcess }).process;
const galleryBuildId =
  nodeProcess?.env?.GALLERY_BUILD_ID || nodeProcess?.env?.VITE_GALLERY_BUILD_ID || 'dev';

export default {
  plugins: [react()],
  define: {
    __GALLERY_BUILD_ID__: JSON.stringify(galleryBuildId),
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
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
