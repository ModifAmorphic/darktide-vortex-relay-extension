import type { types } from '@nexusmods/vortex-api';
import { selectors } from '@nexusmods/vortex-api';

import { DMF_CANONICAL_NAME, DMF_NEXUS_MOD_ID, GAME_ID, MOD_ATTRIBUTE_NAME } from './constants';
import * as archive from './util/archive';
import { isSafeCanonicalName } from './util/names';

/**
 * Darktide `.mod` archive installer. Recognizes archives containing a
 * `.mod` entry, normalizes them into the canonical `<name>/<name>.mod`
 * layout, persists the canonical name as the `relayModName` attribute,
 * and rejects ambiguous or unsafe archives.
 */

export const INSTALLER_ID = 'darktide-relay-mod-installer';

/**
 * Priority 25: within the 21-99 game-specific range, below FOMOD (20),
 * above the generic fallback (100).
 */
export const INSTALLER_PRIORITY = 25;

/**
 * Severity value that makes a Vortex `error` instruction fail the install.
 * Installer rejections use `{ type: 'error', value: 'fatal' }` rather than
 * `unsupported`: `unsupported` surfaces a "submit a Vortex bug report"
 * notification, which is wrong for an "I cannot install this archive"
 * rejection.
 */
const FATAL = 'fatal';

/**
 * Installed mods keyed by Vortex mod id; the value is the mod's
 * `relayModName` attribute (or `undefined`). Used for duplicate-name
 * detection.
 */
export type ExistingRelayMods = ReadonlyMap<string, string | undefined>;

/** Builds a `copy` instruction; `source` is archive-relative, `destination` is staging-relative. */
function copyInstruction(source: string, destination: string): types.IInstruction {
  return { type: 'copy', source, destination };
}

/**
 * Builds an `attribute` instruction. Vortex preserves attributes set on
 * each install across mod updates, so this is what makes `relayModName`
 * survive an update.
 */
function attributeInstruction(key: string, value: string): types.IInstruction {
  return { type: 'attribute', key, value };
}

/**
 * Builds the `after DMF` rule instruction. `util.sortMods` turns the rule
 * into a DAG edge so the bearing mod deploys after DMF. The reference uses
 * DMF's Nexus mod id with `versionMatch: '*'`, which matches via
 * `testModReference`'s fuzzy-version path regardless of file id.
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
 * Builds a fatal `error` instruction; Vortex surfaces `message` and rejects
 * the install (no files committed).
 */
function fatalError(message: string): types.IInstruction {
  return { type: 'error', source: message, value: FATAL };
}

function supportedResult(supported: boolean): types.ISupportedResult {
  return { supported, requiredFiles: [] };
}

/**
 * Support test. Returns `true` for Darktide archives containing at least
 * one `.mod` entry, `false` otherwise. Intentionally permissive: all other
 * validation runs in the install function so the user gets an actionable
 * error rather than a silent decline.
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
 * Fatal error for archives with `.mod` entries in multiple unrelated
 * subtrees. The listed values are the `.mod` entry paths (group
 * representatives), not subtree roots, so the user can find them in the
 * archive.
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

function ambiguousSubtreeError(candidates: readonly string[]): types.IInstruction {
  const listed = candidates.map((c) => `"${c}"`).join(', ');
  return fatalError(
    `Darktide archive contains multiple .mod entries inside one subtree ` +
      `(${listed}). The canonical entry is ambiguous; only one .mod file ` +
      `per mod is supported.`,
  );
}

function unsafeNameError(canonicalName: string): types.IInstruction {
  return fatalError(
    `Darktide archive produced an unsafe canonical mod name ` +
      `"${canonicalName}". The name must be non-empty, contain no path ` +
      `separators, and not be "." or "..".`,
  );
}

function directoryDisagreementError(modEntryPath: string): types.IInstruction {
  return fatalError(
    `Darktide archive layout is ambiguous: the .mod entry ` +
      `"${modEntryPath}" has a basename that disagrees with its containing ` +
      `directory. The folder name, .mod basename, and mods.lst entry must ` +
      `all agree; the installer will not guess which name is canonical.`,
  );
}

/**
 * Fatal error for a duplicate canonical name. With `mergeMods: true`, two
 * archives normalizing to the same `<name>/` would clobber at deploy;
 * rejecting at install surfaces the conflict first.
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
 * Returns `file` relative to `subtreeRoot`, or `null` if `file` is outside
 * the subtree. `subtreeRoot === ''` (`.mod` at archive root) means every
 * file is inside. The prefix check runs on normalized forward-slash forms,
 * but the returned path preserves `file`'s original separators so
 * destinations stay host-native.
 */
function relativeIfInSubtree(file: string, subtreeRoot: string): string | null {
  if (subtreeRoot === '') {
    return file;
  }
  const normalize = (p: string): string => p.replace(/[\\/]+/g, '/');
  const normFile = normalize(file);
  const normRoot = normalize(subtreeRoot);
  const cleanRoot = normRoot.replace(/\/+$/, '');
  if (cleanRoot.length === 0) {
    return file;
  }
  const prefix = cleanRoot + '/';
  if (!normFile.startsWith(prefix)) {
    return null;
  }
  // Slice by segments, not by prefix length: normalized and original forms
  // may differ in separators.
  const rootSegs = cleanRoot.split('/');
  const fileSegs = file.split(/[\\/]/);
  if (fileSegs.length <= rootSegs.length) {
    return null;
  }
  // Case-sensitive: archive paths are exact.
  for (let i = 0; i < rootSegs.length; i++) {
    if (fileSegs[i] !== rootSegs[i]) {
      return null;
    }
  }
  return fileSegs.slice(rootSegs.length).join('/');
}

/**
 * Pure install-plan core. Given the file list, game id, and already-
 * installed mods, returns the install result Vortex consumes. No Vortex
 * api access; tests call this directly.
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

  // Case-insensitive: Windows and Relay treat names differing only in case
  // as the same folder.
  const lowerCanonical = canonicalName.toLowerCase();
  for (const [modId, existingName] of existingMods) {
    if (typeof existingName !== 'string' || existingName.length === 0) {
      continue;
    }
    if (existingName.toLowerCase() === lowerCanonical) {
      return { instructions: [duplicateNameError(canonicalName, modId)] };
    }
  }

  // Files outside the subtree (sibling docs, previews) are not copied.
  const subtreeRoot = archive.determineSubtreeRoot(modEntryPath, files);
  const copyInstructions: types.IInstruction[] = [];
  for (const file of files) {
    if (typeof file !== 'string' || file.length === 0) {
      continue;
    }
    // Skip directory entries (trailing separator); deployment creates empty dirs as needed.
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
    // Defense in depth: a .mod candidate with no copyable files.
    return {
      instructions: [
        fatalError(
          `Darktide archive for "${canonicalName}" produced no installable ` +
            `files. The .mod entry may be missing from the file list.`,
        ),
      ],
    };
  }

  // Non-DMF mods also get the `after DMF` rule; DMF itself does not self-reference.
  const instructions: types.IInstruction[] = [
    ...copyInstructions,
    attributeInstruction(MOD_ATTRIBUTE_NAME, canonicalName),
  ];
  if (canonicalName.toLowerCase() !== DMF_CANONICAL_NAME) {
    instructions.push(afterDmfRuleInstruction());
  }
  return { instructions };
}

/** Reads installed mods for `gameId` into an {@link ExistingRelayMods} map. */
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
 * Returns the installer registration object. `testSupported` is pure; the
 * `install` callback closes over the Vortex api only for duplicate-name
 * detection, delegating everything else to the pure {@link planInstall}
 * core.
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
