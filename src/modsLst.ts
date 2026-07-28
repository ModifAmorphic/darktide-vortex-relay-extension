/**
 * `mods.lst` projection. Serializes an ordered list of canonical Darktide
 * mod names and writes it atomically to the mods content directory; the
 * orchestrator wires that to live Vortex state and `util.sortMods`.
 */

import * as path from 'node:path';

import type { types } from '@nexusmods/vortex-api';
import { selectors, util } from '@nexusmods/vortex-api';

import { GAME_ID, MOD_ATTRIBUTE_NAME } from './constants';
import * as paths from './paths';
import { writeAtomic } from './util/fs';

const MODS_LST_LINE_ENDING = '\r\n';

/**
 * Serializes an ordered list of canonical mod names to `mods.lst` content.
 * Format: CRLF line endings; non-empty content ends with a trailing CRLF;
 * an empty list returns the empty string (writes a zero-byte file that
 * Relay treats as "no mods load").
 */
export function serializeModsLst(names: readonly string[]): string {
  if (names.length === 0) {
    return '';
  }
  return names.join(MODS_LST_LINE_ENDING) + MODS_LST_LINE_ENDING;
}

/**
 * Projects `names` to `<modsContentDir>/mods.lst` via {@link serializeModsLst}
 * and {@link writeAtomic}. Throws on write failure; callers decide retry
 * and logging.
 */
export async function projectModsLst(
  modsContentDir: string,
  names: readonly string[],
): Promise<void> {
  const targetPath = path.join(modsContentDir, 'mods.lst');
  await writeAtomic(targetPath, serializeModsLst(names));
}

/**
 * Projects the active profile's enabled mods to `<modsContentDir>/mods.lst`,
 * ordered via `util.sortMods`. Returns silently when there is no active
 * profile or it belongs to another game. Throws on sort or write failure;
 * the `did-deploy` and `profile-did-change` handlers catch and surface via
 * `showErrorNotification`.
 */
export async function projectActiveProfileModsLst(api: types.IExtensionApi): Promise<void> {
  const projection = await resolveActiveProfileProjection(api);
  if (projection === undefined) {
    return;
  }
  await projectModsLst(projection.modsContentDir, projection.names);
}

/** Result of {@link resolveActiveProfileProjection} when there is work to do. */
interface ActiveProfileProjection {
  /** Directory that contains `mods.lst` and the deployed mod trees. */
  modsContentDir: string;
  /** Canonical mod names in authoritative load order, already filtered. */
  names: string[];
}

/**
 * Projection core: reads live state, sorts enabled mods via `util.sortMods`,
 * and extracts canonical names. Returns `undefined` when there is no active
 * profile or it belongs to another game, so callers can short-circuit
 * without touching the filesystem. Rethrows `CycleError` with an actionable
 * message.
 */
async function resolveActiveProfileProjection(
  api: types.IExtensionApi,
): Promise<ActiveProfileProjection | undefined> {
  const state = api.getState();
  const profile = selectors.activeProfile(state);
  if (profile === undefined) {
    return undefined;
  }
  if (profile.gameId !== GAME_ID) {
    return undefined;
  }

  const modsForGame = selectors.modsForGame(state, GAME_ID);
  const enabledMods: types.IMod[] = [];
  for (const [modId, mod] of Object.entries(modsForGame)) {
    if (profile.modState[modId]?.enabled === true) {
      enabledMods.push(mod);
    }
  }

  let sorted: types.IMod[];
  try {
    sorted = await util.sortMods(GAME_ID, enabledMods, api);
  } catch (err) {
    if (err instanceof util.CycleError) {
      const cycleList = err.cycles
        .map((cycle, index) => `  ${index + 1}. ${cycle.join(' -> ')}`)
        .join('\n');
      throw new Error(
        `Darktide mod rules contain a dependency cycle; ` +
          `mods.lst cannot be projected until the cycle is broken ` +
          `(remove or fix the conflicting after/before rules).\n${cycleList}`,
        { cause: err },
      );
    }
    throw err;
  }

  const names: string[] = [];
  for (const mod of sorted) {
    const attr = mod.attributes?.[MOD_ATTRIBUTE_NAME];
    if (typeof attr === 'string' && attr.length > 0) {
      names.push(attr);
    }
  }

  const modsContentDir = paths.modsContentDir(util.getVortexPath('userData'));
  return { modsContentDir, names };
}
