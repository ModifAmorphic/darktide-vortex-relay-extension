import { describe, expect, it } from 'vitest';

import { findDuplicateNames, isSafeCanonicalName } from '../../src/util/names';

describe('util/names', () => {
  describe('isSafeCanonicalName', () => {
    it('accepts a typical lowercase name', () => {
      expect(isSafeCanonicalName('scoreboard')).toBe(true);
    });

    it('accepts mixed case', () => {
      expect(isSafeCanonicalName('NumericUI')).toBe(true);
    });

    it('accepts names with hyphens', () => {
      expect(isSafeCanonicalName('my-mod')).toBe(true);
    });

    it('accepts names with underscores', () => {
      expect(isSafeCanonicalName('my_mod')).toBe(true);
    });

    it('accepts names with interior dots', () => {
      expect(isSafeCanonicalName('my.mod')).toBe(true);
    });

    it('rejects empty string', () => {
      expect(isSafeCanonicalName('')).toBe(false);
    });

    it('rejects whitespace-only string', () => {
      expect(isSafeCanonicalName('   ')).toBe(false);
      expect(isSafeCanonicalName('\t')).toBe(false);
    });

    it('rejects "."', () => {
      expect(isSafeCanonicalName('.')).toBe(false);
    });

    it('rejects ".."', () => {
      expect(isSafeCanonicalName('..')).toBe(false);
    });

    it('rejects names containing "/"', () => {
      expect(isSafeCanonicalName('foo/bar')).toBe(false);
    });

    it('rejects names containing "\\"', () => {
      expect(isSafeCanonicalName('foo\\bar')).toBe(false);
    });

    it('rejects Windows absolute paths with backslashes', () => {
      expect(isSafeCanonicalName('C:\\foo')).toBe(false);
    });

    it('rejects Windows absolute paths with forward slashes', () => {
      expect(isSafeCanonicalName('C:/foo')).toBe(false);
    });

    it('rejects Windows drive paths with lowercase drive letter', () => {
      expect(isSafeCanonicalName('c:/foo')).toBe(false);
    });

    it('rejects POSIX absolute paths', () => {
      expect(isSafeCanonicalName('/foo')).toBe(false);
    });

    it('rejects Windows rooted paths (leading backslash, no drive)', () => {
      expect(isSafeCanonicalName('\\foo')).toBe(false);
    });

    it('trims surrounding whitespace before checking', () => {
      expect(isSafeCanonicalName('  scoreboard  ')).toBe(true);
    });

    it('rejects non-string input defensively', () => {
      expect(isSafeCanonicalName(undefined as unknown as string)).toBe(false);
      expect(isSafeCanonicalName(null as unknown as string)).toBe(false);
    });
  });

  describe('findDuplicateNames', () => {
    it('returns empty array for a list with no duplicates', () => {
      expect(findDuplicateNames(['a', 'b', 'c'])).toEqual([]);
    });

    it('returns empty array for an empty list', () => {
      expect(findDuplicateNames([])).toEqual([]);
    });

    it('returns the lowercased duplicate for a pair differing in case', () => {
      expect(findDuplicateNames(['Foo', 'foo'])).toEqual(['foo']);
    });

    it('returns multiple duplicates when present', () => {
      const result = findDuplicateNames(['a', 'A', 'b', 'B', 'c']);
      expect(result.sort()).toEqual(['a', 'b']);
    });

    it('does not return names that appear once', () => {
      const result = findDuplicateNames(['a', 'a', 'b']);
      expect(result).toEqual(['a']);
      expect(result).not.toContain('b');
    });

    it('deduplicates the same name appearing more than twice', () => {
      const result = findDuplicateNames(['a', 'A', 'a']);
      expect(result).toEqual(['a']);
    });

    it('does not mutate the input array', () => {
      const input = ['Foo', 'foo', 'bar'];
      const snapshot = [...input];
      findDuplicateNames(input);
      expect(input).toEqual(snapshot);
    });
  });
});
