import type { types } from '@nexusmods/vortex-api';
import { fs, util } from '@nexusmods/vortex-api';

import * as paths from './paths';
import { relayTool } from './relayTool';
import {
  GAME_EXECUTABLE,
  GAME_ID,
  GAME_NAME,
  GAME_REQUIRED_FILES,
  NEXUS_PAGE_ID,
  STEAM_APP_ID,
} from './constants';

/**
 * Darktide game registration for Vortex.
 *
 * Grounded identifiers and field semantics come from
 * `docs/reference/vortex-extension-development.md` Section 5 and
 * `docs/architecture/design.md` (Game registration). The internal game ID is
 * distinct from the Nexus domain; the Nexus download/NXM association is wired
 * through `details.nexusPageId`.
 *
 * Version-grounding note: the installed `@nexusmods/vortex-api` 2.3.0-beta.1
 * types export `fs` as a top-level namespace. The reference doc's import
 * example omitted `fs`, which this module adds explicitly. `fs` and `util`
 * resolve to the same runtime API proxy when Vortex loads the extension.
 */

/**
 * Ensures the extension-owned deployment, mods content, and load-order
 * directories under Vortex userData exist and are writable before Vortex
 * activates game-mode management.
 *
 * Used as `game.setup`. A failure prevents the game from being managed, which
 * is the correct behavior when the deployment target cannot be written: the
 * user gets a single actionable error instead of mysterious deploy failures
 * later.
 *
 * The discovered Darktide install path (`discovery.path`) is intentionally
 * unused. The extension never writes inside the Darktide installation
 * (design invariant; design.md, Design invariants), so all directories it creates live
 * under Vortex userData.
 *
 * @param discovery Vortex's discovery result for the located Darktide install.
 */
export async function setupDiscoveredGame(discovery: types.IDiscoveryResult): Promise<void> {
  void discovery;
  const userData = util.getVortexPath('userData');
  const deployDirPath = paths.deployDir(userData);
  const modsContentDirPath = paths.modsContentDir(userData);
  const loadOrderDirPath = paths.loadOrderDir(userData);
  try {
    // Parent first (deployDir), then its child (modsContentDir), then the
    // sibling load-order dir. ensureDirWritable with recursive semantics
    // would tolerate any order, but creating parent-first keeps the intent
    // explicit and matches the tree layout in paths.ts.
    await fs.ensureDirWritableAsync(deployDirPath);
    await fs.ensureDirWritableAsync(modsContentDirPath);
    await fs.ensureDirWritableAsync(loadOrderDirPath);
  } catch (cause) {
    throw new Error(
      `Darktide Relay could not create its mod directory under "${userData}". ` +
        'Ensure the location exists, is writable, and is not held open by ' +
        'another process, then retry managing the game in Vortex.',
      { cause },
    );
  }
}

/**
 * The Darktide `IGame` registration object.
 *
 * `queryModPath` ignores the discovered game path and returns the absolute
 * mods content directory (`<deployDir>/mods`) so no deployment ever lands
 * inside the Darktide install. `mergeMods: true` routes every staged mod
 * tree to that shared target root, so each mod deploys to
 * `<modsContentDir>/<name>/`, matching the Mod Relay layout (design.md, Mod directory).
 *
 * `supportedTools` registers the Mod Relay tool (design.md, Relay tool).
 * Vortex 2.3 has no separate `registerTool` method on `IExtensionContext`;
 * supported tools are declared per-game via `IGame.supportedTools` (api.d.ts
 * line 4214). Vortex discovers the tool from this list and surfaces it in
 * the launch UI.
 *
 * `getModPaths` returns the same `modsContentDir` for the default mod type
 * (`''`). Vortex's built-in "Open Mod Folder" dashboard action
 * (`openModFolder` in the renderer) resolves its target by calling
 * `getGame(gameId).getModPaths(discovered.path)[""]`. Without `getModPaths`
 * defined, that action silently fails for Darktide, so this is what makes
 * the built-in action work (design.md, User-facing actions). The empty-string key is the
 * default mod type, and returning `modsContentDir` (NOT `deployDir`) is
 * deliberate: `modsContentDir` is the directory that actually contains the
 * deployed mod folders and `mods.lst`, and it is the same value
 * `queryModPath` returns. Returning `deployDir` (the `--mod-path` parent)
 * would open the wrong directory for the user.
 *
 * `environment` is deliberately unset: Relay publishes its own Steam child
 * environment when it launches, and the game registration's environment does
 * not automatically reach a separately registered tool (reference doc
 * Section 5).
 */
export const game: types.IGame = {
  id: GAME_ID,
  name: GAME_NAME,
  executable: () => GAME_EXECUTABLE,
  requiredFiles: [...GAME_REQUIRED_FILES],
  queryModPath: () => paths.modsContentDir(util.getVortexPath('userData')),
  // Vortex's built-in "Open Mod Folder" action reads
  // `getModPaths(discovered.path)[""]`. Returning `modsContentDir` (the
  // directory that holds the deployed mod trees and `mods.lst`, matching
  // `queryModPath`) makes that action open the right directory for the
  // user. See the object-level doc comment for the full rationale.
  getModPaths: (_gamePath: string) => ({
    '': paths.modsContentDir(util.getVortexPath('userData')),
  }),
  // The installed IGame type declares setup as returning the Bluebird-based
  // `Promise_2<void>`, but modern `async` returns a native `Promise<void>`.
  // Vortex awaits any thenable at runtime, so this cast only bridges the
  // legacy API type with contemporary async/await code; no runtime behavior
  // changes.
  setup: setupDiscoveredGame as unknown as types.IGame['setup'],
  mergeMods: true,
  supportedTools: [relayTool],
  details: {
    nexusPageId: NEXUS_PAGE_ID,
    steamAppId: STEAM_APP_ID,
  },
  queryArgs: {
    steam: { id: STEAM_APP_ID },
  },
};
