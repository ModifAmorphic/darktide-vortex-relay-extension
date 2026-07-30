/**
 * Identity, discovery, and layout constants for the Darktide Relay Vortex
 * extension. The internal game ID is distinct from the Nexus domain; the
 * Nexus association is wired through `NEXUS_PAGE_ID` via
 * `details.nexusPageId`.
 */

export const GAME_ID = 'warhammer40kdarktide-relay';

export const GAME_NAME = 'Warhammer 40,000: Darktide';

/**
 * Nexus domain / `nexusPageId`. Routes the internal game ID to Nexus
 * download metadata and NXM links; must be proven with a real
 * "Download with Manager" link.
 */
export const NEXUS_PAGE_ID = 'warhammer40kdarktide';

/** Steam app ID for Darktide (string per Vortex convention). */
export const STEAM_APP_ID = '1361210';

export const GAME_EXECUTABLE = 'binaries/Darktide.exe';

/**
 * Relative paths Vortex uses to validate a discovered install root; kept
 * short to keep discovery inexpensive.
 */
export const GAME_REQUIRED_FILES = ['binaries/Darktide.exe', 'launcher/Launcher.exe'] as const;

/**
 * Top-level directory the extension owns under Vortex userData; all
 * extension writes live here, never inside the Darktide install.
 */
export const MOD_ROOT_DIR_NAME = 'warhammer40kdarktide-relay';

/**
 * Deploy subdirectory under the extension root. Named `deploy` (not
 * `mods`) to avoid colliding with Vortex's own staging `mods` folder.
 */
export const DEPLOY_DIR_NAME = 'deploy';

/**
 * Reserved for future per-profile load-order state; currently unused, but
 * `setup` creates it for forward compatibility.
 */
export const LOAD_ORDER_DIR_NAME = 'load-order';

/**
 * Custom mod attribute storing the canonical Darktide folder name (the
 * `<name>` in `<name>/<name>.mod`). Distinct from the Vortex mod ID and
 * Nexus title; this is the only value written to `mods.lst`.
 */
export const MOD_ATTRIBUTE_NAME = 'relayModName';

/**
 * Canonical name of the Darktide Mod Framework; the installer emits an
 * `after` rule referencing DMF for every non-DMF mod.
 */
export const DMF_CANONICAL_NAME = 'dmf';

/**
 * DMF's logical file name (its stable Nexus identity). Used as the
 * `logicalFileName` in the auto-emitted `after` rule so the rule both
 * matches DMF for Vortex's sort and resolves to a display name in the
 * dependency UI ("Loads after Darktide Mod Framework").
 */
export const DMF_LOGICAL_FILE_NAME = 'Darktide Mod Framework';

/** Internal Vortex tool id for Mod Relay. */
export const RELAY_TOOL_ID = 'mod-relay';

export const RELAY_TOOL_NAME = 'Mod Relay';

/** Short name; Vortex shows this when space is tight (keep below 8 chars). */
export const RELAY_TOOL_SHORT_NAME = 'Relay';

/**
 * The Relay launcher binary, the only Relay filename the extension names.
 * Relay's internal runtime layout is Relay's concern; the extension does
 * not inspect or enumerate it.
 */
export const RELAY_EXECUTABLE = 'mod_relay.exe';

/**
 * Path segments from `%APPDATA%` to the Darktide console-log directory.
 * The underscore is intentional: `console_logs`, not `console-logs`.
 */
export const CONSOLE_LOGS_DIR_SEGMENTS = ['Fatshark', 'Darktide', 'console_logs'] as const;
