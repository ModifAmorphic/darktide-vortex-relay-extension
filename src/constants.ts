/**
 * Identity, discovery, and layout constants for the Darktide Relay Vortex
 * extension.
 *
 * Grounded identifiers come from `docs/reference/vortex-extension-development.md`
 * Section 5 and `docs/architecture/design.md` (Game registration). The internal
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
 * "Download with Manager" link (design.md, Game registration).
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
 * load-order state. Currently unused: the sort-based projection (design.md,
 * Mod ordering) does not write here. `setup` still creates the directory
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

/**
 * The Relay launcher binary, the only Relay filename the extension
 * names. The extension bundles the Mod Relay runtime as an opaque unit
 * beside the built `index.js`; Relay's internal runtime layout (DLL,
 * `mod_loader` Lua files, legal files) is Relay's concern and the
 * extension does not inspect or enumerate it. Consumers that need a
 * one-element list inline `[RELAY_EXECUTABLE]` rather than referencing
 * a shared array constant.
 */
export const RELAY_EXECUTABLE = 'mod_relay.exe';

/**
 * Filename of the warn-once flag file that suppresses the DMF-absent /
 * DMF-misordered launch warning after it has fired once on a Vortex
 * install (design.md, Launch guard, Soft warning). Stored under the extension's
 * mod root, not the deploy dir, so purge/deploy cycles do not clear it.
 */
export const DMF_WARNING_FILE_NAME = '.dmf-warning-state.json';

/**
 * Schema version embedded in the DMF warn-flag file. Increment if the
 * file shape ever changes; the start hook reads but does not currently
 * migrate older versions.
 */
export const DMF_WARNING_FILE_VERSION = 1;

/**
 * Path segments from `%APPDATA%` to the Darktide console-log directory.
 * Verified against the upstream Fatshark convention
 * (`%APPDATA%\Fatshark\Darktide\console_logs\`) and the reference doc
 * Section 10. The underscore is intentional: it is `console_logs`, not
 * `console-logs`. Consumed by the console-log open-directory action in
 * `./actions.ts`.
 */
export const CONSOLE_LOGS_DIR_SEGMENTS = ['Fatshark', 'Darktide', 'console_logs'] as const;
