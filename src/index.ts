import type { types } from '@nexusmods/vortex-api';

import { registerActions } from './actions';
import { game } from './game';
import { createInstaller } from './installer';
import { projectActiveProfileModsLst } from './modsLst';
import {
  createPrimaryToolPromoter,
  PRIMARY_TOOL_TEST_EVENT,
  PRIMARY_TOOL_TEST_ID,
} from './primaryTool';
import { createToolVariablesCallback } from './toolVariables';

/**
 * Entry point for the Darktide Relay Vortex extension.
 *
 * Vortex calls this default export with an `IExtensionContext` when the
 * extension loads and expects a boolean result (`true` for successful init,
 * matching the `ExtensionInit` contract). Capabilities registered here:
 *
 * - Darktide game registration (PR #3). The game registration's
 *   `supportedTools` array carries the Mod Relay tool (design.md,
 *   Relay tool); Vortex 2.3 has no separate `registerTool` method, so the tool
 *   rides along with the game registration. The game registration also
 *   defines `getModPaths`, which enables Vortex's built-in "Open Mod
 *   Folder" dashboard action (design.md, User-facing actions).
 * - The `.mod` archive installer (PR #4), which auto-emits an `after DMF`
 *   dependency rule for every non-DMF mod.
 * - Tool variables (`RELAY_GAME_BINARY`, `RELAY_MOD_PATH`) resolved at
 *   launch time so Relay's `--game-binary` and `--mod-path` arguments
 *   receive the discovered Darktide install and the extension's deploy
 *   directory.
 * - Primary-tool auto-promotion. Vortex 2.3 and 2.4 ignore
 *   `ITool.defaultPrimary`, so a `registerTest('gamemode-activated', ...)`
 *   check promotes Relay to the primary tool for Darktide when no
 *   primary is set and Relay has been discovered with a path. The same
 *   promoter runs as a fire-and-forget tail of the `did-deploy` handler
 *   so a freshly bundled Relay tool gets promoted the first time mods
 *   deploy.
 * - Two user-facing open-directory actions (design.md, User-facing actions): Open
 *   Relay log directory and Open Darktide console-log directory. The
 *   "Launch modded" and "Open Mod Folder" capabilities are Vortex
 *   built-ins (primary-tool launch and `getModPaths`) and are NOT
 *   registered separately here.
 * - The two `mods.lst` projection call sites (`did-deploy` and
 *   `profile-did-change`).
 *
 * The extension does NOT register a custom load order. Vortex's built-in
 * mod sort (`util.sortMods`) resolves deploy order from the rules the
 * installer emits and any user-added `after`/`before` rules; the
 * projection writes the sorted, enabled mods to `mods.lst`.
 *
 * No file I/O runs at module load; the only side effect of loading is
 * capability registration. Long-lived event handlers wait for
 * `context.once` so all extensions are initialized first (reference doc
 * Section 4).
 *
 * Version grounding for the event handler and registration signatures
 * (verified against the installed `@nexusmods/vortex-api@2.3.0-beta.1`
 * types):
 *
 * - `context.once: (callback: () => void | PromiseLike<void>) => void`
 *   (api.d.ts line 3935).
 * - `api.onAsync: (eventName, listener: (...args: any[]) =>
 *   PromiseLike<any>) => void` (api.d.ts line 3364). The Vortex runtime
 *   emits `did-deploy` via `api.emitAndAwait('did-deploy', profileId,
 *   deployment)`; the listener receives `(profileId, deployment?)`. We
 *   accept the profile id and ignore the deployment detail.
 * - `api.events: NodeJS.EventEmitter` (api.d.ts line 3203). Vortex emits
 *   `profile-did-change` synchronously with `(profileId: string)`.
 * - `api.showErrorNotification?: (message, detail, options?) => void`
 *   (api.d.ts line 3137). Optional on the type, so the call site
 *   guards with `?.`; in practice Vortex always supplies it.
 * - `context.registerToolVariables: (callback: ToolParameterCB) => void`
 *   (api.d.ts line 3889).
 * - `context.registerAction: RegisterAction` (api.d.ts line 3499).
 *
 * @param context the Vortex extension context supplied at load time.
 * @returns `true` once initialization has completed successfully.
 */
function main(context: types.IExtensionContext): boolean {
  context.registerGame(game);

  const installer = createInstaller(context.api);
  context.registerInstaller(
    installer.id,
    installer.priority,
    installer.testSupported,
    installer.install,
  );

  context.registerToolVariables(createToolVariablesCallback(context.api));

  registerActions(context);

  // Auto-promote Relay to Vortex's primary tool for Darktide when no
  // primary is set. Vortex 2.3 and 2.4 ignore `ITool.defaultPrimary`,
  // so the extension promotes on its own behalf. The
  // `gamemode-activated` test fires on every Darktide activation; the
  // decision in `shouldPromotePrimary` makes the second and later
  // activations no-ops once a primary is set. The same promoter runs
  // from the `did-deploy` handler below so a freshly bundled Relay
  // tool gets promoted the first time mods deploy.
  const promoter = createPrimaryToolPromoter(context.api);
  // The check returns undefined (no ITestResult), the same pattern
  // starter_dashlet's `primary-tool` test uses: the side effect is the
  // promotion, and surfacing nothing keeps it invisible. The
  // `CheckFunction` type signature demands `PromiseLike<ITestResult>`
  // but the runtime accepts undefined (starter_dashlet relies on this);
  // the cast records that intent at the call site.
  const check = (async (): Promise<void> => {
    await promoter();
  }) as unknown as types.CheckFunction;
  context.registerTest(PRIMARY_TOOL_TEST_ID, PRIMARY_TOOL_TEST_EVENT, check);

  // Long-lived event handlers register inside `context.once` so all
  // extensions are initialized first. Both handlers project mods.lst
  // from the active profile's sorted enabled mods; both swallow
  // projection errors so they never block the underlying Vortex
  // operation.
  context.once(() => {
    const api = context.api;

    api.onAsync('did-deploy', async (profileId: string) => {
      void profileId;
      try {
        await projectActiveProfileModsLst(api);
      } catch (err) {
        // Non-blocking: deploy succeeded, the user can fix state and
        // redeploy.
        api.showErrorNotification?.('Darktide mods.lst projection failed', err, {
          allowReport: false,
          warning: true,
        });
      }
      // Fire-and-forget: deploy is the realistic moment a freshly
      // bundled Relay tool becomes discoverable, so this is the second
      // promotion opportunity (the first is the gamemode-activated
      // test). Swallow errors so a promotion failure never blocks
      // deploy; the next game-mode activation retries.
      void promoter().catch(() => {});
    });

    api.events.on('profile-did-change', (profileId: string) => {
      void profileId;
      // Fire and forget: the synchronous event handler must not block,
      // and the projection is best-effort here. Errors are surfaced via
      // notification; the next deploy or launch will retry.
      void projectActiveProfileModsLst(api).catch((err) => {
        api.showErrorNotification?.('Darktide mods.lst projection failed', err, {
          allowReport: false,
          warning: true,
        });
      });
    });
  });

  return true;
}

export default main;
