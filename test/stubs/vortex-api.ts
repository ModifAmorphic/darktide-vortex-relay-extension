/**
 * Runtime stub for the types-only `@nexusmods/vortex-api` package. The
 * published package ships only TypeScript declarations, and at production
 * runtime Vortex's require wrapper returns the host API. Vitest cannot
 * resolve the bare specifier under the node/import conditions, so
 * vitest.config.ts aliases it to this file so value-imports (util, fs,
 * selectors, actions) load cleanly. Tests that assert on calls still use
 * `vi.mock('@nexusmods/vortex-api', factory)` to replace these defaults
 * with controllable spies. Type-only imports (`import type { types }`)
 * are erased and never reach this stub, so it provides no `types` export.
 */

export const util = {
  getVortexPath(): string {
    return '/stub/vortex/userData';
  },
  // Default no-op sortMods so modules that value-import util load even
  // when the test does not replace it.
  sortMods: async <T>(_gameId: string, mods: T[], _api: unknown): Promise<T[]> => mods,
  // Default open-directory stub resolving immediately, so action handlers
  // loaded as part of module init do not trigger unhandled rejections in
  // unrelated tests.
  opn: async (_target: string): Promise<void> => {
    // intentionally empty; tests override via vi.mock when asserting.
  },
  CycleError: class CycleError extends Error {
    constructor(public cycles: string[][]) {
      super('cycle');
    }
  },
};

export const fs = {
  ensureDirWritableAsync(): Promise<void> {
    return Promise.resolve();
  },
};

/** Minimal selectors stub. */
export const selectors = {
  activeProfile(_state: unknown): unknown {
    return undefined;
  },
  modsForGame(_state: unknown, _gameId: string): Record<string, unknown> {
    return {};
  },
  discoveryByGame(_state: unknown, _gameId: string): { path?: string } | undefined {
    return undefined;
  },
};

/**
 * Minimal actions namespace stub. setPrimaryTool is the only action
 * creator the extension value-imports (from ./primaryTool.ts); the stub
 * returns an opaque sentinel so modules that value-import actions load
 * cleanly.
 */
export const actions = {
  setPrimaryTool(_gameId: string, _toolId: string): unknown {
    return { type: 'set-primary-tool', gameId: _gameId, toolId: _toolId };
  },
};
