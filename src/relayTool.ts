/**
 * Mod Relay supported-tool registration (spec Section 11).
 *
 * The extension bundles the Mod Relay runtime as an opaque unit beside
 * the built `index.js`. The only Relay file the extension names is
 * `mod_relay.exe`, the binary Vortex launches. Relay's internal runtime
 * layout (the injected DLL, the `mod_loader` Lua files, the legal
 * files) is Relay's concern; the extension does not inspect or
 * enumerate it, so a Relay release that adds, removes, renames, or
 * rearranges internal files cannot break the extension.
 *
 * Tools are NOT registered via a separate `registerTool` method. The
 * Vortex 2.3 API exposes supported tools as a per-game property:
 * `IGame.supportedTools?: ITool[]` (api.d.ts line 4214). `game.ts`
 * imports the {@link relayTool} object this module exports and adds it
 * to the game registration's `supportedTools` array.
 *
 * Version grounding (verified against the installed
 * `@nexusmods/vortex-api@2.3.0-beta.1` types):
 *
 * - `ITool` interface: api.d.ts lines 6824-6955.
 * - `ITool.id: string` (line 6830), `ITool.name: string` (line 6836),
 *   `ITool.shortName?: string` (line 6843).
 * - `ITool.queryPath?: () => string | Promise_2<string | IGameStoreEntry>`
 *   (line 6869). Vortex's quick discovery constructs
 *   `path.join(queryPathResult, executable(queryPathResult))` to verify
 *   the tool directory (reference doc Section 11). Returning the bundled
 *   `relayDir()` resolves the runtime correctly.
 * - `ITool.executable: (discoveredPath?: string) => string` (line 6886).
 *   Evaluated at discovery time; must not depend on values that change
 *   at runtime.
 * - `ITool.requiredFiles: string[]` (line 6909). Vortex accepts a
 *   directory as the tool directory only if every listed file exists
 *   relative to it. The list contains only the launcher binary,
 *   `mod_relay.exe`; the extension does not enumerate Relay's internal
 *   runtime files (spec Section 11).
 * - `ITool.parameters?: string[]` (line 6916). Each token is a separate
 *   array element; Vortex passes them as spawn arguments and strips
 *   literal quotes (reference doc Section 11).
 * - `ITool.environment?: { [key: string]: string }` (line 6921).
 *   Deliberately unset; Relay publishes its own Steam child environment
 *   and the game/tool registrations do not share environment scope
 *   (reference doc Section 5).
 * - `ITool.relative?: boolean` (line 6928). `false`: Relay is bundled
 *   with the extension, not under the game directory.
 * - `ITool.exclusive?: boolean` (line 6937). `true`: prevent other
 *   Vortex-launched tools from running alongside the modded game.
 * - `ITool.defaultPrimary?: boolean` (line 6949). `true`: Vortex picks
 *   Relay as the primary tool when several are installed.
 * - `ITool.onStart?: 'hide' | 'hide_recover' | 'close'` (line 6954).
 *   Left unset; the operator's preference controls Vortex visibility.
 *
 * `registerToolVariables` (spec Section 11.1) lives in `./toolVariables.ts`
 * because the callback needs the Vortex api to resolve the discovered
 * game path. This module is pure: it has no Vortex imports and no side
 * effects, which keeps the tool object unit-testable without mocking.
 */

import type { types } from '@nexusmods/vortex-api';

import {
  RELAY_EXECUTABLE,
  RELAY_TOOL_ID,
  RELAY_TOOL_NAME,
  RELAY_TOOL_SHORT_NAME,
} from './constants';
import { relayDir } from './paths';

/**
 * Tool variable placeholder for the discovered Darktide binary path.
 * Resolved at launch time by the {@link createToolVariablesCallback}
 * in `./toolVariables.ts`. Vortex substitutes the placeholder via
 * `string-template` formatting on each parameter token.
 */
export const RELAY_GAME_BINARY_VAR = 'RELAY_GAME_BINARY';

/**
 * Tool variable placeholder for the absolute mod directory path
 * (`paths.deployDir(...)`). Resolved at launch time by the
 * {@link createToolVariablesCallback} in `./toolVariables.ts`.
 */
export const RELAY_MOD_PATH_VAR = 'RELAY_MOD_PATH';

/**
 * The Mod Relay `ITool` registration object (spec Section 11).
 *
 * Vortex invokes the tool as
 *
 * ```text
 * <relayDir>/mod_relay.exe \
 *   --game-binary <RELAY_GAME_BINARY> \
 *   --mod-path <RELAY_MOD_PATH>
 * ```
 *
 * Each flag and value is its own array element so Vortex passes them
 * as separate spawn arguments without shell quoting.
 *
 * `queryPath` returns the bundled runtime directory, so this object is
 * a static const and needs no Vortex api closure. The api-dependent
 * parts of tool launch (variable resolution, start-hook validation)
 * live in `./toolVariables.ts` and `./startHook.ts`.
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
