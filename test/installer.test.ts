import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { types } from '@nexusmods/vortex-api';
import { selectors } from '@nexusmods/vortex-api';

import {
  DMF_CANONICAL_NAME,
  DMF_NEXUS_MOD_ID,
  GAME_ID,
  MOD_ATTRIBUTE_NAME,
} from '../src/constants';
import {
  INSTALLER_ID,
  INSTALLER_PRIORITY,
  createInstaller,
  planInstall,
  testSupported,
} from '../src/installer';

/**
 * The installer is exercised two ways:
 *
 * 1. Pure: tests call {@link planInstall} directly with a hand-rolled
 *    `existingMods` map. No Vortex state plumbing required.
 * 2. Via the factory: tests call {@link createInstaller} with a stub api
 *    whose `getState()` returns controllable state. `selectors.modsForGame`
 *    is mocked at module scope as a `vi.fn` and re-controlled per test via
 *    `vi.mocked(...)`. This verifies duplicate-name detection wires
 *    correctly through the live `selectors.modsForGame` lookup.
 *
 * Instruction shape grounding (see `src/installer.ts` header): fatal
 * rejections are emitted as `{ type: 'error', source: <message>,
 * value: 'fatal' }`. Vortex reads `source` as the user-facing message and
 * rejects the install when `value === 'fatal'`.
 */

/**
 * The mods dictionary the mocked `selectors.modsForGame` returns for the
 * Darktide game id in the current test. Reset in `beforeEach` to `{}` so
 * each test starts from an empty install state unless it explicitly sets
 * this. Factory tests that need duplicate-mod state assign to this object
 * before calling `installer.install`.
 */
let modsForDarktide: Record<string, types.IMod>;

vi.mock('@nexusmods/vortex-api', () => ({
  selectors: {
    // vi.fn so individual tests can override via vi.mocked(...).mockImplementation.
    modsForGame: vi.fn((_state: unknown, _gameId: string) => ({})),
  },
  util: { getVortexPath: vi.fn(() => '/stub') },
  fs: { ensureDirWritableAsync: vi.fn(() => Promise.resolve()) },
}));

beforeEach(() => {
  modsForDarktide = {};
  // Reset to the default behavior: return the controllable Darktide map for
  // the Darktide game id, empty object for any other game.
  vi.mocked(selectors.modsForGame).mockImplementation((_state, gameId) =>
    gameId === GAME_ID ? modsForDarktide : {},
  );
});

/** Empty existing-mods map for happy-path install tests. */
const NO_EXISTING_MODS: ReadonlyMap<string, string | undefined> = new Map();

/**
 * Helper: find the first instruction of a given type, or fail the test if
 * none exists. Keeps assertions readable when the plan emits one
 * attribute plus many copies.
 */
function firstInstructionOfType(
  instructions: types.IInstruction[],
  type: types.InstructionType,
): types.IInstruction {
  const found = instructions.find((i) => i.type === type);
  if (found === undefined) {
    throw new Error(
      `expected an instruction of type "${type}", got: ${JSON.stringify(instructions)}`,
    );
  }
  return found;
}

/**
 * Helper: returns `true` if any instruction in `instructions` is a `copy`
 * from `source` to `destination`. Avoids depending on instruction order
 * for plans that emit many copies.
 */
function hasCopy(instructions: types.IInstruction[], source: string, destination: string): boolean {
  return instructions.some(
    (i) => i.type === 'copy' && i.source === source && i.destination === destination,
  );
}

/** Builds a mod object with only the fields the installer reads. */
function modWithRelayName(modId: string, relayModName: string): types.IMod {
  return {
    id: modId,
    state: 'installed',
    type: '',
    installationPath: modId,
    attributes: { [MOD_ATTRIBUTE_NAME]: relayModName },
  };
}

/**
 * Builds a stub `IExtensionApi` whose `getState()` returns a minimal state
 * object. The `selectors.modsForGame` mock is controlled via the
 * module-level `modsForDarktide` variable (reset per test).
 */
function stubApi(): types.IExtensionApi {
  return {
    getState: () => ({ persistent: { mods: { [GAME_ID]: modsForDarktide } } }),
  } as unknown as types.IExtensionApi;
}

describe('installer constants', () => {
  it('exposes the spec installer id', () => {
    expect(INSTALLER_ID).toBe('darktide-relay-mod-installer');
  });

  it('uses priority 25 (within the 21-99 game-specific range)', () => {
    expect(INSTALLER_PRIORITY).toBe(25);
  });
});

describe('testSupported', () => {
  it('declines a non-Darktide game id', async () => {
    const result = await testSupported(['example.mod'], 'some-other-game');
    expect(result.supported).toBe(false);
    expect(result.requiredFiles).toEqual([]);
  });

  it('declines an empty file list', async () => {
    const result = await testSupported([], GAME_ID);
    expect(result.supported).toBe(false);
  });

  it('declines a file list with no .mod entries', async () => {
    const result = await testSupported(['readme.txt', 'scripts/foo.lua'], GAME_ID);
    expect(result.supported).toBe(false);
  });

  it('supports a file list with a single .mod entry', async () => {
    const result = await testSupported(['example/example.mod'], GAME_ID);
    expect(result.supported).toBe(true);
    expect(result.requiredFiles).toEqual([]);
  });

  it('supports a file list with multiple .mod entries (install handles rejection)', async () => {
    // The support test is intentionally permissive: install emits an
    // actionable error rather than silently declining.
    const result = await testSupported(['foo/foo.mod', 'bar/bar.mod'], GAME_ID);
    expect(result.supported).toBe(true);
  });

  it('supports an archive-root .mod', async () => {
    const result = await testSupported(['scoreboard.mod'], GAME_ID);
    expect(result.supported).toBe(true);
  });

  it('matches .mod extension case-insensitively', async () => {
    const result = await testSupported(['Example.MOD'], GAME_ID);
    expect(result.supported).toBe(true);
  });
});

describe('planInstall: happy paths', () => {
  it('installs a no-wrapper archive (.mod at root) with siblings', () => {
    const files = ['example.mod', 'scripts/foo.lua', 'scripts/bar.lua'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);

    // 3 copies + 1 attribute + 1 after-DMF rule.
    expect(result.instructions).toHaveLength(5);
    expect(hasCopy(result.instructions, 'example.mod', 'example/example.mod')).toBe(true);
    expect(hasCopy(result.instructions, 'scripts/foo.lua', 'example/scripts/foo.lua')).toBe(true);
    expect(hasCopy(result.instructions, 'scripts/bar.lua', 'example/scripts/bar.lua')).toBe(true);

    const attr = firstInstructionOfType(result.instructions, 'attribute');
    expect(attr.key).toBe(MOD_ATTRIBUTE_NAME);
    expect(attr.value).toBe('example');

    const rule = firstInstructionOfType(result.instructions, 'rule');
    expect(rule.rule?.type).toBe('after');
    expect(rule.rule?.reference?.repo?.repository).toBe('nexus');
    expect(rule.rule?.reference?.repo?.modId).toBe(DMF_NEXUS_MOD_ID);
    expect(rule.rule?.reference?.versionMatch).toBe('*');
  });

  it('installs a single-wrapper archive and excludes sibling docs', () => {
    const files = [
      'release-wrapper/example/example.mod',
      'release-wrapper/example/scripts/foo.lua',
      'release-wrapper/README.md', // outside the canonical subtree, not copied
    ];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);

    // Two copies (the .mod, the lua, but NOT the README) + 1 attribute +
    // 1 after-DMF rule.
    expect(result.instructions).toHaveLength(4);
    expect(
      hasCopy(result.instructions, 'release-wrapper/example/example.mod', 'example/example.mod'),
    ).toBe(true);
    expect(
      hasCopy(
        result.instructions,
        'release-wrapper/example/scripts/foo.lua',
        'example/scripts/foo.lua',
      ),
    ).toBe(true);
    expect(hasCopy(result.instructions, 'release-wrapper/README.md', 'example/README.md')).toBe(
      false,
    );

    const attr = firstInstructionOfType(result.instructions, 'attribute');
    expect(attr.key).toBe(MOD_ATTRIBUTE_NAME);
    expect(attr.value).toBe('example');

    expect(firstInstructionOfType(result.instructions, 'rule').rule?.type).toBe('after');
  });

  it('installs a nested-wrapper archive', () => {
    const files = [
      'a/b/example/example.mod',
      'a/b/example/scripts/init.lua',
      'a/b/example/assets/sprite.png',
    ];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);

    // 3 copies + 1 attribute + 1 after-DMF rule.
    expect(result.instructions).toHaveLength(5);
    expect(hasCopy(result.instructions, 'a/b/example/example.mod', 'example/example.mod')).toBe(
      true,
    );
    expect(
      hasCopy(result.instructions, 'a/b/example/scripts/init.lua', 'example/scripts/init.lua'),
    ).toBe(true);
    expect(
      hasCopy(result.instructions, 'a/b/example/assets/sprite.png', 'example/assets/sprite.png'),
    ).toBe(true);

    const attr = firstInstructionOfType(result.instructions, 'attribute');
    expect(attr.value).toBe('example');

    expect(firstInstructionOfType(result.instructions, 'rule').rule?.type).toBe('after');
  });

  it('installs DMF as a normal mod (canonical name dmf) and emits no after-DMF rule', () => {
    const files = ['dmf/dmf.mod', 'dmf/scripts/init.lua'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);

    // 2 copies + 1 attribute. DMF never gets a self-referential rule.
    expect(result.instructions).toHaveLength(3);
    expect(hasCopy(result.instructions, 'dmf/dmf.mod', 'dmf/dmf.mod')).toBe(true);
    expect(hasCopy(result.instructions, 'dmf/scripts/init.lua', 'dmf/scripts/init.lua')).toBe(true);
    const attr = firstInstructionOfType(result.instructions, 'attribute');
    expect(attr.value).toBe(DMF_CANONICAL_NAME);
    expect(result.instructions.some((i) => i.type === 'rule')).toBe(false);
  });

  it('installs DMF from an archive-root .mod (synthesizes dmf/) without an after-DMF rule', () => {
    const files = ['dmf.mod', 'scripts/dmf/init.lua'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);

    // 2 copies + 1 attribute; no rule for DMF.
    expect(result.instructions).toHaveLength(3);
    expect(hasCopy(result.instructions, 'dmf.mod', 'dmf/dmf.mod')).toBe(true);
    expect(hasCopy(result.instructions, 'scripts/dmf/init.lua', 'dmf/scripts/dmf/init.lua')).toBe(
      true,
    );
    expect(result.instructions.some((i) => i.type === 'rule')).toBe(false);
  });

  it('handles Windows-style backslash paths in the file list', () => {
    const files = ['example\\example.mod', 'example\\scripts\\foo.lua'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);

    // 2 copies + 1 attribute + 1 after-DMF rule.
    expect(result.instructions).toHaveLength(4);
    const copyInstrs = result.instructions.filter((i) => i.type === 'copy');
    expect(copyInstrs).toHaveLength(2);
    for (const instr of copyInstrs) {
      expect(instr.destination?.startsWith('example')).toBe(true);
    }
    const attr = firstInstructionOfType(result.instructions, 'attribute');
    expect(attr.value).toBe('example');
    expect(firstInstructionOfType(result.instructions, 'rule').rule?.type).toBe('after');
  });

  it('preserves interior dots in the canonical name', () => {
    const files = ['my.mod/my.mod.mod', 'my.mod/scripts/x.lua'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);
    const attr = firstInstructionOfType(result.instructions, 'attribute');
    expect(attr.value).toBe('my.mod');
    // Non-DMF canonical name still gets the rule.
    expect(firstInstructionOfType(result.instructions, 'rule').rule?.type).toBe('after');
  });

  it('skips directory entries when building the copy plan', () => {
    // Vortex's file walker emits directory entries with a trailing separator.
    const files = ['example/', 'example/example.mod', 'example/scripts/'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);

    const copyInstrs = result.instructions.filter((i) => i.type === 'copy');
    expect(copyInstrs).toHaveLength(1);
    expect(hasCopy(result.instructions, 'example/example.mod', 'example/example.mod')).toBe(true);
  });

  it('treats DMF detection case-insensitively (DMF, DMF, DmF all skip the rule)', () => {
    // The installer lowercases the canonical name before comparing to
    // DMF_CANONICAL_NAME so an archive whose .mod basename is `DMF.mod`
    // (uppercase) is still recognized as DMF and does not get a
    // self-referential rule.
    const files = ['DMF/DMF.mod'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);
    expect(result.instructions.some((i) => i.type === 'rule')).toBe(false);
  });
});

describe('planInstall: rejection paths', () => {
  it('emits a fatal error for a non-Darktide game id (defense in depth)', () => {
    const result = planInstall(['example.mod'], 'wrong-game', NO_EXISTING_MODS);
    expect(result.instructions).toHaveLength(1);
    const instr = result.instructions[0]!;
    expect(instr.type).toBe('error');
    expect(instr.value).toBe('fatal');
    expect(typeof instr.source).toBe('string');
    expect(instr.source!.length).toBeGreaterThan(0);
  });

  it('emits a fatal error when the archive has no .mod entry', () => {
    const result = planInstall(['readme.txt', 'scripts/foo.lua'], GAME_ID, NO_EXISTING_MODS);
    expect(result.instructions).toHaveLength(1);
    const instr = result.instructions[0]!;
    expect(instr.type).toBe('error');
    expect(instr.value).toBe('fatal');
    expect(instr.source).toMatch(/no \.mod entry/i);
  });

  it('emits a fatal error for multiple unrelated .mod entries', () => {
    const files = ['foo/foo.mod', 'foo/scripts/a.lua', 'bar/bar.mod', 'bar/scripts/b.lua'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);
    expect(result.instructions).toHaveLength(1);
    const instr = result.instructions[0]!;
    expect(instr.type).toBe('error');
    expect(instr.value).toBe('fatal');
    expect(instr.source).toMatch(/multiple unrelated \.mod entries/i);
    // Message should list the .mod entry paths so the user can find them.
    expect(instr.source).toContain('"foo/foo.mod"');
    expect(instr.source).toContain('"bar/bar.mod"');
  });

  it('emits a fatal error for multiple .mod entries in one subtree', () => {
    const files = ['example/example.mod', 'example/example_backup.mod'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);
    expect(result.instructions).toHaveLength(1);
    const instr = result.instructions[0]!;
    expect(instr.type).toBe('error');
    expect(instr.value).toBe('fatal');
    expect(instr.source).toMatch(/multiple \.mod entries inside one subtree/i);
  });

  it('emits a fatal error for basename/directory disagreement (foo/example.mod)', () => {
    const files = ['foo/example.mod'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);
    expect(result.instructions).toHaveLength(1);
    const instr = result.instructions[0]!;
    expect(instr.type).toBe('error');
    expect(instr.value).toBe('fatal');
    expect(instr.source).toMatch(/basename/i);
    expect(instr.source).toMatch(/disagree/i);
  });

  it('emits a fatal error for a path-traversal .mod (../escape.mod)', () => {
    // `../escape.mod` has basename `escape`, a safe name, but its containing
    // directory `..` disagrees with the basename. The directory-agreement
    // check is what catches this case.
    const files = ['../escape.mod'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);
    expect(result.instructions).toHaveLength(1);
    const instr = result.instructions[0]!;
    expect(instr.type).toBe('error');
    expect(instr.value).toBe('fatal');
  });

  it('emits a fatal error when the canonical name reduces to "."', () => {
    // A file literally named `..mod` strips to `.`; the agreement check
    // passes (single-segment path), but isSafeCanonicalName rejects `.`.
    const files = ['..mod'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);
    expect(result.instructions).toHaveLength(1);
    const instr = result.instructions[0]!;
    expect(instr.type).toBe('error');
    expect(instr.value).toBe('fatal');
    expect(instr.source).toMatch(/unsafe canonical mod name/i);
    expect(instr.source).toContain('"."');
  });

  it('emits a fatal error when the canonical name reduces to empty', () => {
    // A file literally named `.mod` strips to empty; isSafeCanonicalName
    // rejects empty.
    const files = ['.mod'];
    const result = planInstall(files, GAME_ID, NO_EXISTING_MODS);
    expect(result.instructions).toHaveLength(1);
    const instr = result.instructions[0]!;
    expect(instr.type).toBe('error');
    expect(instr.value).toBe('fatal');
    expect(instr.source).toMatch(/unsafe canonical mod name/i);
  });

  it('rejects a duplicate canonical name from existing mod state (case-insensitive)', () => {
    const existing = new Map<string, string | undefined>([
      ['vortex-mod-id-1', 'Example'], // already installed under capitalized form
    ]);
    const files = ['example/example.mod'];
    const result = planInstall(files, GAME_ID, existing);
    expect(result.instructions).toHaveLength(1);
    const instr = result.instructions[0]!;
    expect(instr.type).toBe('error');
    expect(instr.value).toBe('fatal');
    expect(instr.source).toMatch(/already installed/i);
    expect(instr.source).toContain('example');
    expect(instr.source).toContain('vortex-mod-id-1');
  });

  it('allows install when existing mods have unrelated canonical names', () => {
    const existing = new Map<string, string | undefined>([['other-mod', 'other_name']]);
    const files = ['example/example.mod', 'example/scripts/x.lua'];
    const result = planInstall(files, GAME_ID, existing);
    // Should produce the happy-path plan, not a duplicate error.
    // 2 copies + 1 attribute + 1 after-DMF rule.
    expect(result.instructions).toHaveLength(4);
    expect(firstInstructionOfType(result.instructions, 'attribute').value).toBe('example');
    expect(firstInstructionOfType(result.instructions, 'rule').rule?.type).toBe('after');
  });

  it('ignores existing mods whose relayModName attribute is missing', () => {
    // Mods installed by other extensions may not carry relayModName.
    const existing = new Map<string, string | undefined>([['foreign-mod', undefined]]);
    const files = ['example/example.mod'];
    const result = planInstall(files, GAME_ID, existing);
    expect(result.instructions.some((i) => i.type === 'error')).toBe(false);
  });
});

/**
 * Factory-path tests: verifies the api wiring for duplicate-name detection
 * matches the grounded `selectors.modsForGame(state, gameId)` read.
 */
describe('createInstaller', () => {
  it('returns an object with id, priority, testSupported, install', () => {
    const api = stubApi();
    const installer = createInstaller(api);
    expect(installer.id).toBe(INSTALLER_ID);
    expect(installer.priority).toBe(INSTALLER_PRIORITY);
    expect(typeof installer.testSupported).toBe('function');
    expect(typeof installer.install).toBe('function');
  });

  it('testSupported matches the pure export', async () => {
    const api = stubApi();
    const installer = createInstaller(api);
    const fromFactory = await installer.testSupported(['x.mod'], GAME_ID);
    const fromPure = await testSupported(['x.mod'], GAME_ID);
    expect(fromFactory).toEqual(fromPure);
  });

  it('install reads live state and rejects duplicates by canonical name', async () => {
    modsForDarktide = {
      'existing-mod-id': modWithRelayName('existing-mod-id', 'example'),
    };
    const api = stubApi();
    const installer = createInstaller(api);

    const result = await installer.install(
      ['example/example.mod'],
      '/staging/dest',
      GAME_ID,
      () => undefined,
      undefined,
      true,
      '/tmp/example.zip',
      undefined,
    );

    expect(result.instructions).toHaveLength(1);
    expect(result.instructions[0]!.type).toBe('error');
    expect(result.instructions[0]!.value).toBe('fatal');
    expect(result.instructions[0]!.source).toContain('existing-mod-id');
    // Verify the state lookup actually happened (guards against a future
    // regression that hardcodes an empty map).
    expect(selectors.modsForGame).toHaveBeenCalled();
  });

  it('install produces a happy-path plan when no duplicate exists', async () => {
    const api = stubApi();
    const installer = createInstaller(api);
    const result = await installer.install(
      ['example/example.mod', 'example/scripts/foo.lua'],
      '/staging/dest',
      GAME_ID,
      () => undefined,
    );
    // 2 copies + 1 attribute + 1 after-DMF rule.
    expect(result.instructions).toHaveLength(4);
    expect(result.instructions.some((i) => i.type === 'attribute' && i.value === 'example')).toBe(
      true,
    );
    expect(result.instructions.some((i) => i.type === 'rule')).toBe(true);
  });

  it('install reads mods scoped to the install gameId, not another game', async () => {
    // A mod with the same canonical name installed for a *different* game
    // must NOT be treated as a collision. selectors.modsForGame(state, gameId)
    // is scoped per-game; the mock returns the mod only for `other-game`
    // and an empty object for the Darktide game id.
    vi.mocked(selectors.modsForGame).mockImplementation(
      (_state, gameId): Record<string, types.IMod> => {
        if (gameId === 'other-game') {
          return { 'other-game-mod': modWithRelayName('other-game-mod', 'example') };
        }
        return {};
      },
    );
    const api = stubApi();
    const installer = createInstaller(api);
    const result = await installer.install(
      ['example/example.mod'],
      '/staging',
      GAME_ID,
      () => undefined,
    );
    expect(result.instructions.some((i) => i.type === 'error')).toBe(false);
  });

  it('install passes through to planInstall unmodified for happy paths', async () => {
    // Sanity: the factory's wiring does not drop instructions vs the pure
    // plan. Run both and assert deep equality on the instruction list.
    const api = stubApi();
    const installer = createInstaller(api);
    const files = ['example/example.mod', 'example/scripts/foo.lua'];
    const fromFactory = await installer.install(files, '/dest', GAME_ID, () => undefined);
    const fromPure = planInstall(files, GAME_ID, new Map());
    expect(fromFactory).toEqual(fromPure);
  });
});
