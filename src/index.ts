import type { types } from '@nexusmods/vortex-api';

import { game } from './game';
import { createInstaller } from './installer';
import { projectActiveProfileModsLst } from './modsLst';
import { createStartHook, START_HOOK_ID, START_HOOK_PRIORITY } from './startHook';
import { createToolVariablesCallback } from './toolVariables';

/**
 * Entry point for the Darktide Relay Vortex extension.
 *
 * Vortex calls this default export with an `IExtensionContext` when the
 * extension loads and expects a boolean result (`true` for successful init,
 * matching the `ExtensionInit` contract). Capabilities registered here:
 *
 * - Darktide game registration (PR #3). The game registration's
 *   `supportedTools` array carries the Mod Relay tool (spec Section
 *   11); Vortex 2.3 has no separate `registerTool` method, so the tool
 *   rides along with the game registration.
 * - The `.mod` archive installer (PR #4), which auto-emits an `after DMF`
 *   dependency rule for every non-DMF mod.
 * - Tool variables (`RELAY_GAME_BINARY`, `RELAY_MOD_PATH`) resolved at
 *   launch time so Relay's `--game-binary` and `--mod-path` arguments
 *   receive the discovered Darktide install and the extension's deploy
 *   directory.
 * - The launch-guard start hook, which validates state and regenerates
 *   `mods.lst` immediately before Relay launches (spec Section 12).
 * - The two non-Relay `mods.lst` projection call sites (`did-deploy` and
 *   `profile-did-change`); the Relay start hook is the third call site.
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
 * - `context.registerStartHook: (priority, id, hook) => void`
 *   (api.d.ts line 3805).
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
  context.registerStartHook(START_HOOK_PRIORITY, START_HOOK_ID, createStartHook(context.api));

  // Long-lived event handlers register inside `context.once` so all
  // extensions are initialized first. Both handlers project mods.lst
  // from the active profile's sorted enabled mods; both swallow
  // projection errors so they never block the underlying Vortex
  // operation. The Relay start hook is the final blocking gate
  // before launch.
  context.once(() => {
    const api = context.api;

    api.onAsync('did-deploy', async (profileId: string) => {
      void profileId;
      try {
        await projectActiveProfileModsLst(api);
      } catch (err) {
        // Non-blocking: deploy succeeded, the user can fix state and
        // redeploy. The Relay start hook will catch any remaining
        // inconsistency before launch.
        api.showErrorNotification?.('Darktide mods.lst projection failed', err, {
          allowReport: false,
          warning: true,
        });
      }
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
