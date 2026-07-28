import { describe, expect, it } from 'vitest';

import {
  deriveCanonicalName,
  determineSubtreeRoot,
  findModCandidates,
  groupBySubtreeRoot,
  hasBasenameDirectoryAgreement,
} from '../../src/util/archive';

describe('util/archive', () => {
  describe('findModCandidates', () => {
    it('finds a .mod at archive root', () => {
      expect(findModCandidates(['example.mod', 'scripts/foo.lua'])).toEqual(['example.mod']);
    });

    it('finds a .mod in a subdirectory', () => {
      expect(findModCandidates(['example/example.mod'])).toEqual(['example/example.mod']);
    });

    it('finds multiple .mod files at different depths', () => {
      const files = ['a.mod', 'sub/b.mod', 'deeper/inner/c.mod'];
      expect(findModCandidates(files)).toEqual(['a.mod', 'sub/b.mod', 'deeper/inner/c.mod']);
    });

    it('ignores non-.mod files', () => {
      const files = ['README.txt', 'scripts/foo.lua', 'preview.png', 'metadata.json'];
      expect(findModCandidates(files)).toEqual([]);
    });

    it('matches .mod extension case-insensitively', () => {
      expect(findModCandidates(['Example.MOD', 'foo/Mod.Mod'])).toEqual([
        'Example.MOD',
        'foo/Mod.Mod',
      ]);
    });

    it('preserves original path form (backslashes untouched)', () => {
      const files = ['win\\path\\example.mod'];
      expect(findModCandidates(files)).toEqual(['win\\path\\example.mod']);
    });

    it('rejects directory entries that end with .mod/', () => {
      // A directory named something.mod is not a .mod file; Vortex marks
      // directories with a trailing separator.
      expect(findModCandidates(['something.mod/', 'something.mod/example.mod'])).toEqual([
        'something.mod/example.mod',
      ]);
    });

    it('rejects directory entries that end with .mod\\', () => {
      expect(findModCandidates(['something.mod\\'])).toEqual([]);
    });

    it('ignores the .mod extension only at the end of the basename', () => {
      expect(findModCandidates(['foo.mod.txt', 'real.mod'])).toEqual(['real.mod']);
    });

    it('skips empty and non-string entries defensively', () => {
      expect(findModCandidates(['', undefined as unknown as string, 'real.mod'])).toEqual([
        'real.mod',
      ]);
    });
  });

  describe('deriveCanonicalName', () => {
    it('strips the .mod extension', () => {
      expect(deriveCanonicalName('example.mod')).toBe('example');
    });

    it('strips .mod case-insensitively', () => {
      expect(deriveCanonicalName('Example.MOD')).toBe('Example');
    });

    it('preserves interior dots', () => {
      expect(deriveCanonicalName('my.mod.mod')).toBe('my.mod');
    });

    it('handles paths with directories', () => {
      expect(deriveCanonicalName('foo/bar.mod')).toBe('bar');
    });

    it('handles Windows-style paths with backslashes', () => {
      expect(deriveCanonicalName('foo\\bar.mod')).toBe('bar');
    });

    it('handles a file literally named .mod (returns empty)', () => {
      // Defensive: basename minus .mod extension is empty; the caller
      // must run the result through isSafeCanonicalName, which rejects
      // empty.
      expect(deriveCanonicalName('.mod')).toBe('');
    });

    it('handles a file literally named ..mod (returns .)', () => {
      expect(deriveCanonicalName('..mod')).toBe('.');
    });
  });

  describe('determineSubtreeRoot', () => {
    it('returns empty string for archive-root .mod', () => {
      expect(determineSubtreeRoot('example.mod', ['example.mod'])).toBe('');
    });

    it('returns the containing directory for a single-level wrapper', () => {
      expect(determineSubtreeRoot('example/example.mod', ['example/example.mod'])).toBe('example');
    });

    it('returns the containing directory for a nested wrapper', () => {
      expect(determineSubtreeRoot('a/b/example/example.mod', ['a/b/example/example.mod'])).toBe(
        'a/b/example',
      );
    });

    it('normalizes backslashes to forward slashes', () => {
      expect(determineSubtreeRoot('a\\b\\example.mod', ['a\\b\\example.mod'])).toBe('a/b');
    });

    it('returns empty string for a bare .mod at root with no other files', () => {
      expect(determineSubtreeRoot('foo.mod', ['foo.mod'])).toBe('');
    });
  });

  describe('hasBasenameDirectoryAgreement', () => {
    it('returns true when basename matches containing directory', () => {
      expect(hasBasenameDirectoryAgreement('example/example.mod')).toBe(true);
    });

    it('returns true for archive-root .mod (no containing dir to disagree)', () => {
      expect(hasBasenameDirectoryAgreement('example.mod')).toBe(true);
    });

    it('returns false for foo/example.mod', () => {
      expect(hasBasenameDirectoryAgreement('foo/example.mod')).toBe(false);
    });

    it('compares case-insensitively (uppercase dir, lowercase basename)', () => {
      expect(hasBasenameDirectoryAgreement('Example/example.mod')).toBe(true);
    });

    it('compares case-insensitively (mixed-case basename, lowercase dir)', () => {
      expect(hasBasenameDirectoryAgreement('example/Example.mod')).toBe(true);
    });

    it('returns true for nested-wrapper layout when basename matches immediate dir', () => {
      expect(hasBasenameDirectoryAgreement('release-wrapper/example/example.mod')).toBe(true);
    });

    it('returns false for nested-wrapper layout when basename disagrees', () => {
      expect(hasBasenameDirectoryAgreement('release-wrapper/foo/example.mod')).toBe(false);
    });

    it('handles Windows-style backslash paths', () => {
      expect(hasBasenameDirectoryAgreement('foo\\bar.mod')).toBe(false);
      expect(hasBasenameDirectoryAgreement('example\\example.mod')).toBe(true);
    });
  });

  describe('groupBySubtreeRoot', () => {
    it('returns an empty map for no candidates', () => {
      expect(groupBySubtreeRoot([]).size).toBe(0);
    });

    it('produces one group for a single candidate', () => {
      const result = groupBySubtreeRoot(['example/example.mod']);
      expect(result.size).toBe(1);
      const first = result.values().next().value;
      expect(first).toEqual(['example/example.mod']);
    });

    it('groups same-directory candidates together', () => {
      const result = groupBySubtreeRoot(['example/a.mod', 'example/b.mod']);
      expect(result.size).toBe(1);
      const first = result.values().next().value;
      expect(first).toEqual(['example/a.mod', 'example/b.mod']);
    });

    it('groups ancestor-descendant candidates together (single-wrapper case)', () => {
      // Both .mod entries live under the same nested wrapper, so one
      // group. (The installer separately rejects multiple .mod entries
      // in one subtree as ambiguous; grouping only classifies
      // relatedness.)
      const result = groupBySubtreeRoot(['a/example.mod', 'a/sub/inner.mod']);
      expect(result.size).toBe(1);
    });

    it('separates unrelated candidates into different groups', () => {
      const result = groupBySubtreeRoot(['foo/foo.mod', 'bar/bar.mod']);
      expect(result.size).toBe(2);
    });

    it('treats a root-level .mod as its own group, separate from a subdir .mod', () => {
      // A .mod at the archive root and one inside a subdirectory are two
      // unrelated roots, not a wrapper layout.
      const result = groupBySubtreeRoot(['root.mod', 'sub/inner.mod']);
      expect(result.size).toBe(2);
    });

    it('groups two root-level .mod entries together (same containing dir: empty)', () => {
      const result = groupBySubtreeRoot(['a.mod', 'b.mod']);
      expect(result.size).toBe(1);
    });

    it('uses transitive grouping: ancestor of A and ancestor of C means A,B,C together', () => {
      const result = groupBySubtreeRoot(['a/x.mod', 'a/b/y.mod', 'a/b/c/z.mod']);
      expect(result.size).toBe(1);
    });

    it('does not group sibling directories whose names share a prefix', () => {
      // abc/ and abd/ are siblings; neither is an ancestor of the other.
      const result = groupBySubtreeRoot(['abc/x.mod', 'abd/y.mod']);
      expect(result.size).toBe(2);
    });

    it('groups mixed-separator paths correctly', () => {
      // Forward and back slashes normalize during comparison.
      const result = groupBySubtreeRoot(['a/b/x.mod', 'a\\b\\y.mod']);
      expect(result.size).toBe(1);
    });
  });
});
