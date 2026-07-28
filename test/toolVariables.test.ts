import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { types } from '@nexusmods/vortex-api';
import { selectors, util } from '@nexusmods/vortex-api';

import { GAME_EXECUTABLE, GAME_ID, MOD_ROOT_DIR_NAME, DEPLOY_DIR_NAME } from '../src/constants';
import { createToolVariablesCallback } from '../src/toolVariables';
import { RELAY_GAME_BINARY_VAR, RELAY_MOD_PATH_VAR } from '../src/relayTool';

/**
 * The ToolParameterCB closes over the Vortex api to read live discovery
 * state at launch time; tests control selectors.discoveryByGame and
 * util.getVortexPath via the module-level mock, with per-test state
 * owned by closures in beforeEach. Path assertions assert exact Windows
 * backslash strings because production and CI run on Windows.
 */

vi.mock('@nexusmods/vortex-api', () => ({
  util: {
    getVortexPath: vi.fn(() => '/stub/vortex/userData'),
  },
  selectors: {
    discoveryByGame: vi.fn(() => undefined),
  },
}));

let userData: string;

let discovery: { path?: string } | undefined;

beforeEach(() => {
  userData = 'C:\\Users\\Test\\AppData\\Roaming\\Vortex';
  discovery = undefined;
  vi.mocked(util.getVortexPath).mockReturnValue(userData);
  vi.mocked(selectors.discoveryByGame).mockImplementation((_state: unknown, gameId: string) =>
    gameId === GAME_ID ? discovery : undefined,
  );
});

function stubApi(): types.IExtensionApi {
  return {
    getState: () => ({ persistent: { mods: {} } }),
  } as unknown as types.IExtensionApi;
}

describe('createToolVariablesCallback', () => {
  it('returns both RELAY_GAME_BINARY and RELAY_MOD_PATH keys', () => {
    const cb = createToolVariablesCallback(stubApi());
    const result = cb({ executable: 'x', args: [], options: {} });
    expect(result).toHaveProperty(RELAY_GAME_BINARY_VAR);
    expect(result).toHaveProperty(RELAY_MOD_PATH_VAR);
  });

  it('returns the discovered Darktide binary joined with the game executable', () => {
    discovery = { path: 'C:\\Games\\Darktide' };
    const cb = createToolVariablesCallback(stubApi());
    const result = cb({ executable: 'x', args: [], options: {} });
    expect(result[RELAY_GAME_BINARY_VAR]).toBe(
      `C:\\Games\\Darktide\\${GAME_EXECUTABLE.replace(/\//g, '\\')}`,
    );
  });

  it('returns the absolute deploy dir for RELAY_MOD_PATH', () => {
    const cb = createToolVariablesCallback(stubApi());
    const result = cb({ executable: 'x', args: [], options: {} });
    expect(result[RELAY_MOD_PATH_VAR]).toBe(
      `${userData}\\${MOD_ROOT_DIR_NAME}\\${DEPLOY_DIR_NAME}`,
    );
  });

  it('reflects changes to the discovered game path between calls', () => {
    const cb = createToolVariablesCallback(stubApi());
    discovery = { path: 'C:\\Games\\Darktide' };
    const first = cb({ executable: 'x', args: [], options: {} });
    discovery = { path: 'D:\\SteamLibrary\\Darktide' };
    const second = cb({ executable: 'x', args: [], options: {} });
    expect(first[RELAY_GAME_BINARY_VAR]).toBe(
      `C:\\Games\\Darktide\\${GAME_EXECUTABLE.replace(/\//g, '\\')}`,
    );
    expect(second[RELAY_GAME_BINARY_VAR]).toBe(
      `D:\\SteamLibrary\\Darktide\\${GAME_EXECUTABLE.replace(/\//g, '\\')}`,
    );
  });

  it('reflects changes to the Vortex userData path between calls', () => {
    const cb = createToolVariablesCallback(stubApi());
    const first = cb({ executable: 'x', args: [], options: {} });
    userData = 'E:\\VortexData';
    vi.mocked(util.getVortexPath).mockReturnValue(userData);
    const second = cb({ executable: 'x', args: [], options: {} });
    expect(first[RELAY_MOD_PATH_VAR]).not.toBe(second[RELAY_MOD_PATH_VAR]);
    expect(second[RELAY_MOD_PATH_VAR]).toBe(
      `E:\\VortexData\\${MOD_ROOT_DIR_NAME}\\${DEPLOY_DIR_NAME}`,
    );
  });

  it('returns an empty RELAY_GAME_BINARY when Darktide has not been discovered', () => {
    // Returns '' rather than the garbage relative path path.join would
    // produce for empty input ('binaries\\Darktide.exe').
    discovery = undefined;
    const cb = createToolVariablesCallback(stubApi());
    const result = cb({ executable: 'x', args: [], options: {} });
    expect(result[RELAY_GAME_BINARY_VAR]).toBe('');
  });

  it('returns an empty RELAY_GAME_BINARY when discovery has no path', () => {
    discovery = {};
    const cb = createToolVariablesCallback(stubApi());
    const result = cb({ executable: 'x', args: [], options: {} });
    expect(result[RELAY_GAME_BINARY_VAR]).toBe('');
  });

  it('does not throw when the IRunParameters argument is missing optional fields', () => {
    const cb = createToolVariablesCallback(stubApi());
    expect(() => cb({ executable: '', args: [], options: {} })).not.toThrow();
  });

  it('uses the discoveryByGame selector scoped to the Darktide game id', () => {
    discovery = { path: 'C:\\Games\\Darktide' };
    const cb = createToolVariablesCallback(stubApi());
    cb({ executable: 'x', args: [], options: {} });
    expect(selectors.discoveryByGame).toHaveBeenCalledWith(expect.anything(), GAME_ID);
  });

  it('uses the userData path from util.getVortexPath for the mod directory', () => {
    const cb = createToolVariablesCallback(stubApi());
    cb({ executable: 'x', args: [], options: {} });
    expect(util.getVortexPath).toHaveBeenCalledWith('userData');
  });
});
