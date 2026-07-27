/**
 * Launch guard for the Mod Relay tool (design.md, Launch guard).
 *
 * Registered via `context.registerStartHook(priority, id, hook)`. Vortex
 * runs all start hooks before argument-variable expansion and process
 * spawn (reference doc Section 11; v2.3.0 source
 * `ExtensionManager.applyStartHooks` lines around 2218-2245). Each hook
 * receives the upcoming launch parameters and may return them (possibly
 * modified) to proceed, or reject the promise to cancel the launch.
 *
 * The hook filters by Relay's tool identity (executable path) and only
 * runs the hard checks for Relay launches. Non-Relay launches return the
 * call unchanged so the hook does not affect unrelated tools.
 *
 * Hard checks (reject on failure, design.md, Launch guard, Hard checks):
 *
 * 1. Active profile belongs to the Darktide game.
 * 2. The bundled Relay launcher (`mod_relay.exe`) exists in the bundled
 *    relay directory. The extension does not enumerate Relay's internal
 *    runtime files (DLL, `mod_loader` Lua, legal files); that layout is
 *    Relay's concern, and any further runtime failure is surfaced by
 *    Relay at launch.
 * 3. The discovered Darktide binary exists on disk.
 * 4. `mods.lst` regeneration succeeds and the projected list validates
 *    (duplicates, separators, safe-name, deployed `.mod` files present).
 *
 * Soft warning (never blocks, fires at most once per Vortex install):
 *
 * 5. If at least one non-DMF mod is enabled AND (DMF is not enabled OR
 *    DMF is not first in the projected list), AND the persisted warn-flag
 *    file does not exist, surface a non-blocking notification and write
 *    the flag file.
 *
 * Outcome: returns the call if all hard checks pass; rejects with a
 * `ProcessCanceled` carrying an actionable per-check message otherwise.
 *
 * Version grounding (verified against the installed
 * `@nexusmods/vortex-api@2.3.0-beta.1` types and the v2.3.0 Vortex
 * source):
 *
 * - `IExtensionContext.registerStartHook: (priority: number, id: string,
 *   hook: (call: IRunParameters) => PromiseLike<IRunParameters>) => void`
 *   (api.d.ts line 3805). The hook returns a `PromiseLike<IRunParameters>`
 *   so an `async` function is the natural shape.
 * - `IRunParameters = { executable: string; args: string[]; options:
 *   IRunOptions }` (api.d.ts lines 6043-6047). The call object does NOT
 *   carry a tool id; the hook filters by executable path. Verified in
 *   the v2.3.0 source `ExtensionManager.applyStartHooks` (lines around
 *   2218-2245): the hook receives the resolved `{ executable, args,
 *   options }` exactly as it will be passed to `child_process.spawn`
 *   (after variable expansion).
 * - Rejection: the v2.3.0 source `applyStartHooks` calls `.catch` on the
 *   hook promise for `UserCanceled`, `ProcessCanceled`, and any other
 *   error, then re-rejects with the same error. The launch is aborted
 *   and the error surfaces through Vortex's standard error dialog
 *   (`runExecutable` line 2298 invokes `applyStartHooks`). We reject
 *   with `ProcessCanceled` for actionable blocks because that is the
 *   semantically correct "the launch was canceled because of a known
 *   precondition" signal (api.d.ts line 7691; `util.ProcessCanceled`
 *   re-export at line 9376).
 * - `selectors.discoveryByGame: ParametricSelector<IState, string,
 *   IDiscoveryResult>` (api.d.ts line 1027) returns the discovery info;
 *   `IDiscoveryResult.path?: string` (api.d.ts line 2827) holds the
 *   discovered install directory.
 * - `api.sendNotification?: (notification: INotification) => string`
 *   (api.d.ts line 3129). Optional on the api type; the call site
 *   guards with `?.`. `INotification.type` is `'activity' | 'global' |
 *   'success' | 'info' | 'error'` (api.d.ts lines 5541-5558); the
 *   warning uses `'info'` so it does not block.
 *
 * The hook is exported via {@link createStartHook}, which closes over
 * the Vortex api. The factory pattern mirrors `createInstaller` in
 * `./installer.ts` and `createToolVariablesCallback` in
 * `./toolVariables.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as nodePath from 'node:path';

import type { types } from '@nexusmods/vortex-api';
import { selectors, util } from '@nexusmods/vortex-api';

import {
  DMF_CANONICAL_NAME,
  DMF_WARNING_FILE_NAME,
  DMF_WARNING_FILE_VERSION,
  GAME_EXECUTABLE,
  GAME_ID,
  MOD_ATTRIBUTE_NAME,
  RELAY_EXECUTABLE,
} from './constants';
import { isDmfFirst, projectAndValidateModsLst, validateProjectedNames } from './modsLst';
import type { ProjectionResult } from './modsLst';
import * as paths from './paths';
import { relayDir } from './paths';
import { writeAtomic } from './util/fs';

/**
 * Start-hook priority. design.md (Launch guard) registers at priority 5: a
 * low positive integer. Vortex applies hooks in ascending priority
 * order (api.d.ts line 3798); the exact value only orders among
 * multiple hooks, all of which run before variable expansion and
 * spawn. Priority 5 leaves room for other extensions to insert hooks
 * with finer-grained ordering.
 */
export const START_HOOK_PRIORITY = 5;

/**
 * Start-hook identifier. Used only for Vortex logging per the
 * `registerStartHook` doc comment (api.d.ts line 3802).
 */
export const START_HOOK_ID = 'mod-relay-launch-guard';

/**
 * Shape of the DMF warn-flag file (design.md, Launch guard, Soft warning).
 * Persisted as JSON at `<modRoot>/.dmf-warning-state.json`. Once
 * written, the warning never re-fires on this Vortex install;
 * deleting the file manually re-arms the warning.
 */
interface DmfWarningFlag {
  /** Schema version; matches {@link DMF_WARNING_FILE_VERSION}. */
  version: number;
  /** ISO 8601 timestamp of the first warning emission. */
  warnedAt: string;
}

/**
 * Builds the start hook for `context.registerStartHook(priority, id, hook)`.
 *
 * The factory closes over the Vortex api so the hook can read live
 * state (active profile, discovery) and emit the DMF soft warning. Pure
 * helpers ({@link isRelayLaunch}, {@link missingRelayFiles},
 * {@link decideDmfWarning}) are exported separately so unit tests cover
 * every rule without an api.
 *
 * @param api the Vortex extension api from `IExtensionContext.api`.
 */
export function createStartHook(
  api: types.IExtensionApi,
): (call: types.IRunParameters) => Promise<types.IRunParameters> {
  return async (call: types.IRunParameters): Promise<types.IRunParameters> => {
    if (!isRelayLaunch(call)) {
      return call;
    }
    const projection = await runHardChecks(api);
    await maybeWarnAboutDmf(api, projection.names);
    return call;
  };
}

/**
 * Returns `true` when the launch is for the Relay tool. Vortex's
 * `IRunParameters` does not carry a tool id (verified in the v2.3.0
 * source `ExtensionManager.applyStartHooks`), so the filter matches on
 * the resolved executable path: any path whose basename is the Relay
 * launcher and whose directory is the bundled relay directory.
 *
 * Comparison is case-insensitive on the basename (Windows filesystem
 * semantics). The directory check is also case-insensitive because
 * Vortex may emit either native or POSIX separators depending on how
 * the tool's `queryPath` returned the value; we normalize both sides
 * to lowercased forward-slash forms.
 *
 * Pure: no api access, no side effects. Exported so unit tests cover
 * the filter directly.
 *
 * @param call the upcoming launch parameters.
 * @param expectedExe absolute path the tool registration resolves to
 *   (`<relayDir>/<RELAY_EXECUTABLE>`). Defaults to the live
 *   `relayDir()` value; tests pass an explicit value to avoid coupling
 *   to the test host's filesystem.
 */
export function isRelayLaunch(
  call: types.IRunParameters,
  expectedExe: string = nodePath.join(relayDir(), RELAY_EXECUTABLE),
): boolean {
  if (typeof call.executable !== 'string' || call.executable.length === 0) {
    return false;
  }
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  return norm(call.executable) === norm(expectedExe);
}

/**
 * Runs hard checks 1-4 (design.md, Launch guard, Hard checks). Throws a `ProcessCanceled`
 * with an actionable, per-check message on the first failure. Returns
 * the mods.lst projection on success so the caller can pass the
 * projected names to the DMF soft-warning decision (design.md, Launch
 * guard, Soft warning).
 *
 * The checks are ordered so the cheapest, most-likely-to-fail gates
 * run first. Each produces a distinct message so the user can act on
 * it.
 */
async function runHardChecks(api: types.IExtensionApi): Promise<ProjectionResult> {
  const state = api.getState();
  const profile = selectors.activeProfile(state);

  // Hard check 1: active profile belongs to the Darktide game.
  if (profile === undefined || profile.gameId !== GAME_ID) {
    throw new util.ProcessCanceled(
      'Cannot launch Mod Relay: the active Vortex profile does not ' +
        `belong to "${GAME_ID}". Switch to a Darktide profile in Vortex ` +
        'before launching.',
    );
  }

  // Hard check 2: the bundled Relay launcher exists. The extension
  // treats Relay as an opaque unit; it verifies only the binary it
  // actually invokes and leaves Relay's internal runtime layout (DLL,
  // mod_loader Lua, legal files) to Relay to surface at launch.
  const relayDirectory = relayDir();
  const missing = missingRelayFiles(relayDirectory);
  if (missing.length > 0) {
    throw new util.ProcessCanceled(
      'Cannot launch Mod Relay: the bundled Relay launcher ' +
        `("${RELAY_EXECUTABLE}") is missing from "${relayDirectory}". ` +
        'Reinstall the extension or place a complete Relay runtime in ' +
        "the extension's relay/ directory.",
    );
  }

  // Hard check 3: discovered Darktide binary exists on disk.
  const discovery = selectors.discoveryByGame(state, GAME_ID);
  const gamePath = discovery?.path ?? '';
  if (gamePath.length === 0) {
    throw new util.ProcessCanceled(
      'Cannot launch Mod Relay: Darktide has not been discovered by ' +
        'Vortex. Manage Darktide in Vortex (letting it discover the Steam ' +
        'install) before launching.',
    );
  }
  const gameBinary = nodePath.join(gamePath, GAME_EXECUTABLE);
  if (!existsSync(gameBinary)) {
    throw new util.ProcessCanceled(
      'Cannot launch Mod Relay: the discovered Darktide binary was ' +
        `not found at "${gameBinary}". The discovery may be stale; re-scan ` +
        'Darktide in Vortex (Settings -> Games, then re-manage Darktide).',
    );
  }

  // Hard check 4: regenerate mods.lst and validate the projection.
  const projection = await projectAndValidateModsLst(api);
  if (!projection.ok) {
    const listed = projection.problems.map((p) => `  - ${p.reason}`).join('\n');
    throw new util.ProcessCanceled(
      'Cannot launch Mod Relay: the regenerated mods.lst failed ' +
        `validation.\n${listed}\n` +
        'Resolve the listed problems (remove or fix the conflicting mods) ' +
        'and try again.',
    );
  }

  // Defense-in-depth: every projected mod's deployed <name>/<name>.mod
  // must exist on disk. The pure projection cannot check this because
  // it does not touch the filesystem; the hook does. (design.md, Launch
  // guard, Hard checks: "every enabled mod's deployed <name>/<name>.mod
  // exists on disk".)
  const modsContentDir = paths.modsContentDir(util.getVortexPath('userData'));
  const deployedProblems = validateDeployedModsLstEntries(
    modsContentDir,
    readProjectedNames(state),
  );
  if (deployedProblems.length > 0) {
    const listed = deployedProblems.map((p) => `  - ${p}`).join('\n');
    throw new util.ProcessCanceled(
      'Cannot launch Mod Relay: one or more mods listed in mods.lst ' +
        `are missing their deployed .mod file under "${modsContentDir}".\n` +
        listed +
        '\nRun "Deploy Mods" in Vortex to materialize the deployed trees, ' +
        'or remove the affected mods.',
    );
  }

  return projection;
}

/**
 * Verifies the bundled Relay launcher exists in `directory`. Returns an
 * empty array when `mod_relay.exe` is present, or `[RELAY_EXECUTABLE]`
 * when it is absent. The extension treats Relay as an opaque unit and
 * inspects only the launcher binary it actually invokes; Relay's
 * internal runtime files are not enumerated here (design.md, Relay tool;
 * design.md, Launch guard, Hard checks).
 *
 * Kept as a function (rather than an inline `existsSync`) so the error
 * message shape stays uniform with the other hard-check helpers and
 * unit tests can exercise the existence check with a temp directory.
 *
 * @param directory absolute path to the bundled Relay runtime directory.
 */
export function missingRelayFiles(directory: string): string[] {
  const fullPath = nodePath.join(directory, RELAY_EXECUTABLE);
  return existsSync(fullPath) ? [] : [RELAY_EXECUTABLE];
}

/**
 * Returns the canonical names of every profile-enabled mod for the
 * Darktide game, in install-state order (NOT sorted). Used only for
 * the deployed-file existence check after the projection has already
 * validated the sorted list. The actual `mods.lst` content always
 * comes from {@link projectAndValidateModsLst}; this helper exists so
 * the deploy-state check can find each mod's `.mod` file without
 * re-running the sort.
 *
 * The shape mirrors the read inside {@link resolveActiveProfileProjection}
 * but returns names directly so this helper stays self-contained.
 */
function readProjectedNames(state: types.IState): string[] {
  const profile = selectors.activeProfile(state);
  if (profile === undefined || profile.gameId !== GAME_ID) {
    return [];
  }
  const modsForGame = selectors.modsForGame(state, GAME_ID);
  const names: string[] = [];
  for (const [modId, mod] of Object.entries(modsForGame)) {
    if (profile.modState[modId]?.enabled !== true) {
      continue;
    }
    const attr = mod.attributes?.[MOD_ATTRIBUTE_NAME];
    if (typeof attr === 'string' && attr.length > 0) {
      names.push(attr);
    }
  }
  return names;
}

/**
 * Pure-with-side-effects check: for each projected name, verifies
 * `<modsContentDir>/<name>/<name>.mod` exists on disk. Returns the list
 * of missing paths (relative to `modsContentDir`).
 *
 * The names are re-validated via {@link validateProjectedNames} first
 * so a path-traversal entry cannot escape the mods content directory
 * even if one somehow reached this point.
 *
 * @param modsContentDir absolute path of the directory that contains
 *   the deployed mod trees (`paths.modsContentDir(...)`).
 * @param names canonical mod names from the projection.
 */
export function validateDeployedModsLstEntries(
  modsContentDir: string,
  names: readonly string[],
): string[] {
  // Re-run the pure validation so unsafe names cannot reach the
  // filesystem check. Any problem here would already have failed hard
  // check 4; this is defense in depth.
  const problems = validateProjectedNames(names);
  if (problems.length > 0) {
    return problems.map((p) => p.reason);
  }
  const missing: string[] = [];
  for (const name of names) {
    if (typeof name !== 'string' || name.length === 0) {
      continue;
    }
    const modFile = nodePath.join(modsContentDir, name, `${name}.mod`);
    if (!existsSync(modFile)) {
      missing.push(`${name}/${name}.mod`);
    }
  }
  return missing;
}

/**
 * DMF soft warning (design.md, Launch guard, Soft warning). Surfaces a non-
 * blocking notification when:
 *
 * - at least one non-DMF mod is enabled in the active profile; AND
 * - either DMF is not enabled, or DMF is enabled but not first in the
 *   projected `mods.lst` content; AND
 * - the warn-flag file does not exist.
 *
 * Then writes the flag file so the warning never re-fires on this
 * Vortex install. Never blocks; never throws (failures during flag
 * write or notification are swallowed to keep the launch path clean).
 *
 * @param api the Vortex extension api.
 * @param projectedNames canonical mod names from the projection run by
 *   hard check 4 (sorted by `util.sortMods`). The DMF-position check
 *   uses this array, NOT install-state iteration order, so the warning
 *   decision matches the order the loader will see at launch.
 */
async function maybeWarnAboutDmf(
  api: types.IExtensionApi,
  projectedNames: readonly string[],
): Promise<void> {
  const state = api.getState();
  const profile = selectors.activeProfile(state);
  if (profile === undefined || profile.gameId !== GAME_ID) {
    return;
  }

  const decision = decideDmfWarning(state, projectedNames, dmfWarningFlagExists());
  if (!decision.shouldWarn) {
    return;
  }

  const modRoot = paths.modRoot(util.getVortexPath('userData'));
  const flagPath = nodePath.join(modRoot, DMF_WARNING_FILE_NAME);

  // The decision already established the flag file is absent (the only
  // state from which we warn). Persist the flag first so an exception
  // in sendNotification does not leave the warning re-armed.
  try {
    await persistDmfWarningFlag(flagPath);
  } catch (err) {
    // Without the flag, the warning would re-fire on every launch.
    // Log via the standard error notification (non-blocking; the launch
    // proceeds) so the operator notices and can fix permissions.
    api.showErrorNotification?.('Could not persist Darktide DMF warning flag', err, {
      allowReport: false,
      warning: true,
    });
    return;
  }

  api.sendNotification?.({
    type: 'info',
    title: 'Darktide: DMF load order',
    message:
      'Darktide mods are launching without Darktide Mod Framework (DMF) ' +
      'first in the load order. Most Darktide mods depend on DMF. Verify ' +
      'DMF is installed and enabled, or this warning is safe to ignore if ' +
      'your mods do not use DMF. (This warning fires only once per Vortex ' +
      'install.)',
  });
}

/**
 * Pure decision: returns whether the DMF warning should fire given the
 * current state and the projected mod-name list. Exported so unit
 * tests cover every condition without an api or filesystem.
 *
 * The "is DMF first" check uses `projectedNames`, which reflects
 * `util.sortMods` output (the order Relay will see at launch). The
 * caller is responsible for passing the same projected list that
 * hard check 4 produced; do NOT pass install-state iteration order
 * here, since that diverges from sorted order whenever a user rule
 * or the installer's auto `after DMF` rule moves things around.
 *
 * `state` is still consulted to determine whether DMF is enabled and
 * whether any non-DMF mod is enabled; only the position check uses
 * `projectedNames`.
 *
 * @param state live Vortex state.
 * @param projectedNames canonical mod names in sorted load order, as
 *   produced by {@link projectAndValidateModsLst}.
 * @param flagExists whether the warn-flag file currently exists on
 *   disk.
 */
export function decideDmfWarning(
  state: types.IState,
  projectedNames: readonly string[],
  flagExists: boolean,
): { shouldWarn: boolean; reason: string } {
  if (flagExists) {
    return { shouldWarn: false, reason: 'warning already fired on this install' };
  }
  const profile = selectors.activeProfile(state);
  if (profile === undefined || profile.gameId !== GAME_ID) {
    return { shouldWarn: false, reason: 'no active Darktide profile' };
  }
  const modsForGame = selectors.modsForGame(state, GAME_ID);
  let anyNonDmfEnabled = false;
  let dmfEnabled = false;
  for (const [modId, mod] of Object.entries(modsForGame)) {
    if (profile.modState[modId]?.enabled !== true) {
      continue;
    }
    const attr = mod.attributes?.[MOD_ATTRIBUTE_NAME];
    if (typeof attr !== 'string' || attr.length === 0) {
      // Mod without a relayModName attribute; treat as a non-DMF mod
      // for the "any non-DMF enabled" branch since DMF carries the
      // attribute by definition.
      anyNonDmfEnabled = true;
      continue;
    }
    if (attr.toLowerCase() === DMF_CANONICAL_NAME) {
      dmfEnabled = true;
    } else {
      anyNonDmfEnabled = true;
    }
  }
  if (!anyNonDmfEnabled) {
    return { shouldWarn: false, reason: 'no non-DMF mods are enabled' };
  }
  if (!dmfEnabled) {
    return { shouldWarn: true, reason: 'DMF is not enabled but at least one non-DMF mod is' };
  }
  // DMF enabled; use the projected (sorted) names to verify it sorts
  // first. `projectedNames` is the sort result the loader will see at
  // launch (produced by hard check 4's `projectAndValidateModsLst`
  // call); using it here keeps the warning decision aligned with the
  // actual load order rather than install-state insertion order.
  if (!isDmfFirst(projectedNames)) {
    return {
      shouldWarn: true,
      reason: 'DMF is enabled but is not first in the projected load order',
    };
  }
  return { shouldWarn: false, reason: 'DMF is enabled and first' };
}

/**
 * Returns `true` if the DMF warn-flag file currently exists at its
 * canonical path under the extension's mod root. Pure-with-side-effect
 * (one stat call); isolated so {@link decideDmfWarning} can take the
 * result as a parameter and stay pure.
 */
function dmfWarningFlagExists(): boolean {
  const modRoot = paths.modRoot(util.getVortexPath('userData'));
  const flagPath = nodePath.join(modRoot, DMF_WARNING_FILE_NAME);
  return existsSync(flagPath);
}

/**
 * Reads and lightly validates the DMF warn-flag file at `flagPath`.
 * Returns `null` when the file is absent, and the parsed flag when it
 * parses and carries the expected schema version.
 *
 * Exported so unit tests cover the parse/validate path directly with
 * fixture files.
 *
 * @param flagPath absolute path to `<modRoot>/.dmf-warning-state.json`.
 */
export function readDmfWarningFlag(flagPath: string): DmfWarningFlag | null {
  let raw: string;
  try {
    raw = readFileSync(flagPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== DMF_WARNING_FILE_VERSION ||
    typeof (parsed as { warnedAt?: unknown }).warnedAt !== 'string'
  ) {
    return null;
  }
  return parsed as DmfWarningFlag;
}

/**
 * Atomically writes the DMF warn-flag file at `flagPath` with the
 * current timestamp. Uses {@link writeAtomic} so a torn write cannot
 * leave a half-written flag.
 *
 * @param flagPath absolute path to `<modRoot>/.dmf-warning-state.json`.
 */
export async function persistDmfWarningFlag(flagPath: string): Promise<void> {
  const flag: DmfWarningFlag = {
    version: DMF_WARNING_FILE_VERSION,
    warnedAt: new Date().toISOString(),
  };
  // Ensure the parent directory exists. `setup` normally creates the
  // mod root at game-mode activation, but the warn path can run before
  // that on a fresh install. mkdir with `recursive: true` is a no-op
  // when the directory already exists.
  await mkdir(nodePath.dirname(flagPath), { recursive: true });
  await writeAtomic(flagPath, JSON.stringify(flag, null, 2));
}

// `readFileSync` is imported for {@link readDmfWarningFlag}; `mkdir` for
// {@link persistDmfWarningFlag}; `existsSync` for the file-existence
// checks throughout. The async `mkdir` returns a Promise that callers
// await; no synchronous filesystem helper is used in the launch path
// except `existsSync`, which is the right tool for a one-shot
// existence check on a single file.
