import { describe, expect, it } from 'vitest';

import {
  DMF_WARNING_FILE_NAME,
  RELAY_EXECUTABLE,
  RELAY_TOOL_ID,
  RELAY_TOOL_NAME,
  RELAY_TOOL_SHORT_NAME,
} from '../src/constants';
import { relayTool, RELAY_GAME_BINARY_VAR, RELAY_MOD_PATH_VAR } from '../src/relayTool';

describe('relayTool registration', () => {
  it('uses the spec tool id', () => {
    expect(relayTool.id).toBe(RELAY_TOOL_ID);
    expect(RELAY_TOOL_ID).toBe('mod-relay');
  });

  it('uses the spec display name', () => {
    expect(relayTool.name).toBe(RELAY_TOOL_NAME);
    expect(RELAY_TOOL_NAME).toBe('Mod Relay');
  });

  it('uses the short name (under 8 chars per Vortex layout guidance)', () => {
    expect(relayTool.shortName).toBe(RELAY_TOOL_SHORT_NAME);
    expect(RELAY_TOOL_SHORT_NAME).toBe('Relay');
    expect(RELAY_TOOL_SHORT_NAME.length).toBeLessThan(8);
  });

  it('is non-relative (bundled with the extension, not under the game)', () => {
    expect(relayTool.relative).toBe(false);
  });

  it('is the default primary tool when installed', () => {
    expect(relayTool.defaultPrimary).toBe(true);
  });

  it('is exclusive (blocks other Vortex tools while running)', () => {
    expect(relayTool.exclusive).toBe(true);
  });

  it('exposes the relay launcher executable basename', () => {
    expect(relayTool.executable('whatever')).toBe(RELAY_EXECUTABLE);
    expect(RELAY_EXECUTABLE).toBe('mod_relay.exe');
    // executable() ignores its argument; the basename is constant.
    expect(relayTool.executable(undefined)).toBe(RELAY_EXECUTABLE);
    expect(relayTool.executable('/some/path')).toBe(RELAY_EXECUTABLE);
  });

  it('does not set an environment (Relay owns its Steam child env)', () => {
    expect(relayTool.environment).toBeUndefined();
  });

  it('does not set onStart (operator preference controls Vortex visibility)', () => {
    expect(relayTool.onStart).toBeUndefined();
  });

  it('does not set shell or detach (defaults are correct for an EXE)', () => {
    expect(relayTool.shell).toBeUndefined();
    expect(relayTool.detach).toBeUndefined();
  });

  it('returns the bundled relay directory from queryPath', () => {
    // queryPath resolves at runtime via __dirname; the test only asserts
    // the result is a non-empty string ending with the expected segment.
    // The exact value depends on where the test process loaded the
    // module from, so a strict-equality assertion would be host-specific.
    const result = relayTool.queryPath?.() as string | undefined;
    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
    // On Windows path.sep is '\\' but Node tolerates forward slashes
    // too; assert the final segment regardless of separator.
    expect(result!.split(/[\\/]/).pop()).toBe('relay');
  });
});

describe('relayTool requiredFiles', () => {
  it('lists only the launcher binary the extension actually invokes', () => {
    // The extension treats Relay as an opaque unit; Vortex discovery
    // verifies only the launcher binary. Relay's internal runtime files
    // (DLL, mod_loader Lua, legal files) are not enumerated.
    expect(relayTool.requiredFiles).toEqual([RELAY_EXECUTABLE]);
  });

  it('does not enumerate Relay internal runtime files', () => {
    // Defense against re-introducing the file-list contract: none of
    // Relay's internal files may appear in requiredFiles.
    expect(relayTool.requiredFiles).not.toContain('relay_shell.dll');
    expect(relayTool.requiredFiles).not.toContain('mod_loader/init.lua');
    expect(relayTool.requiredFiles).not.toContain('LICENSE');
    expect(relayTool.requiredFiles).not.toContain('THIRD_PARTY_NOTICES.md');
  });
});

describe('relayTool parameters', () => {
  it('emits each flag and value as a separate token (no shell quoting)', () => {
    // design.md (Relay tool): Vortex passes parameters as spawn arguments and
    // strips literal quote characters. Keeping each value its own token
    // avoids the need for any quoting, even when a path contains spaces.
    expect(relayTool.parameters).toEqual([
      '--game-binary',
      `{${RELAY_GAME_BINARY_VAR}}`,
      '--mod-path',
      `{${RELAY_MOD_PATH_VAR}}`,
    ]);
  });

  it('uses the uppercase extension-namespaced variable names', () => {
    // Per the registerToolVariables doc comment (api.d.ts line 3881):
    // keys should be all upper case, latin characters and underscores.
    expect(RELAY_GAME_BINARY_VAR).toMatch(/^[A-Z_]+$/);
    expect(RELAY_MOD_PATH_VAR).toMatch(/^[A-Z_]+$/);
    expect(RELAY_GAME_BINARY_VAR).toBe('RELAY_GAME_BINARY');
    expect(RELAY_MOD_PATH_VAR).toBe('RELAY_MOD_PATH');
  });

  it('wraps each variable in string-template braces for Vortex expansion', () => {
    // Vortex's `string-template` formatting replaces {VAR} tokens with
    // the value from the merged variable map (reference doc Section 11).
    // Plain VAR (no braces) would be passed through literally.
    expect(relayTool.parameters).toContain(`{${RELAY_GAME_BINARY_VAR}}`);
    expect(relayTool.parameters).toContain(`{${RELAY_MOD_PATH_VAR}}`);
  });

  it('passes exactly four tokens (flag, value, flag, value)', () => {
    expect(relayTool.parameters).toHaveLength(4);
  });

  it('does not pre-quote any path', () => {
    // Vortex strips literal quotes; pre-quoting would mangle the path.
    for (const token of relayTool.parameters ?? []) {
      expect(token.includes('"')).toBe(false);
      expect(token.includes("'")).toBe(false);
    }
  });
});

describe('Relay constants consistency', () => {
  it('uses the same DMF warning filename as the start hook', () => {
    expect(DMF_WARNING_FILE_NAME).toBe('.dmf-warning-state.json');
  });

  it('exposes mod_relay.exe as the single Relay filename the extension knows', () => {
    expect(RELAY_EXECUTABLE).toBe('mod_relay.exe');
    // The requiredFiles list derives solely from RELAY_EXECUTABLE; this
    // guards against a future re-introduction of a file-list constant.
    expect(relayTool.requiredFiles).toEqual([RELAY_EXECUTABLE]);
  });
});
