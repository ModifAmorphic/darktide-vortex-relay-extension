import * as path from 'node:path';

import { DEPLOY_DIR_NAME, LOAD_ORDER_DIR_NAME, MOD_ROOT_DIR_NAME } from './constants';

/**
 * Pure path helpers for the extension's Vortex-managed directory layout.
 *
 * The extension never writes inside the Darktide installation. All deployed
 * mods and derived state live under a single extension-owned subtree of
 * Vortex userData:
 *
 * ```text
 * <vortexUserData>/warhammer40kdarktide-relay
 *   deploy/                  <- passed to Relay via --mod-path (parent of mods/)
 *     mods/                  <- deployed mod trees + mods.lst live here
 *       mods.lst
 *       <modname>/
 *         <modname>.mod
 *         ...
 *   load-order/              <- reserved; currently unused (see LOAD_ORDER_DIR_NAME)
 * ```
 *
 * Relay's `--mod-path` points at `deploy/`, and the launcher expects
 * `deploy/mods/` to contain the mod folders and `mods.lst` (Mod Relay
 * layout). `deployDir` returns the `--mod-path` value; `modsContentDir`
 * returns the directory that actually holds the deployed trees and
 * `mods.lst`.
 *
 * `<vortexUserData>` is supplied by the caller from
 * `util.getVortexPath('userData')`; these functions never reach into the
 * Vortex API themselves, which keeps them unit-testable without mocking.
 *
 * Platform handling: the helpers use Node's default `path` module, which
 * on Windows produces backslash-separated strings. That matches production
 * (Vortex is Windows-only) and matches the test host (CI runs on Windows).
 * Tests assert exact Windows path strings; no separator-normalization
 * helper is needed or wanted.
 */

/**
 * Returns the absolute path of the extension-owned root directory under
 * Vortex userData.
 *
 * @param vortexUserData absolute Vortex userData path.
 */
export function modRoot(vortexUserData: string): string {
  return path.join(vortexUserData, MOD_ROOT_DIR_NAME);
}

/**
 * Returns the absolute path of the deployment target. Vortex writes enabled
 * mod trees here, and Relay consumes this directory via `--mod-path`. This
 * directory is the parent of the `mods/` content directory that holds the
 * actual mod folders and `mods.lst`; Relay's launcher expects
 * `<deployDir>/mods/` to contain them.
 *
 * @param vortexUserData absolute Vortex userData path.
 */
export function deployDir(vortexUserData: string): string {
  return path.join(modRoot(vortexUserData), DEPLOY_DIR_NAME);
}

/**
 * Returns the absolute path of the directory that contains the deployed
 * mod trees and `mods.lst`. Mod Relay consumes this directory's contents
 * via `--mod-path <deployDir>`; the launcher expects `<deployDir>/mods/`
 * to contain the mod folders and `mods.lst`.
 *
 * @param vortexUserData absolute Vortex userData path.
 */
export function modsContentDir(vortexUserData: string): string {
  return path.join(deployDir(vortexUserData), 'mods');
}

/**
 * Returns the absolute path of the reserved load-order directory.
 * Currently unused; the sort-based projection does not write here. `setup`
 * still creates the directory so it is ready if a future revision restores
 * per-profile persistence.
 *
 * @param vortexUserData absolute Vortex userData path.
 */
export function loadOrderDir(vortexUserData: string): string {
  return path.join(modRoot(vortexUserData), LOAD_ORDER_DIR_NAME);
}

/**
 * Returns the absolute path of the bundled Relay runtime directory.
 *
 * Resolved at runtime relative to the loaded extension module via
 * `__dirname`, so it works both in the built extension (`dist/index.js`
 * sits in the extension install directory alongside `relay/`) and during
 * dev iteration (`dev-install` copies `relay/` next to `index.js`).
 *
 * `__dirname` is available because Rolldown emits CommonJS for the Node
 * platform (design.md, Mod directory). Verified at implementation time: the bundled
 * `dist/index.js` references `__dirname` verbatim and Node's CommonJS
 * module loader supplies it as the directory of the loaded module.
 *
 * design.md (Relay tool) names this as the Relay tool's `queryPath` return
 * value. The Relay runtime itself is gitignored and not bundled until
 * step 8; until then the start hook's "Relay files exist" hard check
 * blocks launch until the operator populates `relay/`.
 */
export function relayDir(): string {
  return path.resolve(__dirname, 'relay');
}
