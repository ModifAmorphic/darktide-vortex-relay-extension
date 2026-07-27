#!/usr/bin/env node
/**
 * Dev iteration helper: builds the extension and copies the runtime artifacts
 * into a Vortex plugins directory so a Vortex restart picks up the new build.
 *
 * Usage:
 *   node scripts/dev-install.ts --target <plugins-dir>
 *   node scripts/dev-install.ts --plugins-dir <plugins-dir>
 *   VORTEX_PLUGINS_DIR=<plugins-dir> node scripts/dev-install.ts
 *   node scripts/dev-install.ts --target <plugins-dir> --no-build
 *
 * The default Vortex plugins directory on Windows is `%APPDATA%\Vortex\Plugins`
 * (i.e. `C:\Users\<user>\AppData\Roaming\Vortex\Plugins`).
 *
 * The script copies `info.json`, `gameart.png`, `dist/index.js` (renamed to
 * `index.js`), and (when present) the repo-root `relay/` runtime directory
 * into `<target>/darktide-relay/`. The `relay/` directory is gitignored and
 * is bundled into the release archive by `scripts/package.ts`; populate it
 * by running `pnpm bundle:relay` (which fetches the latest Relay release)
 * before `dev:install` to drive live launch verification.
 *
 * Execution strategy: this file is plain TypeScript source run directly by
 * Node 24's native type stripping. A scoped `scripts/package.json` declares
 * `"type": "module"` so Node treats `.ts` files here as ES modules and strips
 * type annotations without a compile step. The repo-root `package.json`
 * remains `"type": "commonjs"` for the built extension output. The script
 * resolves its own location via `import.meta.url` (the ESM equivalent of
 * `__dirname`), so it works regardless of the caller's working directory.
 *
 * By default the script runs `pnpm build` first so one command produces a
 * fresh extension. Pass `--no-build` to skip the build (useful when you have
 * already built and only want to re-copy).
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Options {
  /** Resolved plugins directory, or null if unset. */
  target: string | null;
  /** Whether to run `pnpm build` before copying. */
  build: boolean;
}

interface CopyArtifact {
  src: string;
  destName: string;
}

interface CaughtError {
  code?: string;
  message?: string;
}

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const INSTALL_SUBDIR = 'darktide-relay';

// Filesystem error codes that, on Windows, typically mean another process
// (usually Vortex) holds the destination file open.
const LOCK_ERROR_CODES: ReadonlySet<string> = new Set(['EACCES', 'EPERM', 'EBUSY', 'EAGAIN']);

/**
 * Error subclass for user-facing failures. Carries a clean message without a
 * noisy stack trace.
 */
class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

/**
 * Parses CLI arguments. Recognizes `--target` and `--plugins-dir` (with `=`
 * or space separator) and the `--no-build` flag.
 */
function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { target: null, build: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === '--no-build') {
      opts.build = false;
    } else if (arg === '--target' || arg === '--plugins-dir') {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value.length === 0) {
        throw new UserError(`Option ${arg} requires a directory path.`);
      }
      opts.target = value;
      i++;
    } else if (arg.startsWith('--target=')) {
      opts.target = arg.slice('--target='.length);
    } else if (arg.startsWith('--plugins-dir=')) {
      opts.target = arg.slice('--plugins-dir='.length);
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
    'Usage: node scripts/dev-install.ts --target <plugins-dir>',
    '       node scripts/dev-install.ts --plugins-dir <plugins-dir>',
    '       VORTEX_PLUGINS_DIR=<plugins-dir> node scripts/dev-install.ts',
    '',
    'Options:',
    '  --target <dir>        Vortex plugins directory (required unless env var is set).',
    '  --plugins-dir <dir>   Alias for --target.',
    '  --no-build            Skip the `pnpm build` step.',
    '  -h, --help            Show this help.',
    '',
    'Default Windows plugins directory: %APPDATA%\\Vortex\\Plugins',
  ];
  console.log(lines.join('\n'));
}

/**
 * Resolves the target plugins directory from CLI args or the
 * `VORTEX_PLUGINS_DIR` environment variable. Throws a UserError if neither
 * is supplied.
 */
function resolveTarget(opts: Options, env: NodeJS.ProcessEnv): string {
  const fromEnv = typeof env.VORTEX_PLUGINS_DIR === 'string' ? env.VORTEX_PLUGINS_DIR : null;
  const raw = opts.target ?? fromEnv;
  if (raw === null || raw.length === 0) {
    throw new UserError(
      'No Vortex plugins directory supplied. Pass --target <dir> (or set the\n' +
        'VORTEX_PLUGINS_DIR environment variable). The default on Windows is\n' +
        '%APPDATA%\\Vortex\\Plugins.',
    );
  }
  return path.resolve(raw);
}

/** Runs `pnpm build` with output inherited so the operator sees live progress. */
function runBuild(): void {
  console.log('Building extension via `pnpm build`...');
  execSync('pnpm build', { cwd: REPO_ROOT, stdio: 'inherit' });
  console.log('Build complete.\n');
}

/**
 * Copies a single file, translating lock-style filesystem errors into a
 * clear operator-facing message.
 */
function copyArtifact(src: string, dest: string): void {
  try {
    fs.copyFileSync(src, dest);
  } catch (err) {
    const info = err as CaughtError;
    const code = info.code ?? '';
    if (LOCK_ERROR_CODES.has(code)) {
      throw new UserError(
        `Could not write "${dest}" (error ${code || 'unknown'}). Vortex likely\n` +
          'has the file open. Close Vortex and re-run this command.',
      );
    }
    throw new UserError(`Could not write "${dest}": ${info.message ?? String(err)}`);
  }
}

/**
 * Entry point. Parses args, optionally builds, ensures the install directory
 * exists, copies the artifacts, and prints a summary plus a restart reminder.
 * Any thrown `UserError` (missing target, lock error, missing source file)
 * is caught once at the top and reported cleanly.
 */
function main(): void {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const target = resolveTarget(opts, process.env);
    if (opts.build) {
      runBuild();
    }
    install(target);
  } catch (err) {
    fail(err);
  }
}

/**
 * Copies the built artifacts into `<target>/darktide-relay/`. Throws a
 * `UserError` for any operator-fixable condition (missing build output,
 * missing source file, or a lock-style write failure).
 *
 * The bundled `relay/` runtime directory is copied when present in the
 * repo root. The directory is gitignored (Relay is bundled into the
 * distributable archive by `scripts/package.ts`); populate it by running
 * `pnpm bundle:relay`. When `relay/` is absent, the copy is skipped
 * silently. The start hook's "Relay files exist" hard check
 * (spec Section 12) blocks launch with an actionable message until a
 * complete runtime is in place, so dev iteration without a runtime is
 * safe but cannot launch Darktide.
 */
function install(target: string): void {
  const sourceIndex = path.join(REPO_ROOT, 'dist', 'index.js');
  if (!fs.existsSync(sourceIndex)) {
    throw new UserError(
      `"${sourceIndex}" does not exist. Run \`pnpm build\` first, or drop\n` +
        'the --no-build flag so this script builds for you.',
    );
  }

  const installDir = path.join(target, INSTALL_SUBDIR);
  fs.mkdirSync(installDir, { recursive: true });

  const artifacts: CopyArtifact[] = [
    { src: path.join(REPO_ROOT, 'info.json'), destName: 'info.json' },
    { src: path.join(REPO_ROOT, 'gameart.png'), destName: 'gameart.png' },
    { src: sourceIndex, destName: 'index.js' },
  ];

  for (const { src, destName } of artifacts) {
    if (!fs.existsSync(src)) {
      throw new UserError(`Expected source file is missing: "${src}".`);
    }
    copyArtifact(src, path.join(installDir, destName));
  }

  // Copy the bundled Relay runtime if the operator has populated it.
  // The directory is gitignored and is bundled into the release archive
  // by `scripts/package.ts`; populate it by running `pnpm bundle:relay`.
  const relaySummary = copyRelayRuntime(installDir);

  const summary = [
    'Installed Darktide Relay extension artifacts:',
    ...artifacts.map((a) => `  - ${path.join(installDir, a.destName)}`),
    relaySummary,
    '',
    'Restart Vortex (fully close and reopen) to load the new build.',
    'If you see file-lock errors, Vortex is still running; close it first.',
  ];
  console.log(summary.join('\n'));
}

/**
 * Recursively copies the repo-root `relay/` directory into `<installDir>/relay/`
 * when it exists. Returns a one-line summary for the install banner.
 * Silent skip (with a "not present" note) when the operator has not yet
 * populated the directory; run `pnpm bundle:relay` to populate it.
 *
 * Uses `fs.cpSync` with `recursive: true` so the entire runtime tree
 * (`mod_loader/` Lua files, the EXE and DLL, and the legal files)
 * copies in one call. Pre-existing destination files are overwritten so
 * re-runs pick up runtime updates cleanly.
 */
function copyRelayRuntime(installDir: string): string {
  const srcRelay = path.join(REPO_ROOT, 'relay');
  if (!fs.existsSync(srcRelay)) {
    return '  - relay/ not present in repo root; skipped (populate it to enable launch).';
  }
  const destRelay = path.join(installDir, 'relay');
  try {
    // `force: true` overwrites existing files; `recursive: true` walks
    // the subtree. Remove the destination first so deleted files in the
    // source do not linger in the install.
    fs.rmSync(destRelay, { recursive: true, force: true });
    fs.cpSync(srcRelay, destRelay, { recursive: true, force: true });
  } catch (err) {
    const info = err as CaughtError;
    const code = info.code ?? '';
    if (LOCK_ERROR_CODES.has(code)) {
      throw new UserError(
        `Could not copy relay/ to "${destRelay}" (error ${code || 'unknown'}).\n` +
          'Vortex likely has a file open there. Close Vortex and re-run\n' +
          'this command.',
      );
    }
    throw new UserError(`Could not copy relay/: ${info.message ?? String(err)}`);
  }
  return `  - ${destRelay} (operator-supplied Relay runtime copied)`;
}

/**
 * Prints an error message and exits non-zero. UserError prints the message
 * cleanly; other errors include the stack for debugging.
 */
function fail(err: unknown): never {
  if (err instanceof UserError) {
    console.error(`\nError: ${err.message}\n`);
  } else {
    console.error('\nUnexpected error:', err, '\n');
  }
  process.exit(1);
}

main();
