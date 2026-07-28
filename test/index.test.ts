import { describe, expect, it, vi } from 'vitest';

import type { types } from '@nexusmods/vortex-api';

import { game } from '../src/game';
import main from '../src/index';
import { INSTALLER_ID, INSTALLER_PRIORITY } from '../src/installer';
import { RELAY_TOOL_ID } from '../src/constants';
import {
  createPrimaryToolPromoter,
  PRIMARY_TOOL_TEST_EVENT,
  PRIMARY_TOOL_TEST_ID,
} from '../src/primaryTool';

/**
 * The primary-tool promoter is mocked so the wiring test can assert the
 * did-deploy handler invokes it without coupling to its real decision.
 * The factory returns a vi.fn by default so any incidental invocation is
 * a no-op; tests that assert on the call override it per-test via
 * `vi.mocked(...).mockReturnValue(...)`.
 */
vi.mock('../src/primaryTool', () => ({
  createPrimaryToolPromoter: vi.fn(() => vi.fn(async () => undefined)),
  PRIMARY_TOOL_TEST_ID: 'mod-relay-primary-promote',
  PRIMARY_TOOL_TEST_EVENT: 'gamemode-activated',
}));

/**
 * Minimal stub of `IExtensionContext`. The cast is explicit: building
 * the full required shape would couple the test to API surface the
 * extension does not touch. The context also exposes an `api` stub
 * because the installer factory, the tool variables factory, and the
 * event handlers registered in `context.once` all close over
 * `context.api`.
 */
function stubContext(): types.IExtensionContext {
  const api: {
    onAsync: ReturnType<typeof vi.fn>;
    events: { on: ReturnType<typeof vi.fn> };
    showErrorNotification: ReturnType<typeof vi.fn>;
    sendNotification: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
  } = {
    onAsync: vi.fn(),
    events: { on: vi.fn() },
    showErrorNotification: vi.fn(),
    sendNotification: vi.fn(),
    getState: vi.fn(() => ({})),
  };
  return {
    registerGame: vi.fn(),
    registerInstaller: vi.fn(),
    registerToolVariables: vi.fn(),
    registerAction: vi.fn(),
    registerTest: vi.fn(),
    once: vi.fn((cb: () => void | PromiseLike<void>) => {
      // Invoke synchronously so the test can assert the handlers were
      // registered; the real Vortex runtime defers this callback.
      void cb();
    }),
    api: api as unknown as types.IExtensionApi,
  } as unknown as types.IExtensionContext;
}

describe('extension entry', () => {
  it('exports a function as default', () => {
    expect(typeof main).toBe('function');
  });

  it('registers exactly one game (the Darktide registration)', () => {
    const ctx = stubContext();
    main(ctx);
    expect(ctx.registerGame).toHaveBeenCalledTimes(1);
  });

  it('passes the Darktide game object to registerGame', () => {
    const ctx = stubContext();
    main(ctx);
    expect(ctx.registerGame).toHaveBeenCalledWith(game);
  });

  it('registers the installer exactly once', () => {
    const ctx = stubContext();
    main(ctx);
    expect(ctx.registerInstaller).toHaveBeenCalledTimes(1);
  });

  it('registers the installer with the spec id and priority', () => {
    const ctx = stubContext();
    main(ctx);
    const args = vi.mocked(ctx.registerInstaller).mock.calls[0]!;
    expect(args[0]).toBe(INSTALLER_ID);
    expect(args[1]).toBe(INSTALLER_PRIORITY);
    // args[2] is testSupported, args[3] is install; both must be functions.
    expect(typeof args[2]).toBe('function');
    expect(typeof args[3]).toBe('function');
  });

  it('registers the Relay tool variables callback', () => {
    const ctx = stubContext();
    main(ctx);
    expect(ctx.registerToolVariables).toHaveBeenCalledTimes(1);
    const args = vi.mocked(ctx.registerToolVariables).mock.calls[0]!;
    expect(typeof args[0]).toBe('function');
  });

  it('registers the primary-tool promotion test with the spec id and gamemode-activated event', () => {
    // Vortex 2.3 and 2.4 ignore ITool.defaultPrimary, so the extension
    // promotes Relay itself via a registerTest check on gamemode-activated.
    const ctx = stubContext();
    main(ctx);
    expect(ctx.registerTest).toHaveBeenCalledTimes(1);
    const args = vi.mocked(ctx.registerTest).mock.calls[0]!;
    expect(args[0]).toBe(PRIMARY_TOOL_TEST_ID);
    expect(args[1]).toBe(PRIMARY_TOOL_TEST_EVENT);
    expect(typeof args[2]).toBe('function'); // CheckFunction
  });

  it('registers the two user-facing open-directory actions via registerAction', () => {
    // The Open Relay log directory and Open Darktide console-log directory
    // actions ride through registerAction. Open Mod Folder and Launch
    // modded are Vortex built-ins and are NOT registered here.
    const ctx = stubContext();
    main(ctx);
    expect(ctx.registerAction).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(ctx.registerAction).mock.calls) {
      expect(typeof call[2]).toBe('string'); // icon name
      expect(typeof call[4]).toBe('string'); // title
      expect(typeof call[5]).toBe('function'); // handler
      expect(typeof call[6]).toBe('function'); // condition
    }
  });

  it('registers the Darktide game with the Relay supported tool attached', () => {
    // Tools in Vortex 2.3 are declared on IGame.supportedTools, not via a
    // separate registerTool method; the entry relies on the game
    // registration to carry the Relay tool.
    expect(game.supportedTools).toBeDefined();
    expect(game.supportedTools?.map((t) => t.id)).toContain(RELAY_TOOL_ID);
  });

  it('does not register a custom load order (uses Vortex native sort)', () => {
    // The entry relies on Vortex native sort and must not touch
    // registerLoadOrder at all.
    const ctx = stubContext();
    expect((ctx as unknown as { registerLoadOrder?: unknown }).registerLoadOrder).toBeUndefined();
    expect(() => main(ctx)).not.toThrow();
  });

  it('returns true after registration', () => {
    const ctx = stubContext();
    expect(main(ctx)).toBe(true);
  });

  it('does not throw when called with a stub context', () => {
    expect(() => main(stubContext())).not.toThrow();
  });
});

describe('event handler registration', () => {
  it('registers a context.once callback', () => {
    const ctx = stubContext();
    main(ctx);
    expect(ctx.once).toHaveBeenCalledTimes(1);
  });

  it('registers did-deploy via api.onAsync inside context.once', () => {
    const ctx = stubContext();
    main(ctx);
    const api = ctx.api as unknown as { onAsync: ReturnType<typeof vi.fn> };
    const onAsyncCalls = api.onAsync.mock.calls;
    const didDeployCalls = onAsyncCalls.filter((c) => c[0] === 'did-deploy');
    expect(didDeployCalls).toHaveLength(1);
    expect(typeof didDeployCalls[0]![1]).toBe('function');
  });

  it('registers profile-did-change via api.events.on inside context.once', () => {
    const ctx = stubContext();
    main(ctx);
    const api = ctx.api as unknown as { events: { on: ReturnType<typeof vi.fn> } };
    const eventCalls = api.events.on.mock.calls;
    const profileChangeCalls = eventCalls.filter((c) => c[0] === 'profile-did-change');
    expect(profileChangeCalls).toHaveLength(1);
    expect(typeof profileChangeCalls[0]![1]).toBe('function');
  });

  it('does not register any other onAsync channels', () => {
    const ctx = stubContext();
    main(ctx);
    const api = ctx.api as unknown as { onAsync: ReturnType<typeof vi.fn> };
    const channels = api.onAsync.mock.calls.map((c) => c[0]);
    expect(channels).toEqual(['did-deploy']);
  });

  it('invokes the primary-tool promoter from the did-deploy handler', async () => {
    // Deploy is the realistic moment at which a freshly bundled Relay
    // tool becomes discoverable, so the did-deploy handler runs the
    // promoter fire-and-forget. primaryTool is mocked at the file top;
    // this test overrides the factory to return a per-test spy.
    const promoterSpy = vi.fn(async () => undefined);
    vi.mocked(createPrimaryToolPromoter).mockReturnValue(promoterSpy);
    const ctx = stubContext();
    main(ctx);
    const api = ctx.api as unknown as { onAsync: ReturnType<typeof vi.fn> };
    const didDeployHandler = api.onAsync.mock.calls.find((c) => c[0] === 'did-deploy')![1] as (
      profileId: string,
    ) => Promise<void>;
    await didDeployHandler('profile-1');
    expect(promoterSpy).toHaveBeenCalledTimes(1);
  });
});
