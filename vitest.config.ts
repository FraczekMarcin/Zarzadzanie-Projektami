import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
      },
    })
  )
);
