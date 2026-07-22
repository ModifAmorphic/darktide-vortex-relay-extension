/**
 * Identity, discovery, and layout constants for the Darktide Relay Vortex
 * extension.
 *
 * Grounded identifiers come from `docs/reference/vortex-extension-development.md`
 * Section 5 and `docs/architecture/extension-spec.md` Section 6. The internal
 * game ID is deliberately distinct from the Nexus domain; the Nexus association
 * is wired through `NEXUS_PAGE_ID` via `details.nexusPageId`.
 *
 * Path-layout constants name the subdirectories the extension creates under
 * Vortex userData. They are resolved dynamically in `./paths.ts`; no user
 * literal is hardcoded anywhere the extension writes.
 */

/** Internal Vortex game ID. Distinct from the Nexus domain. */
export const GAME_ID = 'warhammer40kdarktide-relay';

/** Display name shown by Vortex for the registered game. */
export const GAME_NAME = 'Warhammer 40,000: Darktide';

/**
 * Nexus domain / `nexusPageId`. Maps the internal game ID to Nexus download
 * metadata and NXM link routing. Must be proven with a real
 * "Download with Manager" link (spec Section 16, Game registration).
 */
export const NEXUS_PAGE_ID = 'warhammer40kdarktide';

/**
 * Steam app ID for Darktide, in string form per Vortex convention
 * (`IQueryArgEntry` and `details` both use strings).
 */
export const STEAM_APP_ID = '1361210';

/** Game executable relative to the discovered Darktide install root. */
export const GAME_EXECUTABLE = 'binaries/Darktide.exe';

/**
 * Relative paths used by Vortex discovery to validate a candidate install
 * root. Kept short so discovery stays inexpensive while still rejecting
 * false-positive directories.
 */
export const GAME_REQUIRED_FILES = ['binaries/Darktide.exe', 'launcher/Launcher.exe'] as const;

/**
 * Top-level directory the extension owns under Vortex userData. Everything
 * the extension writes lives under here, never inside the Darktide install.
 */
export const MOD_ROOT_DIR_NAME = 'warhammer40kdarktide-relay';

/**
 * Subdirectory under {@link MOD_ROOT_DIR_NAME} into which Vortex deploys
 * enabled mod trees. Relay consumes this directory via `--mod-path`.
 *
 * Distinct from Vortex's staging folder, which is named `mods` by Vortex's
 * own default pattern `{USERDATA}/{GAME}/mods` and is created/managed by
 * Vortex, not this extension. Using `deploy` here keeps both directories
 * under the extension root without collision.
 */
export const DEPLOY_DIR_NAME = 'deploy';

/**
 * Subdirectory under {@link MOD_ROOT_DIR_NAME} reserved for per-profile
 * load-order state. Currently unused: the sort-based projection (spec
 * Section 9) does not write here. `setup` still creates the directory
 * so it is ready if a future revision restores per-profile persistence.
 */
export const LOAD_ORDER_DIR_NAME = 'load-order';

/**
 * Custom Vortex mod attribute key that stores the canonical Darktide folder
 * name (the `<name>` in `<name>/<name>.mod`). Defined here so it has one
 * home; the installer (added in a later task) populates it.
 *
 * The canonical name is distinct from the Vortex mod ID and the Nexus title;
 * only this value is ever written to `mods.lst`.
 */
export const MOD_ATTRIBUTE_NAME = 'relayModName';

/**
 * The canonical name of the Darktide Mod Framework. DMF is the universal
 * dependency for Darktide mods; the installer emits an `after` rule
 * referencing DMF for every non-DMF mod so Vortex's sort places DMF first.
 */
export const DMF_CANONICAL_NAME = 'dmf';

/**
 * DMF's Nexus mod ID (https://www.nexusmods.com/warhammer40kdarktide/mods/8).
 * Used in the auto-generated `after` rule reference. Permanent and stable.
 */
export const DMF_NEXUS_MOD_ID = '8';

/**
 * The internal Vortex tool id for Mod Relay. Used by the tool
 * registration (`IGame.supportedTools`) and to identify Relay launches
 * in the start hook (the executable path is matched against the relay
 * directory; this id is used for logging and any Vortex UI surfaces).
 */
export const RELAY_TOOL_ID = 'mod-relay';

/** Display name shown by Vortex for the registered Relay tool. */
export const RELAY_TOOL_NAME = 'Mod Relay';

/** Short name (Vortex shows this when space is tight; keep below 8 chars). */
export const RELAY_TOOL_SHORT_NAME = 'Relay';

/** Relay launcher executable filename, beside which `relay_shell.dll` lives. */
export const RELAY_EXECUTABLE = 'mod_relay.exe';

/**
 * Quick-discovery subset of required Relay runtime files. Vortex's
 * discovery only needs enough files to uniquely identify the tool
 * directory; the start hook (spec Section 12, hard check 2) verifies
 * the complete set with {@link RELAY_REQUIRED_FILES}.
 *
 * Listed in `ITool.requiredFiles` so Vortex's discovery picks the
 * bundled Relay directory and rejects look-alikes.
 */
export const RELAY_DISCOVERY_FILES: readonly string[] = [
  RELAY_EXECUTABLE,
  'relay_shell.dll',
  'mod_loader/init.lua',
  'mod_loader/file.lua',
  'mod_loader/mod_manager.lua',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
] as const;

/**
 * The seven `mod_loader/` Lua files every Relay runtime ships. The start
 * hook verifies each exists beside the launcher (spec Section 12, hard
 * check 2). The list is grounded in Relay's published runtime layout
 * (reference doc Section 2).
 */
export const MOD_LOADER_FILES: readonly string[] = [
  'init.lua',
  'file.lua',
  'class_registry.lua',
  'require_bridge.lua',
  'lifecycle.lua',
  'mod_manager.lua',
  'dmf_adapter.lua',
] as const;

/**
 * Full list of required Relay runtime files. Combines the EXE, DLL, every
 * `mod_loader/` Lua file, and the two legal files. The start hook's hard
 * check 2 verifies every entry exists in the bundled relay directory.
 *
 * The legal files (`LICENSE`, `THIRD_PARTY_NOTICES.md`) are non-negotiable
 * per spec Section 11 and reference doc Section 11: every distributed
 * Relay bundle must include Relay's GPL-3.0 LICENSE and the third-party
 * notices for statically linked MinHook and Capstone.
 */
export const RELAY_REQUIRED_FILES: readonly string[] = [
  RELAY_EXECUTABLE,
  'relay_shell.dll',
  ...MOD_LOADER_FILES.map((name) => `mod_loader/${name}`),
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
] as const;

/**
 * Filename of the warn-once flag file that suppresses the DMF-absent /
 * DMF-misordered launch warning after it has fired once on a Vortex
 * install (spec Section 12, soft warning). Stored under the extension's
 * mod root, not the deploy dir, so purge/deploy cycles do not clear it.
 */
export const DMF_WARNING_FILE_NAME = '.dmf-warning-state.json';

/**
 * Schema version embedded in the DMF warn-flag file. Increment if the
 * file shape ever changes; the start hook reads but does not currently
 * migrate older versions.
 */
export const DMF_WARNING_FILE_VERSION = 1;
