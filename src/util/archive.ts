/**
 * Pure archive parsing helpers for the installer. The Darktide layout is
 * `<name>/<name>.mod` plus optional siblings, and Nexus archives are not
 * guaranteed to put the canonical directory at the archive root, so these
 * helpers reason from the `.mod` entry path rather than the archive root.
 */

/** File extension (case-insensitive) that identifies the canonical mod entry. */
const MOD_EXTENSION = '.mod';

/** Splits on any separator so helpers tolerate POSIX and Windows-style inputs. */
function splitSegments(p: string): string[] {
  return p.split(/[\\/]/);
}

/** Last path segment of `p`, ignoring trailing separators; `''` if `p` is empty or all separators. */
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
 * Containing directory of `p` in normalized forward-slash form, or `''` if
 * `p` is a bare filename at the archive root. Returns `''` (not `'.'`) so
 * "at root" is a simple emptiness test. Mixed separators are normalized.
 */
function containingDir(p: string): string {
  const segs = splitSegments(p);
  const cleaned: string[] = [];
  for (const seg of segs) {
    if (seg !== '') {
      cleaned.push(seg);
    }
  }
  if (cleaned.length <= 1) {
    return '';
  }
  return cleaned.slice(0, -1).join('/');
}

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
 * `true` if `ancestor` is an ancestor of (or equal to) `descendant`. Both
 * inputs must be normalized forward-slash paths with no trailing separators.
 * Empty `ancestor` is treated as unrelated to any path.
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
 * `true` if `p` looks like a directory entry. Vortex appends a trailing
 * separator to directories; treating any trailing separator as a directory
 * marker keeps `.mod`-suffixed directories from being mistaken for mods.
 */
function isDirectoryEntry(p: string): boolean {
  return p.endsWith('/') || p.endsWith('\\');
}

/**
 * Every `.mod` entry in `files`: non-directory paths whose basename ends
 * with `.mod` (case-insensitive). Original path forms are preserved (no
 * normalization) so callers can correlate results back to the source list.
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
 * Strips the `.mod` extension from the basename of `modEntryPath`. Does not
 * validate the result; callers must run it through `isSafeCanonicalName`
 * before using it as a path component. Interior dots are preserved.
 */
export function deriveCanonicalName(modEntryPath: string): string {
  const base = basename(modEntryPath);
  if (base.toLowerCase().endsWith(MOD_EXTENSION) && base.length >= MOD_EXTENSION.length) {
    return base.slice(0, base.length - MOD_EXTENSION.length);
  }
  // Defensive: return the basename unmodified for a non-`.mod` path rather
  // than inventing a value.
  return base;
}

/**
 * Groups candidates by subtree root, merging groups whose containing
 * directories are equal or in an ancestor/descendant relationship
 * (single-wrapper layouts). Unrelated directories produce separate groups
 * (the multiple-root case). The Map key is the first candidate in each
 * group, for stable iteration order.
 */
export function groupBySubtreeRoot(candidates: readonly string[]): Map<string, string[]> {
  const n = candidates.length;
  if (n === 0) {
    return new Map();
  }

  const dirs = candidates.map((c) => containingDir(c));

  const parent = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
  }
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) {
      root = parent[root]!;
    }
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
      // A root-level `.mod` is its own subtree; never grouped with a
      // subdirectory one.
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
 * Directory anchoring the canonical subtree. Returns `''` when the `.mod`
 * is at the archive root (the install plan synthesizes the canonical
 * directory); otherwise the `.mod`'s containing directory. The `files`
 * parameter is reserved for future validation and currently unused.
 */
export function determineSubtreeRoot(modEntryPath: string, _files: readonly string[] = []): string {
  return containingDir(modEntryPath);
}

/**
 * `true` if the `.mod` basename (minus extension) matches the immediate
 * containing directory name (case-insensitive). Returns `true` at the
 * archive root (no containing directory to disagree). Rejecting
 * `foo/example.mod` avoids guessing which name is canonical.
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
