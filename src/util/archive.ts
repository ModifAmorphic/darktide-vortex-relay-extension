/**
 * Pure archive parsing helpers for the Darktide mod installer.
 *
 * Operates on file lists as Vortex passes them to installers: arrays of
 * archive-relative paths (strings). No Vortex imports, no side effects.
 *
 * The Darktide mod layout is `<name>/<name>.mod` plus optional siblings
 * (`scripts/...`, assets, etc.). Nexus archives are not guaranteed to put
 * the canonical mod directory at the archive root, so these helpers reason
 * from the `.mod` entry path rather than the archive root. See spec Section
 * 8.3 and the reference doc's "Archive normalization implications".
 */

/** File extension (case-insensitive) that identifies the canonical mod entry. */
const MOD_EXTENSION = '.mod';

/**
 * Splits a path into segments on any separator (forward or back). Used
 * throughout so helpers tolerate both POSIX and Windows-style inputs from
 * Vortex's host-native file walker.
 */
function splitSegments(p: string): string[] {
  return p.split(/[\\/]/);
}

/**
 * Returns the basename (last path segment) of `p`, ignoring trailing
 * separators. Empty string if `p` is empty or all separators.
 */
function basename(p: string): string {
  const segs = splitSegments(p);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    if (seg !== undefined && seg !== '') {
      return seg;
    }
  }
  return '';
}

/**
 * Returns the containing directory of `p` in normalized forward-slash form,
 * or `''` if `p` is a bare filename at the archive root. Trailing separators
 * on the input are ignored. Returns `''` rather than `'.'` to make "at root"
 * checks a simple emptiness test.
 *
 * Examples:
 *
 * - `'example.mod'` -> `''`
 * - `'foo/example.mod'` -> `'foo'`
 * - `'a/b/example.mod'` -> `'a/b'`
 * - `'a/b\\example.mod'` -> `'a/b'` (mixed separators normalized)
 */
function containingDir(p: string): string {
  const segs = splitSegments(p);
  // Drop trailing empty segments (from trailing separators).
  const cleaned: string[] = [];
  for (const seg of segs) {
    if (seg !== '') {
      cleaned.push(seg);
    }
  }
  if (cleaned.length <= 1) {
    return '';
  }
  // Drop the basename; the rest is the containing directory.
  return cleaned.slice(0, -1).join('/');
}

/**
 * Returns the last segment of a directory path, or `''` if the input is
 * empty or has no segments.
 */
function lastSegment(dir: string): string {
  if (dir === '') {
    return '';
  }
  const segs = splitSegments(dir);
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    if (seg !== undefined && seg !== '') {
      return seg;
    }
  }
  return '';
}

/**
 * Returns `true` if `ancestor` is an ancestor of (or equal to) `descendant`
 * in normalized path terms. Both inputs must be normalized forward-slash
 * directory paths with no trailing separators. Empty `ancestor` is treated
 * as unrelated to any non-empty path (root-level `.mod` files are handled
 * by the caller, not as ancestors).
 *
 * Examples:
 *
 * - `('a', 'a')` -> `true`
 * - `('a', 'a/b')` -> `true`
 * - `('a', 'ab')` -> `false`
 * - `('a/b', 'a')` -> `false`
 */
function isAncestorOrEqual(ancestor: string, descendant: string): boolean {
  if (ancestor === '' || descendant === '') {
    return false;
  }
  if (ancestor === descendant) {
    return true;
  }
  return descendant.startsWith(ancestor + '/');
}

/**
 * Returns `true` if `p` looks like a directory entry. Vortex's file walker
 * appends a trailing path separator to directory entries. We treat any
 * trailing separator as a directory marker so `.mod`-suffixed directories
 * are not mistaken for mod entries.
 */
function isDirectoryEntry(p: string): boolean {
  return p.endsWith('/') || p.endsWith('\\');
}

/**
 * Returns every `.mod` entry path in `files`. A `.mod` entry is a non-directory
 * path whose basename ends with `.mod` (case-insensitive). The original path
 * form is preserved (no separator normalization) so callers can correlate
 * results back to the source file list.
 *
 * @param files archive-relative paths from Vortex's installer API.
 */
export function findModCandidates(files: readonly string[]): string[] {
  const result: string[] = [];
  for (const f of files) {
    if (typeof f !== 'string' || f.length === 0) {
      continue;
    }
    if (isDirectoryEntry(f)) {
      continue;
    }
    const base = basename(f);
    if (base.length === 0) {
      continue;
    }
    if (base.toLowerCase().endsWith(MOD_EXTENSION)) {
      result.push(f);
    }
  }
  return result;
}

/**
 * Strips the `.mod` extension from the basename of `modEntryPath` and
 * returns the result. Does not validate the result; callers must run the
 * output through `isSafeCanonicalName` before using it as a path component.
 *
 * Interior dots are preserved (`my.mod.mod` -> `my.mod`). Paths containing
 * directories are handled (`foo/bar.mod` -> `bar`). The check is
 * case-insensitive (Windows filesystem semantics).
 *
 * @param modEntryPath archive-relative path to a `.mod` file.
 */
export function deriveCanonicalName(modEntryPath: string): string {
  const base = basename(modEntryPath);
  if (base.toLowerCase().endsWith(MOD_EXTENSION) && base.length >= MOD_EXTENSION.length) {
    return base.slice(0, base.length - MOD_EXTENSION.length);
  }
  // Defensive: callers should only pass `.mod` candidates from
  // findModCandidates, which already filter on extension. If somehow a
  // non-`.mod` path arrives, return its basename unmodified rather than
  // inventing a value.
  return base;
}

/**
 * Groups `.mod` candidates by their containing directory, merging groups
 * whose containing directories are the same or in an ancestor/descendant
 * relationship (single-wrapper layouts such as `release-wrapper/example/`
 * alongside `release-wrapper/example/scripts/`).
 *
 * Two candidates are placed in different groups when neither containing
 * directory is an ancestor or descendant of the other (the multiple-root
 * case rejected per spec Section 8.3).
 *
 * The Map key is the path of the first candidate in each group; the value
 * is the list of candidates in that group. The key choice is for stable
 * iteration order, not semantic meaning.
 *
 * @param candidates `.mod` entry paths, typically output of `findModCandidates`.
 */
export function groupBySubtreeRoot(candidates: readonly string[]): Map<string, string[]> {
  const n = candidates.length;
  if (n === 0) {
    return new Map();
  }

  // Precompute containing directories in normalized forward-slash form.
  const dirs = candidates.map((c) => containingDir(c));

  // Union-find over candidate indices.
  const parent = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
  }
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
    // Path compression.
    while (parent[i] !== root) {
      const next = parent[i]!;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent[ra] = rb;
    }
  };
  const related = (i: number, j: number): boolean => {
    const di = dirs[i]!;
    const dj = dirs[j]!;
    if (di === '' || dj === '') {
      // A root-level `.mod` is its own subtree; never grouped with one in
      // a subdirectory (different archive shape entirely).
      return di === dj;
    }
    return isAncestorOrEqual(di, dj) || isAncestorOrEqual(dj, di);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (related(i, j)) {
        union(i, j);
      }
    }
  }

  // Build result keyed by the candidate path at the root index of each group.
  const result = new Map<string, string[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const key = candidates[root]!;
    const existing = result.get(key);
    if (existing === undefined) {
      result.set(key, [candidates[i]!]);
    } else {
      existing.push(candidates[i]!);
    }
  }
  return result;
}

/**
 * Returns the directory path that anchors the canonical subtree. If the
 * `.mod` is at the archive root, returns `''` to signal that the install
 * plan must synthesize the canonical directory. Otherwise returns the
 * `.mod`'s containing directory in normalized forward-slash form.
 *
 * The `files` parameter is accepted for parity with the install pipeline
 * (and reserved for future validation that the subtree actually contains
 * files) but is not used by the current implementation.
 *
 * @param modEntryPath archive-relative path to a `.mod` file.
 * @param _files full archive file list (reserved).
 */
export function determineSubtreeRoot(modEntryPath: string, _files: readonly string[] = []): string {
  return containingDir(modEntryPath);
}

/**
 * Returns `true` if the `.mod` basename (minus extension) matches the
 * immediate containing directory name (case-insensitive). Returns `true`
 * when the `.mod` is at the archive root, since there is no containing
 * directory to disagree with.
 *
 * Implements the directory-agreement rule from spec Section 8.2: an archive
 * whose layout is `foo/example.mod` (containing directory disagrees with
 * the `.mod` basename) is rejected rather than guessing which name is
 * canonical.
 *
 * @param modEntryPath archive-relative path to a `.mod` file.
 */
export function hasBasenameDirectoryAgreement(modEntryPath: string): boolean {
  const dir = containingDir(modEntryPath);
  if (dir === '') {
    return true;
  }
  const dirName = lastSegment(dir);
  const baseName = deriveCanonicalName(modEntryPath);
  if (dirName.length === 0 || baseName.length === 0) {
    return false;
  }
  return dirName.toLowerCase() === baseName.toLowerCase();
}
