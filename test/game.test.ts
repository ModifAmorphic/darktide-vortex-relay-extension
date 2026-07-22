import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fs, util } from '@nexusmods/vortex-api';

import {
  GAME_EXECUTABLE,
  GAME_ID,
  GAME_NAME,
  GAME_REQUIRED_FILES,
  DEPLOY_DIR_NAME,
  MOD_ROOT_DIR_NAME,
  NEXUS_PAGE_ID,
  STEAM_APP_ID,
  LOAD_ORDER_DIR_NAME,
  RELAY_TOOL_ID,
} from '../src/constants';
import { game, setupDiscoveredGame } from '../src/game';
import * as paths from '../src/paths';

// Predictable Windows userData path so assertions are exact. Production
// runs on Windows and CI runs on Windows, so path.join produces
// backslash-separated output.
const FAKE_USER_DATA = 'C:\\Users\\Test\\AppData\\Roaming\\Vortex';
const EXPECTED_DEPLOY_DIR = `${FAKE_USER_DATA}\\${MOD_ROOT_DIR_NAME}\\${DEPLOY_DIR_NAME}`;
const EXPECTED_MODS_CONTENT_DIR = `${EXPECTED_DEPLOY_DIR}\\mods`;
const EXPECTED_LOAD_ORDER_DIR = `${FAKE_USER_DATA}\\${MOD_ROOT_DIR_NAME}\\${LOAD_ORDER_DIR_NAME}`;

vi.mock('@nexusmods/vortex-api', () => ({
  util: { getVortexPath: vi.fn() },
  fs: { ensureDirWritableAsync: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(util.getVortexPath).mockReturnValue(FAKE_USER_DATA);
  vi.mocked(fs.ensureDirWritableAsync).mockReset();
  vi.mocked(fs.ensureDirWritableAsync).mockResolvedValue(undefined);
});

describe('game registration object', () => {
  it('uses the distinct internal game id', () => {
    expect(game.id).toBe(GAME_ID);
  });

  it('uses the Darktide display name', () => {
    expect(game.name).toBe(GAME_NAME);
  });

  it('returns the relative Darktide executable', () => {
    expect(game.executable()).toBe(GAME_EXECUTABLE);
  });

  it('lists the required identifying files', () => {
    expect(game.requiredFiles).toEqual([...GAME_REQUIRED_FILES]);
  });

  it('enables shared-root deployment via mergeMods', () => {
    expect(game.mergeMods).toBe(true);
  });

  it('wires the Nexus page id for download/NXM routing', () => {
    expect(game.details?.nexusPageId).toBe(NEXUS_PAGE_ID);
  });

  it('records the Steam app id in details', () => {
    expect(game.details?.steamAppId).toBe(STEAM_APP_ID);
  });

  it('publishes the Steam app id under the steam store key for discovery', () => {
    // queryArgs is keyed by store id; the value is an IStoreQuery. The bare
    // { id: STEAM_APP_ID } form would register under a store named "id" and
    // Steam discovery would never match it.
    expect(game.queryArgs).toEqual({ steam: { id: STEAM_APP_ID } });
  });

  it('does not set an environment (Relay owns its Steam child env)', () => {
    expect(game.environment).toBeUndefined();
  });

  it('returns the absolute modsContentDir for queryModPath', () => {
    // queryModPath returns <deployDir>/mods so each mod deploys to
    // <deployDir>/mods/<name>/, matching the Mod Relay layout.
    expect(game.queryModPath('/discovered/darktide')).toBe(EXPECTED_MODS_CONTENT_DIR);
  });

  it('queryModPath ignores the discovered game path argument', () => {
    const fromOne = game.queryModPath('/first/darktide');
    const fromOther = game.queryModPath('/completely/different/darktide');
    expect(fromOne).toBe(fromOther);
    expect(fromOne).toBe(EXPECTED_MODS_CONTENT_DIR);
  });

  it('exposes setupDiscoveredGame as the setup callback', () => {
    expect(game.setup).toBe(setupDiscoveredGame);
  });

  it('registers the Relay tool via supportedTools (no registerTool API)', () => {
    // Vortex 2.3 has no context.registerTool; tools are declared on the
    // game's supportedTools array (api.d.ts line 4214).
    expect(game.supportedTools).toBeDefined();
    expect(game.supportedTools).toHaveLength(1);
    expect(game.supportedTools?.[0]?.id).toBe(RELAY_TOOL_ID);
  });
});

describe('setupDiscoveredGame', () => {
  it('creates deployDir, modsContentDir, and loadOrderDir exactly', async () => {
    await setupDiscoveredGame({ path: '/discovered/darktide' });

    expect(fs.ensureDirWritableAsync).toHaveBeenCalledTimes(3);
    expect(fs.ensureDirWritableAsync).toHaveBeenCalledWith(EXPECTED_DEPLOY_DIR);
    expect(fs.ensureDirWritableAsync).toHaveBeenCalledWith(EXPECTED_MODS_CONTENT_DIR);
    expect(fs.ensureDirWritableAsync).toHaveBeenCalledWith(EXPECTED_LOAD_ORDER_DIR);
  });

  it('derives all three directories from Vortex userData, not the discovery path', async () => {
    const discoveryPath = '/discovered/darktide/install';
    await setupDiscoveredGame({ path: discoveryPath });

    expect(util.getVortexPath).toHaveBeenCalledWith('userData');
    const calls = vi.mocked(fs.ensureDirWritableAsync).mock.calls.map((c) => c[0]);
    for (const dir of calls) {
      // Every directory must live under Vortex userData, never inside the
      // discovered Darktide install (design invariant, spec Section 1).
      expect(dir.startsWith(FAKE_USER_DATA)).toBe(true);
      expect(dir.startsWith(discoveryPath)).toBe(false);
    }
  });

  it('matches the path helpers exactly (single source of truth)', async () => {
    await setupDiscoveredGame({});

    expect(fs.ensureDirWritableAsync).toHaveBeenCalledWith(paths.deployDir(FAKE_USER_DATA));
    expect(fs.ensureDirWritableAsync).toHaveBeenCalledWith(paths.modsContentDir(FAKE_USER_DATA));
    expect(fs.ensureDirWritableAsync).toHaveBeenCalledWith(paths.loadOrderDir(FAKE_USER_DATA));
  });

  it('resolves when all three directories are created successfully', async () => {
    await expect(setupDiscoveredGame({})).resolves.toBeUndefined();
  });

  it('rejects with an actionable message when directory creation fails', async () => {
    vi.mocked(fs.ensureDirWritableAsync).mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );

    await expect(setupDiscoveredGame({})).rejects.toThrow(/could not create its mod directory/i);
  });

  it('preserves the underlying cause for diagnostics', async () => {
    const cause = new Error('disk full');
    vi.mocked(fs.ensureDirWritableAsync).mockRejectedValueOnce(cause);

    let caught: unknown;
    try {
      await setupDiscoveredGame({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).cause).toBe(cause);
  });
});
