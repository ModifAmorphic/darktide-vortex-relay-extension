import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { types } from '@nexusmods/vortex-api';
import { util } from '@nexusmods/vortex-api';

import { CONSOLE_LOGS_DIR_SEGMENTS, GAME_ID } from '../src/constants';
import {
  ACTION_GROUP,
  dirExistsSync,
  registerActions,
  resolveConsoleLogsDir,
} from '../src/actions';
import * as pathsModule from '../src/paths';

/**
 * The action module closes over the Vortex api for util.opn and the
 * notification helpers, and resolves paths through paths.relayDir and
 * process.env.APPDATA. Tests control util.opn and paths.relayDir via
 * module-level mocks; process.env.APPDATA is saved and restored so the
 * pure-helper tests can mutate it without leaking into other suites.
 * Filesystem-touching tests for dirExistsSync use a per-test tmp
 * directory under os.tmpdir().
 */

vi.mock('@nexusmods/vortex-api', () => ({
  util: {
    // opn is the open-directory primitive; default is a no-op spy so
    // handlers do not trigger unhandled rejections. Tests that assert on
    // calls or simulate failures override it in beforeEach.
    opn: vi.fn(async (_target: string) => undefined),
    getVortexPath: vi.fn(() => '/stub/vortex/userData'),
  },
}));

vi.mock('../src/paths', () => ({
  // relayDir is the only paths export the action module consumes; stub
  // it as a vi.fn so each test can point it at a per-test path.
  relayDir: vi.fn(() => '/test/relay'),
  modRoot: vi.fn(() => '/test/modRoot'),
  deployDir: vi.fn(() => '/test/deploy'),
  modsContentDir: vi.fn(() => '/test/deploy/mods'),
  loadOrderDir: vi.fn(() => '/test/loadOrder'),
}));

const RELAY_LOG_TITLE = 'Open Relay log directory';
const CONSOLE_LOG_TITLE = 'Open Darktide console-log directory';

let dir: string;
let savedAppData: string | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'actions-test-'));
  vi.mocked(util.opn).mockReset();
  vi.mocked(util.opn).mockResolvedValue(undefined);
  savedAppData = process.env.APPDATA;
});

afterEach(async () => {
  if (savedAppData === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = savedAppData;
  }
  await fs.rm(dir, { recursive: true, force: true });
});

/** Stubs api recording showErrorNotification and sendNotification calls. */
function stubApi(): types.IExtensionApi {
  return {
    showErrorNotification: vi.fn(),
    sendNotification: vi.fn(),
  } as unknown as types.IExtensionApi;
}

/** Stubs extension context whose registerAction is a spy. */
function stubContext(): types.IExtensionContext & {
  registerAction: ReturnType<typeof vi.fn>;
} {
  return {
    registerAction: vi.fn(),
    api: stubApi(),
  } as unknown as types.IExtensionContext & {
    registerAction: ReturnType<typeof vi.fn>;
  };
}

/** Per-action registration args captured by registerAction. */
function registrations(ctx: ReturnType<typeof stubContext>): Array<{
  group: string;
  position: number;
  icon: string;
  options: unknown;
  title: string;
  handler: (instanceIds?: string[]) => void;
  condition: (instanceIds?: string[]) => boolean | string;
}> {
  return vi.mocked(ctx.registerAction).mock.calls.map((c) => ({
    group: c[0] as string,
    position: c[1] as number,
    icon: c[2] as string,
    options: c[3],
    title: c[4] as string,
    handler: c[5] as (instanceIds?: string[]) => void,
    condition: c[6] as (instanceIds?: string[]) => boolean | string,
  }));
}

describe('ACTION_GROUP constant', () => {
  it("is 'game-managed-buttons' so actions render on the dashboard tile", () => {
    // The API type accepts any string for the group parameter; a wrong
    // guess compiles but renders nothing. This is the fix point if the
    // operator's verification shows the actions do not appear.
    expect(ACTION_GROUP).toBe('game-managed-buttons');
  });
});

describe('resolveConsoleLogsDir', () => {
  it('returns the joined APPDATA/Fatshark/Darktide/console_logs path', () => {
    process.env.APPDATA = 'C:\\Users\\Test\\AppData\\Roaming';
    const expected = ['C:\\Users\\Test\\AppData\\Roaming', ...CONSOLE_LOGS_DIR_SEGMENTS].join('\\');
    expect(resolveConsoleLogsDir(process.env.APPDATA)).toBe(expected);
  });

  it('returns null when APPDATA is undefined', () => {
    delete process.env.APPDATA;
    expect(resolveConsoleLogsDir(undefined)).toBeNull();
  });

  it('joins segments onto an empty APPDATA string (does NOT return null)', () => {
    // path.join('', ...) yields a relative path; an empty APPDATA is a
    // real misconfiguration the user should notice, so we surface it
    // rather than return null.
    const result = resolveConsoleLogsDir('');
    expect(result).toBe(path.join('Fatshark', 'Darktide', 'console_logs'));
    expect(result).not.toBeNull();
  });

  it('uses the underscore form (console_logs), not the hyphen form', () => {
    process.env.APPDATA = 'C:\\Users\\Test\\AppData\\Roaming';
    const result = resolveConsoleLogsDir(process.env.APPDATA);
    expect(result).toMatch(/console_logs/);
    expect(result).not.toMatch(/console-logs/);
  });
});

describe('dirExistsSync', () => {
  it('returns true for an existing directory', async () => {
    expect(dirExistsSync(dir)).toBe(true);
  });

  it('returns false for a missing path', () => {
    const missing = path.join(dir, 'does', 'not', 'exist');
    expect(dirExistsSync(missing)).toBe(false);
  });

  it('returns true for a file (thin wrapper over fs.existsSync)', async () => {
    // existsSync does not distinguish files from directories; document
    // the file behavior so the contract stays honest.
    const file = path.join(dir, 'file.txt');
    await fs.writeFile(file, 'placeholder');
    expect(dirExistsSync(file)).toBe(true);
  });
});

describe('registerActions wiring', () => {
  it('registers exactly two actions (Open Mod Folder is Vortex built-in)', () => {
    const ctx = stubContext();
    registerActions(ctx);
    expect(ctx.registerAction).toHaveBeenCalledTimes(2);
  });

  it('registers both actions on the game-managed-buttons group', () => {
    const ctx = stubContext();
    registerActions(ctx);
    for (const reg of registrations(ctx)) {
      expect(reg.group).toBe(ACTION_GROUP);
    }
  });

  it('uses the open-ext Material icon for both actions', () => {
    const ctx = stubContext();
    registerActions(ctx);
    for (const reg of registrations(ctx)) {
      expect(reg.icon).toBe('open-ext');
    }
  });

  it('passes an options object (no icon-collapse overrides needed)', () => {
    const ctx = stubContext();
    registerActions(ctx);
    for (const reg of registrations(ctx)) {
      expect(typeof reg.options).toBe('object');
    }
  });

  it('passes a handler function and a condition function on every action', () => {
    const ctx = stubContext();
    registerActions(ctx);
    for (const reg of registrations(ctx)) {
      expect(typeof reg.handler).toBe('function');
      expect(typeof reg.condition).toBe('function');
    }
  });

  it('registers the Relay log action at position 200 with the spec title', () => {
    const ctx = stubContext();
    registerActions(ctx);
    const relayLog = registrations(ctx).find((r) => r.title === RELAY_LOG_TITLE);
    expect(relayLog).toBeDefined();
    expect(relayLog!.position).toBe(200);
  });

  it('registers the console-log action at position 210 with the spec title', () => {
    const ctx = stubContext();
    registerActions(ctx);
    const consoleLog = registrations(ctx).find((r) => r.title === CONSOLE_LOG_TITLE);
    expect(consoleLog).toBeDefined();
    expect(consoleLog!.position).toBe(210);
  });

  it('positions the two actions in ascending order with room above Vortex built-ins', () => {
    const ctx = stubContext();
    registerActions(ctx);
    const positions = registrations(ctx)
      .map((r) => r.position)
      .sort((a, b) => a - b);
    // Vortex built-ins occupy up to 150; ours sit at 200 and 210.
    expect(positions[0]).toBeGreaterThanOrEqual(200);
    expect(positions[1]).toBeGreaterThan(positions[0]!);
  });
});

describe('action conditions (gate on Darktide dashboard tile)', () => {
  it('each condition returns true when instanceIds[0] is the Darktide game id', () => {
    const ctx = stubContext();
    registerActions(ctx);
    for (const reg of registrations(ctx)) {
      expect(reg.condition([GAME_ID])).toBe(true);
    }
  });

  it('each condition returns false for a different game id', () => {
    const ctx = stubContext();
    registerActions(ctx);
    for (const reg of registrations(ctx)) {
      expect(reg.condition(['skyrim'])).toBe(false);
    }
  });

  it('each condition returns false when instanceIds is undefined', () => {
    // Defending against undefined keeps the gate from throwing on a
    // future call-site change.
    const ctx = stubContext();
    registerActions(ctx);
    for (const reg of registrations(ctx)) {
      expect(reg.condition(undefined)).toBe(false);
    }
  });

  it('each condition returns false when instanceIds is empty', () => {
    const ctx = stubContext();
    registerActions(ctx);
    for (const reg of registrations(ctx)) {
      expect(reg.condition([])).toBe(false);
    }
  });

  it('conditions return a strict boolean (never a string)', () => {
    // The API type allows string returns, but the renderer treats only
    // `false` as hidden; strings are visible.
    const ctx = stubContext();
    registerActions(ctx);
    for (const reg of registrations(ctx)) {
      expect(typeof reg.condition([GAME_ID])).toBe('boolean');
      expect(typeof reg.condition(['other'])).toBe('boolean');
    }
  });
});

describe('Open Relay log directory handler', () => {
  it('calls util.opn with paths.relayDir()', async () => {
    const ctx = stubContext();
    const relayPath = path.join(dir, 'relay');
    vi.mocked(pathsModule.relayDir).mockReturnValue(relayPath);
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === RELAY_LOG_TITLE)!;

    reg.handler([GAME_ID]);
    // util.opn returns a Promise; the handler swallows it via
    // void ... .catch. Await a microtask tick so the spy is invoked
    // before the assertion.
    await Promise.resolve();
    await Promise.resolve();

    expect(util.opn).toHaveBeenCalledTimes(1);
    expect(util.opn).toHaveBeenCalledWith(relayPath);
  });

  it('reflects changes to paths.relayDir between clicks (lazy resolution)', async () => {
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === RELAY_LOG_TITLE)!;

    const first = path.join(dir, 'relay1');
    vi.mocked(pathsModule.relayDir).mockReturnValue(first);
    reg.handler([GAME_ID]);
    await Promise.resolve();
    await Promise.resolve();
    expect(util.opn).toHaveBeenLastCalledWith(first);

    const second = path.join(dir, 'relay2');
    vi.mocked(pathsModule.relayDir).mockReturnValue(second);
    reg.handler([GAME_ID]);
    await Promise.resolve();
    await Promise.resolve();
    expect(util.opn).toHaveBeenLastCalledWith(second);
  });

  it('surfaces a util.opn rejection via showErrorNotification and does not throw', async () => {
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === RELAY_LOG_TITLE)!;
    const failure = new Error('explorer hung');
    vi.mocked(util.opn).mockRejectedValueOnce(failure);

    expect(() => reg.handler([GAME_ID])).not.toThrow();
    // Flush the microtask queue so the .catch handler runs.
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.api.showErrorNotification).toHaveBeenCalledTimes(1);
    expect(ctx.api.showErrorNotification).toHaveBeenCalledWith(RELAY_LOG_TITLE, failure, {
      allowReport: false,
      warning: true,
    });
  });

  it('returns void at runtime (does not return the opn promise)', () => {
    // Vortex overloads the 6th positional arg: a boolean return is read
    // as a condition, not a handler. Asserting undefined documents the
    // runtime shape.
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === RELAY_LOG_TITLE)!;
    expect(reg.handler([GAME_ID])).toBeUndefined();
  });
});

describe('Open Darktide console-log directory handler', () => {
  it('calls util.opn with resolveConsoleLogsDir(APPDATA) when the directory exists', async () => {
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === CONSOLE_LOG_TITLE)!;

    // Materialize the console-log directory under a per-test APPDATA so
    // dirExistsSync returns true and the handler calls util.opn.
    const appdata = path.join(dir, 'AppData', 'Roaming');
    const consoleLogsDir = path.join(appdata, ...CONSOLE_LOGS_DIR_SEGMENTS);
    await fs.mkdir(consoleLogsDir, { recursive: true });
    process.env.APPDATA = appdata;

    reg.handler([GAME_ID]);
    await Promise.resolve();
    await Promise.resolve();

    expect(util.opn).toHaveBeenCalledTimes(1);
    expect(util.opn).toHaveBeenCalledWith(consoleLogsDir);
  });

  it('does NOT call util.opn when the directory is missing', async () => {
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === CONSOLE_LOG_TITLE)!;

    // Point APPDATA at an empty per-test directory so
    // resolveConsoleLogsDir returns a path that does not exist on disk.
    const appdata = path.join(dir, 'AppData', 'Roaming');
    await fs.mkdir(appdata, { recursive: true });
    process.env.APPDATA = appdata;

    expect(() => reg.handler([GAME_ID])).not.toThrow();
    expect(util.opn).not.toHaveBeenCalled();
  });

  it('surfaces an explanatory notification when the directory is missing', async () => {
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === CONSOLE_LOG_TITLE)!;

    const appdata = path.join(dir, 'AppData', 'Roaming');
    await fs.mkdir(appdata, { recursive: true });
    process.env.APPDATA = appdata;

    reg.handler([GAME_ID]);

    expect(ctx.api.sendNotification).toHaveBeenCalledTimes(1);
    const calls = (ctx.api.sendNotification as ReturnType<typeof vi.fn>).mock.calls as unknown as [
      { type: string; message: string },
    ][];
    expect(calls[0]![0].type).toBe('info');
    expect(calls[0]![0].message).toMatch(/has not generated console logs yet/i);
    expect(calls[0]![0].message).toMatch(/Launch Darktide once/i);
  });

  it('does NOT call sendNotification when the directory exists', async () => {
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === CONSOLE_LOG_TITLE)!;

    const appdata = path.join(dir, 'AppData', 'Roaming');
    const consoleLogsDir = path.join(appdata, ...CONSOLE_LOGS_DIR_SEGMENTS);
    await fs.mkdir(consoleLogsDir, { recursive: true });
    process.env.APPDATA = appdata;

    reg.handler([GAME_ID]);
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.api.sendNotification).not.toHaveBeenCalled();
    expect(util.opn).toHaveBeenCalledTimes(1);
  });

  it('treats undefined APPDATA as missing and surfaces the notification', () => {
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === CONSOLE_LOG_TITLE)!;
    delete process.env.APPDATA;

    reg.handler([GAME_ID]);

    expect(util.opn).not.toHaveBeenCalled();
    expect(ctx.api.sendNotification).toHaveBeenCalledTimes(1);
  });

  it('surfaces a util.opn rejection via showErrorNotification and does not throw', async () => {
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === CONSOLE_LOG_TITLE)!;

    const appdata = path.join(dir, 'AppData', 'Roaming');
    const consoleLogsDir = path.join(appdata, ...CONSOLE_LOGS_DIR_SEGMENTS);
    await fs.mkdir(consoleLogsDir, { recursive: true });
    process.env.APPDATA = appdata;

    const failure = new Error('permission denied');
    vi.mocked(util.opn).mockRejectedValueOnce(failure);

    expect(() => reg.handler([GAME_ID])).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.api.showErrorNotification).toHaveBeenCalledTimes(1);
    expect(ctx.api.showErrorNotification).toHaveBeenCalledWith(CONSOLE_LOG_TITLE, failure, {
      allowReport: false,
      warning: true,
    });
  });

  it('returns void at runtime (does not return the opn promise)', () => {
    const ctx = stubContext();
    registerActions(ctx);
    const reg = registrations(ctx).find((r) => r.title === CONSOLE_LOG_TITLE)!;
    delete process.env.APPDATA;
    expect(reg.handler([GAME_ID])).toBeUndefined();
  });
});
