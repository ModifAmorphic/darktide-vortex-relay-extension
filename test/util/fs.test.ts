import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeAtomic } from '../../src/util/fs';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mods-lst-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('util/fs writeAtomic', () => {
  it('writes content to a new file at the target path', async () => {
    const target = path.join(dir, 'target.txt');
    await writeAtomic(target, 'hello world');
    const content = await fs.readFile(target, 'utf8');
    expect(content).toBe('hello world');
  });

  it('replaces an existing file atomically (old content gone, new content in place)', async () => {
    const target = path.join(dir, 'target.txt');
    await fs.writeFile(target, 'old content');
    await writeAtomic(target, 'new content');
    const content = await fs.readFile(target, 'utf8');
    expect(content).toBe('new content');
  });

  it('cleans up the tmp file on success', async () => {
    const target = path.join(dir, 'target.txt');
    await writeAtomic(target, 'hello world');
    const entries = await fs.readdir(dir);
    // The final file should exist; the .tmp working file should not.
    expect(entries).toContain('target.txt');
    expect(entries).not.toContain('.target.txt.tmp');
  });

  it('cleans up the tmp file and preserves the original when rename fails', async () => {
    // Spy on fs.promises.rename (the same node:fs/promises singleton
    // writeAtomic imports) to drive the rename step to fail.
    const target = path.join(dir, 'target.txt');
    await fs.writeFile(target, 'original');
    const renameSpy = vi
      .spyOn(fs, 'rename')
      .mockRejectedValueOnce(new Error('synthetic rename failure'));

    try {
      await expect(writeAtomic(target, 'new content')).rejects.toThrow('synthetic rename failure');

      const entries = await fs.readdir(dir);
      expect(entries).not.toContain('.target.txt.tmp');

      const content = await fs.readFile(target, 'utf8');
      expect(content).toBe('original');
    } finally {
      renameSpy.mockRestore();
    }
  });

  it('cleans up gracefully when the write itself fails', async () => {
    // Pointing the target at a path whose parent does not exist makes
    // writeFile fail before any tmp exists; the cleanup branch must not
    // throw trying to unlink a non-existent file.
    const target = path.join(dir, 'does-not-exist', 'target.txt');
    await expect(writeAtomic(target, 'hello world')).rejects.toThrow();
    const entries = await fs.readdir(dir);
    expect(entries).toEqual([]);
  });

  it('writes content as UTF-8 without BOM', async () => {
    const target = path.join(dir, 'target.txt');
    // Non-ASCII content forces a difference between UTF-8 and the
    // platform code page; if the helper ever defaults to latin1 or adds
    // a BOM, the byte comparison fails.
    const nonAscii = 'café 世界';
    await writeAtomic(target, nonAscii);

    const bytes = await fs.readFile(target);
    const expected = Buffer.from(nonAscii, 'utf8');
    expect(bytes.equals(expected)).toBe(true);

    // Defense in depth: the first byte must not be the UTF-8 BOM.
    expect(bytes[0]).not.toBe(0xef);
  });
});
