/**
 * Pure safe-name validation for canonical Darktide mod names.
 *
 * The canonical name is the `<name>` in `<name>/<name>.mod`. Relay constructs
 * a filesystem path directly from this value, so the Vortex installer is the
 * correct boundary at which to reject unsafe values. See design.md (Installer,
 * Safe-name validation)
 * and the reference doc's "Safe names" rule.
 *
 * No Vortex imports, no side effects. Every function here is a pure unit
 * testable seam.
 */

/**
 * Windows drive-letter prefix pattern, e.g. `C:` or `c:`. Used to reject
 * absolute Windows paths such as `C:\foo` or `C:/foo` whose first segment
 * parses as a drive letter followed by a colon.
 */
const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/;

/**
 * Returns `true` if and only if `name` is a safe canonical Darktide mod name
 * per design.md (Installer, Safe-name validation):
 *
 * - non-empty after trimming;
 * - not `.` and not `..`;
 * - contains no `/` and no `\`;
 * - not an absolute or rooted value (reject anything that resolves absolute
 *   on Windows or POSIX, including `C:\foo`, `C:/foo`, `\foo`, `/foo`); and
 * - case-insensitive uniqueness is enforced separately by the installer via
 *   {@link findDuplicateNames}; this function only validates the name shape.
 *
 * Directory-agreement (the `.mod` basename must match its containing
 * directory) is a property of an archive path, not of a name in isolation.
 * That check lives in `archive.ts` (`hasBasenameDirectoryAgreement`).
 *
 * @param name candidate canonical name (the `.mod` basename minus extension).
 */
export function isSafeCanonicalName(name: string): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed === '.' || trimmed === '..') {
    return false;
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return false;
  }
  // POSIX absolute: leading `/`. Windows rooted: leading `\` (no drive).
  // Windows drive-absolute: `C:\...` or `C:/...` (the leading drive prefix
  // by itself indicates an absolute intent, since the rest is checked by
  // the separator rule above for the path body).
  const firstChar = trimmed[0];
  if (firstChar === '/' || firstChar === '\\') {
    return false;
  }
  if (WINDOWS_DRIVE_PREFIX.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * Returns the subset of `names` that appear more than once, compared
 * case-insensitively (Windows filesystem semantics; Relay runs on Windows).
 *
 * Each duplicate is returned as its lowercased form, deduplicated. Names
 * appearing only once are not returned. Used by the installer for both
 * in-archive duplicate detection and cross-mod-state duplicate detection
 * (design.md, Installer, Duplicate canonical names).
 *
 * Examples:
 *
 * - `['a', 'b', 'c']` -> `[]`
 * - `['Foo', 'foo']` -> `['foo']`
 * - `['a', 'A', 'b', 'B', 'c']` -> `['a', 'b']`
 *
 * @param names canonical names to inspect. The input is not mutated.
 */
export function findDuplicateNames(names: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const raw of names) {
    if (typeof raw !== 'string') {
      continue;
    }
    const key = raw.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates: string[] = [];
  for (const [key, count] of counts) {
    if (count > 1) {
      duplicates.push(key);
    }
  }
  return duplicates;
}
