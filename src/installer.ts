import type { types } from '@nexusmods/vortex-api';
import { selectors } from '@nexusmods/vortex-api';

import { DMF_CANONICAL_NAME, DMF_NEXUS_MOD_ID, GAME_ID, MOD_ATTRIBUTE_NAME } from './constants';
import * as archive from './util/archive';
import { isSafeCanonicalName } from './util/names';

/**
 * Darktide `.mod` archive installer.
 *
 * Recognizes Darktide mod archives (any archive containing a `.mod` entry
 * for the registered Darktide game), normalizes them into the canonical
 * `<name>/<name>.mod` layout the Relay mod loader expects, persists the
 * canonical name as a Vortex mod attribute (`relayModName`), and rejects
 * archives that are ambiguous or unsafe. See spec Section 8 and the
 * reference doc's "Archive normalization implications".
 *
 * Version grounding (verified against the installed
 * `@nexusmods/vortex-api@2.3.0-beta.1` types):
 *
 * - `types.IExtensionContext.registerInstaller` signature is
 *   `(id, priority, testSupported, install) => void` (api.d.ts line 3492).
 * - `TestSupported` is
 *   `(files, gameId, archivePath?, details?) => PromiseLike<ISupportedResult>`
 *   (api.d.ts line 8932).
 * - `InstallFunc` is
 *   `(files, destinationPath, gameId, progressDelegate, choices?, unattended?, archivePath?, options?) => PromiseLike<IInstallResult>`
 *   (api.d.ts line 5697).
 * - `IInstallResult` is `{ instructions: IInstruction[] }` (api.d.ts line 4852).
 *
 * Error/unsupported instruction shape: the spec groups `error` / `unsupported`
 * together as "reject a recognized but invalid layout" with "message data".
 * The grounded Vortex 2.3 source (`InstallManager.ts` lines 4296-4327 and
 * 3922-3967) shows the two have different runtime semantics:
 *
 * - `error` instructions surface `source` as the user-facing message and
 *   read `value` as severity. If `value === 'fatal'`, Vortex rejects the
 *   install via `ProcessCanceled` and no files are committed.
 * - `unsupported` instructions trigger a "this installer uses unimplemented
 *   functions" notification that prompts the user to submit a Vortex bug
 *   report, which is wrong for our "I cannot install this archive" case.
 *
 * All installer rejections therefore use `{ type: 'error', source: <message>,
 * value: 'fatal' }`. The message is the actionable text the user sees in the
 * Vortex error dialog.
 *
 * DMF dependency rule (spec Section 8.5): every non-DMF install emits one
 * `rule` instruction with `type: 'after'` referencing DMF by Nexus mod id,
 * so Vortex's `util.sortMods` places DMF before any mod that depends on
 * it. Grounded in the installed `@nexusmods/vortex-api@2.3.0-beta.1` types:
 *
 * - `InstructionType` includes `"rule"` (api.d.ts line 5733).
 * - `IInstruction.rule?: IRule` (api.d.ts line 4873). `IRule` is imported
 *   from `modmeta-db` (api.d.ts line 51); the `modmeta-db` package is not
 *   resolvable at type-check time, so under `skipLibCheck` the `IRule`
 *   type resolves to `any`. The rule literal therefore type-checks
 *   without a cast; the runtime shape is what carries correctness.
 * - `InstallManager.processRule` in the Vortex v2.3.0 source
 *   (`InstallManager.ts` around lines 4096-4107) dispatches
 *   `addModRule` for each `rule` instruction, persisting the rule onto
 *   the mod's `rules` array.
 *
 * `IModRepoId.fileId: string` is required by the installed type, but the
 * rule reference here intentionally omits `fileId`. Grounded in the
 * Vortex v2.3.0 source `testModReference.ts`: when `versionMatch === '*'`,
 * the matcher takes the `fuzzyVersion` path, which skips the `fileId`
 * equality check entirely and matches any installed mod whose
 * `attributes.source === 'nexus'` and `attributes.modId === 8`. The
 * `fileId` omission is type-level only; runtime behavior is correct.
 */

/**
 * Vortex installer registration id. Used only for logging per the
 * `IExtensionContext.registerInstaller` doc comment.
 */
export const INSTALLER_ID = 'darktide-relay-mod-installer';

/**
 * Installer priority. Spec Section 8 places this within the 21-99
 * game-specific range, below FOMOD at priority 20 and above the generic
 * fallback at 100. Smaller number wins among supported installers.
 */
export const INSTALLER_PRIORITY = 25;

/**
 * Severity value that makes a Vortex `error` instruction fail the install.
 * Matches the convention read by `InstallManager.ts` at line 4297
 * (`instructionGroups.error.find((err) => err.value === "fatal")`).
 */
const FATAL = 'fatal';

/**
 * Existing installed mods, keyed by Vortex mod ID. The value is the mod's
 * `relayModName` attribute (or `undefined` when the attribute is unset or
 * not a string). Used for duplicate-name detection per spec Section 8.4.
 */
export type ExistingRelayMods = ReadonlyMap<string, string | undefined>;

/**
 * Builds a Vortex `copy` instruction. The `source` is the archive-relative
 * path Vortex's file walker produced; the `destination` is the staging-
 * relative path Vortex writes during install.
 */
function copyInstruction(source: string, destination: string): types.IInstruction {
  return { type: 'copy', source, destination };
}

/**
 * Builds a Vortex `attribute` instruction that persists `value` under
 * `key` on the installed mod's `attributes` dictionary. Vortex preserves
 * attributes set on each install across mod updates, so this is what
 * makes `relayModName` survive an update.
 */
function attributeInstruction(key: string, value: string): types.IInstruction {
  return { type: 'attribute', key, value };
}

/**
 * Builds a Vortex `rule` instruction declaring an `after` dependency on
 * DMF (spec Section 8.5). Vortex's `util.sortMods` reads `mod.rules` and
 * produces a DAG edge from each rule's reference to the rule-bearing mod,
 * so a mod carrying this rule is sorted to deploy after DMF. The
 * reference uses DMF's Nexus mod id, which matches any installed DMF
 * record via `testModReference`'s fuzzy-version path regardless of file
 * version or file id. See the module header for the type/runtime
 * grounding on the omitted `fileId`.
 */
function afterDmfRuleInstruction(): types.IInstruction {
  return {
    type: 'rule',
    rule: {
      type: 'after',
      reference: {
        repo: {
          repository: 'nexus',
          modId: DMF_NEXUS_MOD_ID,
        },
        versionMatch: '*',
      },
    },
  };
}

/**
 * Builds a fatal Vortex `error` instruction. Vortex surfaces `message` to
 * the user via its standard error dialog and rejects the install, so no
 * files are committed. See module header for the grounded semantics.
 */
function fatalError(message: string): types.IInstruction {
  return { type: 'error', source: message, value: FATAL };
}

/**
 * Pure test-supported result builder.
 */
function supportedResult(supported: boolean): types.ISupportedResult {
  return { supported, requiredFiles: [] };
}

/**
 * The installer's support test (spec Section 8 "Support test").
 *
 * Returns `supported: false` for any non-Darktide `gameId`. For Darktide
 * archives, returns `supported: true` if at least one `.mod` entry is
 * present; otherwise `false`. The support test is intentionally permissive
 * about everything except game and `.mod` presence so the user receives
 * actionable error messages from the install function rather than a silent
 * decline (spec Section 8.3).
 *
 * Pure: no Vortex state access, no side effects.
 *
 * @param files archive-relative paths, including directory entries.
 * @param gameId the game Vortex is asking about.
 */
export async function testSupported(
  files: string[],
  gameId: string,
): Promise<types.ISupportedResult> {
  if (gameId !== GAME_ID) {
    return supportedResult(false);
  }
  const candidates = archive.findModCandidates(files);
  if (candidates.length === 0) {
    return supportedResult(false);
  }
  return supportedResult(true);
}

/**
 * Returns the fatal-error instructions to emit when an archive contains
 * `.mod` entries in multiple unrelated subtrees (spec Section 8.3). The
 * listed values are the `.mod` entry paths (the group representatives
 * returned by `groupBySubtreeRoot`), not subtree roots; the wording is
 * precise so the user can find the listed paths in their archive.
 */
function multipleRootsError(groups: Map<string, string[]>): types.IInstruction {
  // Sort for deterministic error messages.
  const entryPaths = [...groups.keys()].sort();
  const listed = entryPaths.map((p) => `"${p}"`).join(', ');
  return fatalError(
    `Darktide archive contains multiple unrelated .mod entries ` +
      `(${listed}). Only one mod per archive is supported; ` +
      `please install each mod separately.`,
  );
}

/**
 * Returns the fatal-error instructions to emit when an archive contains
 * multiple `.mod` entries inside a single subtree (ambiguous layout).
 */
function ambiguousSubtreeError(candidates: readonly string[]): types.IInstruction {
  const listed = candidates.map((c) => `"${c}"`).join(', ');
  return fatalError(
    `Darktide archive contains multiple .mod entries inside one subtree ` +
      `(${listed}). The canonical entry is ambiguous; only one .mod file ` +
      `per mod is supported.`,
  );
}

/**
 * Returns the fatal-error instruction to emit when the derived canonical
 * name fails safe-name validation.
 */
function unsafeNameError(canonicalName: string): types.IInstruction {
  return fatalError(
    `Darktide archive produced an unsafe canonical mod name ` +
      `"${canonicalName}". The name must be non-empty, contain no path ` +
      `separators, and not be "." or "..".`,
  );
}

/**
 * Returns the fatal-error instruction to emit when the `.mod` basename
 * disagrees with its containing directory (spec Section 8.2 directory
 * agreement rule).
 */
function directoryDisagreementError(modEntryPath: string): types.IInstruction {
  return fatalError(
    `Darktide archive layout is ambiguous: the .mod entry ` +
      `"${modEntryPath}" has a basename that disagrees with its containing ` +
      `directory. The folder name, .mod basename, and mods.lst entry must ` +
      `all agree; the installer will not guess which name is canonical.`,
  );
}

/**
 * Returns the fatal-error instruction to emit when an existing installed
 * mod already claims the same canonical name (spec Section 8.4). With
 * `mergeMods: true`, two archives normalizing to the same `<name>/...`
 * would clobber each other at deploy time; rejecting at install time
 * surfaces the conflict before deployment.
 */
function duplicateNameError(canonicalName: string, ownerId: string): types.IInstruction {
  return fatalError(
    `Darktide mod "${canonicalName}" is already installed ` +
      `(Vortex mod id "${ownerId}"). Remove or update the existing mod ` +
      `instead of installing a second copy; the canonical folder name ` +
      `must be unique.`,
  );
}

/**
 * Returns the relative path of `file` under `subtreeRoot`, or `null` if
 * `file` is outside the subtree. When `subtreeRoot === ''` (the `.mod` is
 * at the archive root), every file is considered inside the subtree.
 *
 * Comparison is on normalized forward-slash forms so the helper tolerates
 * mixed input separators. The returned relative path preserves the
 * original separators of `file` so destinations stay host-native.
 */
function relativeIfInSubtree(file: string, subtreeRoot: string): string | null {
  if (subtreeRoot === '') {
    return file;
  }
  // Normalize both sides to forward-slash segments for the prefix check.
  const normalize = (p: string): string => p.replace(/[\\/]+/g, '/');
  const normFile = normalize(file);
  const normRoot = normalize(subtreeRoot);
  // Strip trailing separators on the root.
  const cleanRoot = normRoot.replace(/\/+$/, '');
  if (cleanRoot.length === 0) {
    return file;
  }
  const prefix = cleanRoot + '/';
  if (!normFile.startsWith(prefix)) {
    return null;
  }
  // Slice the original file by the prefix length, adjusted for any
  // separator differences between the normalized and original forms.
  // Walk past the segments that match the subtree root.
  const rootSegs = cleanRoot.split('/');
  const fileSegs = file.split(/[\\/]/);
  if (fileSegs.length <= rootSegs.length) {
    return null;
  }
  // All rootSegs must match (case-sensitive; archive paths are exact).
  for (let i = 0; i < rootSegs.length; i++) {
    if (fileSegs[i] !== rootSegs[i]) {
      return null;
    }
  }
  return fileSegs.slice(rootSegs.length).join('/');
}

/**
 * The pure core of the install plan (spec Section 8 "Install function").
 *
 * Given the file list, the game id, and the set of already-installed mods,
 * returns the install result Vortex consumes. No Vortex api access; tests
 * call this directly with whatever state they need.
 *
 * Steps:
 *
 * 1. Reject if `gameId` is not Darktide (defense in depth; the support
 *    test already declines).
 * 2. Find every `.mod` candidate. Reject as unsupported if none.
 * 3. Group candidates by subtree root. Reject if more than one group
 *    (multiple unrelated `.mod` entries).
 * 4. Reject if the single group contains more than one `.mod` entry
 *    (ambiguous canonical name within one subtree).
 * 5. Derive the canonical name; reject if the name fails safe-name
 *    validation.
 * 6. Reject if the `.mod` basename disagrees with its containing dir
 *    (spec 8.2 directory-agreement rule).
 * 7. Reject if an existing installed mod already claims the canonical name
 *    (case-insensitive).
 * 8. Walk files inside the subtree root and emit `copy` instructions. The
 *    destination prefix is always `<canonicalName>/`; the wrapper-ancestor
 *    stripping from spec step 5 is realized implicitly by
 *    `relativeIfInSubtree`, which drops the subtree-root segments from
 *    each file's path so its remainder is appended to the canonical
 *    prefix. `hasBasenameDirectoryAgreement` (step 6) guarantees the
 *    last segment of the subtree root equals the canonical name, so the
 *    destination for the `.mod` entry resolves to
 *    `<canonicalName>/<canonicalName>.mod` exactly. Emits an
 *    `attribute` instruction persisting `relayModName`, and for non-DMF
 *    mods one `rule` instruction declaring `after DMF` (spec 8.5).
 *
 * @param files archive-relative paths from Vortex.
 * @param gameId the game id Vortex determined for the install.
 * @param existingMods already-installed mods keyed by Vortex mod id, with
 *   values being their persisted `relayModName` attribute (if any).
 */
export function planInstall(
  files: string[],
  gameId: string,
  existingMods: ExistingRelayMods,
): types.IInstallResult {
  if (gameId !== GAME_ID) {
    return {
      instructions: [
        fatalError(
          `Darktide installer was invoked for a different game ` +
            `"${gameId}". This installer only handles "${GAME_ID}".`,
        ),
      ],
    };
  }

  const candidates = archive.findModCandidates(files);
  if (candidates.length === 0) {
    return {
      instructions: [
        fatalError(
          `Darktide archive contains no .mod entry. Only archives that ` +
            `ship a .mod file can be installed for Darktide via Relay.`,
        ),
      ],
    };
  }

  const groups = archive.groupBySubtreeRoot(candidates);
  if (groups.size > 1) {
    return { instructions: [multipleRootsError(groups)] };
  }

  // Exactly one group. The first member is the group's representative.
  const groupEntries = [...groups.entries()];
  const groupKey = groupEntries[0]![0];
  const groupMembers = groupEntries[0]![1];
  if (groupMembers.length > 1) {
    return { instructions: [ambiguousSubtreeError(groupMembers)] };
  }

  const modEntryPath = groupKey;
  const canonicalName = archive.deriveCanonicalName(modEntryPath);
  if (!isSafeCanonicalName(canonicalName)) {
    return { instructions: [unsafeNameError(canonicalName)] };
  }

  if (!archive.hasBasenameDirectoryAgreement(modEntryPath)) {
    return { instructions: [directoryDisagreementError(modEntryPath)] };
  }

  // Duplicate detection across existing installs (spec Section 8.4).
  // Case-insensitive: Windows filesystem and Relay's runtime treat names
  // that differ only in case as the same folder.
  const lowerCanonical = canonicalName.toLowerCase();
  for (const [modId, existingName] of existingMods) {
    if (typeof existingName !== 'string' || existingName.length === 0) {
      continue;
    }
    if (existingName.toLowerCase() === lowerCanonical) {
      return { instructions: [duplicateNameError(canonicalName, modId)] };
    }
  }

  // Build the copy plan. Files outside the subtree (sibling docs, preview
  // images, anything not under the canonical .mod entry) are not copied.
  const subtreeRoot = archive.determineSubtreeRoot(modEntryPath, files);
  const copyInstructions: types.IInstruction[] = [];
  for (const file of files) {
    if (typeof file !== 'string' || file.length === 0) {
      continue;
    }
    // Skip directory entries; Vortex represents them with a trailing
    // separator and the deployment activator creates empty dirs as needed.
    if (file.endsWith('/') || file.endsWith('\\')) {
      continue;
    }
    const relative = relativeIfInSubtree(file, subtreeRoot);
    if (relative === null) {
      continue;
    }
    const destination = `${canonicalName}/${relative}`;
    copyInstructions.push(copyInstruction(file, destination));
  }

  if (copyInstructions.length === 0) {
    // Defense in depth: we found a .mod candidate but no files to copy.
    // This should not happen with a real archive (the .mod entry itself
    // is a file in the subtree) but guard against it cleanly.
    return {
      instructions: [
        fatalError(
          `Darktide archive for "${canonicalName}" produced no installable ` +
            `files. The .mod entry may be missing from the file list.`,
        ),
      ],
    };
  }

  // Build the final instruction list. Every non-DMF mod also carries an
  // `after DMF` rule so Vortex's sort places DMF first in deployment
  // order (spec Section 8.5). DMF itself does not get a self-reference.
  const instructions: types.IInstruction[] = [
    ...copyInstructions,
    attributeInstruction(MOD_ATTRIBUTE_NAME, canonicalName),
  ];
  if (canonicalName.toLowerCase() !== DMF_CANONICAL_NAME) {
    instructions.push(afterDmfRuleInstruction());
  }
  return { instructions };
}

/**
 * Reads the installed mods for `gameId` from the live Vortex state and
 * returns them as an {@link ExistingRelayMods} map keyed by Vortex mod id.
 *
 * Grounded path (against the installed 2.3.0-beta.1 types):
 * - `IExtensionContext.api: IExtensionApi` (api.d.ts line 3961) is the
 *   api the extension context exposes at load time.
 * - `api.getState: <T extends IState = IState>() => T` (line 3400) is the
 *   typed convenience wrapper around `store.getState()`.
 * - `selectors.modsForGame: (state, gameId) => { [modId: string]: IMod }`
 *   (line 7429) returns the mods for one game.
 * - `IMod.attributes` is `IModAttributes`, which has an index signature
 *   `[key: string]: any`; reading the extension-owned `relayModName`
 *   attribute via the index signature is type-safe and matches how
 *   Vortex's own attribute pipeline round-trips extension-set values.
 */
function readExistingRelayMods(api: types.IExtensionApi, gameId: string): ExistingRelayMods {
  const state = api.getState();
  const modsForGame = selectors.modsForGame(state, gameId);
  const result = new Map<string, string | undefined>();
  for (const [modId, mod] of Object.entries(modsForGame)) {
    const attr = mod.attributes?.[MOD_ATTRIBUTE_NAME];
    result.set(modId, typeof attr === 'string' ? attr : undefined);
  }
  return result;
}

/**
 * Returns the installer registration object suitable for passing to
 * `context.registerInstaller(id, priority, testSupported, install)`.
 *
 * The {@link testSupported} function is pure and is re-exported directly.
 * The `install` callback closes over the Vortex `api` so it can read the
 * installed-mods state for duplicate-name detection (spec Section 8.4),
 * which is the only state-aware step in the install plan. All other
 * install logic runs through the pure {@link planInstall} core, which
 * tests call directly without an api.
 *
 * @param api the Vortex extension api from `IExtensionContext.api`.
 */
export function createInstaller(api: types.IExtensionApi): {
  id: string;
  priority: number;
  testSupported: types.TestSupported;
  install: types.InstallFunc;
} {
  return {
    id: INSTALLER_ID,
    priority: INSTALLER_PRIORITY,
    testSupported,
    async install(
      files: string[],
      _destinationPath: string,
      gameId: string,
      _progressDelegate: types.ProgressDelegate,
      _choices?: unknown,
      _unattended?: boolean,
      _archivePath?: string,
      _options?: types.IInstallationDetails,
    ): Promise<types.IInstallResult> {
      const existingMods = readExistingRelayMods(api, gameId);
      return planInstall(files, gameId, existingMods);
    },
  };
}
