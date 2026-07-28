import { describe, expect, it, vi } from 'vitest';

import type { types } from '@nexusmods/vortex-api';
import { actions, selectors } from '@nexusmods/vortex-api';

import { GAME_ID, RELAY_TOOL_ID } from '../src/constants';
import {
  createPrimaryToolPromoter,
  PRIMARY_TOOL_TEST_EVENT,
  PRIMARY_TOOL_TEST_ID,
  shouldPromotePrimary,
} from '../src/primaryTool';

/**
 * The pure decision helper takes live Vortex state and reads it via
 * `selectors.activeProfile` plus two nested settings paths. Tests build
 * a minimal state shape inline (mirroring how `test/startHook.test.ts`
 * builds state for `decideDmfWarning`) so the decision is exercised
 * without an api or a store.
 *
 * The promoter factory test uses a tiny fake `api` (getState returns
 * the fixture state, store.dispatch is a spy) and the stub
 * `actions.setPrimaryTool` returns an opaque sentinel action. The
 * decision is what governs the dispatch, so the assertions reduce to
 * "dispatch was called (or not) per the decision".
 */

vi.mock('@nexusmods/vortex-api', () => ({
  selectors: {
    activeProfile: vi.fn(() => undefined),
  },
  actions: {
    // Sentinel action carrying the args so the promoter dispatch test
    // can assert the dispatch received the right payload.
    setPrimaryTool: vi.fn((gameId: string, toolId: string): unknown => ({
      type: 'set-primary-tool',
      gameId,
      toolId,
    })),
  },
}));

/**
 * Builds a minimal Vortex `IState` fixture with the supplied primary
 * tool and discovered Relay tool record. Other state the decision does
 * not read is omitted; the `as unknown as types.IState` cast records
 * that intent at the call site.
 *
 * @param activeGameId the `gameId` of the active profile. When defined,
 *   the fixture's active profile carries this id (and `selectors.activeProfile`
 *   is mocked to return it).
 * @param primaryToolId the current primary tool id for `gameId`. Pass
 *   `undefined` to leave the primary unset.
 * @param relayPath the discovered Relay tool's `path`. Pass `undefined`
 *   for a discovery record without a path; pass `null` for no
 *   discovery record at all.
 */
function makeState(opts: {
  activeGameId?: string;
  primaryToolId?: string;
  relayPath?: string | null;
}): types.IState {
  const profile =
    opts.activeGameId === undefined
      ? undefined
      : ({
          id: 'p',
          gameId: opts.activeGameId,
          name: 'T',
          modState: {},
          lastActivated: 0,
        } as unknown as types.IProfile);
  vi.mocked(selectors.activeProfile).mockReturnValue(profile);
  const tools =
    opts.relayPath === null || opts.relayPath === undefined
      ? opts.relayPath === null
        ? {}
        : { [RELAY_TOOL_ID]: {} }
      : { [RELAY_TOOL_ID]: { path: opts.relayPath } };
  return {
    settings: {
      interface: {
        primaryTool: opts.primaryToolId === undefined ? {} : { [GAME_ID]: opts.primaryToolId },
      },
      gameMode: {
        discovered: {
          [GAME_ID]: {
            tools: tools as unknown as types.IDiscoveryResult['tools'],
          },
        },
      },
    },
  } as unknown as types.IState;
}

describe('constants', () => {
  it('exposes the spec test id and event', () => {
    expect(PRIMARY_TOOL_TEST_ID).toBe('mod-relay-primary-promote');
    expect(PRIMARY_TOOL_TEST_EVENT).toBe('gamemode-activated');
  });
});

describe('shouldPromotePrimary', () => {
  it('returns promote=false when there is no active profile', () => {
    const decision = shouldPromotePrimary(makeState({ activeGameId: undefined }), GAME_ID);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toMatch(/not Darktide/i);
  });

  it('returns promote=false when the active profile is for a different game', () => {
    const decision = shouldPromotePrimary(makeState({ activeGameId: 'skyrim' }), GAME_ID);
    expect(decision.promote).toBe(false);
    expect(decision.reason).toMatch(/not Darktide/i);
  });

  it('returns promote=false when a primary tool is already set for the game', () => {
    const decision = shouldPromotePrimary(
      makeState({ activeGameId: GAME_ID, primaryToolId: 'other-tool', relayPath: 'C:\\Relay' }),
      GAME_ID,
    );
    expect(decision.promote).toBe(false);
    expect(decision.reason).toMatch(/already set/i);
  });

  it('returns promote=false when the Relay tool has no discovery record at all', () => {
    const decision = shouldPromotePrimary(
      makeState({ activeGameId: GAME_ID, relayPath: null }),
      GAME_ID,
    );
    expect(decision.promote).toBe(false);
    expect(decision.reason).toMatch(/not discovered/i);
  });

  it('returns promote=false when the Relay tool is discovered without a path', () => {
    // Vortex may legitimately persist a discovery record before the
    // tool's `path` has been resolved; we treat absence of a truthy
    // path as "not ready to promote".
    const decision = shouldPromotePrimary(
      makeState({ activeGameId: GAME_ID, relayPath: undefined }),
      GAME_ID,
    );
    expect(decision.promote).toBe(false);
    expect(decision.reason).toMatch(/not discovered/i);
  });

  it('returns promote=false when the Relay tool is discovered with an empty path', () => {
    const decision = shouldPromotePrimary(
      makeState({ activeGameId: GAME_ID, relayPath: '' }),
      GAME_ID,
    );
    expect(decision.promote).toBe(false);
    expect(decision.reason).toMatch(/not discovered/i);
  });

  it('returns promote=true when no primary is set and Relay is discovered with a path', () => {
    const decision = shouldPromotePrimary(
      makeState({ activeGameId: GAME_ID, relayPath: 'C:\\Program Files\\Vortex\\plugins\\relay' }),
      GAME_ID,
    );
    expect(decision.promote).toBe(true);
    expect(decision.reason).toMatch(/no primary set/i);
  });

  it('defaults the gameId parameter to GAME_ID', () => {
    // No gameId argument; the decision must still match the Darktide
    // active profile. This verifies the default works at the call site
    // (src/index.ts does not pass gameId explicitly).
    const decision = shouldPromotePrimary(
      makeState({ activeGameId: GAME_ID, relayPath: 'C:\\Relay' }),
    );
    expect(decision.promote).toBe(true);
  });

  it('ignores a primary tool set for a different game', () => {
    // A primary set on a different game's slot does not block promotion
    // for Darktide. The lookup is keyed by gameId.
    const state = {
      settings: {
        interface: {
          primaryTool: { skyrim: 'skse' },
        },
        gameMode: {
          discovered: {
            [GAME_ID]: {
              tools: { [RELAY_TOOL_ID]: { path: 'C:\\Relay' } },
            },
          },
        },
      },
    } as unknown as types.IState;
    vi.mocked(selectors.activeProfile).mockReturnValue({
      id: 'p',
      gameId: GAME_ID,
      name: 'T',
      modState: {},
      lastActivated: 0,
    } as unknown as types.IProfile);
    const decision = shouldPromotePrimary(state, GAME_ID);
    expect(decision.promote).toBe(true);
  });
});

describe('createPrimaryToolPromoter', () => {
  /** Builds a fake api with a spy dispatch and the supplied fixture state. */
  function fakeApi(state: types.IState): {
    api: types.IExtensionApi;
    dispatch: ReturnType<typeof vi.fn>;
  } {
    const dispatch = vi.fn();
    const api = {
      getState: () => state,
      store: { dispatch },
    } as unknown as types.IExtensionApi;
    return { api, dispatch };
  }

  it('dispatches setPrimaryTool when the decision says promote', async () => {
    const state = makeState({ activeGameId: GAME_ID, relayPath: 'C:\\Relay' });
    const { api, dispatch } = fakeApi(state);
    const promoter = createPrimaryToolPromoter(api);
    await promoter();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(actions.setPrimaryTool).toHaveBeenCalledWith(GAME_ID, RELAY_TOOL_ID);
  });

  it('dispatches setPrimaryTool with the gameId and Relay tool id as the action payload', async () => {
    const state = makeState({ activeGameId: GAME_ID, relayPath: 'C:\\Relay' });
    const { api, dispatch } = fakeApi(state);
    await createPrimaryToolPromoter(api)();
    // The default stub returns a sentinel action carrying the args; the
    // dispatch must receive exactly that action object.
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'set-primary-tool', gameId: GAME_ID, toolId: RELAY_TOOL_ID }),
    );
  });

  it('does NOT dispatch when there is no active profile', async () => {
    const state = makeState({ activeGameId: undefined });
    const { api, dispatch } = fakeApi(state);
    await createPrimaryToolPromoter(api)();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does NOT dispatch when the active profile is for a different game', async () => {
    const state = makeState({ activeGameId: 'skyrim', relayPath: 'C:\\Relay' });
    const { api, dispatch } = fakeApi(state);
    await createPrimaryToolPromoter(api)();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does NOT dispatch when a primary tool is already set', async () => {
    const state = makeState({
      activeGameId: GAME_ID,
      primaryToolId: 'user-chosen-tool',
      relayPath: 'C:\\Relay',
    });
    const { api, dispatch } = fakeApi(state);
    await createPrimaryToolPromoter(api)();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does NOT dispatch when the Relay tool has no discovered path', async () => {
    const state = makeState({ activeGameId: GAME_ID, relayPath: undefined });
    const { api, dispatch } = fakeApi(state);
    await createPrimaryToolPromoter(api)();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does NOT dispatch when the Relay tool has no discovery record at all', async () => {
    const state = makeState({ activeGameId: GAME_ID, relayPath: null });
    const { api, dispatch } = fakeApi(state);
    await createPrimaryToolPromoter(api)();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns a resolved promise even when not dispatching', async () => {
    const state = makeState({ activeGameId: undefined });
    const { api } = fakeApi(state);
    await expect(createPrimaryToolPromoter(api)()).resolves.toBeUndefined();
  });

  it('re-evaluates state on every invocation', async () => {
    // The promoter must read fresh state each call so promotion fires
    // as soon as Vortex discovers the Relay tool, even if the promoter
    // was created before discovery completed.
    const stateA = makeState({ activeGameId: GAME_ID, relayPath: undefined });
    const dispatch = vi.fn();
    let current = stateA;
    const api = {
      getState: () => current,
      store: { dispatch },
    } as unknown as types.IExtensionApi;
    const promoter = createPrimaryToolPromoter(api);
    await promoter();
    expect(dispatch).not.toHaveBeenCalled();
    current = makeState({ activeGameId: GAME_ID, relayPath: 'C:\\Relay' });
    await promoter();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
