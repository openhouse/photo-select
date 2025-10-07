import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    deps: {
      interopDefault: true,
      optimizer: {
        ssr: {
          include: ['handlebars', 'diff', 'cli-progress'],
        },
      },
    },
  },
  ssr: {
    external: ['handlebars', 'diff', 'cli-progress'],
  },
});
