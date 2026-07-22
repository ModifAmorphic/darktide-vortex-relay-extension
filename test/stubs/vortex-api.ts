/**
 * Runtime stub for the types-only `@nexusmods/vortex-api` package.
 *
 * The published package ships only TypeScript declarations (its `exports`
 * field exposes a `types` condition but no runtime entry). At production
 * runtime, Vortex's extension `require` wrapper intercepts the bare
 * specifier and returns the host application's API proxy.
 *
 * Vitest resolves modules under the `node`/`import` conditions, so without
 * help it cannot resolve `@nexusmods/vortex-api` and fails before any
 * `vi.mock` factory runs. `vitest.config.ts` aliases the bare specifier to
 * this file so that source modules which value-import `util`, `fs`, and
 * `selectors` load cleanly. Tests that need to assert on calls to the API
 * still use `vi.mock('@nexusmods/vortex-api', factory)` to replace these
 * defaults with controllable spies; the alias is only the resolvable
 * fallback.
 *
 * Type-only imports (`import type { types }`) are erased by the transpiler
 * and never reach this stub, so it intentionally provides no `types`
 * export.
 */

export const util = {
  getVortexPath(): string {
    return '/stub/vortex/userData';
  },
  // Default no-op sort: returns the input unchanged. Tests that assert on
  // ordering mock `util.sortMods` via `vi.mock('@nexusmods/vortex-api',
  // ...)`. Kept here so modules that value-import `util` load even when
  // the test does not replace it.
  sortMods: async <T>(_gameId: string, mods: T[], _api: unknown): Promise<T[]> => mods,
  // Default open-directory stub: resolves immediately. Tests that assert
  // on `util.opn` override it via `vi.mock('@nexusmods/vortex-api',
  // ...)`. Kept here so action handlers loaded as part of module init
  // (registerActions) do not trigger unhandled rejections in unrelated
  // tests.
  opn: async (_target: string): Promise<void> => {
    // intentionally empty; tests override via vi.mock when asserting.
  },
  CycleError: class CycleError extends Error {
    constructor(public cycles: string[][]) {
      super('cycle');
    }
  },
  // ProcessCanceled is the rejection type the start hook throws to cancel
  // a launch (spec Section 12 outcome 6). Mirrors the Vortex 2.3 type
  // exported via the `util` namespace (api.d.ts lines 7691, 9376).
  ProcessCanceled: class ProcessCanceled extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ProcessCanceled';
    }
  },
};

export const fs = {
  ensureDirWritableAsync(): Promise<void> {
    return Promise.resolve();
  },
};

/**
 * Minimal selectors stub. Tests that need to control installed-mod,
 * active-profile, or discovery state override these via
 * `vi.mock('@nexusmods/vortex-api', ...)`.
 */
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
