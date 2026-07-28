/**
 * Promotes the Mod Relay tool to Vortex's primary tool for Darktide, because
 * Vortex 2.3/2.4 ignore `ITool.defaultPrimary`.
 */

import type { types } from '@nexusmods/vortex-api';
import { actions, selectors } from '@nexusmods/vortex-api';

import { GAME_ID, RELAY_TOOL_ID } from './constants';

/** `registerTest` id for the promotion check. */
export const PRIMARY_TOOL_TEST_ID = 'mod-relay-primary-promote';

/** The Vortex event the promotion test registers against. */
export const PRIMARY_TOOL_TEST_EVENT = 'gamemode-activated';

/**
 * Pure decision: whether Relay should be promoted to the primary tool for
 * `gameId`, plus a short reason for diagnostics and tests. Returns
 * `{ promote: false }` when:
 * - the active profile is missing or belongs to another game;
 * - a primary tool is already set for `gameId` (never overwrite the user's choice);
 * - the Relay tool has not been discovered with a resolved `path`.
 *
 * @param gameId defaults to `GAME_ID`; tests pass an explicit value for the
 *   wrong-game branch.
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
 * Builds the promoter: reads live state, decides via
 * {@link shouldPromotePrimary}, and dispatches `setPrimaryTool` when the
 * decision says promote. Never throws (the only side effect is a sync redux
 * dispatch); returns a resolved Promise so callers can `await` without
 * try/catch.
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
