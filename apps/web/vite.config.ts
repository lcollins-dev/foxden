import eslintPlugin from '@nabla/vite-plugin-eslint';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, type ProxyOptions } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import { SERVER_PATH_PREFIXES } from '@libs/dto';

import { iconsPlugin } from './icons.config';

const webPort = Number(process.env.WEB_PORT ?? 8080);
const apiPort = Number(process.env.API_PORT ?? 3000);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A key starting with ^ is a regular expression, so `/token` does not also claim `/tokens`.
const apiProxy: Record<string, ProxyOptions> = Object.fromEntries(
  SERVER_PATH_PREFIXES.map(prefix => [`^${escapeRegExp(prefix)}(?:[/?]|$)`, { target: `http://localhost:${apiPort}` }])
);

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    iconsPlugin(),
    eslintPlugin(),
    tsconfigPaths({
      loose: true,
    }),
  ],
  server: {
    port: webPort,
    strictPort: true,
    proxy: apiProxy,
  },
});
