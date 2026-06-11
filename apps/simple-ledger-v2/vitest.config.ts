import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const foundationSrc = fileURLToPath(new URL('../../packages/foundation/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@snishi\/foundation$/, replacement: `${foundationSrc}/index.ts` },
      { find: /^@snishi\/foundation\/(.+)$/, replacement: `${foundationSrc}/$1` },
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['../../packages/foundation/src/test-setup.ts'],
    passWithNoTests: true,
  },
});
