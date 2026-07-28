/**
 * Two user-facing open-directory actions on the `game-managed-buttons`
 * group: Open Relay log directory and Open Darktide console-log directory.
 * "Launch modded" (primary-tool launch) and "Open Mod Folder" (built-in,
 * via `getModPaths`) are Vortex built-ins and are NOT registered here.
 */

import { existsSync } from 'node:fs';
import * as nodePath from 'node:path';

import type { types } from '@nexusmods/vortex-api';
import { util } from '@nexusmods/vortex-api';

import { CONSOLE_LOGS_DIR_SEGMENTS, GAME_ID } from './constants';
import { relayDir } from './paths';

/**
 * Action group that renders on a game's dashboard tile. The API accepts any
 * string for `group` (a wrong guess compiles but renders nothing); this is
 * the single fix point.
 */
export const ACTION_GROUP = 'game-managed-buttons';

/** Material icon Vortex uses for its built-in open-folder actions. */
const OPEN_DIR_ICON = 'open-ext';

/**
 * Position for the Open Relay log directory action. Vortex's built-in
 * `game-managed-buttons` actions occupy 50, 105, 110, 120, and 150; 200
 * leaves clear space above them.
 */
const POSITION_OPEN_RELAY_LOG_DIR = 200;

/** Sits right after the Relay log action so the two diagnostic actions read as a pair. */
const POSITION_OPEN_DARKTIDE_CONSOLE_LOGS = 210;

/** Notification shown when Darktide has not generated console logs yet. */
const CONSOLE_LOGS_MISSING_MESSAGE =
  'Darktide has not generated console logs yet. Launch Darktide once to create them.';

/**
 * Resolves the Darktide console-log directory under `appData`. Returns
 * `null` only when `appData` is `undefined`; an empty string is joined
 * as-is (yielding a relative path) because that is `path.join`'s actual
 * behavior, and hiding it would mask a real misconfiguration.
 */
export function resolveConsoleLogsDir(appData: string | undefined): string | null {
  if (appData === undefined) {
    return null;
  }
  return nodePath.join(appData, ...CONSOLE_LOGS_DIR_SEGMENTS);
}

/** Sync wrapper over `fs.existsSync`; the handler checks existence before calling `util.opn`. */
export function dirExistsSync(dir: string): boolean {
  return existsSync(dir);
}

/**
 * Builds a handler that opens `pathResolver()` via `util.opn` and surfaces
 * rejections via `showErrorNotification`. The handler returns `void` at
 * runtime: a Promise is an object (not a boolean), so Vortex's overloaded
 * 6th positional arg is not misread as a condition. `pathResolver` runs
 * lazily on each click so the path reflects the current userData.
 */
function createOpenDirHandler(
  api: types.IExtensionApi,
  title: string,
  pathResolver: () => string,
): (instanceIds?: string[]) => void {
  return (): void => {
    // Swallow the rejection so it does not become an unhandled rejection in
    // Vortex's renderer; the user still sees the failure via the notification.
    void util.opn(pathResolver()).catch((err: unknown) => {
      api.showErrorNotification?.(title, err, { allowReport: false, warning: true });
    });
  };
}

/**
 * Builds the console-log handler. Checks existence before opening; if the
 * directory is missing, surfaces an explanatory notification instead of
 * calling `util.opn` on a nonexistent path (which would pop an Explorer
 * error dialog).
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
 * Condition gate: visible only on the Darktide tile. The dashboard tile
 * passes its game id through `instanceIds[0]`; returns a strict boolean so
 * the action is hidden on every other tile.
 */
function isDarktideTile(instanceIds?: string[]): boolean {
  return instanceIds?.[0] === GAME_ID;
}

/**
 * Registers the two actions. Called eagerly from `main` (outside
 * `context.once`, which is reserved for long-lived event handlers).
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
