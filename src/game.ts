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
 * Darktide `IGame` registration for Vortex.
 */

/**
 * `game.setup`. Ensures the extension-owned directories under Vortex
 * userData exist and are writable before Vortex activates game-mode
 * management. A failure prevents management, which is correct: the user
 * gets one actionable error instead of mysterious deploy failures later.
 * The discovered Darktide path is unused; the extension never writes
 * inside the Darktide install.
 */
export async function setupDiscoveredGame(discovery: types.IDiscoveryResult): Promise<void> {
  void discovery;
  const userData = util.getVortexPath('userData');
  const deployDirPath = paths.deployDir(userData);
  const modsContentDirPath = paths.modsContentDir(userData);
  const loadOrderDirPath = paths.loadOrderDir(userData);
  try {
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
 * The Darktide `IGame` registration. `queryModPath` and `getModPaths['']`
 * both return `modsContentDir` (not `deployDir`) so the built-in Open Mod
 * Folder opens the directory holding the mod trees and `mods.lst`.
 * `supportedTools` carries the Relay tool; Vortex 2.3 has no separate
 * `registerTool`.
 */
export const game: types.IGame = {
  id: GAME_ID,
  name: GAME_NAME,
  executable: () => GAME_EXECUTABLE,
  requiredFiles: [...GAME_REQUIRED_FILES],
  queryModPath: () => paths.modsContentDir(util.getVortexPath('userData')),
  getModPaths: (_gamePath: string) => ({
    '': paths.modsContentDir(util.getVortexPath('userData')),
  }),
  // The installed IGame type declares `setup` returning the Bluebird-based
  // `Promise_2<void>`, but modern `async` returns native `Promise<void>`;
  // Vortex awaits any thenable at runtime, so the cast only bridges the
  // legacy type.
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
