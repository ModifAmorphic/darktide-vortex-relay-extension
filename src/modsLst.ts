/**
 * mods.lst projection (design.md).
 *
 * Serializes an ordered list of canonical Darktide mod names to `mods.lst`
 * file content and writes it atomically to the mods content directory
 * (`<deployDir>/mods/`, where Relay's launcher expects to find it). Relay
 * reads `mods.lst` at launch and treats an empty file as "no mods load"
 * (reference doc Section 4).
 *
 * The pure helpers (`serializeModsLst`, `projectModsLst`) have no Vortex
 * imports. The higher-level {@link projectActiveProfileModsLst}
 * orchestrator (design.md, mods.lst projection, Projection orchestrator) wires those helpers to the live
 * Vortex state and `util.sortMods`. It is invoked from the `did-deploy`
 * and `profile-did-change` event handlers registered in `./index.ts`.
 *
 * Format choices (do not change without operator approval):
 *
 * - One canonical name per line.
 * - CRLF line endings. The project is Windows-only and CRLF matches the
 *   convention used elsewhere in the codebase. Relay's reader trims
 *   surrounding whitespace per line so it tolerates either ending, but
 *   emitting CRLF keeps `mods.lst` consistent with the files Vortex
 *   stages and deploys on Windows.
 * - Non-empty content ends with a trailing CRLF.
 * - Empty list produces an empty string, which writes a zero-byte file.
 *   Relay's contract explicitly treats an empty file as "no mods load".
 */

import * as path from 'node:path';

import type { types } from '@nexusmods/vortex-api';
import { selectors, util } from '@nexusmods/vortex-api';

import { GAME_ID, MOD_ATTRIBUTE_NAME } from './constants';
import * as paths from './paths';
import { writeAtomic } from './util/fs';

/** Line ending used between and after `mods.lst` entries. */
const MODS_LST_LINE_ENDING = '\r\n';

/**
 * Pure projection: serializes an ordered list of canonical Darktide mod
 * names to `mods.lst` file content.
 *
 * Format (design.md, mods.lst projection):
 *
 * - one canonical name per line;
 * - CRLF line endings;
 * - for a non-empty list, the content ends with a trailing CRLF;
 * - for an empty list, returns an empty string (writes a zero-byte file).
 *
 * The input array is not mutated.
 *
 * @param names canonical mod names in authoritative load order.
 */
export function serializeModsLst(names: readonly string[]): string {
  if (names.length === 0) {
    return '';
  }
  return names.join(MODS_LST_LINE_ENDING) + MODS_LST_LINE_ENDING;
}

/**
 * Projects an ordered list of canonical mod names to
 * `<modsContentDir>/mods.lst`.
 *
 * Combines {@link serializeModsLst} with {@link writeAtomic}. Throws on
 * write failure; callers decide retry and logging policy.
 *
 * @param modsContentDir absolute path to the directory that contains
 *   `mods.lst` and the deployed mod trees (from
 *   `paths.modsContentDir(...)`).
 * @param names canonical mod names in authoritative load order.
 */
export async function projectModsLst(
  modsContentDir: string,
  names: readonly string[],
): Promise<void> {
  const targetPath = path.join(modsContentDir, 'mods.lst');
  await writeAtomic(targetPath, serializeModsLst(names));
}

/**
 * Projects the active profile's enabled mods to
 * `<modsContentDir>/mods.lst` (design.md, mods.lst projection, Projection orchestrator), ordering them via
 * Vortex's built-in `util.sortMods`.
 *
 * Steps:
 *
 * 1. Reads the active profile via `selectors.activeProfile`. Returns
 *    silently when there is no active profile or the active profile does
 *    not belong to this game, so a non-Darktide active game receives no
 *    side effect (design.md, Extension entry).
 * 2. Reads installed mods for the Darktide game id via
 *    `selectors.modsForGame`.
 * 3. Filters to mods that are profile-enabled in the active profile's
 *    `modState`. Profile enable/disable is the single source of enabled
 *    state.
 * 4. Calls `util.sortMods(gameId, enabledMods, api)` to resolve the
 *    deploy order from the mods' `rules` arrays (the installer's auto
 *    `after DMF` rule plus any user-added rules).
 * 5. Maps each sorted mod to its canonical name via the `relayModName`
 *    attribute, dropping any mod whose attribute is missing or not a
 *    string (defense in depth).
 * 6. Writes the names via {@link projectModsLst}.
 *
 * Throws on sort or write failure. The `did-deploy` and
 * `profile-did-change` handlers in `./index.ts` catch and surface via
 * `api.showErrorNotification`.
 *
 * Version grounding (verified against the installed
 * `@nexusmods/vortex-api@2.3.0-beta.1` types):
 *
 * - `util.sortMods: (gameId, mods, api) => Promise<IMod[]>` is in the
 *   installed types (api.d.ts line 8732) and re-exported on the `util`
 *   namespace (api.d.ts line 9394). No cast is required.
 * - `CycleError` (api.d.ts line 943) is thrown by `sortMods` when the
 *   rule graph contains a cycle. Its `cycles: string[][]` property
 *   enumerates the offending mod-id cycles; this function rethrows with
 *   a message that includes the cycle so the user can act on it.
 * - `selectors.activeProfile: (state) => IProfile | undefined`
 *   (api.d.ts line 327).
 * - `selectors.modsForGame: (state, gameId) => { [modId: string]: IMod }`
 *   (api.d.ts line 7429).
 * - `IProfile.modState: { [id: string]: IProfileMod }`,
 *   `IProfileMod.enabled: boolean` (api.d.ts lines 5857, 5871).
 * - `util.getVortexPath('userData'): string` (api.d.ts line 1870).
 *
 * @param api the Vortex extension api.
 */
export async function projectActiveProfileModsLst(api: types.IExtensionApi): Promise<void> {
  const projection = await resolveActiveProfileProjection(api);
  if (projection === undefined) {
    return;
  }
  await projectModsLst(projection.modsContentDir, projection.names);
}

/**
 * Outcome of the projection orchestrator when there is work to do.
 * Returned by {@link resolveActiveProfileProjection} and consumed by
 * {@link projectActiveProfileModsLst} (which writes the file and
 * discards the names).
 */
interface ActiveProfileProjection {
  /**
   * Absolute path of the directory that contains `mods.lst` and the
   * deployed mod trees (`paths.modsContentDir(...)`). Relay consumes
   * the parent (`paths.deployDir(...)`) via `--mod-path`; this is the
   * `mods/` content subdirectory beneath it.
   */
  modsContentDir: string;
  /**
   * Canonical mod names in authoritative load order, with unsafe or
   * non-string attributes already filtered out.
   */
  names: string[];
}

/**
 * Shared projection core: reads live Vortex state, sorts enabled mods
 * via `util.sortMods`, and extracts the canonical names. Returns
 * `undefined` when there is no active profile or the active profile
 * belongs to a different game, so callers can short-circuit without
 * touching the filesystem.
 *
 * Rethrows `CycleError` with an actionable message (see
 * {@link projectActiveProfileModsLst}).
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
