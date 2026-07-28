/**
 * Mod Relay supported-tool registration. The extension bundles Relay as an
 * opaque unit; the only Relay file the extension names is `mod_relay.exe`.
 * Registered as an entry in `IGame.supportedTools` (Vortex 2.3 has no
 * separate `registerTool`).
 */

import type { types } from '@nexusmods/vortex-api';

import {
  RELAY_EXECUTABLE,
  RELAY_TOOL_ID,
  RELAY_TOOL_NAME,
  RELAY_TOOL_SHORT_NAME,
} from './constants';
import { relayDir } from './paths';

/** Tool-variable placeholder; resolved at launch (see `./toolVariables.ts`). */
export const RELAY_GAME_BINARY_VAR = 'RELAY_GAME_BINARY';

/** Tool-variable placeholder for the absolute mod directory; resolved at launch (see `./toolVariables.ts`). */
export const RELAY_MOD_PATH_VAR = 'RELAY_MOD_PATH';

/**
 * The Mod Relay `ITool` registration. Each parameter flag and value is a
 * separate array element so Vortex passes them as distinct spawn arguments
 * (no shell quoting). The api-dependent variable resolution lives in
 * `./toolVariables.ts`.
 */
export const relayTool: types.ITool = {
  id: RELAY_TOOL_ID,
  name: RELAY_TOOL_NAME,
  shortName: RELAY_TOOL_SHORT_NAME,
  relative: false,
  queryPath: () => relayDir(),
  executable: () => RELAY_EXECUTABLE,
  requiredFiles: [RELAY_EXECUTABLE],
  defaultPrimary: true,
  exclusive: true,
  parameters: [
    '--game-binary',
    `{${RELAY_GAME_BINARY_VAR}}`,
    '--mod-path',
    `{${RELAY_MOD_PATH_VAR}}`,
  ],
};
