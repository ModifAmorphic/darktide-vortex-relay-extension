import { describe, expect, it, vi } from 'vitest';

import type { types } from '@nexusmods/vortex-api';

import { game } from '../src/game';
import main from '../src/index';
import { INSTALLER_ID, INSTALLER_PRIORITY } from '../src/installer';
import { RELAY_TOOL_ID } from '../src/constants';
import { START_HOOK_ID, START_HOOK_PRIORITY } from '../src/startHook';

/**
 * Builds a stub extension context that records only the surfaces the entry
 * uses. The cast is explicit: the real `IExtensionContext` has many
 * required methods this extension does not touch yet, and constructing them
 * all would couple the test to unrelated API surface. `as unknown as` states
 * that intent at the call site rather than papering over it with `as never`.
 *
 * The context also exposes an `api` stub since the installer factory closes
 * over `context.api` to read installed-mod state at install time, the tool
 * variables and start hook factories close over `context.api`, and the
 * event handlers registered in `context.once` close over `context.api` for
 * `onAsync`, `events.on`, and `showErrorNotification`.
 *
 * Each test resets the recorded calls by building a fresh context.
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
    registerStartHook: vi.fn(),
    registerAction: vi.fn(),
    once: vi.fn((cb: () => void | PromiseLike<void>) => {
      // Invoke synchronously so the test can assert the handlers were
      // registered. The real Vortex runtime defers this callback until
      // extensions are initialized; here we just need the side effect.
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

  it('registers the launch-guard start hook with the spec id and priority', () => {
    const ctx = stubContext();
    main(ctx);
    expect(ctx.registerStartHook).toHaveBeenCalledTimes(1);
    const args = vi.mocked(ctx.registerStartHook).mock.calls[0]!;
    expect(args[0]).toBe(START_HOOK_PRIORITY);
    expect(args[1]).toBe(START_HOOK_ID);
    expect(typeof args[2]).toBe('function');
  });

  it('registers the two user-facing open-directory actions via registerAction', () => {
    // The Open Relay log directory and Open Darktide console-log
    // directory actions both ride through registerAction (spec Section
    // 13). Open Mod Folder and Launch modded are Vortex built-ins and
    // are NOT registered here.
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
    // Tools in Vortex 2.3 are declared on `IGame.supportedTools`, not via
    // a separate `registerTool` method (api.d.ts line 4214). The entry
    // relies on the game registration to carry the Relay tool.
    expect(game.supportedTools).toBeDefined();
    expect(game.supportedTools?.map((t) => t.id)).toContain(RELAY_TOOL_ID);
  });

  it('does not register a custom load order (uses Vortex native sort)', () => {
    // The pivot drops the custom load-order page. The entry must not
    // touch registerLoadOrder at all.
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
    // did-deploy is the only async channel this extension subscribes to.
    const ctx = stubContext();
    main(ctx);
    const api = ctx.api as unknown as { onAsync: ReturnType<typeof vi.fn> };
    const channels = api.onAsync.mock.calls.map((c) => c[0]);
    expect(channels).toEqual(['did-deploy']);
  });
});
