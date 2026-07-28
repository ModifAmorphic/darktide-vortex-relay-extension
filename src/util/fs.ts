/**
 * Atomic filesystem write helper. Writes via a tmp file and rename so
 * concurrent readers never observe a partial or missing file. The caller
 * must ensure the destination directory exists and is writable.
 */

import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Atomically writes `content` to `filePath` via a tmp file, fsync, and
 * rename. On failure, cleans up the tmp and rethrows. The rename is atomic
 * on Windows when the destination is not held open; Relay reads `mods.lst`
 * only at launch, so there is no open handle to race.
 */
export async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmpPath = path.join(path.dirname(filePath), '.' + path.basename(filePath) + '.tmp');

  let handle: FileHandle | undefined;
  try {
    // UTF-8 (no BOM); the leading-dot name hides it on Windows and avoids
    // colliding with the final name.
    await fs.writeFile(tmpPath, content, 'utf8');

    // fsync so the rename is not itself the durable write boundary.
    // 'r+' (not 'r'): Windows FlushFileBuffers needs GENERIC_WRITE; plain 'r' fails with EPERM.
    handle = await fs.open(tmpPath, 'r+');
    await handle.sync();
    await handle.close();
    handle = undefined;

    await fs.rename(tmpPath, filePath);
  } catch (error) {
    // Close first so the OS lets us unlink.
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Swallow close errors so the original failure is what surfaces.
      }
    }
    // Best-effort tmp cleanup; ignore unlink errors (e.g. ENOENT).
    await fs.unlink(tmpPath).catch(() => {
      /* intentional: cleanup must not mask the original error */
    });
    throw error;
  }
}
