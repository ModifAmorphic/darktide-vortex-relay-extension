import * as path from 'node:path';

import { DEPLOY_DIR_NAME, LOAD_ORDER_DIR_NAME, MOD_ROOT_DIR_NAME } from './constants';

/**
 * Pure path helpers for the extension's Vortex-managed directory layout.
 * All deployed mods and derived state live under one extension-owned
 * subtree of Vortex userData; the extension never writes inside the
 * Darktide install.
 *
 * ```text
 * <vortexUserData>/warhammer40kdarktide-relay
 *   deploy/                  <- Relay --mod-path target (parent of mods/)
 *     mods/                  <- deployed mod trees + mods.lst
 *   load-order/              <- reserved; currently unused
 * ```
 *
 * `deployDir` is the `--mod-path` value; `modsContentDir` holds the mod
 * trees and `mods.lst`. Callers pass `util.getVortexPath('userData')`;
 * these helpers never touch the Vortex api, keeping them unit-testable.
 */

export function modRoot(vortexUserData: string): string {
  return path.join(vortexUserData, MOD_ROOT_DIR_NAME);
}

export function deployDir(vortexUserData: string): string {
  return path.join(modRoot(vortexUserData), DEPLOY_DIR_NAME);
}

export function modsContentDir(vortexUserData: string): string {
  return path.join(deployDir(vortexUserData), 'mods');
}

/**
 * Reserved for future per-profile load-order state; currently unused
 * (`setup` still creates it).
 */
export function loadOrderDir(vortexUserData: string): string {
  return path.join(modRoot(vortexUserData), LOAD_ORDER_DIR_NAME);
}

/** Returns the bundled Relay runtime directory, resolved via `__dirname` (the built `index.js` ships beside `relay/`). */
export function relayDir(): string {
  return path.resolve(__dirname, 'relay');
}
