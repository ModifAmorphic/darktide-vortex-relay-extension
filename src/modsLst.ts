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
 * and `profile-did-change` event handlers registered in `./index.ts`;
 * the Relay start hook calls {@link projectAndValidateModsLst}, which
 * returns the projected names and any validation problems so the hook
 * can block launch when deployed state is inconsistent.
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

import { DMF_CANONICAL_NAME, GAME_ID, MOD_ATTRIBUTE_NAME } from './constants';
import * as paths from './paths';
import { isSafeCanonicalName } from './util/names';
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
 * `api.showErrorNotification`; the Relay start hook calls
 * {@link projectAndValidateModsLst} (which runs the same projection and
 * additionally returns validation problems so the hook can block
 * launch on inconsistent deployed state).
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
 * Returned by {@link resolveActiveProfileProjection}; consumed by both
 * {@link projectActiveProfileModsLst} (writes the file and discards
 * the names) and {@link projectAndValidateModsLst} (writes the file
 * and additionally validates the names against deployed state).
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
 * Extracted from {@link projectActiveProfileModsLst} so the start hook
 * ({@link projectAndValidateModsLst}) can reuse the exact same
 * projection and add validation without re-implementing the read+sort
 * pipeline.
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

/**
 * A single projected mod that failed launch-time validation (design.md,
 * Launch guard, Hard checks). `reason` is the actionable text the start
 * hook surfaces through the Vortex error dialog.
 */
export interface ProjectionProblem {
  /** Vortex mod id when known; empty string for list-only problems. */
  modId: string;
  /** Canonical Darktide folder name (`relayModName`). */
  relayModName: string;
  /** Human-readable reason this entry failed validation. */
  reason: string;
}

/**
 * Outcome of {@link projectAndValidateModsLst}. The deploy and
 * profile-change handlers ignore `problems` and only need the write to
 * happen; the Relay start hook treats `ok === false` as a launch-
 * blocking error (design.md, Launch guard, Hard checks) and consumes `names`
 * for the DMF soft-warning position check (design.md, Launch guard, Soft warning).
 */
export interface ProjectionResult {
  /**
   * `true` when the projection completed and every projected name
   * passed validation. `false` when one or more problems were
   * detected; the file is still written (best effort) so any partial
   * state is consistent with current Vortex state.
   */
  ok: boolean;
  /**
   * Canonical mod names in authoritative load order, exactly as
   * written to `mods.lst`. Reflects `util.sortMods` output (NOT
   * install-state iteration order). Consumed by the Relay start hook
   * for the DMF-position check so the warning decision uses the same
   * projected order the loader will see at launch. Empty when there
   * is no active profile or no enabled mods.
   */
  names: string[];
  /** Each validation failure; empty when `ok === true`. */
  problems: ProjectionProblem[];
}

/**
 * Projects the active profile's enabled mods to
 * `<modsContentDir>/mods.lst` and validates the result against the
 * projected names (design.md, Launch guard, Hard checks).
 *
 * Validation set (design.md, Launch guard, Hard checks):
 *
 * - no duplicate `relayModName` values (case-insensitive);
 * - no `relayModName` contains path separators or traversal components;
 * - every listed canonical name passed the installer's safe-name
 *   validation (defense in depth; the installer should already have
 *   rejected unsafe names).
 *
 * Filesystem existence (`<modsContentDir>/<name>/<name>.mod` exists on
 * disk) is intentionally NOT checked here. The start hook performs
 * that check separately so the projection itself stays pure with
 * respect to the mods content directory: the orchestrator writes the
 * projected list, and the hook adds deploy-state validation that
 * depends on the live filesystem at launch time.
 *
 * Returns `ok: true` when there is no active profile or the active
 * profile belongs to a different game; the start hook treats the
 * absence of Darktide state as a separate hard check (design.md, Launch
 * guard, Hard checks) so this function only reports problems it can detect
 * from the projected names themselves.
 *
 * @param api the Vortex extension api.
 */
export async function projectAndValidateModsLst(
  api: types.IExtensionApi,
): Promise<ProjectionResult> {
  const projection = await resolveActiveProfileProjection(api);
  if (projection === undefined) {
    return { ok: true, names: [], problems: [] };
  }
  const problems = validateProjectedNames(projection.names);
  await projectModsLst(projection.modsContentDir, projection.names);
  return { ok: problems.length === 0, names: projection.names, problems };
}

/**
 * Pure validation: inspects the projected canonical-name list and
 * returns each failure. Used by {@link projectAndValidateModsLst};
 * exported separately so unit tests cover every rule directly without
 * a Vortex api or filesystem.
 *
 * Rules (design.md, Launch guard, Hard checks):
 *
 * - duplicate names (case-insensitive);
 * - names that fail safe-name validation (separators, traversal,
 *   empty, absolute). The installer's safe-name check is the first
 *   line of defense; this is the defense-in-depth second line.
 */
export function validateProjectedNames(names: readonly string[]): ProjectionProblem[] {
  const problems: ProjectionProblem[] = [];

  // Case-insensitive duplicate detection (Windows filesystem semantics
  // and Relay runtime treat names that differ only in case as the same
  // folder).
  const seen = new Map<string, string>();
  for (const name of names) {
    if (typeof name !== 'string' || name.length === 0) {
      continue;
    }
    const lower = name.toLowerCase();
    const firstSeen = seen.get(lower);
    if (firstSeen !== undefined) {
      problems.push({
        modId: '',
        relayModName: name,
        reason: `duplicate canonical name "${name}" (already seen as "${firstSeen}")`,
      });
    } else {
      seen.set(lower, name);
    }
  }

  // Safe-name validation. The installer's `isSafeCanonicalName` is the
  // canonical rule; the start hook re-applies it so an unsafe name
  // reaching this point (for example a manually edited mod attribute
  // or a future installer regression) cannot write a path-traversal
  // entry into mods.lst.
  for (const name of names) {
    if (typeof name !== 'string' || name.length === 0) {
      continue;
    }
    if (!isSafeCanonicalName(name)) {
      problems.push({
        modId: '',
        relayModName: name,
        reason: `canonical name "${name}" is unsafe (empty, contains a path separator, or is "."/"..")`,
      });
    }
  }

  return problems;
}

/**
 * Indicates whether DMF is the first name in the projected list (the
 * soft-warning condition, design.md, Launch guard, Soft warning). Pure helper
 * used by the start hook so the DMF-position logic is unit-testable
 * without an api.
 *
 * Returns `false` when the list is empty or the first name (case-
 * insensitive) is not the DMF canonical name. The check is
 * case-insensitive because Windows filesystems and Relay treat names
 * that differ only in case as the same folder.
 *
 * @param names projected canonical names in load order.
 */
export function isDmfFirst(names: readonly string[]): boolean {
  if (names.length === 0) {
    return false;
  }
  const first = names[0];
  if (typeof first !== 'string' || first.length === 0) {
    return false;
  }
  return first.toLowerCase() === DMF_CANONICAL_NAME;
}
