/**
 * Atomic filesystem write helper.
 *
 * Writes a file via a tmp file and rename, so concurrent readers never
 * observe a partial or missing file. Used by `mods.lst` projection (design.md,
 * mods.lst projection, Atomic write) and any future write where read-while-writing safety
 * matters.
 *
 * Version grounding (verified against the installed `@types/node@24.13.3`
 * declarations in `node_modules/@types/node/fs/promises.d.ts`; these APIs
 * are stable since Node 10 and unchanged in the Node 24 runtime the
 * extension targets):
 *
 * - `writeFile(file, data, encoding)` accepts a `'utf8'` encoding string
 *   and writes UTF-8 without BOM (promises.d.ts line 1075).
 * - `open(path, flags?, mode?)` returns `Promise<FileHandle>`; we open the
 *   tmp with flag `'r+'` after writing so we can reach `FileHandle.sync()`
 *   without re-allocating a fresh write handle (promises.d.ts line 588).
 *   On Windows, `FileHandle.sync()` ultimately calls `FlushFileBuffers`,
 *   which requires `GENERIC_WRITE` access; the read-only `'r'` flag fails
 *   with `EPERM`. `'r+'` opens read+write and works on Windows while
 *   matching POSIX `fsync` semantics.
 * - `FileHandle.sync()` flushes dirty pages and metadata to the storage
 *   device (promises.d.ts line 227, the equivalent of `fsync(2)`).
 * - `FileHandle.close()` releases the descriptor (promises.d.ts line 499).
 * - `rename(oldPath, newPath)` performs the atomic rename step
 *   (promises.d.ts line 594).
 * - `unlink(path)` removes the tmp on failure (promises.d.ts line 867).
 *
 * The caller is responsible for ensuring the destination directory exists
 * and is writable. `setupDiscoveredGame` in `src/game.ts` guarantees that
 * for the deploy directory at game-mode activation; other call sites must
 * arrange the same.
 */

import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Atomically writes `content` to `filePath` via a tmp file and rename.
 *
 * Sequence: write `<dirname>/.<basename>.tmp`, fsync, rename to `filePath`.
 * On any failure, attempts to delete the tmp file and re-throws the
 * original error.
 *
 * The rename is atomic on Windows when the destination is not held open.
 * For `mods.lst` specifically, Relay reads only at launch and the start
 * hook runs before spawn, so there is no open handle to race.
 *
 * The tmp filename (`.mods.lst.tmp` for the canonical case) is hidden on
 * Windows by the leading dot and is in the same directory as the
 * destination, so the rename stays within one volume and remains atomic.
 *
 * @param filePath absolute path to the final file.
 * @param content file content, UTF-8 without BOM, with whatever line
 *   endings the caller provides.
 */
export async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmpPath = path.join(path.dirname(filePath), '.' + path.basename(filePath) + '.tmp');

  let handle: FileHandle | undefined;
  try {
    // Write the tmp file as UTF-8 (no BOM). The leading-dot name keeps
    // it hidden on Windows and avoids colliding with the final name.
    await fs.writeFile(tmpPath, content, 'utf8');

    // fsync the tmp so the rename does not become the durable write
    // boundary in its own right. Open with 'r+' (read+write) since we
    // only need to reach sync(), not to append or truncate; on Windows,
    // FlushFileBuffers requires GENERIC_WRITE access, so plain 'r' fails.
    handle = await fs.open(tmpPath, 'r+');
    await handle.sync();
    await handle.close();
    handle = undefined;

    await fs.rename(tmpPath, filePath);
  } catch (error) {
    // Release the handle if it is still open so the OS lets us unlink.
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Swallow close errors so the original failure is what surfaces.
      }
    }
    // Best-effort cleanup of the tmp file; ignore errors from the unlink
    // itself (e.g. ENOENT when the writeFile step never produced it).
    await fs.unlink(tmpPath).catch(() => {
      /* intentional: cleanup must not mask the original error */
    });
    throw error;
  }
}
