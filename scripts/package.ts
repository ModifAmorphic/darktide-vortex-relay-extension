#!/usr/bin/env node
/**
 * Assembles the distributable Vortex extension archive.
 *
 * Usage:
 *   node scripts/package.ts
 *   node scripts/package.ts --no-build
 *   node scripts/package.ts --out <path-to-zip>
 *   node scripts/package.ts -h
 *
 * The archive root contains, with no wrapper directory:
 *
 *   info.json
 *   gameart.png
 *   index.js
 *   relay/  (whatever Relay shipped, verbatim)
 *
 * This matches design.md (Distribution) and the Vortex package guide: Vortex
 * loads built extensions with these files at the archive root. A
 * wrapper directory would make Vortex reject the archive.
 *
 * The script stages a temp directory with the four inputs, zips it via
 * `Compress-Archive -Path '<stage>/*'` (the `-Path` wildcard form
 * places entries at the archive root), then reads the zip's central
 * directory to verify the root layout, and cleans the staging dir.
 *
 * Execution model: plain TypeScript run directly by Node 24's native
 * type stripping. A scoped `scripts/package.json` declares
 * `"type": "module"` so Node treats `.ts` files here as ES modules and
 * strips type annotations without a compile step. The repo-root
 * `package.json` remains `"type": "commonjs"` for the built extension
 * output. The script resolves its own location via `import.meta.url`,
 * so it works regardless of the caller's working directory.
 *
 * Zip creation and entry listing use Windows PowerShell 5.1's built-in
 * cmdlets and the .NET `System.IO.Compression.ZipFile` type (always
 * present on Windows) via `child_process.execFileSync`. No npm zip
 * dependency is added. The PowerShell I/O is integration-level
 * (validated manually); the version parsing, output-path composition,
 * and root-layout assertion are factored into pure helpers covered by
 * unit tests.
 */

import { execSync, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Relay launcher executable filename. The single Relay contract this
 * script enforces (the `relay/mod_relay.exe` gate). Inlined (rather
 * than imported from `src/constants`) so the build script has no
 * runtime dependency on product code: Node type-stripping does not
 * resolve extensionless `.ts` imports, and adding `.ts` suffixes would
 * require a tsconfig change. The value is identical to
 * `RELAY_EXECUTABLE` in `src/constants.ts`.
 */
const RELAY_EXECUTABLE = 'mod_relay.exe';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'dist-package');
const ARCHIVE_NAME_PREFIX = 'darktide-relay-vortex-extension-';

interface Options {
  /** Skip the `pnpm build` step. */
  noBuild: boolean;
  /** Override the output archive path; null means use the default. */
  out: string | null;
}

/**
 * Error subclass for operator-fixable failures. Carries a clean message
 * without a noisy stack trace, mirroring `bundle-relay.ts`.
 */
class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/**
 * Parses the `version` field out of an `info.json` document. Pure:
 * takes the file text, returns the version string. Exported for unit
 * testing.
 *
 * Throws a {@link UserError} when the text is not valid JSON, is not an
 * object, or lacks a non-empty string `version` field. These are
 * operator-fixable (the manifest is hand-edited).
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

/**
 * Composes the default output archive path for a given version and
 * output directory: `<outDir>/<prefix><version>.zip`. Pure: no
 * filesystem access. Exported for unit testing.
 */
export function composeArchivePath(version: string, outDir: string): string {
  return path.join(outDir, `${ARCHIVE_NAME_PREFIX}${version}.zip`);
}

/**
 * The files this script guarantees sit at the archive root. The verify
 * step asserts each is present among the zip's entries (after slash
 * normalization).
 */
const REQUIRED_ROOT_ENTRIES: readonly string[] = [
  'info.json',
  'gameart.png',
  'index.js',
  `relay/${RELAY_EXECUTABLE}`,
];

/**
 * Validates that a list of archive-relative entry paths contains every
 * required root file. Pure: takes the entry list, returns the problems.
 * Exported for unit testing.
 *
 * Entries are normalized so backslash and forward-slash separators both
 * match (PowerShell `Compress-Archive` writes backslashes; standard zip
 * tools write forward slashes). A wrapper directory surfaces here as
 * missing root entries (e.g. `wrapper/info.json` does not match
 * `info.json`), so the basic presence check also rejects wrappers.
 *
 * @param entries archive-relative entry paths (forward or back slashes).
 * @returns empty array when the layout is correct; otherwise a list of
 *   human-readable problem strings.
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

/** Prints a short usage summary. */
function printHelp(): void {
  const lines = [
    'Usage: node scripts/package.ts [options]',
    '',
    'Assembles the distributable Vortex extension archive.',
    '',
    'Options:',
    '  --no-build     Skip the `pnpm build` step (use when already built).',
    '  --out <path>   Output archive path (zip).',
    `                  Default: <repo>/dist-package/${ARCHIVE_NAME_PREFIX}<version>.zip`,
    '  -h, --help     Show this help.',
    '',
    'Prerequisites:',
    '  - dist/index.js (run `pnpm build`, or drop --no-build to build here).',
    `  - relay/${RELAY_EXECUTABLE} (run \`pnpm bundle:relay\` to fetch the runtime).`,
  ];
  console.log(lines.join('\n'));
}

/** Runs `pnpm build` with output inherited so the operator sees progress. */
function runBuild(): void {
  console.log('Building extension via `pnpm build`...');
  execSync('pnpm build', { cwd: REPO_ROOT, stdio: 'inherit' });
  console.log('Build complete.\n');
}

/**
 * Copies `info.json`, `gameart.png`, `dist/index.js` (as `index.js`),
 * and the `relay/` tree into `stageDir`. The staging directory is the
 * archive root. Throws a {@link UserError} if a source is missing.
 */
function stageExtension(stageDir: string, indexPath: string, relayDir: string): void {
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

  copyFile(path.join(REPO_ROOT, 'info.json'), 'info.json');
  copyFile(path.join(REPO_ROOT, 'gameart.png'), 'gameart.png');
  copyFile(indexPath, 'index.js');

  try {
    // recursive:true copies the whole relay/ subtree; force:true
    // overwrites. The destination is a fresh staging dir, so this is a
    // clean copy.
    fs.cpSync(relayDir, path.join(stageDir, 'relay'), {
      recursive: true,
      force: true,
    });
  } catch (err) {
    throw new UserError(`Could not stage the relay/ tree: ${(err as Error).message}.`);
  }
}

/**
 * Creates the archive via PowerShell `Compress-Archive`. Uses `-Path
 * '<stageDir>/*'` (wildcard form) so entries land at the archive root
 * with no wrapper directory. The `-LiteralPath` form does NOT work here:
 * LiteralPath disables wildcards, so `*` matches no file and the
 * resulting archive is empty (verified on Windows PowerShell 5.1).
 */
function compressArchive(stageDir: string, outZip: string): void {
  const command =
    `Compress-Archive -Path ${psQuote(`${stageDir}/*`)} ` +
    `-DestinationPath ${psQuote(outZip)} -Force`;
  runPowerShell(command);
}

/**
 * Lists the entry paths stored in `zip` via the .NET
 * `System.IO.Compression.ZipFile` type. Returns FullNames exactly as
 * stored (separator style depends on the tool that created the zip);
 * the caller normalizes before comparison.
 */
function listZipEntries(zip: string): string[] {
  // Add-Type loads the FileSystem facade so ZipFile is callable in
  // Windows PowerShell 5.1. It is a no-op on later versions where the
  // type is already loaded; wrap in try/catch so a reload error never
  // blocks listing.
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

/** Runs a PowerShell command with inherited stdio. Throws on non-zero exit. */
function runPowerShell(command: string): void {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: 'inherit',
  });
}

/** Runs a PowerShell command and returns its captured stdout as a string. */
function runPowerShellCapture(command: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
  });
}

/**
 * Quotes a path for a PowerShell single-quoted string literal: wraps in
 * single quotes and doubles any embedded single quotes per PowerShell
 * escaping rules.
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
 * Entry point. Optionally builds, checks prerequisites, reads the
 * version, stages the inputs, zips, verifies the root layout, and
 * cleans up. Any thrown {@link UserError} is caught once at the top and
 * reported cleanly.
 */
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

    const infoText = fs.readFileSync(path.join(REPO_ROOT, 'info.json'), 'utf8');
    const version = readInfoVersion(infoText);

    const outZip = path.resolve(opts.out ?? composeArchivePath(version, DEFAULT_OUT_DIR));
    fs.mkdirSync(path.dirname(outZip), { recursive: true });

    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-stage-'));
    try {
      console.log(`Staging archive contents in ${stageDir}...`);
      stageExtension(stageDir, indexPath, relayDir);

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
  main();
}
