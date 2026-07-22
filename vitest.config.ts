import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // The types-only @nexusmods/vortex-api package has no runtime entry;
      // Vortex injects the real API at production runtime. Alias to a stub
      // so Vite can resolve the bare specifier in tests. Per-test vi.mock
      // factories still override this for spy-based assertions.
      '@nexusmods/vortex-api': path.resolve(__dirname, 'test/stubs/vortex-api.ts'),
    },
  },
});
