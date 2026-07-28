/**
 * Safe-name validation for canonical Darktide mod names (the `<name>` in
 * `<name>/<name>.mod`). Relay builds a filesystem path directly from this
 * value, so the installer is the boundary that rejects unsafe names.
 */

/** Windows drive-letter prefix (e.g. `C:`), used to reject drive-absolute names. */
const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/;

/**
 * `true` if `name` is a safe canonical mod name: non-empty (after trim),
 * not `.` or `..`, no separators, and not absolute or rooted on Windows or
 * POSIX. Case-insensitive uniqueness is enforced separately by the
 * installer, not here.
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
  // Reject POSIX-absolute (`/`), Windows-rooted (`\`), and drive-absolute (`C:`) forms.
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
 * Returns names that appear more than once, compared case-insensitively
 * (Windows filesystem semantics). Each duplicate is returned once, in its
 * lowercased form; names appearing once are omitted.
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
