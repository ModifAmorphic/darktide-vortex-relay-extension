import { promises as fs, type Stats } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { types } from '@nexusmods/vortex-api';
import { selectors, util } from '@nexusmods/vortex-api';

import { GAME_ID, MOD_ATTRIBUTE_NAME } from '../src/constants';
import { projectActiveProfileModsLst, projectModsLst, serializeModsLst } from '../src/modsLst';
import * as paths from '../src/paths';

/**
 * For the projectModsLst tests, each test gets a fresh isolated tmp
 * directory created with `fs.mkdtemp`, matching per-test isolation.
 * The pure serializeModsLst tests do not touch the filesystem.
 */
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mods-lst-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * Vortex API mock. The factory creates plain stubs; per-test behavior is
 * controlled by re-implementing `selectors.activeProfile`,
 * `selectors.modsForGame`, and `util.sortMods` via
 * `vi.mocked(...).mockImplementation(...)` in `beforeEach` and individual
 * tests. The factory itself does not close over outer test state because
 * `vi.mock` is hoisted above the describe block.
 */
vi.mock('@nexusmods/vortex-api', () => ({
  util: {
    getVortexPath: vi.fn(() => '/stub/vortex/userData'),
    sortMods: vi.fn(async (_gameId: string, mods: unknown[]) => mods),
    CycleError: class CycleError extends Error {
      constructor(public cycles: string[][]) {
        super('cycle');
      }
    },
  },
  selectors: {
    activeProfile: vi.fn(() => undefined),
    modsForGame: vi.fn(() => ({})),
  },
}));

describe('serializeModsLst', () => {
  it('returns the empty string for an empty list', () => {
    expect(serializeModsLst([])).toBe('');
  });

  it('returns name + CRLF for a single name', () => {
    expect(serializeModsLst(['dmf'])).toBe('dmf\r\n');
  });

  it('joins multiple names with CRLF and ends with a trailing CRLF', () => {
    expect(serializeModsLst(['dmf', 'scoreboard', 'numeric_ui'])).toBe(
      'dmf\r\nscoreboard\r\nnumeric_ui\r\n',
    );
  });

  it('preserves names with interior dots', () => {
    expect(serializeModsLst(['my.mod'])).toBe('my.mod\r\n');
    expect(serializeModsLst(['my.mod', 'other.mod'])).toBe('my.mod\r\nother.mod\r\n');
  });

  it('preserves non-ASCII names (UTF-8 round-trip)', () => {
    const names = ['café', '世界'];
    const content = serializeModsLst(names);
    // The serialized content must contain the original characters; a
    // latin1 or ASCII-only implementation would mangle these.
    expect(content).toBe('café\r\n世界\r\n');
    // Re-decode the UTF-8 bytes to confirm the round-trip is lossless.
    const decoded = Buffer.from(content, 'utf8').toString('utf8');
    expect(decoded).toBe(content);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    const snapshot = [...input];
    serializeModsLst(input);
    expect(input).toEqual(snapshot);
  });

  it('round-trips through a UTF-8 file: written content parses back to the input names in order', async () => {
    const names = ['dmf', 'scoreboard', 'numeric_ui'];
    const target = path.join(dir, 'mods.lst');
    const content = serializeModsLst(names);
    await fs.writeFile(target, content, 'utf8');
    const readBack = await fs.readFile(target, 'utf8');
    // Parse the same way Relay's reader does: split on lines, drop blank
    // trailing entries from the final CRLF.
    const parsed = readBack.split(/\r\n/).filter((line) => line.length > 0);
    expect(parsed).toEqual(names);
  });
});

describe('projectModsLst', () => {
  it('writes the serialized content to <modsContentDir>/mods.lst', async () => {
    const names = ['dmf', 'scoreboard'];
    await projectModsLst(dir, names);
    const content = await fs.readFile(path.join(dir, 'mods.lst'), 'utf8');
    expect(content).toBe(serializeModsLst(names));
  });

  it('replaces an existing mods.lst atomically (old content gone, new content in place)', async () => {
    const target = path.join(dir, 'mods.lst');
    await fs.writeFile(target, 'stale content');
    await projectModsLst(dir, ['dmf']);
    const content = await fs.readFile(target, 'utf8');
    expect(content).toBe('dmf\r\n');
  });

  it('writes a zero-byte file for an empty list (not no file)', async () => {
    const target = path.join(dir, 'mods.lst');
    await projectModsLst(dir, []);
    const stats = await fs.stat(target);
    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBe(0);
  });

  it('leaves no tmp file behind after writing', async () => {
    await projectModsLst(dir, ['dmf']);
    const entries = await fs.readdir(dir);
    expect(entries).toContain('mods.lst');
    expect(entries).not.toContain('.mods.lst.tmp');
  });
});

/**
 * projectActiveProfileModsLst orchestrator tests.
 *
 * The orchestrator reads Vortex state via `selectors.activeProfile` and
 * `selectors.modsForGame`, calls `util.sortMods`, and writes via
 * `projectModsLst`. Tests control state and the sort result by mocking
 * `@nexusmods/vortex-api` (see the top-level `vi.mock` factory). The
 * orchestrator is the seam where Vortex's native sort meets the
 * canonical-name projection; these tests verify that wiring without
 * depending on real Vortex behavior.
 */
describe('projectActiveProfileModsLst', () => {
  /**
   * Each test owns this map of modId -> IMod so it can describe the
   * installed-mod state for one game. Reset before every test.
   */
  let modsForDarktide: Record<string, types.IMod>;

  /**
   * The active profile used in the current test. Tests set this when
   * they need to drive the active-profile selector. Cast as `IProfile`
   * because the orchestrator only reads `gameId` and `modState`; building
   * the full required-IProfile shape would couple the test to unrelated
   * fields.
   */
  let activeProfile: types.IProfile | undefined;

  beforeEach(async () => {
    modsForDarktide = {};
    activeProfile = undefined;
    // Clear call history from prior tests so `toHaveBeenCalled` and the
    // call-count assertions see only the current test's calls.
    vi.mocked(selectors.activeProfile).mockClear();
    vi.mocked(selectors.modsForGame).mockClear();
    vi.mocked(util.sortMods).mockClear();
    // Default implementations read the current test's `modsForDarktide`
    // and `activeProfile` via closure. Individual tests override
    // `util.sortMods` to control the sort result.
    vi.mocked(selectors.activeProfile).mockImplementation(() => activeProfile);
    vi.mocked(selectors.modsForGame).mockImplementation((_state, gameId) =>
      gameId === GAME_ID ? modsForDarktide : {},
    );
    vi.mocked(util.sortMods).mockImplementation(async (_gameId, mods) => mods as types.IMod[]);
    vi.mocked(util.getVortexPath).mockReturnValue(dir);
    // The orchestrator writes to `paths.modsContentDir(userData)`, which
    // is `<dir>/warhammer40kdarktide-relay/deploy/mods/`. The runtime
    // `setup` creates this; tests mirror that here so writeAtomic does
    // not fail with ENOENT.
    await fs.mkdir(paths.modsContentDir(dir), { recursive: true });
  });

  /** Helper: a mod with a relayModName attribute. Casts to IMod because the
   * orchestrator only reads `id` and `attributes`; building the full
   * required-IMod shape would couple the test to unrelated fields. */
  function mod(modId: string, canonical: string): types.IMod {
    return { id: modId, attributes: { [MOD_ATTRIBUTE_NAME]: canonical } } as unknown as types.IMod;
  }

  /**
   * Helper: build an IProfile fixture for the Darktide game. Casts the
   * partial shape; the orchestrator only reads `gameId` and `modState`.
   */
  function profile(modState: Record<string, { enabled: boolean }>): types.IProfile {
    return {
      id: 'profile-1',
      gameId: GAME_ID,
      name: 'Test Profile',
      modState,
      lastActivated: 0,
    } as unknown as types.IProfile;
  }

  /** Helper: build a stub api that returns the live modsForDarktide map. */
  function stubApi() {
    return {
      getState: () => ({ persistent: { mods: { [GAME_ID]: modsForDarktide } } }),
    } as unknown as Parameters<typeof projectActiveProfileModsLst>[0];
  }

  /** Helper: read the projected mods.lst from the mods content dir. */
  async function readModsLst(): Promise<string> {
    return fs.readFile(path.join(paths.modsContentDir(dir), 'mods.lst'), 'utf8');
  }

  /** Helper: stat the projected mods.lst from the mods content dir. */
  async function statModsLst(): Promise<Stats> {
    return fs.stat(path.join(paths.modsContentDir(dir), 'mods.lst'));
  }

  it('writes the sorted enabled mods as canonical names to mods.lst', async () => {
    modsForDarktide = {
      dmf: mod('dmf', 'dmf'),
      scoreboard: mod('scoreboard', 'scoreboard'),
      numericUi: mod('numericUi', 'numeric_ui'),
    };
    activeProfile = profile({
      dmf: { enabled: true },
      scoreboard: { enabled: true },
      numericUi: { enabled: true },
    });
    // Simulate Vortex's sort reordering the input.
    vi.mocked(util.sortMods).mockResolvedValue([
      modsForDarktide['dmf']!,
      modsForDarktide['scoreboard']!,
      modsForDarktide['numericUi']!,
    ]);

    await projectActiveProfileModsLst(stubApi());

    expect(util.sortMods).toHaveBeenCalledTimes(1);
    const sortArgs = vi.mocked(util.sortMods).mock.calls[0]!;
    expect(sortArgs[0]).toBe(GAME_ID);
    // sortMods received exactly the enabled mods.
    expect(sortArgs[1]).toHaveLength(3);

    expect(await readModsLst()).toBe('dmf\r\nscoreboard\r\nnumeric_ui\r\n');
  });

  it('passes only profile-enabled mods to sortMods', async () => {
    modsForDarktide = {
      dmf: mod('dmf', 'dmf'),
      disabledMod: mod('disabledMod', 'disabled'),
      enabledMod: mod('enabledMod', 'enabled'),
    };
    activeProfile = profile({
      dmf: { enabled: true },
      disabledMod: { enabled: false },
      enabledMod: { enabled: true },
    });

    await projectActiveProfileModsLst(stubApi());

    const sortArgs = vi.mocked(util.sortMods).mock.calls[0]!;
    const sortedIds = (sortArgs[1] as { id: string }[]).map((m) => m.id);
    expect(sortedIds).toEqual(['dmf', 'enabledMod']);
  });

  it('omits mods whose relayModName attribute is missing', async () => {
    modsForDarktide = {
      dmf: mod('dmf', 'dmf'),
      // Installed but missing the relayModName attribute (e.g. a mod
      // installed by a different extension or before the attribute existed).
      noAttr: { id: 'noAttr', attributes: {} } as unknown as types.IMod,
    };
    activeProfile = profile({ dmf: { enabled: true }, noAttr: { enabled: true } });
    // sortMods sees both enabled mods; the projection drops the one
    // without a canonical name.
    vi.mocked(util.sortMods).mockResolvedValue([
      modsForDarktide['dmf']!,
      modsForDarktide['noAttr']!,
    ]);

    await projectActiveProfileModsLst(stubApi());

    expect(await readModsLst()).toBe('dmf\r\n');
  });

  it('omits mods whose relayModName attribute is not a string', async () => {
    modsForDarktide = {
      dmf: mod('dmf', 'dmf'),
      numAttr: {
        id: 'numAttr',
        attributes: { [MOD_ATTRIBUTE_NAME]: 42 },
      } as unknown as types.IMod,
    };
    activeProfile = profile({ dmf: { enabled: true }, numAttr: { enabled: true } });
    vi.mocked(util.sortMods).mockResolvedValue([
      modsForDarktide['dmf']!,
      modsForDarktide['numAttr']!,
    ]);

    await projectActiveProfileModsLst(stubApi());

    expect(await readModsLst()).toBe('dmf\r\n');
  });

  it('writes a zero-byte mods.lst when no mods are enabled', async () => {
    modsForDarktide = { dmf: mod('dmf', 'dmf') };
    activeProfile = profile({ dmf: { enabled: false } });

    await projectActiveProfileModsLst(stubApi());

    // No enabled mods -> sortMods is still called with an empty array,
    // and the projection writes an empty file (Relay treats this as
    // "no mods load").
    expect(util.sortMods).toHaveBeenCalledTimes(1);
    const stats = await statModsLst();
    expect(stats.size).toBe(0);
  });

  it('does nothing when there is no active profile', async () => {
    activeProfile = undefined;
    await projectActiveProfileModsLst(stubApi());
    expect(util.sortMods).not.toHaveBeenCalled();
  });

  it('does nothing when the active profile belongs to a different game', async () => {
    activeProfile = {
      id: 'profile-1',
      gameId: 'skyrim',
      name: 'Skyrim Profile',
      modState: {},
      lastActivated: 0,
    };
    await projectActiveProfileModsLst(stubApi());
    expect(util.sortMods).not.toHaveBeenCalled();
  });

  it('rethrows CycleError with an actionable message naming the cycle', async () => {
    modsForDarktide = {
      modA: mod('modA', 'mod_a'),
      modB: mod('modB', 'mod_b'),
    };
    activeProfile = profile({ modA: { enabled: true }, modB: { enabled: true } });
    const cycleErr = new (util.CycleError as unknown as new (cycles: string[][]) => Error)([
      ['mod_a', 'mod_b', 'mod_a'],
    ]);
    vi.mocked(util.sortMods).mockRejectedValue(cycleErr);

    await expect(projectActiveProfileModsLst(stubApi())).rejects.toThrow(/dependency cycle/);
    await expect(projectActiveProfileModsLst(stubApi())).rejects.toThrow(/mod_a -> mod_b -> mod_a/);
  });

  it('rethrows non-cycle errors unchanged', async () => {
    modsForDarktide = { dmf: mod('dmf', 'dmf') };
    activeProfile = profile({ dmf: { enabled: true } });
    const other = new Error('sort backend unavailable');
    vi.mocked(util.sortMods).mockRejectedValue(other);

    await expect(projectActiveProfileModsLst(stubApi())).rejects.toBe(other);
  });
});
