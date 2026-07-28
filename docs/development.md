# Development

Human-facing guide for building, testing, and working on the Darktide Relay
Vortex extension. For agent orientation and operating rules, see
[`../AGENTS.md`](../AGENTS.md). For the system architecture, see
[`architecture/design.md`](architecture/design.md). For operator verification
checklists, see [`../scripts/README.md`](../scripts/README.md).

## Prerequisites

- **Windows.** Vortex is a Windows-only application and the extension runs
  inside it. There is no Linux or macOS target.
- **Node 24** (matches the Vortex 2.3+ runtime).
- **pnpm 11.15+** (activated via corepack).
- **Vortex 2.3+** (tested on 2.4), a Steam Darktide install, and
  representative mod archives for live integration testing.

## Get the code and install

```powershell
git clone <repo-url>
cd darktide-vortex-relay-extension
pnpm install
```

Dependencies are pinned in `pnpm-lock.yaml`; the lockfile is the source of
truth.

## Codebase layout

```text
src/
  index.ts          entry; registers every capability
  constants.ts      game id, Nexus domain, attribute names, Relay executable
  game.ts           IGame registration and setup
  installer.ts      .mod archive installer (auto-emits after-DMF rule)
  modsLst.ts        mods.lst projection, atomic write, sortMods orchestrator
  relayTool.ts      ITool registration
  toolVariables.ts  registerToolVariables callback
  actions.ts        user-facing open-directory actions
  paths.ts          path resolution helpers
  util/
    archive.ts      .mod candidate discovery and name derivation
    names.ts        safe-name validation
    fs.ts            atomic write helper
scripts/
  bundle-relay.ts   fetch the latest Relay release into relay/
  package.ts        assemble the distributable archive
test/               Vitest unit tests (one file per source module)
docs/
  architecture/     system design
  reference/        grounded external contracts (Vortex, Relay, Darktide)
```

`relay/` is populated at build time by `pnpm bundle:relay` and is gitignored;
it is never committed. `dist/` and `dist-package/` are build outputs, also
gitignored.

## Build

```powershell
pnpm build
```

Bundles `src/index.ts` to `dist/index.js` via Rolldown, emitting CommonJS for
the Node platform. The Vortex API (`@nexusmods/vortex-api` and the legacy
`vortex-api`), Node, Electron, and Vortex-provided modules are external;
Vortex supplies them at runtime. The extension's own runtime dependencies
bundle into `dist/index.js`.

## Type-check, lint, format

```powershell
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint .
pnpm format       # prettier --write (apply)
pnpm format:check # prettier --check (verify only)
```

Source files use CRLF line endings (`.gitattributes` enforces `eol=crlf`;
Prettier's `endOfLine: "crlf"` enforces it on format). Markdown is excluded
from Prettier enforcement and formatted by hand.

## Test

```powershell
pnpm test
```

Vitest, Node environment, `test/**/*.test.ts`. The design factors behavior
into pure seams with no Vortex or Darktide dependency, so most logic is
unit-testable without an integration environment. The runtime stub for the
types-only `@nexusmods/vortex-api` package is in `test/stubs/vortex-api.ts`;
per-test `vi.mock` overrides it.

Integration validation (Vortex + Darktide + real mods) is operator-driven;
see [`../scripts/README.md`](../scripts/README.md) for the per-capability
verification checklists.

## Install a build into Vortex

The extension is installed the same way end users install it: package the
archive and drop it into Vortex. Vortex manages where extensions are stored;
the extension does not reach into Vortex's plugin directory.

```powershell
pnpm bundle:relay   # once, to populate relay/ (see below)
pnpm package        # builds and assembles dist-package/<archive>.zip
```

Then drag-drop the produced `.zip` onto the Vortex window. Vortex installs it
over any previous version (the manifest carries a stable `id`, so an update
replaces the old one; no uninstall needed) and prompts you to restart. A full
restart is required: the Node extension host that serves
`require("@nexusmods/vortex-api")` only re-initializes on a full restart, not
a window reload.

## Bundle the Relay runtime

```powershell
pnpm bundle:relay
```

Fetches the newest non-draft Mod Relay release (pre-release inclusive) from
the GitHub releases API, downloads the `-windows-x64.zip` asset, and extracts
it verbatim into `relay/`. The extension's only Relay contract is
`mod_relay.exe`; the script verifies that one file is present and does not
inspect Relay's internal layout. `--out <dir>` overrides the target directory
(the default is `<repo>/relay`). Set `GITHUB_TOKEN` to raise the
unauthenticated GitHub API rate limit (useful in CI).

## Package a release archive

```powershell
pnpm package
```

Assembles the distributable archive: stages `info.json`, `gameart.png`,
`dist/index.js` (as `index.js`), and `relay/` in a temp directory, zips it so
the four entries sit at the archive root with no wrapper directory, reads the
zip's central directory to verify the root layout, and writes
`dist-package/darktide-relay-vortex-extension-<info-version>.zip`. Runs
`pnpm build` first unless you pass `--no-build`. `--out <path>` overrides the
output archive path.

Run `pnpm bundle:relay` first so `relay/` is populated; `package` gates on
`relay/mod_relay.exe` existing.

## Release pipeline

Push to `main` triggers release-please, which opens a release PR proposing the
next version from the conventional commits since the last release. Merging
that release PR cuts the tag and GitHub release, and the release workflow then
runs `bundle:relay` and `package` in CI and uploads the archive to the
release. A release ships only when you merge the release PR; feature PR merges
do not release.

The release workflow injects the tag version into `info.json` at build time so
the shipped archive carries the release version. Add a `Release-As: X.Y.Z`
footer to a merge commit only if you want to override the version
release-please computed.

The manifest bootstraps at `0.0.0`. release-please's default first release
from `0.0.0` is `1.0.0` (the `bump-minor-pre-major` flag only governs bumps
for versions already between `0.0.0` and `1.0.0`, not the initial release).
The config pins the first release to `0.1.0` via `initial-version` in the
`.` package, so the first release is `0.1.0` and subsequent releases stay
pre-1.0 until deliberately bumped. Remove `initial-version` after the first
release is cut (it is inert by then, but cleaning it avoids confusion).

Releases are marked as pre-release until Mod Relay ships 1.0.0 stable
(`prerelease: true` in `.release-please-config.json`). Flip that flag off
when the extension is ready for a stable release.

Repository conventions (Conventional Commits, branch + PR flow, no unreviewed
merges to `main`) are in [`../AGENTS.md`](../AGENTS.md).

## Toolchain

Pinned by the lockfile; grounded against the npm registry and the Vortex 2.3+
build runtime.

| Tool | Version | Notes |
| --- | --- | --- |
| Node | 24 LTS | Matches the Vortex 2.3+ runtime; required by pnpm 11.15+. CI uses Node 24. |
| pnpm | 11.15.0 | Activated via corepack. |
| TypeScript | 6.0.3 | `typescript-eslint` 8.x peer-requires TS `<6.1.0`; TS 7 support was closed as `not_planned` ([typescript-eslint#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518)). |
| Rolldown | 1.2.0 | Bundler. Emits CommonJS for the Node platform. |
| Vitest | 4.1.10 | Test runner. |
| ESLint | 9.x | Flat config. |
| `typescript-eslint` | 8.x | ESLint 9 compatible. |
| Prettier | 3.x | `endOfLine: "crlf"`. |
| `@nexusmods/vortex-api` | 2.3.0-beta.1 | devDependency for types only. |
| `@types/node` | 24.x | Matches Node 24. |

Re-ground if the target Vortex, Relay, or Node version changes.
