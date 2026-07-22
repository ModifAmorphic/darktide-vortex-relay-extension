/**
 * Tool variable resolver for the Mod Relay launch (spec Section
 * 11.1).
 *
 * Registered via `context.registerToolVariables(callback)`. Vortex
 * invokes the callback at launch time, after start hooks have run but
 * before argument-token expansion. The returned object is merged with
 * variables from all other registered callbacks and substituted into
 * each parameter token via `string-template` formatting
 * (`ExtensionManager.ts` source lines around 2320-2324 in v2.3.0).
 *
 * The two variables this extension publishes:
 *
 * - `RELAY_GAME_BINARY`: the discovered
 *   `<gamePath>/binaries/Darktide.exe`. Resolved from Vortex's
 *   discovery state for the active game.
 * - `RELAY_MOD_PATH`: the absolute mod directory
 *   (`paths.deployDir(util.getVortexPath('userData'))`). Relay
 *   consumes this directory via `--mod-path`; the launcher expects
 *   `<mod-path>/mods/` to contain the mod folders and `mods.lst`.
 *
 * Both resolve from current Vortex state (active game discovery and
 * the extension's path constants). Neither depends on profile-specific
 * values that change between profile switches (spec Section 11.1).
 *
 * Version grounding (verified against the installed
 * `@nexusmods/vortex-api@2.3.0-beta.1` types):
 *
 * - `IExtensionContext.registerToolVariables: (callback: ToolParameterCB)
 *   => void` (api.d.ts line 3889).
 * - `ToolParameterCB = (options: IRunParameters) => { [key: string]: string }`
 *   (api.d.ts line 8974). The callback receives the upcoming launch
 *   parameters; it returns the variables to merge. We do not use the
 *   `options` argument because our variables do not depend on the
 *   specific tool being launched (this extension only registers one).
 * - `selectors.discoveryByGame: ParametricSelector<IState, string, IDiscoveryResult>`
 *   (api.d.ts line 1027). Returns the discovery info for `gameId`,
 *   including `path` (the discovered install directory).
 * - `IDiscoveryResult.path?: string` (api.d.ts line 2827). May be
 *   undefined when the game has not been discovered; the callback
 *   returns an empty string for `RELAY_GAME_BINARY` in that case
 *   so the start hook (not variable resolution) produces the
 *   actionable error.
 * - `util.getVortexPath('userData'): string` (api.d.ts line 1870).
 *
 * The callback is exported via {@link createToolVariablesCallback},
 * which closes over the Vortex api. The factory pattern mirrors
 * `createInstaller` in `./installer.ts`: it lets the pure variables
 * shape (constants only) be unit-tested without an api while the
 * factory wires the api-dependent discovery lookup.
 */

import * as nodePath from 'node:path';

import type { types } from '@nexusmods/vortex-api';
import { selectors, util } from '@nexusmods/vortex-api';

import { GAME_EXECUTABLE, GAME_ID } from './constants';
import * as paths from './paths';
import { RELAY_GAME_BINARY_VAR, RELAY_MOD_PATH_VAR } from './relayTool';

/**
 * Builds the `ToolParameterCB` for `context.registerToolVariables`.
 *
 * @param api the Vortex extension api from `IExtensionContext.api`.
 *   Used to read the live discovery state for the Darktide game id so
 *   `RELAY_GAME_BINARY` reflects the current install location at
 *   every launch.
 */
export function createToolVariablesCallback(
  api: types.IExtensionApi,
): (options: types.IRunParameters) => Record<string, string> {
  return (_options: types.IRunParameters): Record<string, string> => {
    const state = api.getState();
    const discovery = selectors.discoveryByGame(state, GAME_ID);
    const gamePath = discovery?.path ?? '';
    // path.join tolerates an empty gamePath (returns the relative
    // segment), so the result is 'binaries\\Darktide.exe' when the game
    // has not been discovered. Returning an empty string here keeps the
    // placeholder unexpanded; the start hook rejects the launch with a
    // specific message rather than letting Relay receive a garbage path.
    const gameBinary = gamePath.length === 0 ? '' : nodePath.join(gamePath, GAME_EXECUTABLE);
    const modPath = paths.deployDir(util.getVortexPath('userData'));
    return {
      [RELAY_GAME_BINARY_VAR]: gameBinary,
      [RELAY_MOD_PATH_VAR]: modPath,
    };
  };
}
