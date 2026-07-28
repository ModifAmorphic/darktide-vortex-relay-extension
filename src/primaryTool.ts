/**
 * Primary-tool auto-promotion for the Mod Relay tool.
 *
 * Vortex 2.3 and 2.4 do NOT honor `ITool.defaultPrimary` for
 * auto-promotion (verified by reading the v2.3.0 and v2.4.0 source of
 * `src/renderer/src/extensions/starter_dashlet/index.ts`: its
 * `testPrimaryTool`, registered via `registerTest("primary-tool",
 * "gamemode-activated", ...)`, only validates or clears an existing
 * primary; it never reads `defaultPrimary` and never promotes one). The
 * Relay tool carries `defaultPrimary: true` (`./relayTool.ts`), but on
 * a fresh Vortex 2.4 install the tool appears in the Tools list, not as
 * the Default launcher, and Play would launch vanilla Darktide.exe.
 * This module promotes Relay itself.
 *
 * The promotion runs from a `registerTest("gamemode-activated", ...)`
 * check (Vortex fires `gamemode-activated` when the user activates a
 * game mode) and again as a fire-and-forget tail of the existing
 * `did-deploy` handler in `./index.ts` (deploy is the realistic moment
 * at which a freshly-bundled Relay tool becomes discoverable). Both
 * call sites share one {@link createPrimaryToolPromoter} instance.
 *
 * The decision is pure ({@link shouldPromotePrimary}); only the thin
 * {@link createPrimaryToolPromoter} factory closes over the Vortex api.
 * The factory pattern mirrors `createInstaller` in `./installer.ts`,
 * `createToolVariablesCallback` in `./toolVariables.ts`, and
 * `createStartHook` in `./startHook.ts`.
 *
 * Version grounding (verified against the installed
 * `@nexusmods/vortex-api@2.3.0-beta.1` types and the v2.3.0/v2.4.0
 * Vortex source):
 *
 * - `IExtensionContext.registerTest: (id: string, event: string, check:
 *   CheckFunction) => void` (api.d.ts line 3653). `CheckFunction = () =>
 *   PromiseLike<ITestResult>` (api.d.ts line 575). The check may return
 *   `undefined` (starter_dashlet does this); surfacing nothing keeps the
 *   promotion side effect invisible to the user.
 * - `actions.setPrimaryTool: ComplexActionCreator2<string, string, {
 *   gameId: string; toolId: string }, {}>` (api.d.ts line 8502;
 *   re-exported via the `actions` namespace at api.d.ts lines 288 and
 *   294). `setPrimaryTool` is NOT a top-level named export of the
 *   package; it is reachable only as `actions.setPrimaryTool(...)`. The
 *   action is dispatched via
 *   `api.store.dispatch(actions.setPrimaryTool(gameId, toolId))`.
 *   Setting `toolId` to `undefined` clears the primary (this is what
 *   starter_dashlet does to invalidate stale primaries); we only ever
 *   SET it to the Relay tool id.
 * - `state.settings.interface.primaryTool?.[gameId]` holds the current
 *   primary tool id for a game (api.d.ts line 6224).
 * - `state.settings.gameMode.discovered?.[gameId]?.tools?.[toolId]`
 *   holds discovered tool records (api.d.ts lines 6188-6191 and
 *   2830-2832). A discovered tool that has been resolved carries a
 *   truthy `path` (`IDiscoveredTool.path: string`, api.d.ts line 2802);
 *   an unresolved record may legitimately lack a persisted `path` (a
 *   known Vortex state quirk during mid-discovery). We treat absence of
 *   a truthy `path` as "not ready to promote" so we never promote onto
 *   a pathless discovery record.
 * - `api.store?: ThunkStore<any>` (api.d.ts line 3196). Optional on the
 *   type; in practice Vortex always supplies it. The promoter reads
 *   state through `api.getState()` (the typed wrapper) and dispatches
 *   through `api.store.dispatch`.
 */

import type { types } from '@nexusmods/vortex-api';
import { actions, selectors } from '@nexusmods/vortex-api';

import { GAME_ID, RELAY_TOOL_ID } from './constants';

/**
 * `registerTest` id for the primary-tool promotion check. Exported so
 * `./index.ts` and unit tests share one source of truth for the wiring.
 */
export const PRIMARY_TOOL_TEST_ID = 'mod-relay-primary-promote';

/**
 * The Vortex event the promotion test registers against. Vortex fires
 * `gamemode-activated` when the user activates a game mode; this is the
 * same event starter_dashlet's `primary-tool` test listens on, which
 * established the precedent for side-effecting in a `registerTest`
 * check.
 */
export const PRIMARY_TOOL_TEST_EVENT = 'gamemode-activated';

/**
 * Pure decision: returns whether the Mod Relay tool should be promoted
 * to the primary tool for `gameId` given the current Vortex state, plus
 * a short, human-readable reason for diagnostics and tests.
 *
 * Returns `{ promote: false }` when any of these hold:
 *
 * - The active profile is missing or belongs to a different game. We
 *   only promote while the user is looking at Darktide, so the
 *   promotion never crosses game boundaries.
 * - A primary tool is already set for `gameId`. We never overwrite a
 *   user's choice; clearing an existing primary is the user's job via
 *   Vortex's UI.
 * - The Relay tool has not been discovered with a resolved `path`. A
 *   discovery record may legitimately exist without a `path` while
 *   Vortex is mid-discovery; promoting in that window would point the
 *   primary at an unresolved record.
 *
 * Otherwise returns `{ promote: true }`.
 *
 * Pure: no api, no side effects, no filesystem. Imports only `types`
 * and `selectors` from `@nexusmods/vortex-api` and constants from
 * `./constants`.
 *
 * @param state live Vortex state.
 * @param gameId the game id to promote for. Defaults to
 *   {@link GAME_ID} so production call sites need no import; tests pass
 *   an explicit value to exercise the wrong-game branch without
 *   constructing a mismatched fixture.
 */
export function shouldPromotePrimary(
  state: types.IState,
  gameId: string = GAME_ID,
): { promote: boolean; reason: string } {
  const profile = selectors.activeProfile(state);
  if (profile === undefined || profile.gameId !== gameId) {
    return { promote: false, reason: 'active game is not Darktide' };
  }
  const existing = state.settings.interface.primaryTool?.[gameId];
  if (typeof existing === 'string' && existing.length > 0) {
    return { promote: false, reason: 'primary tool already set' };
  }
  const toolRecord = state.settings.gameMode.discovered?.[gameId]?.tools?.[RELAY_TOOL_ID];
  if (
    toolRecord === undefined ||
    typeof toolRecord.path !== 'string' ||
    toolRecord.path.length === 0
  ) {
    return { promote: false, reason: 'Relay tool not discovered with a path' };
  }
  return { promote: true, reason: 'no primary set and Relay is discovered' };
}

/**
 * Builds the promoter that {@link shouldPromotePrimary} and the
 * `actions.setPrimaryTool` dispatch close over. The returned function
 * reads live state, decides, and dispatches when the decision says
 * promote.
 *
 * The promoter never throws: the only side effect is the
 * (synchronous, non-throwing) redux dispatch, gated by the pure
 * decision. Returns a resolved Promise so the caller can `await` it
 * from async contexts (the `registerTest` check, the `did-deploy`
 * handler) without a try/catch.
 *
 * @param api the Vortex extension api from `IExtensionContext.api`.
 */
export function createPrimaryToolPromoter(api: types.IExtensionApi): () => Promise<void> {
  return async (): Promise<void> => {
    const state = api.getState();
    const decision = shouldPromotePrimary(state);
    if (decision.promote) {
      api.store?.dispatch(actions.setPrimaryTool(GAME_ID, RELAY_TOOL_ID));
    }
  };
}
