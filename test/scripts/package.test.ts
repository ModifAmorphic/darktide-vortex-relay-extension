import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertArchiveRoot, composeArchivePath, readInfoVersion } from '../../scripts/package';

/** Unit tests for the pure helpers in scripts/package.ts. */
describe('readInfoVersion', () => {
  it('returns the version field from a valid info.json', () => {
    const text = JSON.stringify({
      name: 'Game: Warhammer 40,000: Darktide',
      author: 'ModifAmorphic',
      version: '0.1.0',
      description: 'Darktide support for Vortex through Mod Relay',
    });
    expect(readInfoVersion(text)).toBe('0.1.0');
  });

  it('returns a SemVer-style version with pre-release and build metadata', () => {
    const text = JSON.stringify({ version: '1.2.3-rc.1+build.5' });
    expect(readInfoVersion(text)).toBe('1.2.3-rc.1+build.5');
  });

  it('throws when the text is not valid JSON', () => {
    expect(() => readInfoVersion('{ not json')).toThrow(/not valid JSON/);
    expect(() => readInfoVersion('')).toThrow(/not valid JSON/);
  });

  it('throws when the parsed value is not an object', () => {
    expect(() => readInfoVersion('"a string"')).toThrow(/must be a JSON object/);
    expect(() => readInfoVersion('42')).toThrow(/must be a JSON object/);
    expect(() => readInfoVersion('null')).toThrow(/must be a JSON object/);
    expect(() => readInfoVersion('[]')).toThrow(/must be a JSON object/);
    expect(() => readInfoVersion('true')).toThrow(/must be a JSON object/);
  });

  it('throws when the version field is missing', () => {
    expect(() => readInfoVersion(JSON.stringify({ name: 'x' }))).toThrow(
      /missing a non-empty string "version" field/,
    );
  });

  it('throws when the version field is empty', () => {
    expect(() => readInfoVersion(JSON.stringify({ version: '' }))).toThrow(/non-empty string/);
  });

  it('throws when the version field is not a string', () => {
    expect(() => readInfoVersion(JSON.stringify({ version: 123 }))).toThrow(/non-empty string/);
    expect(() => readInfoVersion(JSON.stringify({ version: null }))).toThrow(/non-empty string/);
    expect(() => readInfoVersion(JSON.stringify({ version: ['1.0.0'] }))).toThrow(
      /non-empty string/,
    );
  });
});

describe('composeArchivePath', () => {
  it('composes the default archive path from version and out dir', () => {
    const result = composeArchivePath('0.1.0', path.join('repo', 'dist-package'));
    expect(result).toBe(
      path.join('repo', 'dist-package', 'darktide-relay-vortex-extension-0.1.0.zip'),
    );
  });

  it('preserves pre-release and build metadata in the filename', () => {
    const result = composeArchivePath('1.2.3-rc.1+build.5', 'out');
    expect(result).toBe(path.join('out', 'darktide-relay-vortex-extension-1.2.3-rc.1+build.5.zip'));
  });

  it('works with an absolute out dir', () => {
    const result = composeArchivePath('0.1.0', 'C:\\builds\\out');
    expect(result).toBe(path.join('C:\\builds\\out', 'darktide-relay-vortex-extension-0.1.0.zip'));
  });
});

describe('assertArchiveRoot', () => {
  it('returns no problems when every required entry is at the root', () => {
    const entries = [
      'info.json',
      'gameart.png',
      'index.js',
      'relay/mod_relay.exe',
      'relay/relay_shell.dll',
      'relay/mod_loader/init.lua',
      'relay/LICENSE',
    ];
    expect(assertArchiveRoot(entries)).toEqual([]);
  });

  it('returns no problems for the minimal required set', () => {
    const entries = ['info.json', 'gameart.png', 'index.js', 'relay/mod_relay.exe'];
    expect(assertArchiveRoot(entries)).toEqual([]);
  });

  it('reports every missing required entry', () => {
    const entries = ['relay/mod_loader/init.lua'];
    const problems = assertArchiveRoot(entries);
    expect(problems).toContain('missing "info.json" at the archive root');
    expect(problems).toContain('missing "gameart.png" at the archive root');
    expect(problems).toContain('missing "index.js" at the archive root');
    expect(problems).toContain('missing "relay/mod_relay.exe" at the archive root');
    expect(problems).toHaveLength(4);
  });

  it('rejects a wrapper directory (info.json nested under a dir)', () => {
    // A wrapper directory nests the root files one level deep; this is
    // what Compress-Archive produces without the /* glob.
    const entries = [
      'darktide-relay/info.json',
      'darktide-relay/gameart.png',
      'darktide-relay/index.js',
      'darktide-relay/relay/mod_relay.exe',
    ];
    const problems = assertArchiveRoot(entries);
    expect(problems).toContain('missing "info.json" at the archive root');
    expect(problems).toContain('missing "relay/mod_relay.exe" at the archive root');
  });

  it('normalizes backslash separators to forward slashes (Compress-Archive output)', () => {
    // Compress-Archive on Windows writes backslash entry separators.
    const entries = [
      'info.json',
      'gameart.png',
      'index.js',
      'relay\\mod_relay.exe',
      'relay\\mod_loader\\init.lua',
    ];
    expect(assertArchiveRoot(entries)).toEqual([]);
  });

  it('normalizes a leading "./" prefix on entries', () => {
    const entries = ['./info.json', './gameart.png', './index.js', './relay/mod_relay.exe'];
    expect(assertArchiveRoot(entries)).toEqual([]);
  });

  it('does NOT match relay/mod_relay.exe via a partial substring', () => {
    // Ensures the check is exact-equality on the normalized path, not a
    // substring test.
    const entries = [
      'info.json',
      'gameart.png',
      'index.js',
      'relay/x-mod_relay.exe', // contains "mod_relay.exe" but wrong path
    ];
    const problems = assertArchiveRoot(entries);
    expect(problems).toContain('missing "relay/mod_relay.exe" at the archive root');
  });

  it('treats an empty entry list as missing every required entry', () => {
    const problems = assertArchiveRoot([]);
    expect(problems).toHaveLength(4);
  });

  it('accepts extra entries alongside the required set', () => {
    // Only the required root set is asserted; extra files are allowed.
    const entries = [
      'info.json',
      'gameart.png',
      'index.js',
      'relay/mod_relay.exe',
      'README.md',
      'relay/relay_shell.dll',
    ];
    expect(assertArchiveRoot(entries)).toEqual([]);
  });

  it('ignores directory entries', () => {
    // Some zip tools store explicit directory entries (e.g. "relay/")
    // which must not interfere with the file presence check.
    const entries = ['info.json', 'gameart.png', 'index.js', 'relay/', 'relay/mod_relay.exe'];
    expect(assertArchiveRoot(entries)).toEqual([]);
  });
});
