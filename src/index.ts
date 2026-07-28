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
 * Entry point for the Darktide Relay Vortex extension. Registers the
 * Darktide game (with the Mod Relay tool), the `.mod` archive installer,
 * the Relay tool-variable resolver, the primary-tool promoter, two
 * open-directory actions, and the `mods.lst` projection event handlers.
 * Returns `true` on successful init per the `ExtensionInit` contract.
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

  // Promotes Relay to primary tool; Vortex 2.3/2.4 ignore `ITool.defaultPrimary`.
  const promoter = createPrimaryToolPromoter(context.api);
  // Returns undefined (no ITestResult); the runtime accepts it though the type
  // demands `PromiseLike<ITestResult>`.
  const check = (async (): Promise<void> => {
    await promoter();
  }) as unknown as types.CheckFunction;
  context.registerTest(PRIMARY_TOOL_TEST_ID, PRIMARY_TOOL_TEST_EVENT, check);

  // Handlers register in `context.once` so all extensions initialize first.
  context.once(() => {
    const api = context.api;

    api.onAsync('did-deploy', async (profileId: string) => {
      void profileId;
      try {
        await projectActiveProfileModsLst(api);
      } catch (err) {
        // Non-blocking: deploy succeeded; the user can fix state and redeploy.
        api.showErrorNotification?.('Darktide mods.lst projection failed', err, {
          allowReport: false,
          warning: true,
        });
      }
      // Fire-and-forget: deploy is when a freshly bundled Relay tool becomes discoverable.
      void promoter().catch(() => {});
    });

    api.events.on('profile-did-change', (profileId: string) => {
      void profileId;
      // Fire and forget: the sync handler must not block; errors surface via notification.
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
