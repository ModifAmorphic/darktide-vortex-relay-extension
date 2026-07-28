/**
 * Tool-variable resolver for the Mod Relay launch. Registered via
 * `context.registerToolVariables`; returns `RELAY_GAME_BINARY` (discovered
 * Darktide binary) and `RELAY_MOD_PATH` (the extension's deploy directory)
 * at launch time.
 */

import * as nodePath from 'node:path';

import type { types } from '@nexusmods/vortex-api';
import { selectors, util } from '@nexusmods/vortex-api';

import { GAME_EXECUTABLE, GAME_ID } from './constants';
import * as paths from './paths';
import { RELAY_GAME_BINARY_VAR, RELAY_MOD_PATH_VAR } from './relayTool';

/**
 * Builds the `ToolParameterCB`. Closes over the api so `RELAY_GAME_BINARY`
 * reflects the current discovery path at every launch.
 */
export function createToolVariablesCallback(
  api: types.IExtensionApi,
): (options: types.IRunParameters) => Record<string, string> {
  return (_options: types.IRunParameters): Record<string, string> => {
    const state = api.getState();
    const discovery = selectors.discoveryByGame(state, GAME_ID);
    const gamePath = discovery?.path ?? '';
    // path.join tolerates empty gamePath (returns 'binaries\\Darktide.exe');
    // return '' instead so RELAY_GAME_BINARY is not a garbage relative path.
    const gameBinary = gamePath.length === 0 ? '' : nodePath.join(gamePath, GAME_EXECUTABLE);
    const modPath = paths.deployDir(util.getVortexPath('userData'));
    return {
      [RELAY_GAME_BINARY_VAR]: gameBinary,
      [RELAY_MOD_PATH_VAR]: modPath,
    };
  };
}
