import { defineConfig } from 'rolldown';

/**
 * Bundles `src/index.ts` to `dist/index.js` as CommonJS for the Vortex 2.3
 * Node runtime.
 *
 * Vortex supplies the API proxy for both `@nexusmods/vortex-api` and the
 * legacy unscoped `vortex-api` name, so both stay external. Node built-ins,
 * Electron, and the Vortex host modules are also external; `platform: 'node'`
 * handles the Node built-ins automatically.
 *
 * The extension has no runtime dependencies in this revision; anything added
 * later must be bundled here rather than added to `external`.
 */
export default defineConfig({
  input: 'src/index.ts',
  platform: 'node',
  external: [/^@nexusmods\/vortex-api/, /^vortex-api$/, 'electron'],
  output: {
    dir: 'dist',
    entryFileNames: 'index.js',
    format: 'cjs',
    sourcemap: true,
    exports: 'default',
  },
});
