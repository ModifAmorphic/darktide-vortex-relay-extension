#!/usr/bin/env node
/**
 * Assembles the distributable Vortex extension archive. The archive root
 * contains, with no wrapper directory, `info.json`, `gameart.png`,
 * `index.js`, and `relay/` (whatever Relay shipped, verbatim). Vortex
 * loads built extensions with these files at the archive root and
 * rejects archives that nest them under a wrapper directory.
 *
 * The script stages a temp directory with the four inputs, zips it via
 * `Compress-Archive -Path '<stage>/*'`, then reads the zip's central
 * directory to verify the root layout, and cleans the staging dir.
 *
 * Plain TypeScript run directly by Node 24's native type stripping
 * (`release/package.json` declares `"type": "module"`). Zip creation and
 * entry listing use Windows PowerShell 5.1's `Compress-Archive` and the
 * .NET `System.IO.Compression.ZipFile` type. The version parse,
 * output-path composition, and root-layout assertion are factored into
 * pure helpers covered by unit tests; the PowerShell I/O is
 * integration-level.
 */

import { execSync, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Relay launcher executable filename, and the single Relay contract
 * this script enforces (the `relay/mod_relay.exe` gate). Inlined
 * rather than imported from `src/constants`: Node type-stripping does
 * not resolve extensionless `.ts` imports, and adding `.ts` suffixes
 * would require a tsconfig change.
 */
const RELAY_EXECUTABLE = 'mod_relay.exe';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
/** Source location of the static archive inputs (`info.json`, `gameart.png`). */
const ASSETS_DIR = path.join(SCRIPT_DIR, 'assets');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'dist-package');
const ARCHIVE_NAME_PREFIX = 'darktide-relay-vortex-extension-';

interface Options {
  /** Skip the `pnpm build` step. */
  noBuild: boolean;
  /** Override the output archive path; null means use the default. */
  out: string | null;
}

/** Operator-fixable failure with a clean message and no stack trace. */
class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/**
 * Parses the `version` field out of an `info.json` document. Exported
 * for unit testing. Throws a {@link UserError} when the text is not
 * valid JSON, is not an object, or lacks a non-empty string `version`
 * field (operator-fixable, since the manifest is hand-edited).
 */
export function readInfoVersion(infoJsonText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(infoJsonText);
  } catch (err) {
    throw new UserError(`info.json is not valid JSON: ${(err as Error).message}.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UserError('info.json must be a JSON object.');
  }
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new UserError('info.json is missing a non-empty string "version" field.');
  }
  return version;
}

/** Composes the default output archive path: `<outDir>/<prefix><version>.zip`. Exported for unit testing. */
export function composeArchivePath(version: string, outDir: string): string {
  return path.join(outDir, `${ARCHIVE_NAME_PREFIX}${version}.zip`);
}

/**
 * Local dev build version: `0.0.0-dev+<short sha>`, or `0.0.0-dev` if git is
 * unavailable. Pure (the sha is injected by the caller) so it is unit-
 * testable. The sha distinguishes two builds from different commits.
 *
 * `0.0.0` is the zero sentinel: it sorts below every release and clearly is
 * not one, and the `-dev` prerelease plus `+<sha>` build metadata mark the
 * archive as a local build with provenance. This stamp never reaches a
 * release; the release pipeline injects the real SemVer via the workflow.
 * Vortex requires a SemVer-valid extension version to load (a bare
 * `dev+<sha>` is rejected), which is why the zero core is present.
 */
export function composeDevVersion(sha: string | null): string {
  return sha ? `0.0.0-dev+${sha}` : '0.0.0-dev';
}

/**
 * True in CI. GitHub Actions sets `CI=true`. The release workflow injects the
 * real release version into `info.json` before packaging, so in CI we trust
 * that value verbatim; locally we stamp a dev version instead.
 */
function isCI(): boolean {
  return process.env.CI === 'true' || process.env.CI === '1';
}

/** Returns the short HEAD sha, or `null` if git is unavailable or not a repo. */
function gitShortSha(): string | null {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const trimmed = sha.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** The files this script guarantees sit at the archive root. */
const REQUIRED_ROOT_ENTRIES: readonly string[] = [
  'info.json',
  'gameart.png',
  'index.js',
  `relay/${RELAY_EXECUTABLE}`,
];

/**
 * Validates that `entries` contains every required root file. Exported
 * for unit testing. Entries are normalized so backslash and
 * forward-slash separators both match (PowerShell `Compress-Archive`
 * writes backslashes; standard zip tools write forward slashes). A
 * wrapper directory surfaces here as missing root entries (e.g.
 * `wrapper/info.json` does not match `info.json`), so the presence
 * check also rejects wrappers.
 */
export function assertArchiveRoot(entries: readonly string[]): string[] {
  const normalized = new Set(
    entries.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\/+/, '')),
  );
  const problems: string[] = [];
  for (const required of REQUIRED_ROOT_ENTRIES) {
    if (!normalized.has(required)) {
      problems.push(`missing "${required}" at the archive root`);
    }
  }
  return problems;
}

/** Parses CLI arguments. Recognizes `--no-build`, `--out`, and help flags. */
function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { noBuild: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === '--no-build') {
      opts.noBuild = true;
    } else if (arg === '--out') {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value.length === 0) {
        throw new UserError('Option --out requires an archive path.');
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

function printHelp(): void {
  const lines = [
    'Usage: node release/package.ts [options]',
    '',
    'Assembles the distributable Vortex extension archive.',
    '',
    'Options:',
    '  --no-build     Skip the `pnpm build` step (use when already built).',
    '  --out <path>   Output archive path (zip).',
    `                  Default: <repo>/dist-package/${ARCHIVE_NAME_PREFIX}<version>.zip`,
    '  -h, --help     Show this help.',
    '',
    'Versioning:',
    '  In CI (the release pipeline) the version is the one injected into',
    '  release/assets/info.json. Locally the archive and its embedded',
    '  info.json are stamped `0.0.0-dev+<short sha>` (or `0.0.0-dev` if git is missing)',
    '  so a local build is obviously not a release.',
    '',
    'Prerequisites:',
    '  - dist/index.js (run `pnpm build`, or drop --no-build to build here).',
    `  - relay/${RELAY_EXECUTABLE} (run \`pnpm bundle:relay\` to fetch the runtime).`,
  ];
  console.log(lines.join('\n'));
}

/** Runs `pnpm build` with inherited stdio so the operator sees progress. */
function runBuild(): void {
  console.log('Building extension via `pnpm build`...');
  execSync('pnpm build', { cwd: REPO_ROOT, stdio: 'inherit' });
  console.log('Build complete.\n');
}

/**
 * Copies `gameart.png`, `dist/index.js` (as `index.js`), and the `relay/`
 * tree into `stageDir` (the archive root), and writes `info.json` with `version`
 * set to the resolved build version (so a local dev build reports its dev
 * version, not the stale source placeholder). Throws a {@link UserError} if a
 * source is missing.
 */
function stageExtension(
  stageDir: string,
  indexPath: string,
  relayDir: string,
  version: string,
): void {
  const copyFile = (src: string, destName: string): void => {
    if (!fs.existsSync(src)) {
      throw new UserError(`Expected source file is missing: "${src}".`);
    }
    try {
      fs.copyFileSync(src, path.join(stageDir, destName));
    } catch (err) {
      throw new UserError(`Could not stage "${src}" -> "${destName}": ${(err as Error).message}.`);
    }
  };

  // info.json is written with the resolved version rather than copied verbatim,
  // so an installed dev build shows its dev version in Vortex.
  const infoPath = path.join(ASSETS_DIR, 'info.json');
  if (!fs.existsSync(infoPath)) {
    throw new UserError(`Expected source file is missing: "${infoPath}".`);
  }
  let infoObj: Record<string, unknown>;
  try {
    infoObj = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  } catch (err) {
    throw new UserError(`Could not parse "${infoPath}": ${(err as Error).message}.`);
  }
  infoObj.version = version;
  try {
    fs.writeFileSync(path.join(stageDir, 'info.json'), `${JSON.stringify(infoObj, null, 2)}\n`);
  } catch (err) {
    throw new UserError(`Could not stage "info.json": ${(err as Error).message}.`);
  }

  copyFile(path.join(ASSETS_DIR, 'gameart.png'), 'gameart.png');
  copyFile(indexPath, 'index.js');

  try {
    fs.cpSync(relayDir, path.join(stageDir, 'relay'), {
      recursive: true,
      force: true,
    });
  } catch (err) {
    throw new UserError(`Could not stage the relay/ tree: ${(err as Error).message}.`);
  }
}

/**
 * Creates the archive via `Compress-Archive -Path '<stageDir>/*'` so
 * entries land at the archive root with no wrapper directory. The
 * `-LiteralPath` form does NOT work here: LiteralPath disables
 * wildcards, so `*` matches no file and the resulting archive is empty.
 * Do not "simplify" this to LiteralPath.
 */
function compressArchive(stageDir: string, outZip: string): void {
  const command =
    `Compress-Archive -Path ${psQuote(`${stageDir}/*`)} ` +
    `-DestinationPath ${psQuote(outZip)} -Force`;
  runPowerShell(command);
}

/**
 * Lists the entry paths stored in `zip` via .NET
 * `System.IO.Compression.ZipFile`. Returns FullNames exactly as stored
 * (separator style depends on the tool that created the zip); the
 * caller normalizes before comparison.
 */
function listZipEntries(zip: string): string[] {
  // Add-Type loads the FileSystem facade so ZipFile is callable in
  // Windows PowerShell 5.1; it is a no-op on later versions. Wrap in
  // try/catch so a reload error never blocks listing.
  const command =
    'try { Add-Type -AssemblyName System.IO.Compression.FileSystem } catch {};' +
    ` $z = [System.IO.Compression.ZipFile]::OpenRead(${psQuote(zip)});` +
    ' $z.Entries | ForEach-Object { $_.FullName };' +
    ' $z.Dispose()';
  const output = runPowerShellCapture(command);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Runs a PowerShell command with inherited stdio. */
function runPowerShell(command: string): void {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: 'inherit',
  });
}

/** Runs a PowerShell command and returns its captured stdout. */
function runPowerShellCapture(command: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
  });
}

/**
 * Wraps `value` in single quotes and doubles any embedded single
 * quotes per PowerShell escaping rules.
 */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

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

function main(): void {
  try {
    const opts = parseArgs(process.argv.slice(2));

    if (!opts.noBuild) {
      runBuild();
    }

    const indexPath = path.join(REPO_ROOT, 'dist', 'index.js');
    if (!fs.existsSync(indexPath)) {
      throw new UserError(
        `"${indexPath}" does not exist. ` +
          'Run `pnpm build` first, or drop the --no-build flag so this script builds for you.',
      );
    }

    const relayDir = path.join(REPO_ROOT, 'relay');
    const relayExe = path.join(relayDir, RELAY_EXECUTABLE);
    if (!fs.existsSync(relayExe)) {
      throw new UserError(
        `"${relayExe}" does not exist. ` +
          'Run `pnpm bundle:relay` first to fetch the Mod Relay runtime into relay/.',
      );
    }

    const infoText = fs.readFileSync(path.join(ASSETS_DIR, 'info.json'), 'utf8');
    const infoVersion = readInfoVersion(infoText);
    // In CI the release workflow has injected the real version into info.json;
    // use it verbatim. Locally stamp an obviously-dev version.
    const version = isCI() ? infoVersion : composeDevVersion(gitShortSha());

    const outZip = path.resolve(opts.out ?? composeArchivePath(version, DEFAULT_OUT_DIR));
    fs.mkdirSync(path.dirname(outZip), { recursive: true });

    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-stage-'));
    try {
      console.log(`Staging archive contents in ${stageDir}...`);
      stageExtension(stageDir, indexPath, relayDir, version);

      console.log(`Creating archive ${outZip}...`);
      compressArchive(stageDir, outZip);

      const entries = listZipEntries(outZip);
      const problems = assertArchiveRoot(entries);
      if (problems.length > 0) {
        const listed = problems.map((p) => `  - ${p}`).join('\n');
        throw new UserError(
          `Archive root layout verification failed:\n${listed}\n` +
            `This indicates a packaging bug; the staging directory or ` +
            `Compress-Archive invocation may need adjustment. Entry list:\n` +
            entries.map((e) => `  - ${e}`).join('\n'),
        );
      }
    } finally {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }

    const size = fs.statSync(outZip).size;
    const lines = [
      `Created ${outZip} (${formatSize(size)})`,
      'Archive root layout verified: info.json, gameart.png, index.js, relay/.',
    ];
    console.log(lines.join('\n'));
  } catch (err) {
    fail(err);
  }
}

/** Prints `UserError` messages cleanly; other errors include the stack. */
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
  main();
}
