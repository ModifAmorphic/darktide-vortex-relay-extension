#!/usr/bin/env node
/**
 * Fetches the latest Mod Relay runtime release and extracts it verbatim
 * into the repo-root `relay/` directory.
 *
 * Usage:
 *   node scripts/bundle-relay.ts
 *   node scripts/bundle-relay.ts --out <dir>
 *   node scripts/bundle-relay.ts -h
 *
 * The extension's only Relay contract is `mod_relay.exe`. Relay ships its
 * own complete, legally-compliant runtime; this script redistributes
 * whatever the latest release contains, verbatim, with no file
 * enumeration or legal-file check. The only post-extract gate is that
 * `mod_relay.exe` exists at the target root.
 *
 * Relay is NOT version-pinned. The script fetches the newest non-draft
 * release (pre-release inclusive, since every Relay release so far is a
 * pre-release) and selects the asset matching
 * `/^v\d+\.\d+\.\d+-windows-x64\.zip$/`.
 *
 * The release zip has a flat layout (files at the zip root plus a
 * `mod_loader/` subdirectory, no wrapper directory). Extraction lands
 * each file directly under the target directory.
 *
 * Execution model: plain TypeScript run directly by Node 24's native
 * type stripping. A scoped `scripts/package.json` declares
 * `"type": "module"` so Node treats `.ts` files here as ES modules and
 * strips type annotations without a compile step. The repo-root
 * `package.json` remains `"type": "commonjs"` for the built extension
 * output. The script resolves its own location via `import.meta.url`,
 * so it works regardless of the caller's working directory.
 *
 * Zip extraction uses Windows PowerShell 5.1's built-in `Expand-Archive`
 * cmdlet (always present on Windows) via `child_process.execFileSync`.
 * No npm zip dependency is added. The PowerShell I/O is integration-
 * level (validated manually); the release-selection and asset-selection
 * logic is factored into pure helpers covered by unit tests.
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream, type Stats } from 'node:fs';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Relay launcher executable filename. The single Relay contract this
 * script enforces. Inlined (rather than imported from `src/constants`)
 * so the build script has no runtime dependency on product code: Node
 * type-stripping does not resolve extensionless `.ts` imports, and
 * adding `.ts` suffixes would require a tsconfig change. The value is
 * identical to `RELAY_EXECUTABLE` in `src/constants.ts`.
 */
const RELAY_EXECUTABLE = 'mod_relay.exe';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

const RELEASES_URL = 'https://api.github.com/repos/ModifAmorphic/darktide-mod-relay/releases';

/** GitHub requires a User-Agent header on all API requests. */
const USER_AGENT = 'darktide-vortex-relay-extension-bundler';

/**
 * Matches the Relay Windows x64 runtime asset name, e.g.
 * `v0.5.1-windows-x64.zip`. The tag and the asset basename agree.
 */
const WINDOWS_ASSET_PATTERN = /^v\d+\.\d+\.\d+-windows-x64\.zip$/;

/** Default target directory: the repo-root `relay/`. */
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'relay');

/**
 * Subset of the GitHub release asset shape that this script consumes.
 * Defined locally so the pure helpers stay decoupled from the full API
 * response type.
 */
interface Asset {
  /** GitHub asset id (used for logging only). */
  id: number;
  /** Asset filename, e.g. `v0.5.1-windows-x64.zip`. */
  name: string;
  /** Asset size in bytes. */
  size: number;
  /** Direct download URL (redirects to the CDN). */
  browser_download_url: string;
}

/** A release reduced to the fields the bundling logic needs. */
interface SelectedRelease {
  /** Git tag, e.g. `v0.5.1`. */
  tagName: string;
  /** ISO 8601 publish timestamp; used for newest-first ordering. */
  publishedAt: string;
  /** Coerced asset list. */
  assets: Asset[];
}

interface Options {
  /** Override target directory; null means use the default. */
  out: string | null;
}

/**
 * Error subclass for operator-fixable failures. Carries a clean message
 * without a noisy stack trace, mirroring `dev-install.ts`.
 */
class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/**
 * Selects the newest non-draft release from a GitHub releases API
 * response. Pure: no network, no filesystem. Exported for unit testing.
 *
 * Defensively sorts by `published_at` descending and takes the first
 * entry rather than trusting the API's documented newest-first order,
 * so a future API change cannot silently downgrade the bundle.
 *
 * Pre-releases ARE candidates (Relay's releases so far are all
 * pre-releases). Only `draft: true` releases are skipped.
 *
 * Throws a {@link UserError} when the response is not an array or
 * contains no usable release.
 */
export function selectLatestRelease(releases: unknown): SelectedRelease {
  if (!Array.isArray(releases)) {
    throw new UserError(
      'GitHub API returned a non-array releases response; cannot select a release.',
    );
  }
  const candidates: SelectedRelease[] = [];
  for (const release of releases) {
    const coerced = coerceRelease(release);
    if (coerced !== null) {
      candidates.push(coerced);
    }
  }
  if (candidates.length === 0) {
    throw new UserError('GitHub API returned no usable (non-draft) releases for Mod Relay.');
  }
  // Stable sort by publishedAt descending. Ties preserve API order.
  candidates.sort((a, b) =>
    a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0,
  );
  const newest = candidates[0];
  if (newest === undefined) {
    throw new UserError('GitHub API returned no usable (non-draft) releases for Mod Relay.');
  }
  return newest;
}

/**
 * Coerces a raw release object into a {@link SelectedRelease}, or
 * returns null when the shape is wrong or the release is a draft.
 */
function coerceRelease(release: unknown): SelectedRelease | null {
  if (typeof release !== 'object' || release === null || Array.isArray(release)) {
    return null;
  }
  const obj = release as {
    draft?: unknown;
    tag_name?: unknown;
    published_at?: unknown;
    assets?: unknown;
  };
  if (obj.draft === true) {
    return null;
  }
  const tagName = obj.tag_name;
  const publishedAt = obj.published_at;
  const assetsRaw = obj.assets;
  if (
    typeof tagName !== 'string' ||
    tagName.length === 0 ||
    typeof publishedAt !== 'string' ||
    publishedAt.length === 0 ||
    !Array.isArray(assetsRaw)
  ) {
    return null;
  }
  const assets: Asset[] = [];
  for (const raw of assetsRaw) {
    const asset = coerceAsset(raw);
    if (asset !== null) {
      assets.push(asset);
    }
  }
  return { tagName, publishedAt, assets };
}

/** Coerces a raw asset object into an {@link Asset}, or returns null. */
function coerceAsset(raw: unknown): Asset | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as {
    id?: unknown;
    name?: unknown;
    size?: unknown;
    browser_download_url?: unknown;
  };
  if (typeof obj.name !== 'string' || typeof obj.browser_download_url !== 'string') {
    return null;
  }
  return {
    id: typeof obj.id === 'number' ? obj.id : 0,
    name: obj.name,
    size: typeof obj.size === 'number' ? obj.size : 0,
    browser_download_url: obj.browser_download_url,
  };
}

/**
 * Selects the Windows x64 runtime asset from a release's asset list.
 * Pure: no network, no filesystem. Exported for unit testing.
 *
 * Throws a {@link UserError} naming the tag and the available asset
 * names when no asset matches, and a separate error when more than one
 * matches (a release bug that should not be silently resolved).
 */
export function selectWindowsAsset(assets: readonly Asset[], tagName: string): Asset {
  let selected: Asset | undefined;
  for (const asset of assets) {
    if (WINDOWS_ASSET_PATTERN.test(asset.name)) {
      if (selected !== undefined) {
        throw new UserError(
          `Release ${tagName} has multiple Windows x64 zip assets ` +
            `(${selected.name}, ${asset.name}); cannot pick one automatically.`,
        );
      }
      selected = asset;
    }
  }
  if (selected === undefined) {
    const available = assets.length > 0 ? assets.map((a) => a.name).join(', ') : '(no assets)';
    throw new UserError(
      `Release ${tagName} has no Windows x64 zip asset. Expected a name ` +
        `matching ${WINDOWS_ASSET_PATTERN}. Available: ${available}.`,
    );
  }
  return selected;
}

/** Parses CLI arguments. Recognizes `--out <dir>` and help flags. */
function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === '--out') {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value.length === 0) {
        throw new UserError('Option --out requires a directory path.');
      }
      opts.out = value;
      i++;
    } else if (arg.startsWith('--out=')) {
      opts.out = arg.slice('--out='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new UserError(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

/** Prints a short usage summary. */
function printHelp(): void {
  const lines = [
    'Usage: node scripts/bundle-relay.ts [options]',
    '',
    'Fetches the latest Mod Relay release and extracts it into the target directory.',
    '',
    'Options:',
    '  --out <dir>   Target directory for the extracted runtime.',
    `                Default: <repo>/relay (${DEFAULT_OUT_DIR}).`,
    '  -h, --help    Show this help.',
    '',
    'Environment:',
    '  GITHUB_TOKEN  Optional. If set, sent as a bearer token to raise the',
    '                unauthenticated API rate limit (60/hr) to 5000/hr.',
  ];
  console.log(lines.join('\n'));
}

/**
 * Fetches the releases list from the GitHub API. Returns the raw JSON
 * (an array); validation happens in {@link selectLatestRelease}.
 */
async function fetchReleases(): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(RELEASES_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github+json',
        ...authHeaders(),
      },
      redirect: 'follow',
    });
  } catch (err) {
    throw new UserError(
      `Could not reach the GitHub API (${RELEASES_URL}): ${(err as Error).message}. ` +
        'Check your network connection and try again.',
    );
  }
  if (!response.ok) {
    const hint =
      response.status === 403 || response.status === 429
        ? '\nThis may be a rate limit. Wait and retry, or set GITHUB_TOKEN to raise the limit.'
        : '';
    throw new UserError(
      `GitHub API request failed: HTTP ${response.status} ${response.statusText}.${hint}`,
    );
  }
  return response.json();
}

/**
 * Returns the optional Authorization header when `GITHUB_TOKEN` is set.
 * Empty object otherwise so the spread is a no-op.
 */
function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token && token.length > 0 ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Streams the download at `url` to `destPath`. The body is piped to
 * disk so the full zip is never buffered in memory.
 */
async function downloadAsset(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...authHeaders() },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new UserError(
      `Download failed: HTTP ${response.status} ${response.statusText} for ${url}.`,
    );
  }
  const body = response.body;
  if (body === null) {
    throw new UserError(`Download failed: response had no body for ${url}.`);
  }
  const stream = createWriteStream(destPath);
  try {
    await pipeline(Readable.fromWeb(body), stream);
  } catch (err) {
    throw new UserError(`Download failed: ${(err as Error).message}.`);
  }
}

/**
 * Extracts `zip` into `dest` via Windows PowerShell `Expand-Archive`.
 * The `-LiteralPath` form is correct here (a specific zip file, no
 * wildcards). Throws on non-zero exit.
 */
function expandArchive(zip: string, dest: string): void {
  const command = `Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(dest)} -Force`;
  runPowerShell(command);
}

/** Runs a PowerShell command via `powershell.exe` (Windows PowerShell 5.1). */
function runPowerShell(command: string): void {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: 'inherit',
  });
}

/**
 * Quotes a path for a PowerShell single-quoted string literal: wraps in
 * single quotes and doubles any embedded single quotes per PowerShell
 * escaping rules. Used for `-LiteralPath`/`-DestinationPath` arguments.
 */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Formats a byte count as a human-readable size string. */
function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown size';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Entry point. Fetches the latest release, downloads the Windows asset,
 * cleans and recreates the target directory, extracts the zip, verifies
 * `mod_relay.exe` exists, and prints a summary. Any thrown
 * {@link UserError} is caught once at the top and reported cleanly.
 */
async function main(): Promise<void> {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const outDir = path.resolve(opts.out ?? DEFAULT_OUT_DIR);

    console.log('Fetching the latest Mod Relay release...');
    const releases = await fetchReleases();
    const latest = selectLatestRelease(releases);
    const asset = selectWindowsAsset(latest.assets, latest.tagName);
    console.log(
      `Selected release ${latest.tagName}, asset ${asset.name} (${formatSize(asset.size)}).`,
    );

    const tmpZip = path.join(os.tmpdir(), `relay-${latest.tagName}-${Date.now()}.zip`);
    try {
      console.log(`Downloading ${asset.browser_download_url}...`);
      await downloadAsset(asset.browser_download_url, tmpZip);

      // Replace the target directory so re-runs are clean and idempotent.
      // Any pre-existing relay/ (stale runtime, manual edits) is removed
      // before extraction so the new release lands verbatim.
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.mkdirSync(outDir, { recursive: true });

      console.log(`Extracting into ${outDir}...`);
      expandArchive(tmpZip, outDir);
    } finally {
      fs.rmSync(tmpZip, { force: true });
    }

    const exePath = path.join(outDir, RELAY_EXECUTABLE);
    if (!fs.existsSync(exePath)) {
      throw new UserError(
        `Downloaded release ${latest.tagName} did not contain ${RELAY_EXECUTABLE} ` +
          `at the archive root. The release zip layout may have changed; ` +
          `inspect ${exePath.replace(RELAY_EXECUTABLE, '')} and report this.`,
      );
    }

    const sizeSummary = readDirSize(outDir);
    const lines = [
      `Bundled Mod Relay ${latest.tagName} into ${outDir}`,
      `  asset:  ${asset.name} (${formatSize(asset.size)})`,
      `  on disk: ${formatSize(sizeSummary)} total`,
      '',
      'Next: run `pnpm dev:install` for local iteration, or ' +
        '`pnpm package` to assemble the distributable archive.',
    ];
    console.log(lines.join('\n'));
  } catch (err) {
    fail(err);
  }
}

/** Sums the sizes of every regular file under `dir` (recursive). */
function readDirSize(dir: string): number {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const stat: Stats = fs.statSync(full);
          total += stat.size;
        } catch {
          // Ignore unreadable entries; size is informational only.
        }
      }
    }
  }
  return total;
}

/**
 * Prints an error message and exits non-zero. {@link UserError} prints
 * the message cleanly; other errors include the stack for debugging.
 */
function fail(err: unknown): never {
  if (err instanceof UserError) {
    console.error(`\nError: ${err.message}\n`);
  } else {
    console.error('\nUnexpected error:', err, '\n');
  }
  process.exit(1);
}

const isMain = pathToFileURL(process.argv[1] ?? '').href === import.meta.url;
if (isMain) {
  void main();
}
