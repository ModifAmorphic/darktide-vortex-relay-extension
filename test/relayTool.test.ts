import { describe, expect, it } from 'vitest';

import {
  DMF_WARNING_FILE_NAME,
  MOD_LOADER_FILES,
  RELAY_DISCOVERY_FILES,
  RELAY_EXECUTABLE,
  RELAY_REQUIRED_FILES,
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
  it('uses the quick-discovery subset, not the full set', () => {
    // The ITool.requiredFiles list is intentionally short so Vortex
    // discovery stays fast. The start hook verifies the full set.
    expect(relayTool.requiredFiles).toEqual([...RELAY_DISCOVERY_FILES]);
  });

  it('includes the launcher and shell DLL (the unique runtime markers)', () => {
    expect(relayTool.requiredFiles).toContain(RELAY_EXECUTABLE);
    expect(relayTool.requiredFiles).toContain('relay_shell.dll');
  });

  it('includes the mod loader entry points and legal files', () => {
    expect(relayTool.requiredFiles).toContain('mod_loader/init.lua');
    expect(relayTool.requiredFiles).toContain('mod_loader/file.lua');
    expect(relayTool.requiredFiles).toContain('mod_loader/mod_manager.lua');
    expect(relayTool.requiredFiles).toContain('LICENSE');
    expect(relayTool.requiredFiles).toContain('THIRD_PARTY_NOTICES.md');
  });

  it('is a strict subset of RELAY_REQUIRED_FILES (start hook verifies more)', () => {
    for (const f of relayTool.requiredFiles) {
      expect(RELAY_REQUIRED_FILES).toContain(f);
    }
  });
});

describe('relayTool parameters', () => {
  it('emits each flag and value as a separate token (no shell quoting)', () => {
    // Spec Section 11: Vortex passes parameters as spawn arguments and
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
  it('RELAY_REQUIRED_FILES contains every mod_loader Lua file under mod_loader/', () => {
    for (const lua of MOD_LOADER_FILES) {
      expect(RELAY_REQUIRED_FILES).toContain(`mod_loader/${lua}`);
    }
  });

  it('RELAY_REQUIRED_FILES contains exactly 11 files (exe, dll, 7 lua, 2 legal)', () => {
    // 1 EXE + 1 DLL + 7 Lua + 1 LICENSE + 1 THIRD_PARTY_NOTICES.md.
    expect(RELAY_REQUIRED_FILES).toHaveLength(11);
  });

  it('RELAY_DISCOVERY_FILES is a strict subset of RELAY_REQUIRED_FILES', () => {
    for (const f of RELAY_DISCOVERY_FILES) {
      expect(RELAY_REQUIRED_FILES).toContain(f);
    }
  });

  it('uses the same DMF warning filename as the start hook', () => {
    expect(DMF_WARNING_FILE_NAME).toBe('.dmf-warning-state.json');
  });

  it('MOD_LOADER_FILES contains exactly the seven published Relay Lua files', () => {
    // Reference doc Section 2: the runtime directory contains seven
    // mod_loader Lua files; the start hook verifies each exists.
    expect(MOD_LOADER_FILES).toEqual([
      'init.lua',
      'file.lua',
      'class_registry.lua',
      'require_bridge.lua',
      'lifecycle.lua',
      'mod_manager.lua',
      'dmf_adapter.lua',
    ]);
    expect(MOD_LOADER_FILES).toHaveLength(7);
  });
});
