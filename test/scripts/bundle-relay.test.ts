import { describe, expect, it } from 'vitest';

import { selectLatestRelease, selectWindowsAsset } from '../../scripts/bundle-relay';

/**
 * Unit tests for the pure release- and asset-selection helpers in
 * scripts/bundle-relay.ts. Fixture shape mirrors the GitHub REST API
 * releases response: each release has tag_name, published_at, draft,
 * prerelease, and assets[] where each asset has id, name, size, and
 * browser_download_url.
 */

interface Asset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
}

interface ReleaseFixture {
  tag_name: string;
  published_at: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: Array<Partial<Asset> & { name: string; browser_download_url: string }>;
}

function makeAsset(name: string, extras: Partial<Asset> = {}): Asset {
  return {
    id: 1,
    size: 1024,
    browser_download_url: `https://example.invalid/download/${name}`,
    ...extras,
    name,
  };
}

function makeRelease(
  tag: string,
  publishedAt: string,
  assets: Asset[],
  flags: { draft?: boolean; prerelease?: boolean } = {},
): ReleaseFixture {
  return {
    tag_name: tag,
    published_at: publishedAt,
    assets,
    ...flags,
  };
}

describe('selectLatestRelease', () => {
  it('returns the newest non-draft release by published_at', () => {
    const releases: ReleaseFixture[] = [
      makeRelease('v0.4.0', '2026-01-01T00:00:00Z', []),
      makeRelease('v0.5.1', '2026-07-26T00:00:00Z', [makeAsset('v0.5.1-windows-x64.zip')]),
      makeRelease('v0.5.0', '2026-06-01T00:00:00Z', []),
    ];
    const result = selectLatestRelease(releases);
    expect(result.tagName).toBe('v0.5.1');
    expect(result.publishedAt).toBe('2026-07-26T00:00:00Z');
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.name).toBe('v0.5.1-windows-x64.zip');
  });

  it('does NOT trust API order: picks by published_at even when out of order', () => {
    // Newest-by-date is FIRST in the array, but oldest by published_at.
    // If the helper trusted array order it would return v0.4.0; it must
    // instead sort and return v0.5.1.
    const releases: ReleaseFixture[] = [
      makeRelease('v0.4.0', '2026-01-01T00:00:00Z', []),
      makeRelease('v0.5.1', '2026-07-26T00:00:00Z', []),
      makeRelease('v0.5.0', '2026-06-01T00:00:00Z', []),
    ];
    const result = selectLatestRelease(releases);
    expect(result.tagName).toBe('v0.5.1');
  });

  it('skips draft releases', () => {
    const releases: ReleaseFixture[] = [
      makeRelease('v0.6.0-unreleased', '2026-12-01T00:00:00Z', [], { draft: true }),
      makeRelease('v0.5.1', '2026-07-26T00:00:00Z', []),
    ];
    const result = selectLatestRelease(releases);
    expect(result.tagName).toBe('v0.5.1');
  });

  it('includes pre-releases (Relay ships pre-releases)', () => {
    const releases: ReleaseFixture[] = [
      makeRelease('v0.5.1-beta', '2026-07-26T00:00:00Z', [], { prerelease: true }),
      makeRelease('v0.5.0', '2026-06-01T00:00:00Z', []),
    ];
    const result = selectLatestRelease(releases);
    // The pre-release is newer by date, so it must be selected.
    expect(result.tagName).toBe('v0.5.1-beta');
  });

  it('handles a single release', () => {
    const releases: ReleaseFixture[] = [makeRelease('v0.5.1', '2026-07-26T00:00:00Z', [])];
    const result = selectLatestRelease(releases);
    expect(result.tagName).toBe('v0.5.1');
  });

  it('throws on a non-array response', () => {
    expect(() => selectLatestRelease({ not: 'an array' })).toThrow(/non-array/);
    expect(() => selectLatestRelease(null)).toThrow(/non-array/);
    expect(() => selectLatestRelease('string')).toThrow(/non-array/);
    expect(() => selectLatestRelease(42)).toThrow(/non-array/);
  });

  it('throws when no usable release is present', () => {
    expect(() => selectLatestRelease([])).toThrow(/no usable/);
  });

  it('throws when every release is a draft', () => {
    const releases: ReleaseFixture[] = [
      makeRelease('v0.6.0', '2026-12-01T00:00:00Z', [], { draft: true }),
      makeRelease('v0.5.0', '2026-06-01T00:00:00Z', [], { draft: true }),
    ];
    expect(() => selectLatestRelease(releases)).toThrow(/no usable/);
  });

  it('skips malformed release entries without throwing', () => {
    const releases: unknown[] = [
      { tag_name: 'v0.5.1', published_at: '2026-07-26T00:00:00Z', assets: [] },
      { missing: 'fields' },
      null,
      'string',
      42,
      { tag_name: 'v0.4.0', published_at: '2026-01-01T00:00:00Z', assets: [] },
    ];
    const result = selectLatestRelease(releases);
    expect(result.tagName).toBe('v0.5.1');
  });

  it('coerces the asset shape, dropping malformed assets', () => {
    const releases: unknown[] = [
      {
        tag_name: 'v0.5.1',
        published_at: '2026-07-26T00:00:00Z',
        assets: [
          makeAsset('v0.5.1-windows-x64.zip', { id: 99, size: 1234567 }),
          { name: 'source.zip' /* missing browser_download_url */ },
          null,
          { browser_download_url: 'https://example.invalid/x' /* missing name */ },
        ],
      },
    ];
    const result = selectLatestRelease(releases);
    expect(result.assets).toHaveLength(1);
    const asset = result.assets[0];
    expect(asset).toBeDefined();
    expect(asset?.id).toBe(99);
    expect(asset?.size).toBe(1234567);
    expect(asset?.name).toBe('v0.5.1-windows-x64.zip');
  });

  it('breaks published_at ties stably (preserves input order)', () => {
    // Two releases with identical published_at; the one listed first
    // wins under a stable sort.
    const releases: ReleaseFixture[] = [
      makeRelease('v0.5.1', '2026-07-26T00:00:00Z', []),
      makeRelease('v0.5.0', '2026-07-26T00:00:00Z', []),
    ];
    const result = selectLatestRelease(releases);
    expect(result.tagName).toBe('v0.5.1');
  });

  it('preserves the asset browser_download_url verbatim', () => {
    const url =
      'https://github.com/ModifAmorphic/darktide-mod-relay/releases/download/v0.5.1/v0.5.1-windows-x64.zip';
    const releases: ReleaseFixture[] = [
      makeRelease('v0.5.1', '2026-07-26T00:00:00Z', [
        makeAsset('v0.5.1-windows-x64.zip', { browser_download_url: url }),
      ]),
    ];
    const result = selectLatestRelease(releases);
    expect(result.assets[0]?.browser_download_url).toBe(url);
  });
});

describe('selectWindowsAsset', () => {
  it('selects the asset matching the Windows x64 pattern', () => {
    const assets = [
      makeAsset('source.zip'),
      makeAsset('v0.5.1-windows-x64.zip', { id: 7, size: 1200000 }),
      makeAsset('v0.5.1-linux-x64.zip'),
    ];
    const result = selectWindowsAsset(assets, 'v0.5.1');
    expect(result.name).toBe('v0.5.1-windows-x64.zip');
    expect(result.id).toBe(7);
    expect(result.size).toBe(1200000);
  });

  it('matches across version numbers in the tag', () => {
    const assets = [makeAsset('v1.23.456-windows-x64.zip')];
    const result = selectWindowsAsset(assets, 'v1.23.456');
    expect(result.name).toBe('v1.23.456-windows-x64.zip');
  });

  it('throws naming the available assets when none matches', () => {
    const assets = [makeAsset('source.zip'), makeAsset('v0.5.1-linux-x64.zip')];
    expect(() => selectWindowsAsset(assets, 'v0.5.1')).toThrow(
      /Release v0\.5\.1 has no Windows x64 zip asset/,
    );
    expect(() => selectWindowsAsset(assets, 'v0.5.1')).toThrow(/source\.zip/);
    expect(() => selectWindowsAsset(assets, 'v0.5.1')).toThrow(/v0\.5\.1-linux-x64\.zip/);
  });

  it('names an empty asset list in the no-match error', () => {
    expect(() => selectWindowsAsset([], 'v0.5.1')).toThrow(/no assets/);
  });

  it('throws when multiple assets match (ambiguous release)', () => {
    const assets = [
      makeAsset('v0.5.1-windows-x64.zip'),
      makeAsset('v0.5.1-windows-x64.zip'), // duplicate
    ];
    expect(() => selectWindowsAsset(assets, 'v0.5.1')).toThrow(/multiple Windows x64 zip assets/);
  });

  it('does NOT match a partial or malformed name', () => {
    const assets = [
      makeAsset('windows-x64.zip'), // no version prefix
      makeAsset('vx.y.z-windows-x64.zip'), // non-numeric version
      makeAsset('v0.5.1-windows-x86.zip'), // wrong arch
      makeAsset('v0.5.1-windows-x64.tar.gz'), // wrong extension
      makeAsset('0.5.1-windows-x64.zip'), // no leading v
    ];
    expect(() => selectWindowsAsset(assets, 'v0.5.1')).toThrow(/no Windows x64 zip asset/);
  });

  it('does NOT match a name with extra path segments', () => {
    const assets = [makeAsset('prefix/v0.5.1-windows-x64.zip')];
    expect(() => selectWindowsAsset(assets, 'v0.5.1')).toThrow(/no Windows x64 zip asset/);
  });

  it('includes the tag name in the error for diagnosis', () => {
    expect(() => selectWindowsAsset([], 'v9.9.9-rc1')).toThrow(/v9\.9\.9-rc1/);
  });
});
