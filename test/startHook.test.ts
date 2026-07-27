import { mkdirSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { types } from '@nexusmods/vortex-api';
import { selectors, util } from '@nexusmods/vortex-api';

import {
  DMF_CANONICAL_NAME,
  DMF_WARNING_FILE_NAME,
  DEPLOY_DIR_NAME,
  GAME_ID,
  MOD_ATTRIBUTE_NAME,
  MOD_ROOT_DIR_NAME,
  RELAY_EXECUTABLE,
} from '../src/constants';
import * as pathsModule from '../src/paths';
import {
  createStartHook,
  decideDmfWarning,
  isRelayLaunch,
  missingRelayFiles,
  persistDmfWarningFlag,
  readDmfWarningFlag,
  START_HOOK_ID,
  START_HOOK_PRIORITY,
  validateDeployedModsLstEntries,
} from '../src/startHook';
import { projectAndValidateModsLst, validateProjectedNames } from '../src/modsLst';

/**
 * The start hook closes over the Vortex api and reads live state through
 * selectors. Tests control `selectors.activeProfile`,
 * `selectors.modsForGame`, and `selectors.discoveryByGame` via the
 * module-level vi.mock factory; per-test state is owned by closures
 * reset in `beforeEach`.
 *
 * `paths.relayDir()` is also mocked because the production default
 * resolves via `__dirname`, which would point at the test runner's
 * module location rather than the per-test tmp relay directory the
 * filesystem fixtures create.
 *
 * The hook also touches the filesystem (relay directory, deployed mod
 * files, DMF warn-flag). Filesystem-touching tests use a per-test tmp
 * directory created with `fs.mkdtemp`, matching the per-test isolation
 * pattern in `modsLst.test.ts` and `util/fs.test.ts`.
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
    ProcessCanceled: class ProcessCanceled extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ProcessCanceled';
      }
    },
  },
  selectors: {
    activeProfile: vi.fn(() => undefined),
    modsForGame: vi.fn(() => ({})),
    discoveryByGame: vi.fn(() => undefined),
  },
}));

vi.mock('../src/paths', () => ({
  // All five exports are vi.fn stubs so tests can override per-test via
  // vi.mocked(...). The default return values are unused; beforeEach
  // sets them to the test's tmp directory tree.
  relayDir: vi.fn(() => '/test/relay'),
  modRoot: vi.fn(() => '/test/modRoot'),
  deployDir: vi.fn(() => '/test/deploy'),
  modsContentDir: vi.fn(() => '/test/deploy/mods'),
  loadOrderDir: vi.fn(() => '/test/loadOrder'),
}));

/**
 * Per-test state. Reset in beforeEach. The `relayDir` and the various
 * filesystem paths are bound to the test's tmp directory tree; selectors
 * return the per-test fixtures.
 */
let dir: string;
let relayDirectory: string;
let deployDirectory: string;
let modsContentDirectory: string;
let modRootDirectory: string;
let gameDirectory: string;
let activeProfile: types.IProfile | undefined;
let modsForDarktide: Record<string, types.IMod>;
let discovery: { path?: string } | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'start-hook-test-'));
  relayDirectory = path.join(dir, 'relay');
  deployDirectory = path.join(dir, MOD_ROOT_DIR_NAME, DEPLOY_DIR_NAME);
  // Deployed mod trees and mods.lst live under <deploy>/mods/ (Mod Relay
  // layout). The start hook validates deployed <name>/<name>.mod files
  // here, and projectAndValidateModsLst writes mods.lst here.
  modsContentDirectory = path.join(deployDirectory, 'mods');
  modRootDirectory = path.join(dir, MOD_ROOT_DIR_NAME);
  gameDirectory = path.join(dir, 'darktide-install');
  // Create the mods content directory up front. The start hook writes
  // mods.lst here on every Relay launch via projectAndValidateModsLst;
  // in production, `setup` creates this directory at game-mode
  // activation. Tests that specifically exercise missing-directory
  // scenarios remove it explicitly.
  await fs.mkdir(modsContentDirectory, { recursive: true });
  activeProfile = undefined;
  modsForDarktide = {};
  discovery = undefined;
  vi.mocked(util.getVortexPath).mockReturnValue(dir);
  vi.mocked(selectors.activeProfile).mockImplementation(() => activeProfile);
  vi.mocked(selectors.modsForGame).mockImplementation((_state: unknown, gameId: string) =>
    gameId === GAME_ID ? modsForDarktide : {},
  );
  vi.mocked(selectors.discoveryByGame).mockImplementation((_state: unknown, gameId: string) =>
    gameId === GAME_ID ? discovery : undefined,
  );
  // Wire the path stubs to the test's tmp tree.
  vi.mocked(pathsModule.relayDir).mockReturnValue(relayDirectory);
  vi.mocked(pathsModule.modRoot).mockReturnValue(modRootDirectory);
  vi.mocked(pathsModule.deployDir).mockReturnValue(deployDirectory);
  vi.mocked(pathsModule.modsContentDir).mockReturnValue(modsContentDirectory);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Helper: build an IRunParameters for a Relay launch from the test's relayDir. */
function relayCall(): types.IRunParameters {
  return {
    executable: path.join(relayDirectory, RELAY_EXECUTABLE),
    args: ['--game-binary', '{RELAY_GAME_BINARY}', '--mod-path', '{RELAY_MOD_PATH}'],
    options: {},
  };
}

/** Helper: build an IRunParameters for an unrelated tool. */
function unrelatedCall(): types.IRunParameters {
  return {
    executable: 'C:\\Windows\\notepad.exe',
    args: [],
    options: {},
  };
}

/** Helper: build a stub api whose getState returns the per-test state. */
function stubApi(): types.IExtensionApi {
  return {
    getState: () => ({ persistent: { mods: { [GAME_ID]: modsForDarktide } } }),
    showErrorNotification: vi.fn(),
    sendNotification: vi.fn(),
  } as unknown as types.IExtensionApi;
}

/** Helper: a mod with a relayModName attribute. */
function mod(modId: string, canonical: string): types.IMod {
  return { id: modId, attributes: { [MOD_ATTRIBUTE_NAME]: canonical } } as unknown as types.IMod;
}

/** Helper: build an IProfile fixture for the Darktide game. */
function profile(modState: Record<string, { enabled: boolean }>): types.IProfile {
  return {
    id: 'profile-1',
    gameId: GAME_ID,
    name: 'Test',
    modState,
    lastActivated: 0,
  } as unknown as types.IProfile;
}

/**
 * Helper: populate the bundled relay directory with the launcher binary.
 * The extension treats Relay as an opaque unit and verifies only that
 * `mod_relay.exe` is present; the fixture therefore stages only the
 * launcher, not Relay's internal runtime files.
 */
async function writeCompleteRelayRuntime(): Promise<void> {
  await fs.mkdir(relayDirectory, { recursive: true });
  await fs.writeFile(path.join(relayDirectory, RELAY_EXECUTABLE), 'placeholder');
}

/** Helper: write the deployed `<name>/<name>.mod` files for the given names. */
async function writeDeployedMods(names: readonly string[]): Promise<void> {
  await fs.mkdir(modsContentDirectory, { recursive: true });
  for (const name of names) {
    const modDir = path.join(modsContentDirectory, name);
    await fs.mkdir(modDir, { recursive: true });
    await fs.writeFile(path.join(modDir, `${name}.mod`), '-- placeholder');
  }
}

/** Helper: write the discovered Darktide binary so hard check 3 passes. */
async function writeDiscoveredDarktideBinary(): Promise<void> {
  await fs.mkdir(path.join(gameDirectory, 'binaries'), { recursive: true });
  await fs.writeFile(path.join(gameDirectory, 'binaries', 'Darktide.exe'), 'exe');
}

describe('constants', () => {
  it('exposes the spec priority and id', () => {
    expect(START_HOOK_PRIORITY).toBe(5);
    expect(START_HOOK_ID).toBe('mod-relay-launch-guard');
  });
});

describe('isRelayLaunch filter', () => {
  it('returns true when the executable matches the relay launcher path', () => {
    const expectedExe = path.join(relayDirectory, RELAY_EXECUTABLE);
    const call: types.IRunParameters = {
      executable: expectedExe,
      args: [],
      options: {},
    };
    expect(isRelayLaunch(call, expectedExe)).toBe(true);
  });

  it('returns false when the executable is for an unrelated tool', () => {
    const expectedExe = path.join(relayDirectory, RELAY_EXECUTABLE);
    const call: types.IRunParameters = {
      executable: 'C:\\Windows\\notepad.exe',
      args: [],
      options: {},
    };
    expect(isRelayLaunch(call, expectedExe)).toBe(false);
  });

  it('matches case-insensitively on the basename and directory', () => {
    // Windows filesystem is case-insensitive; Vortex may emit a
    // different-case executable path than the one our queryPath produced.
    const expectedExe = path.join(relayDirectory, RELAY_EXECUTABLE);
    const call: types.IRunParameters = {
      executable: expectedExe.toUpperCase(),
      args: [],
      options: {},
    };
    expect(isRelayLaunch(call, expectedExe)).toBe(true);
  });

  it('tolerates backslash vs forward slash differences in the path', () => {
    const expectedExe = `${relayDirectory.replace(/\\/g, '/')}\\${RELAY_EXECUTABLE}`;
    const call: types.IRunParameters = {
      executable: `${relayDirectory}/${RELAY_EXECUTABLE}`,
      args: [],
      options: {},
    };
    expect(isRelayLaunch(call, expectedExe)).toBe(true);
  });

  it('returns false for an empty executable', () => {
    const expectedExe = path.join(relayDirectory, RELAY_EXECUTABLE);
    const call: types.IRunParameters = { executable: '', args: [], options: {} };
    expect(isRelayLaunch(call, expectedExe)).toBe(false);
  });

  it('returns false when the basename is right but the directory differs', () => {
    // Defense in depth: a stray mod_relay.exe elsewhere on disk
    // (for example an unzipped copy in Downloads) should not trigger the
    // hook.
    const expectedExe = path.join(relayDirectory, RELAY_EXECUTABLE);
    const call: types.IRunParameters = {
      executable: path.join(dir, 'elsewhere', RELAY_EXECUTABLE),
      args: [],
      options: {},
    };
    expect(isRelayLaunch(call, expectedExe)).toBe(false);
  });
});

describe('missingRelayFiles', () => {
  it('returns an empty list when the launcher exists', async () => {
    await writeCompleteRelayRuntime();
    expect(missingRelayFiles(relayDirectory)).toEqual([]);
  });

  it('returns the launcher filename when the directory does not exist', () => {
    expect(missingRelayFiles(relayDirectory)).toEqual([RELAY_EXECUTABLE]);
  });

  it('detects a missing mod_relay.exe', async () => {
    // Stage the relay directory but omit the launcher binary.
    await fs.mkdir(relayDirectory, { recursive: true });
    expect(missingRelayFiles(relayDirectory)).toEqual([RELAY_EXECUTABLE]);
  });

  it('passes regardless of other Relay runtime files when the launcher exists', async () => {
    // The extension treats Relay as an opaque unit: the DLL, Lua, and
    // legal files are irrelevant to this check. Only mod_relay.exe
    // matters.
    await fs.mkdir(relayDirectory, { recursive: true });
    await fs.writeFile(path.join(relayDirectory, RELAY_EXECUTABLE), 'placeholder');
    // No relay_shell.dll, no mod_loader/, no legal files: still empty.
    expect(missingRelayFiles(relayDirectory)).toEqual([]);
  });
});

describe('validateProjectedNames (pure projection validation)', () => {
  it('returns no problems for a clean list', () => {
    expect(validateProjectedNames(['dmf', 'scoreboard', 'numeric_ui'])).toEqual([]);
  });

  it('returns no problems for an empty list', () => {
    expect(validateProjectedNames([])).toEqual([]);
  });

  it('flags duplicate names case-insensitively', () => {
    const problems = validateProjectedNames(['Foo', 'foo']);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.reason).toMatch(/duplicate canonical name/i);
    expect(problems[0]!.relayModName).toBe('foo');
  });

  it('reports each duplicate pair separately when three copies appear', () => {
    const problems = validateProjectedNames(['a', 'A', 'a']);
    expect(problems).toHaveLength(2);
    for (const p of problems) {
      expect(p.reason).toMatch(/duplicate canonical name/i);
    }
  });

  it('flags names containing a forward slash', () => {
    const problems = validateProjectedNames(['evil/mod']);
    expect(problems.some((p) => p.reason.match(/unsafe/i))).toBe(true);
  });

  it('flags names containing a backslash', () => {
    const problems = validateProjectedNames(['evil\\mod']);
    expect(problems.some((p) => p.reason.match(/unsafe/i))).toBe(true);
  });

  it('flags names that are "."', () => {
    const problems = validateProjectedNames(['.']);
    expect(problems.some((p) => p.reason.match(/unsafe/i))).toBe(true);
  });

  it('flags names that are ".."', () => {
    const problems = validateProjectedNames(['..']);
    expect(problems.some((p) => p.reason.match(/unsafe/i))).toBe(true);
  });

  it('flags names with a Windows drive prefix', () => {
    const problems = validateProjectedNames(['C:foo']);
    expect(problems.some((p) => p.reason.match(/unsafe/i))).toBe(true);
  });

  it('reports both a duplicate and an unsafe problem for the same name when applicable', () => {
    const problems = validateProjectedNames(['..', '..']);
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateDeployedModsLstEntries', () => {
  it('returns an empty list when every <name>/<name>.mod exists', async () => {
    await writeDeployedMods(['dmf', 'scoreboard']);
    expect(validateDeployedModsLstEntries(modsContentDirectory, ['dmf', 'scoreboard'])).toEqual([]);
  });

  it('reports each missing <name>/<name>.mod', async () => {
    await writeDeployedMods(['dmf']);
    const missing = validateDeployedModsLstEntries(modsContentDirectory, ['dmf', 'scoreboard']);
    expect(missing).toEqual(['scoreboard/scoreboard.mod']);
  });

  it('reports multiple missing mods', async () => {
    const missing = validateDeployedModsLstEntries(modsContentDirectory, ['a', 'b', 'c']);
    expect(missing.sort()).toEqual(['a/a.mod', 'b/b.mod', 'c/c.mod'].sort());
  });

  it('re-runs the pure validation and reports problems for unsafe names', () => {
    const problems = validateDeployedModsLstEntries(modsContentDirectory, ['../escape']);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.match(/unsafe/i))).toBe(true);
  });
});

describe('projectAndValidateModsLst orchestrator', () => {
  // The global beforeEach already creates `modsContentDirectory` so the
  // projection can write mods.lst without an ENOENT.

  it('writes mods.lst and returns ok=true for a clean projection', async () => {
    modsForDarktide = { dmf: mod('dmf', 'dmf'), sb: mod('sb', 'scoreboard') };
    activeProfile = profile({ dmf: { enabled: true }, sb: { enabled: true } });
    const result = await projectAndValidateModsLst(stubApi());
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    const content = await fs.readFile(path.join(modsContentDirectory, 'mods.lst'), 'utf8');
    expect(content).toBe('dmf\r\nscoreboard\r\n');
  });

  it('returns ok=true when there is no active profile', async () => {
    activeProfile = undefined;
    const result = await projectAndValidateModsLst(stubApi());
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('returns ok=true when the active profile is for a different game', async () => {
    activeProfile = {
      id: 'p',
      gameId: 'skyrim',
      name: 'Skyrim',
      modState: {},
      lastActivated: 0,
    } as unknown as types.IProfile;
    const result = await projectAndValidateModsLst(stubApi());
    expect(result.ok).toBe(true);
  });

  it('still writes mods.lst when validation problems are detected', async () => {
    modsForDarktide = {
      a: mod('a', 'dup'),
      b: mod('b', 'DUP'), // case-insensitive duplicate of 'dup'
    };
    activeProfile = profile({ a: { enabled: true }, b: { enabled: true } });
    const result = await projectAndValidateModsLst(stubApi());
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
    const stat = await fs.stat(path.join(modsContentDirectory, 'mods.lst'));
    expect(stat.isFile()).toBe(true);
  });
});

describe('start hook: filter behavior', () => {
  it('passes an unrelated launch through unchanged', async () => {
    const hook = createStartHook(stubApi());
    const call = unrelatedCall();
    const result = await hook(call);
    expect(result).toBe(call);
  });

  it('rejects a Relay launch when there is no active profile', async () => {
    await writeCompleteRelayRuntime();
    activeProfile = undefined;
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).rejects.toThrow(/active Vortex profile does not belong/i);
  });
});

describe('start hook: hard check 1 (active profile game id)', () => {
  beforeEach(async () => {
    await writeCompleteRelayRuntime();
    discovery = { path: gameDirectory };
    await writeDiscoveredDarktideBinary();
  });

  it('rejects when the active profile is for a different game', async () => {
    activeProfile = {
      id: 'p',
      gameId: 'skyrim',
      name: 'Skyrim',
      modState: {},
      lastActivated: 0,
    } as unknown as types.IProfile;
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).rejects.toThrow(/active Vortex profile does not belong/i);
  });

  it('proceeds past hard check 1 when the active profile is Darktide', async () => {
    activeProfile = profile({});
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).resolves.toBeDefined();
  });
});

describe('start hook: hard check 2 (Relay launcher)', () => {
  beforeEach(async () => {
    activeProfile = profile({});
    discovery = { path: gameDirectory };
    // Provide a discovered Darktide install so hard check 3 does not
    // fail first when the test is exercising hard check 2.
    mkdirSync(path.join(gameDirectory, 'binaries'), { recursive: true });
    writeFileSync(path.join(gameDirectory, 'binaries', 'Darktide.exe'), 'exe');
  });

  it('rejects when the relay directory does not exist', async () => {
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).rejects.toThrow(/bundled Relay launcher/i);
    await expect(hook(relayCall())).rejects.toThrow(/mod_relay\.exe/);
  });

  it('rejects when mod_relay.exe is absent', async () => {
    // Stage the relay directory but omit the launcher binary. The check
    // verifies only mod_relay.exe; Relay's internal runtime files are
    // not enumerated.
    await fs.mkdir(relayDirectory, { recursive: true });
    const hook = createStartHook(stubApi());
    const promise = hook(relayCall());
    await expect(promise).rejects.toThrow(/bundled Relay launcher/i);
    await expect(promise).rejects.toThrow(/mod_relay\.exe/);
  });

  it('proceeds past hard check 2 when the launcher exists', async () => {
    await writeCompleteRelayRuntime();
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).resolves.toBeDefined();
  });
});

describe('start hook: hard check 3 (discovered Darktide binary)', () => {
  beforeEach(async () => {
    await writeCompleteRelayRuntime();
    activeProfile = profile({});
  });

  it('rejects when Darktide has not been discovered', async () => {
    discovery = undefined;
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).rejects.toThrow(/Darktide has not been discovered/i);
  });

  it('rejects when discovery has no path', async () => {
    discovery = {};
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).rejects.toThrow(/Darktide has not been discovered/i);
  });

  it('rejects when the discovered binary does not exist on disk', async () => {
    discovery = { path: gameDirectory };
    // Note: we deliberately do NOT create the binaries directory.
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).rejects.toThrow(/discovered Darktide binary was not found/i);
  });

  it('proceeds past hard check 3 when the binary exists', async () => {
    discovery = { path: gameDirectory };
    await writeDiscoveredDarktideBinary();
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).resolves.toBeDefined();
  });
});

describe('start hook: hard check 4 (projection validation)', () => {
  beforeEach(async () => {
    await writeCompleteRelayRuntime();
    discovery = { path: gameDirectory };
    await writeDiscoveredDarktideBinary();
  });

  it('proceeds past hard check 4 when no mods are enabled', async () => {
    activeProfile = profile({});
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).resolves.toBeDefined();
  });

  it('proceeds when enabled mods have their deployed .mod files', async () => {
    modsForDarktide = { dmf: mod('dmf', 'dmf') };
    activeProfile = profile({ dmf: { enabled: true } });
    await writeDeployedMods(['dmf']);
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).resolves.toBeDefined();
  });

  it('rejects when a deployed <name>/<name>.mod is missing', async () => {
    modsForDarktide = { dmf: mod('dmf', 'dmf') };
    activeProfile = profile({ dmf: { enabled: true } });
    // No writeDeployedMods call: the deployed tree is missing.
    const hook = createStartHook(stubApi());
    await expect(hook(relayCall())).rejects.toThrow(/missing their deployed .mod file/i);
    await expect(hook(relayCall())).rejects.toThrow(/dmf\/dmf\.mod/);
  });
});

describe('DMF soft warning: pure decision', () => {
  /** Helper: build a minimal Vortex state with the given mod state. */
  function state(): types.IState {
    return {
      persistent: { mods: { [GAME_ID]: modsForDarktide }, profiles: {} },
    } as unknown as types.IState;
  }

  it('does not warn when the flag file already exists', () => {
    modsForDarktide = { sb: mod('sb', 'scoreboard') };
    activeProfile = profile({ sb: { enabled: true } });
    const decision = decideDmfWarning(state(), ['scoreboard'], true);
    expect(decision.shouldWarn).toBe(false);
    expect(decision.reason).toMatch(/already fired/);
  });

  it('does not warn when there is no active profile', () => {
    activeProfile = undefined;
    expect(decideDmfWarning(state(), [], false).shouldWarn).toBe(false);
  });

  it('does not warn when the active profile is for a different game', () => {
    activeProfile = {
      id: 'p',
      gameId: 'skyrim',
      name: 'Skyrim',
      modState: {},
      lastActivated: 0,
    } as unknown as types.IProfile;
    expect(decideDmfWarning(state(), [], false).shouldWarn).toBe(false);
  });

  it('does not warn when only DMF is enabled', () => {
    modsForDarktide = { dmf: mod('dmf', DMF_CANONICAL_NAME) };
    activeProfile = profile({ dmf: { enabled: true } });
    expect(decideDmfWarning(state(), [DMF_CANONICAL_NAME], false).shouldWarn).toBe(false);
  });

  it('does not warn when no mods are enabled', () => {
    modsForDarktide = { dmf: mod('dmf', DMF_CANONICAL_NAME), sb: mod('sb', 'scoreboard') };
    activeProfile = profile({ dmf: { enabled: false }, sb: { enabled: false } });
    expect(decideDmfWarning(state(), [], false).shouldWarn).toBe(false);
  });

  it('warns when at least one non-DMF mod is enabled and DMF is not enabled', () => {
    modsForDarktide = { sb: mod('sb', 'scoreboard') };
    activeProfile = profile({ sb: { enabled: true } });
    const decision = decideDmfWarning(state(), ['scoreboard'], false);
    expect(decision.shouldWarn).toBe(true);
    expect(decision.reason).toMatch(/DMF is not enabled/);
  });

  it('warns when DMF is enabled but not first in the projected order', () => {
    modsForDarktide = {
      sb: mod('sb', 'scoreboard'),
      dmf: mod('dmf', DMF_CANONICAL_NAME),
    };
    activeProfile = profile({ sb: { enabled: true }, dmf: { enabled: true } });
    // The projected names list reflects `util.sortMods` output. Here a
    // user rule (or some other sort input) placed scoreboard before
    // DMF, so the warning should fire even though both are enabled.
    // The decision uses the projected order verbatim, not install-
    // state insertion order.
    const decision = decideDmfWarning(state(), ['scoreboard', DMF_CANONICAL_NAME], false);
    expect(decision.shouldWarn).toBe(true);
    expect(decision.reason).toMatch(/not first/);
  });

  it('does not warn when DMF is enabled and first in the projected order', () => {
    modsForDarktide = {
      dmf: mod('dmf', DMF_CANONICAL_NAME),
      sb: mod('sb', 'scoreboard'),
    };
    activeProfile = profile({ dmf: { enabled: true }, sb: { enabled: true } });
    // The projected names list places DMF first (the normal case after
    // the installer's auto `after DMF` rule on non-DMF mods).
    const decision = decideDmfWarning(state(), [DMF_CANONICAL_NAME, 'scoreboard'], false);
    expect(decision.shouldWarn).toBe(false);
    expect(decision.reason).toMatch(/first/);
  });

  it('treats DMF detection case-insensitively on both sides (state and projected names)', () => {
    modsForDarktide = {
      dmf: mod('dmf', 'DMF'),
      sb: mod('sb', 'scoreboard'),
    };
    activeProfile = profile({ dmf: { enabled: true }, sb: { enabled: true } });
    // DMF canonical name is lowercase (`dmf`); both the state attribute
    // (`DMF`) and the projected first slot (`Dmf`) must match it
    // case-insensitively.
    expect(decideDmfWarning(state(), ['Dmf', 'scoreboard'], false).shouldWarn).toBe(false);
  });

  it('treats a mod with a missing relayModName attribute as a non-DMF mod', () => {
    modsForDarktide = {
      foreign: { id: 'foreign', attributes: {} } as unknown as types.IMod,
    };
    activeProfile = profile({ foreign: { enabled: true } });
    expect(decideDmfWarning(state(), [], false).shouldWarn).toBe(true);
  });
});

describe('DMF soft warning: flag file persistence', () => {
  it('persistDmfWarningFlag writes a version 1 file with an ISO 8601 timestamp', async () => {
    const flagPath = path.join(modRootDirectory, DMF_WARNING_FILE_NAME);
    await persistDmfWarningFlag(flagPath);
    const parsed = readDmfWarningFlag(flagPath);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
    const ts = new Date(parsed!.warnedAt);
    expect(ts.getTime()).not.toBeNaN();
  });

  it('readDmfWarningFlag returns null when the file is absent', () => {
    const flagPath = path.join(dir, 'missing-flag.json');
    expect(readDmfWarningFlag(flagPath)).toBeNull();
  });

  it('readDmfWarningFlag returns null for a malformed file', async () => {
    const flagPath = path.join(dir, 'malformed.json');
    await fs.writeFile(flagPath, 'not valid json');
    expect(readDmfWarningFlag(flagPath)).toBeNull();
  });

  it('readDmfWarningFlag returns null for an unsupported schema version', async () => {
    const flagPath = path.join(dir, 'old-version.json');
    await fs.writeFile(
      flagPath,
      JSON.stringify({ version: 999, warnedAt: '2025-01-01T00:00:00.000Z' }),
    );
    expect(readDmfWarningFlag(flagPath)).toBeNull();
  });

  it('readDmfWarningFlag returns null when warnedAt is not a string', async () => {
    const flagPath = path.join(dir, 'bad-shape.json');
    await fs.writeFile(flagPath, JSON.stringify({ version: 1, warnedAt: 42 }));
    expect(readDmfWarningFlag(flagPath)).toBeNull();
  });

  it('persistDmfWarningFlag creates the parent directory when missing', async () => {
    // The hook may run on a fresh install before setup has created the
    // mod root. The persist helper must ensure the parent exists.
    const nestedFlag = path.join(dir, 'nested', 'deep', DMF_WARNING_FILE_NAME);
    await persistDmfWarningFlag(nestedFlag);
    expect(readDmfWarningFlag(nestedFlag)).not.toBeNull();
  });

  it('persistDmfWarningFlag overwrites an existing flag file atomically', async () => {
    const flagPath = path.join(modRootDirectory, DMF_WARNING_FILE_NAME);
    await fs.mkdir(modRootDirectory, { recursive: true });
    await fs.writeFile(flagPath, 'stale content');
    await persistDmfWarningFlag(flagPath);
    const parsed = readDmfWarningFlag(flagPath);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
  });
});

describe('DMF soft warning: hook wiring (fire-once)', () => {
  beforeEach(async () => {
    await writeCompleteRelayRuntime();
    discovery = { path: gameDirectory };
    await writeDiscoveredDarktideBinary();
    // Provide an enabled non-DMF mod with no DMF: warning condition met.
    modsForDarktide = { sb: mod('sb', 'scoreboard') };
    activeProfile = profile({ sb: { enabled: true } });
    await writeDeployedMods(['scoreboard']);
  });

  it('writes the flag file and sends a notification on the first Relay launch', async () => {
    const api = stubApi();
    const hook = createStartHook(api);
    await hook(relayCall());
    const flagPath = path.join(modRootDirectory, DMF_WARNING_FILE_NAME);
    expect(readDmfWarningFlag(flagPath)).not.toBeNull();
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    // Cast via `as` because stubApi's IExtensionApi cast hides the vi.fn
    // type of sendNotification; the actual call signature returns the
    // INotification argument we passed in.
    const calls = (api.sendNotification as ReturnType<typeof vi.fn>).mock.calls as unknown as [
      { type: string; message: string },
    ][];
    const notifArg = calls[0]![0];
    expect(notifArg.type).toBe('info');
    expect(notifArg.message).toMatch(/DMF/i);
  });

  it('does not re-fire on a second Relay launch once the flag file exists', async () => {
    const api = stubApi();
    const hook = createStartHook(api);
    await hook(relayCall());
    await hook(relayCall());
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('never blocks the launch even when the warning fires', async () => {
    const api = stubApi();
    const hook = createStartHook(api);
    await expect(hook(relayCall())).resolves.toBeDefined();
    expect(api.sendNotification).toHaveBeenCalled();
  });

  it('does not fire when DMF is enabled and first', async () => {
    modsForDarktide = {
      dmf: mod('dmf', DMF_CANONICAL_NAME),
      sb: mod('sb', 'scoreboard'),
    };
    activeProfile = profile({ dmf: { enabled: true }, sb: { enabled: true } });
    await writeDeployedMods([DMF_CANONICAL_NAME, 'scoreboard']);
    const api = stubApi();
    const hook = createStartHook(api);
    await hook(relayCall());
    expect(api.sendNotification).not.toHaveBeenCalled();
  });

  it('still launches cleanly when DMF is absent but no non-DMF mod is enabled', async () => {
    modsForDarktide = { sb: mod('sb', 'scoreboard') };
    activeProfile = profile({ sb: { enabled: false } });
    const api = stubApi();
    const hook = createStartHook(api);
    await expect(hook(relayCall())).resolves.toBeDefined();
    expect(api.sendNotification).not.toHaveBeenCalled();
  });

  it('re-arms the warning when the flag file is manually deleted', async () => {
    const api = stubApi();
    const hook = createStartHook(api);
    await hook(relayCall());
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    await fs.unlink(path.join(modRootDirectory, DMF_WARNING_FILE_NAME));
    await hook(relayCall());
    expect(api.sendNotification).toHaveBeenCalledTimes(2);
  });
});

describe('start hook: rejection mechanism', () => {
  beforeEach(async () => {
    activeProfile = profile({});
    discovery = { path: gameDirectory };
    await writeDiscoveredDarktideBinary();
  });

  it('rejects with a ProcessCanceled instance so Vortex surfaces it cleanly', async () => {
    // No relay runtime: hard check 2 fails. The hook must throw a
    // ProcessCanceled (per design.md, Launch guard, Outcome) so Vortex's
    // `applyStartHooks` recognizes it as a structured cancellation.
    const hook = createStartHook(stubApi());
    let caught: unknown;
    try {
      await hook(relayCall());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(util.ProcessCanceled);
    expect((caught as Error).message).toMatch(/bundled Relay launcher/i);
  });

  it('produces a distinct message per failed hard check', async () => {
    const hook = createStartHook(stubApi());
    // Hard check 2: relay launcher missing.
    await expect(hook(relayCall())).rejects.toThrow(/bundled Relay launcher/i);

    // Hard check 3: relay launcher present, but the discovered binary is
    // missing.
    await writeCompleteRelayRuntime();
    await fs.unlink(path.join(gameDirectory, 'binaries', 'Darktide.exe'));
    await expect(hook(relayCall())).rejects.toThrow(/discovered Darktide binary was not found/i);

    // Hard check 4: binary exists again, but a deployed <name>/<name>.mod
    // is missing for an enabled mod.
    await fs.writeFile(path.join(gameDirectory, 'binaries', 'Darktide.exe'), 'exe');
    modsForDarktide = { dmf: mod('dmf', 'dmf') };
    activeProfile = profile({ dmf: { enabled: true } });
    await expect(hook(relayCall())).rejects.toThrow(/missing their deployed .mod file/i);
  });
});
