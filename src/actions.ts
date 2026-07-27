/**
 * User-facing open-directory actions (design.md, User-facing actions).
 *
 * Two actions are registered, both on the `game-managed-buttons` action
 * group so Vortex renders them on the Darktide dashboard tile alongside
 * its built-in Open Game Folder, Open Mod Folder, Open Nexus Page, and
 * Stop Managing actions:
 *
 * - Open Relay log directory: opens the bundled Relay runtime directory
 *   (`paths.relayDir()`), which is where `relay.log` is written beside
 *   the launcher (reference doc Section 10).
 * - Open Darktide console-log directory: opens
 *   `%APPDATA%\Fatshark\Darktide\console_logs\` when it exists, or
 *   surfaces an explanatory notification when Darktide has not yet
 *   generated console logs.
 *
 * Two other capabilities named in design.md (User-facing actions) are intentionally NOT
 * registered as custom actions:
 *
 * - "Launch modded with Mod Relay" is Vortex's built-in primary-tool
 *   launch (the Relay tool carries `defaultPrimary: true`, see
 *   `./relayTool.ts`). Adding a custom launch action would duplicate the
 *   built-in Play button.
 * - "Open Relay mod directory" is Vortex's built-in "Open Mod Folder"
 *   action, which works once `game.ts` defines `getModPaths`. Registering
 *   a custom action would duplicate it.
 *
 * Version grounding (verified against the installed
 * `@nexusmods/vortex-api@2.3.0-beta.1` types):
 *
 * - `IExtensionContext.registerAction: RegisterAction` (api.d.ts line
 *   3499). `RegisterAction` (api.d.ts line 7792) is
 *   `(group, position, iconOrComponent, options, titleOrProps?,
 *   actionOrCondition?, condition?) => void`. The 6th positional arg is
 *   overloaded: returning `boolean` is interpreted as a condition, not
 *   a handler. Async handlers returning `Promise<void>` are fine because
 *   a Promise is an object (not a boolean), so the runtime overload
 *   discrimination does not misread it. Handlers MUST return `void` at
 *   runtime; the declared type here is `(instanceIds?) => void`.
 * - `IActionOptions` (api.d.ts line 1965) is
 *   `{ noCollapse?, namespace?, hollowIcon?, isClassicOnly?,
 *   isModernOnly? }`. All fields optional; we pass an empty object and
 *   rely on the `iconOrComponent` argument for the icon.
 * - `util.opn: (target: string, _wait?: boolean) => Promise<void>`
 *   (api.d.ts line 7562; exported as `open_2 as opn` at line 9373).
 *   On Windows it opens a directory in Explorer.
 * - `api.showErrorNotification?: (message, detail, options?) => void`
 *   (api.d.ts line 3137). Optional on the type; the call site guards
 *   with `?.`. Used to surface `util.opn` failures as non-blocking
 *   warnings so the user is not left wondering why nothing happened.
 *
 * Action group string: `'game-managed-buttons'`. This is one of the
 * groups Vortex's renderer defines for dashboard-tile actions; the API
 * types accept any string for the `group` parameter, so a wrong guess
 * compiles but renders nothing at runtime. {@link ACTION_GROUP} is the
 * one-line fix point if the operator's verification shows the actions do
 * not appear.
 *
 * Conditions gate on `instanceIds?.[0] === GAME_ID`. On
 * `game-managed-buttons`, the dashboard tile passes its own game ID
 * through `instanceIds[0]`, so this is the canonical pattern (no
 * `selectors.activeGameId` lookup). Verified in the Vortex renderer
 * source: only `false` hides an action; truthy strings are visible.
 * Conditions here are kept boolean.
 */

import { existsSync } from 'node:fs';
import * as nodePath from 'node:path';

import type { types } from '@nexusmods/vortex-api';
import { util } from '@nexusmods/vortex-api';

import { CONSOLE_LOGS_DIR_SEGMENTS, GAME_ID } from './constants';
import { relayDir } from './paths';

/**
 * Action group string for actions that render on a game's dashboard tile
 * alongside Vortex's built-in Open Game Folder, Open Mod Folder, and
 * similar actions. The API types accept any string for `group`; this
 * constant is the single fix point if the operator's verification shows
 * actions do not render.
 */
export const ACTION_GROUP = 'game-managed-buttons';

/** Icon name (Material) Vortex uses for its built-in open-folder actions. */
const OPEN_DIR_ICON = 'open-ext';

/**
 * Position for the "Open Relay log directory" action. Vortex's own
 * `game-managed-buttons` actions occupy positions 50, 105, 110, 120, and
 * 150 (Activate, Open Game Folder, Open Mod Folder, Open Nexus Page /
 * Manually Set Location, Stop Managing). 200 leaves clear space above
 * Vortex's top-range entries.
 */
const POSITION_OPEN_RELAY_LOG_DIR = 200;

/**
 * Position for the "Open Darktide console-log directory" action. Sits
 * immediately after the Relay log action so the two diagnostic actions
 * read as a pair.
 */
const POSITION_OPEN_DARKTIDE_CONSOLE_LOGS = 210;

/**
 * Explanatory notification shown when the user clicks the console-log
 * action before Darktide has generated any logs. Surfaces via
 * `api.sendNotification`; never blocks.
 */
const CONSOLE_LOGS_MISSING_MESSAGE =
  'Darktide has not generated console logs yet. Launch Darktide once to create them.';

/**
 * Resolves the Darktide console-log directory under the supplied APPDATA
 * path. Returns `null` only when `appData` is `undefined`; an empty
 * string is joined as-is (yielding a relative path) because that is
 * Node `path.join`'s actual behavior and pretending otherwise would
 * mask a real misconfiguration. Exported for unit testing without
 * `process.env` mutation.
 *
 * @param appData value of `process.env.APPDATA` (or equivalent).
 */
export function resolveConsoleLogsDir(appData: string | undefined): string | null {
  if (appData === undefined) {
    return null;
  }
  return nodePath.join(appData, ...CONSOLE_LOGS_DIR_SEGMENTS);
}

/**
 * Thin sync wrapper over `fs.existsSync`. Sync because the action
 * condition runs sync and the handler decides whether to call `util.opn`
 * without awaiting a stat. Exported so unit tests exercise the
 * present/missing branches with a real temp directory.
 */
export function dirExistsSync(dir: string): boolean {
  return existsSync(dir);
}

/**
 * Builds an action handler that opens `pathResolver()` via `util.opn` and
 * surfaces any rejection through `api.showErrorNotification` as a
 * non-blocking warning. The handler returns `void` at runtime (a Promise
 * is an object, not a boolean, so Vortex's overloaded 6th positional arg
 * is not misread as a condition).
 *
 * `pathResolver` is invoked lazily on each click so the resolved path
 * always reflects the current Vortex userData location, not a snapshot
 * taken at registration time.
 *
 * @param api the Vortex extension api from `IExtensionContext.api`.
 * @param title notification title used when `util.opn` rejects.
 * @param pathResolver returns the directory to open.
 */
function createOpenDirHandler(
  api: types.IExtensionApi,
  title: string,
  pathResolver: () => string,
): (instanceIds?: string[]) => void {
  return (): void => {
    // `util.opn` returns a Bluebird-style Promise per the types; treated
    // as `Promise<void>` at the call site. The catch handler swallows the
    // rejection so it does not become an unhandled promise rejection in
    // Vortex's renderer; the user still sees the failure via the
    // notification.
    void util.opn(pathResolver()).catch((err: unknown) => {
      api.showErrorNotification?.(title, err, { allowReport: false, warning: true });
    });
  };
}

/**
 * Builds the console-log handler, which checks directory existence
 * before opening. If the directory is missing (Darktide has not been
 * launched yet), it surfaces an explanatory notification instead of
 * calling `util.opn` on a nonexistent path (which would pop an Explorer
 * error dialog).
 *
 * @param api the Vortex extension api.
 */
function createConsoleLogsHandler(api: types.IExtensionApi): (instanceIds?: string[]) => void {
  return (): void => {
    const dir = resolveConsoleLogsDir(process.env.APPDATA);
    if (dir === null || !dirExistsSync(dir)) {
      api.sendNotification?.({ type: 'info', message: CONSOLE_LOGS_MISSING_MESSAGE });
      return;
    }
    void util.opn(dir).catch((err: unknown) => {
      api.showErrorNotification?.('Open Darktide console-log directory', err, {
        allowReport: false,
        warning: true,
      });
    });
  };
}

/**
 * Gate for `game-managed-buttons` actions: visible only on the Darktide
 * dashboard tile. The dashboard tile passes its own game ID through
 * `instanceIds[0]`, so this filter is the canonical pattern (no
 * `selectors.activeGameId` lookup). Returns a strict boolean so the
 * action is hidden on every other game's tile.
 */
function isDarktideTile(instanceIds?: string[]): boolean {
  return instanceIds?.[0] === GAME_ID;
}

/**
 * Registers the two user-facing open-directory actions. Called from
 * `src/index.ts` in the `main()` body, outside `context.once` (actions
 * register eagerly, like other capabilities; `context.once` is reserved
 * for long-lived event handlers).
 *
 * @param context the Vortex extension context supplied at load time.
 */
export function registerActions(context: types.IExtensionContext): void {
  const api = context.api;

  context.registerAction(
    ACTION_GROUP,
    POSITION_OPEN_RELAY_LOG_DIR,
    OPEN_DIR_ICON,
    {},
    'Open Relay log directory',
    createOpenDirHandler(api, 'Open Relay log directory', () => relayDir()),
    isDarktideTile,
  );

  context.registerAction(
    ACTION_GROUP,
    POSITION_OPEN_DARKTIDE_CONSOLE_LOGS,
    OPEN_DIR_ICON,
    {},
    'Open Darktide console-log directory',
    createConsoleLogsHandler(api),
    isDarktideTile,
  );
}
