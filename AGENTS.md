# AGENTS.md -- Darktide Relay Vortex extension

> Orientation for any agent working in this repo. Read this first. This file is
> for **agents**, not humans. The human-facing entry point is `README.md`.

## What this is

This repository is a greenfield, unofficial Vortex game extension for
Warhammer 40,000: Darktide. It will let Vortex download, install, enable, and
order Darktide mods, then launch the game modded through
[Mod Relay](https://github.com/ModifAmorphic/darktide-mod-relay).

Mod Relay is a separate product and repository. Relay launches Darktide
through DLL injection, with no game-directory patch and no bundle-database
modification. This extension consumes Relay's launcher contract; it does not
reimplement the injected runtime or mod loader.

The extension targets Windows Vortex and GitHub distribution. Vortex/Nexus
approval may improve discovery and installation convenience later, but
approval is not required for the extension to work or be publicly released.

## Target platform

Vortex is a Windows-only application. This extension runs inside Vortex on
Windows. There is no POSIX or Linux target, present or planned, and
cross-platform support is explicitly out of scope (see Product scope and
boundaries).

This is binding for code, tests, and CI:

- The production runtime is Windows. Path output uses Windows separators
  (backslashes) via Node's `path` module on Windows. That is the correct
  production behavior; do not normalize it.
- Source files use CRLF line endings, matching the Windows platform.
  `.gitattributes` enforces `eol=crlf` on checkout; Prettier's
  `endOfLine: "crlf"` enforces it on format. Do not configure either to
  LF; do not add a `.gitattributes` rule that forces LF.
- CI runs on `windows-latest`. Do not run CI on Linux or macOS runners.
  A green build on a non-Windows host validates the wrong platform's
  behavior and can mask real test bugs: path tests asserting POSIX
  forward-slash strings passed on Ubuntu CI while production emits
  backslash paths on Windows.
- Tests assert Windows behavior, including exact backslash path strings.
  Do not write path tests that hedge between POSIX and Windows, and do
  not introduce helpers whose stated purpose is to make assertions
  robust on a POSIX test host.

## Baseline (read before planning)

This repo's `main` branch holds the documentation seed plus the production
toolchain foundation (TypeScript, Rolldown, Vitest, ESLint, Prettier, GitHub
Actions CI). The extension entry stub exists but registers no capabilities
yet; there is no bundled Relay runtime or release workflow yet.

The reference docs establish that the required Vortex and Relay integration
surfaces exist. The architecture doc (`docs/architecture/design.md`) is the
binding design.

Production is built from the ground up with testability, review, and
production-readiness as first-class goals. Do not copy or adapt another Darktide
Vortex extension. Do not treat another extension's code or lifecycle as this
project's baseline.

Before planning implementation, read:

- `docs/reference/vortex-extension-development.md`
- `docs/reference/darktide-mods-and-relay.md`
- `docs/architecture/design.md`

## Product scope and boundaries

The intended responsibility split is:

| Concern | Owner |
| --- | --- |
| Nexus download and metadata | Vortex core |
| Installed-mod records and profile enablement | Vortex core |
| Staging and deployment | Vortex core, configured by this extension |
| Darktide archive recognition and path normalization | This extension |
| Load-order UI integration | Vortex core, registered by this extension |
| Projecting the active order into `mods.lst` | This extension |
| Selecting and passing `--game-binary` and `--mod-path` | This extension |
| Creating Darktide suspended and injecting the shell | Mod Relay |
| Loading `.mod` files and running DMF/mod lifecycle | Mod Relay |

### Relay's mod-directory boundary

Relay does **not** prescribe, create, discover, or own the mod directory. The
caller supplies any suitable parent directory through `--mod-path`. That parent
must contain `mods.lst` and the listed mod subdirectories.

Choosing a Vortex-managed directory outside Darktide is an extension design
choice that preserves no-game-footprint behavior. Do not describe that location
as a Relay requirement or a Relay-owned root.

### Explicitly not this project's job

- Patching or unpatching Darktide files.
- Integrating DML, `dtkit-patch`, or `mod_load_order.txt`.
- Modifying the bundle database.
- Generating live patches or merged content files.
- Reimplementing Nexus download, profile, staging, or deployment systems that
  Vortex already provides.
- Reimplementing Relay injection or the Lua mod loader.
- Building a native Linux Vortex application.
- Depending on Vortex/Nexus approval before development or release.
- Copying another Darktide extension.

## Repository state

- **`main`** -- documentation seed plus the production toolchain foundation
  (TypeScript, Rolldown, Vitest, ESLint, Prettier, GitHub Actions CI) and
  the extension capabilities through step 7: Darktide game registration
  with `setup` and `queryModPath`; the `.mod` archive installer that recognizes Darktide mods,
  normalizes them into the canonical `<name>/<name>.mod` layout, persists
  the `relayModName` attribute, auto-emits an `after DMF` dependency rule
  for non-DMF mods, and rejects ambiguous or unsafe archives; the pure
  `mods.lst` projection helpers and the `projectActiveProfileModsLst`
  orchestrator (which calls Vortex's built-in `util.sortMods`) wired
  into `did-deploy` and `profile-did-change` event handlers; the
  Relay supported tool (`IGame.supportedTools`), the
  `registerToolVariables` callback that resolves `RELAY_GAME_BINARY`
  and `RELAY_MOD_PATH` at launch; and two user-facing open-directory
  actions registered on the `game-managed-buttons` group (Open Relay
  log directory, Open Darktide console-log directory). "Launch modded
  with Mod Relay" is Vortex's built-in primary-tool launch (the Relay
  tool carries `defaultPrimary: true`), and "Open Relay mod directory"
  is Vortex's built-in "Open Mod Folder" action, which works because
  the game registration now defines `getModPaths` returning
  `modsContentDir` for the default mod type. The entry at `src/index.ts`
  registers the game, the installer, the tool variables, the start
  hook, and the two open-directory actions. The extension does NOT
  register a custom load-order page; it relies on Vortex's native
  mod sort. Vortex deploys each mod tree to `<deployDir>/mods/<name>/`
  (the Mod Relay layout: `--mod-path` points at `<deployDir>`, and the
  launcher expects `<deployDir>/mods/` to contain the mod folders and
  `mods.lst`). The bundled Relay runtime is gitignored.
  `release/bundle-relay.ts` fetches the latest Relay release into `relay/`
  (run `pnpm bundle:relay`), and `release/package.ts` assembles the
  distributable archive (run `pnpm package`). The GitHub release workflow
  (release-please config + release.yml on push to main, gated on
  releases_created) runs these in CI to build and upload the archive to
  the release.
- Development is branch + PR. No unreviewed merges to `main`; changes should be
  reviewed, covered where executable behavior exists, QA'd, and CI-green.

The `feat/load-order` branch on the remote is preserved as a reference for the
abandoned `registerLoadOrder` design. Do not merge or delete it. The active
design uses Vortex's built-in `util.sortMods` instead (design.md, Mod
ordering; PR #7).

## Implementation progress

Tracks which implementation steps have landed. Each step shipped in its own
PR.

- [x] Step 1: Toolchain scaffolding (PR #2)
- [x] Step 2: Game registration (PR #3)
- [x] Step 3: `.mod` archive installer (PR #4)
- [x] Step 4: `mods.lst` projection and atomic write (PR #6)
- [x] Step 5: Auto DMF dependency rules and sortMods-based mods.lst projection
  (PR #7)
- [x] Step 6: Relay tool and tool variables (PR #8)
- [x] Step 7: User-facing actions (pending operator Vortex render
  verification; PR to be opened by the operator after the actions are
  confirmed to render on the Games tab Darktide tile)
- [x] Step 8: Bundle Relay and package release archive (the `bundle-relay.ts`
  and `package.ts` scripts plus release-please config + release.yml that
  run them in CI on push to main, gated on releases_created, and upload the
  archive to the release).

## Directory structure (current `main`)

```text
README.md
  Human-facing project summary, status, and documentation links.
AGENTS.md
  Agent orientation and repository operating rules.
LICENSE
  GPL-3.0 project license.
package.json
  npm manifest, dev-only dependencies, scripts, engines, packageManager.
pnpm-lock.yaml
  Resolved dependency versions; the source of truth for installs.
pnpm-workspace.yaml
  pnpm 11 settings (allowBuilds opt-out for the transitive core-js banner).
tsconfig.json
  Strict TypeScript configuration (typecheck only; emit is via Rolldown).
rolldown.config.ts
  Bundles src/index.ts to dist/index.js as CommonJS for the Node platform.
vitest.config.ts
  Vitest configuration (Node environment, test/**/*.test.ts). Aliases the
  types-only @nexusmods/vortex-api to a runtime stub for test resolution.
eslint.config.mjs
  ESLint 9 flat config (typescript-eslint recommended + prettier).
.prettierrc
  Prettier defaults.
.prettierignore
  Excludes dist/, node_modules/, lockfile, logs, relay/, and *.md from
  Prettier enforcement (markdown is formatted by hand).
.gitignore
  Ignores node_modules/, dist/, relay/, coverage/, OS junk, *.log.
.release-please-config.json
  Release-please configuration (simple release type, changelog path).
.release-please-manifest.json
  Bootstrap manifest for release-please, tracks current version.
CHANGELOG.md
  Auto-generated changelog maintained by release-please.
.github/
  workflows/
    pr.yml
      GitHub Actions: install/typecheck/lint/test/build on pull request to
      `main`. The format job auto-formats same-repo PRs in place and verifies
      formatting on fork PRs and dispatch.
    release.yml
      GitHub Actions: release-please on push to main, gated on
      releases_created, chains into build job that bundles Relay, packages the
      extension archive, and uploads it to the release.
src/
  index.ts
    Entry; default-exports main(context). Registers the Darktide game and
    the `.mod` archive installer; registers the Relay tool variables
     callback; registers the two
    user-facing open-directory actions via registerActions; registers
    did-deploy and profile-did-change handlers inside context.once that
    project mods.lst. The Relay tool itself is registered via the
    Darktide game's supportedTools array, not a separate registerTool
    call.
  constants.ts
    Game ID, Nexus domain, Steam app ID, required files, mod attribute
    name, DMF canonical name, DMF logical file name, mod-directory layout
    subdirectory names, Relay tool id/name and the launcher executable
    (the only Relay file the extension names; Relay's internal runtime
     layout is not enumerated), and the Darktide console-log directory
     path segments.
  paths.ts
    Pure path helpers (modRoot, deployDir, modsContentDir, loadOrderDir)
    under Vortex userData, plus relayDir() which resolves the bundled
    Relay runtime directory at runtime via __dirname. deployDir is the
    value passed to Relay via --mod-path; modsContentDir is the `mods/`
    content subdirectory beneath it that holds the deployed mod trees
    and mods.lst. No Vortex imports, no side effects (relayDir reads
    __dirname, supplied by Node's CommonJS module loader).
  game.ts
    The IGame registration object and setupDiscoveredGame callback. The
    game's supportedTools array carries the Relay tool. queryModPath
    returns modsContentDir so each mod deploys to
    <deployDir>/mods/<name>/; getModPaths[''] returns the same
    modsContentDir so Vortex's built-in Open Mod Folder action opens
    the right directory; setup creates deployDir, modsContentDir, and
    loadOrderDir.
  installer.ts
    The Darktide `.mod` archive installer: testSupported, planInstall
    (pure core), and a createInstaller(api) factory that closes over the
    Vortex api for duplicate-name detection against installed mod state.
    planInstall auto-emits one `after DMF` rule instruction for every
    non-DMF mod so Vortex's sort places DMF first.
  modsLst.ts
    `mods.lst` projection. serializeModsLst serializes an ordered name
    list to file content (CRLF, empty string for empty list);
    projectModsLst composes serialization with atomic write to
    `<modsContentDir>/mods.lst`; projectActiveProfileModsLst orchestrates
    the full path from live Vortex state through util.sortMods to the
     atomic write. Imports util and selectors from
    @nexusmods/vortex-api.
  relayTool.ts
    The Mod Relay ITool registration object (id, name, shortName,
    queryPath -> relayDir, executable -> mod_relay.exe,
    requiredFiles, parameters, defaultPrimary, exclusive). Pure module:
    no Vortex imports, no side effects. Tool variable name placeholders
    (RELAY_GAME_BINARY_VAR, RELAY_MOD_PATH_VAR) are exported here so
    toolVariables.ts and tests share one source of truth.
  toolVariables.ts
    The registerToolVariables callback factory. createToolVariablesCallback
    closes over the Vortex api to resolve RELAY_GAME_BINARY (from
    selectors.discoveryByGame) and RELAY_MOD_PATH (from
    paths.deployDir(util.getVortexPath('userData'))).
  actions.ts
    User-facing open-directory actions (design.md, User-facing actions).
    registerActions(context) registers two actions on the
    `game-managed-buttons` group so they render on the Games tab
    Darktide tile, in the Open submenu behind the tile's vertical
    "..." kebab button: Open Relay log directory (opens
    paths.relayDir(), where relay.log lives beside the launcher) and
    Open Darktide console-log directory (opens
    %APPDATA%\Fatshark\Darktide\console_logs\ when it exists, or
    surfaces an explanatory notification when Darktide has not
    generated logs yet). The placement is secondary: once Darktide is
    managed, users live on the active-game dashboard, whose toolbar is
    a hardcoded Vortex component no registerAction group can extend,
    so the custom actions are not reachable there. "Launch modded" and
    "Open Mod Folder" are Vortex built-ins (primary-tool launch and
    getModPaths) and are NOT registered here. Pure helpers
    (resolveConsoleLogsDir, dirExistsSync) and the ACTION_GROUP
    constant are exported for unit testing.
    Launch options (Relay flags such as `--log-lua` and `--skip-splash`,
    plus forwarded game args after `--`) are configured through Vortex's
    built-in tool editor (Tools -> Mod Relay -> Edit -> Command Line),
    not a custom action or settings panel; the extension meets Vortex at
    that contract surface. See README (Launch options).
  util/
    names.ts
      Pure safe-name validation: isSafeCanonicalName, findDuplicateNames.
      No Vortex imports, no side effects.
    archive.ts
      Pure archive parsing: `.mod` candidate discovery, canonical name
      derivation, subtree root determining, wrapper-ancestor stripping,
      basename/directory-agreement check, multiple-root grouping. No
      Vortex imports, no side effects.
    fs.ts
      Atomic write helper (writeAtomic): write tmp, fsync, rename, with
      best-effort tmp cleanup on failure. No Vortex imports; only
      `node:fs` and `node:path`.
release/
  package.json
    Scopes release/ to ES modules so Node 24 type-strips dev .ts files
    directly (the repo root remains "type": "commonjs" for built output).
  bundle-relay.ts
    Fetches the latest stable Mod Relay release (skipping drafts and
    pre-releases) from the GitHub releases API, downloads the
    `-windows-x64.zip` asset, and extracts it verbatim into the
    repo-root relay/ directory. Defensively sorts releases by
    published_at and selects the newest non-draft, non-prerelease one;
    selects the asset matching /^v\d+\.\d+\.\d+-windows-x64\.zip$/.
    Verifies the one contract file (mod_relay.exe) at the target root
    after extraction; no internal-file enumeration or legal-file check.
    Optional GITHUB_TOKEN env raises the unauthenticated API rate limit.
    Run via `pnpm bundle:relay` (`--out <dir>` overrides the target dir).
    Pure helpers (selectLatestRelease, selectWindowsAsset) are exported
    for unit testing. Used both locally and by the release workflow.
  package.ts
    Assembles the distributable Vortex extension archive. Stages
    assets/info.json (with the resolved build version written in),
    assets/gameart.png, dist/index.js (renamed index.js), and the
    relay/ tree in a temp dir, zips it via PowerShell Compress-Archive
    (the `-Path '<stage>/*'` wildcard form places entries at the archive
    root with no wrapper directory), reads the zip's central directory
    via [System.IO.Compression.ZipFile]::OpenRead to verify the root
    layout (info.json, gameart.png, index.js, relay/mod_relay.exe), and
    cleans the staging dir. Gates on dist/index.js and
    relay/mod_relay.exe existing; runs `pnpm build` first unless
    `--no-build`. Versioning: in CI (release workflow) uses the version
    injected into assets/info.json verbatim; locally stamps
    `0.0.0-dev+<short sha>` (or `0.0.0-dev` if git is missing) into both the archive
    name and the embedded info.json, so a local build is obviously not a
    release. Default output is
    dist-package/darktide-relay-vortex-extension-<version>.zip
    (`--out <path>` overrides). Run via `pnpm package`. Pure helpers
    (readInfoVersion, composeArchivePath, composeDevVersion,
    assertArchiveRoot) are exported for unit testing. Used both locally
    and by the release workflow.
  assets/
    Static extension files package.ts drops verbatim at the archive root:
    info.json (Vortex extension manifest: name, id, author, version,
    description) and gameart.png (640x360 Vortex game art, placeholder
    pending real art). Inputs to package.ts, not build artifacts.
  README.md
    Build/packaging guide and operator-facing verification checklist. Opens
    with the dual role of these scripts (local dev + release pipeline) and
    the assets/ description, then the per-step verification checklist. Run
    `pnpm package` and install the archive into Vortex, then work through
    the checks documented there. Grows as implementation steps land.
test/
  paths.test.ts
    Unit tests for the path helpers exercising Windows path composition
    (modRoot, deployDir, modsContentDir, loadOrderDir).
  game.test.ts
    Unit tests for the game object and setup callback (mocked Vortex API),
    including queryModPath and getModPaths both returning modsContentDir.
  index.test.ts
    Unit tests for the entry's registerGame and registerInstaller wiring,
    the registerToolVariables wiring, the
    registerAction wiring for the two open-directory actions, and the
    did-deploy / profile-did-change handler registration.
  installer.test.ts
    Unit tests for testSupported, the pure planInstall core (every
    archive shape and rejection path, including the after-DMF rule
    emission for non-DMF mods and the omission for DMF), and the
    createInstaller factory's duplicate-name detection wiring through
    selectors.modsForGame.
  modsLst.test.ts
    Unit tests for serializeModsLst (empty, single, multi, non-ASCII,
    round-trip), projectModsLst (writes, replaces, zero-byte empty
    file, no tmp leak), and projectActiveProfileModsLst (sortMods-based
    projection, profile-enabled filtering, missing/non-string attribute
    filtering, no-active-profile / wrong-game short-circuits, CycleError
    rethrow).
  relayTool.test.ts
    Unit tests for the Relay ITool object (id/name/shortName, queryPath,
    executable, requiredFiles = [mod_relay.exe], parameter tokens, no
     shell quoting, no environment, defaultPrimary and exclusive flags).
  toolVariables.test.ts
    Unit tests for createToolVariablesCallback (returns both
    RELAY_GAME_BINARY and RELAY_MOD_PATH, resolves the discovered
    game path and the Vortex userData deploy dir, returns empty for
    RELAY_GAME_BINARY when discovery is missing, scoped to the
    Darktide game id).
  actions.test.ts
    Unit tests for the user-facing actions: ACTION_GROUP constant;
    resolveConsoleLogsDir (provided APPDATA, undefined APPDATA, empty
    APPDATA joined as relative); dirExistsSync (present directory,
    missing path, file passthrough); registerActions wiring (two
    actions on game-managed-buttons with open-ext icon, position
    200/210, spec titles, handler + condition passed); condition
    gating on instanceIds[0] === GAME_ID (strict boolean); each
    handler's util.opn call with the expected path, rejection routed
    through showErrorNotification; the console-log handler's
    missing-directory branch (no util.opn call, explanatory
    notification instead).
  util/
    names.test.ts
      Unit tests for safe-name validation covering every rule.
    archive.test.ts
      Unit tests for archive parsing covering every shape and grouping
      rule.
    fs.test.ts
      Unit tests for writeAtomic covering write, replace, tmp cleanup on
      success and on simulated rename failure, write-failure cleanup, and
      UTF-8-without-BOM encoding.
  release/
    bundle-relay.test.ts
      Unit tests for selectLatestRelease (newest non-draft by
      published_at, defensive sort not trusting API order, pre-releases
      skipped, draft skipping, malformed-release filtering, asset
      coercion, published_at tie-breaking) and selectWindowsAsset
      (pattern match across versions, no-match and multi-match errors
      naming available assets, rejection of malformed names).
    package.test.ts
      Unit tests for readInfoVersion (valid version, pre-release/build
      metadata, bad-JSON/non-object/missing/empty/non-string rejections),
      composeArchivePath (default filename, absolute out dir, pre-release
      preservation), and assertArchiveRoot (required set present, missing
      entries reported, wrapper-directory rejection, backslash and "./"
      normalization, exact-path matching, directory-entry tolerance,
      extra-entry tolerance).
  stubs/
    vortex-api.ts
      Runtime stub for the types-only @nexusmods/vortex-api package so
      Vitest can resolve value imports (util, fs, selectors); per-test
      vi.mock overrides it. Provides default no-op sortMods, opn,
      activeProfile and discoveryByGame stubs.
docs/
  architecture/
    design.md
      Selected production design and component/lifecycle contracts.
  development.md
      Human-facing developer guide: build, test, develop, package, release.
  reference/
    README.md
      Reference index, version baseline, and evidence labels.
    vortex-extension-development.md
      Vortex 2.3 package/build/API/lifecycle facts and derived consequences.
    darktide-mods-and-relay.md
      Darktide mod shape and Relay launcher/mod-directory contracts.
dist/                     build output, gitignored
  index.js                produced by `pnpm build`
dist-package/             release-archive output, gitignored
  darktide-relay-vortex-extension-<version>.zip  produced by `pnpm package`
```

When implementation directories, build tooling, tests, workflows, or release
artifacts are added, update this tree in the same change. Do not document a
planned directory as if it already exists.

## Version grounding

The extension targets Vortex's stable extension API, not a specific patch.
The reference baseline is the Vortex 2.3 line, tested against 2.3 and 2.4:

- Vortex `2.3+` (developed against 2.3.0; verified on 2.4.0). A Vortex minor
  bump should not require changes here unless Nexus ships a breaking change
  in a non-major release, which it should not.
- `@nexusmods/vortex-api` `2.3.0-beta.1` (the types package the build
  depends on; pinned in `package.json`).
- Mod Relay (current release of
  https://github.com/ModifAmorphic/darktide-mod-relay), using its current
  published launcher and loader contract.
- Windows as the only supported Vortex host.

Re-ground only if Vortex or Relay ships a breaking change that affects a
contract the extension depends on.

Do not trust training data for Vortex, Electron, Node, TypeScript, bundler, or
Relay version-specific behavior. Before deciding an API or build approach:

1. inventory the exact declared and resolved versions in this repo;
2. compare them with this baseline;
3. read the installed types/source for behavior-sensitive APIs; and
4. ground unfamiliar or newer behavior against version-pinned upstream source
   or documentation.

The Vortex Wiki contains migrated pages that it explicitly warns may be stale.
Use this evidence order when sources disagree:

1. exact target Vortex source and generated types;
2. the matching `@nexusmods/vortex-api` package;
3. current focused Vortex Wiki pages;
4. migrated/legacy Wiki examples.

Record version deltas and source links in specs so implementation, QA, and
review do not each rediscover them.

## Established external contracts

These are grounded facts, not optional design preferences.

### Vortex extension package

A built extension archive has these files at its root, without one enclosing
wrapper directory:

```text
info.json
gameart.png
index.js
<optional assets and subdirectories>
```

- `info.json` carries mandatory name, author, SemVer version, and description,
  plus a stable `id` (the extension's machine identity). Vortex's installer
  derives the install directory from `id` and uses it to recognize prior
  installs, so a new version drag-dropped over an old one replaces it cleanly
  without an uninstall first; without an `id` it falls back to the archive
  basename and each version installs side-by-side and conflicts.
- `gameart.png` is 640 x 360, PNG, no more than 1 MB, with no title text.
- Vortex loads built JavaScript. If source is TypeScript, it must compile to
  `index.js`.
- The Vortex 2.3 runtime resolves both `vortex-api` and
  `@nexusmods/vortex-api`; new code uses the scoped package/import.
- Own runtime dependencies are bundled. Vortex/Electron/Node-provided modules
  and the Vortex API remain external.

### Darktide registration

Grounded identifiers and paths:

| Item | Value |
| --- | --- |
| Nexus domain | `warhammer40kdarktide` |
| Steam app ID | `1361210` |
| Game executable | `binaries/Darktide.exe` relative to the game root |
| Additional identifying file | `launcher/Launcher.exe` |

`details.nexusPageId` maps an internal Vortex game ID to the Nexus domain and
NXM links. Prove the final internal-ID choice with a real “Download with
manager” link, especially if another registration is active.

### Vortex deployment path

`queryModPath(gamePath)` may return a relative path or a dynamically resolved
absolute path. Never hardcode a user's drive/path. Vortex does not create a
nonstandard target automatically; the game `setup` callback must ensure it
exists and is writable.

Vortex's `mergeMods` setting controls deployment subdirectory routing:

- `true` deploys each staged tree at the shared target root;
- `false` introduces a Vortex mod-ID subdirectory; and
- a function chooses the subdirectory per mod.

This is not file-content merging. Do not add `registerMerge` unless a future,
separately specified file-merging requirement exists.

### Darktide mod shape

For a canonical mod name `example`, Relay loads:

```text
<caller-mod-directory>/mods/example/example.mod
```

`--mod-path` points at `<caller-mod-directory>`, and the launcher expects
that directory to contain a `mods/` subdirectory holding the mod folders and
`mods.lst`. The folder name, `.mod` basename, and `mods.lst` entry must
agree. Preserve the mod subtree without parsing its Lua/assets. Reject unsafe
or ambiguous derived names instead of guessing.

Nexus title, Vortex mod ID, archive filename, and Darktide folder name are
different identities. Persist the canonical Darktide name separately; do not
derive `mods.lst` from a display name.

### `mods.lst`

- One folder name per line, in authoritative load order.
- Blank lines and `--` comment lines are ignored.
- Missing/unreadable means no mods load, with a loader diagnostic.
- Relay injects no implicit DMF entry.
- If DMF is used, `dmf` must appear before mods that depend on it.
- Relay does not know which arbitrary mods require DMF; dependency policy
  belongs to the extension.

### Relay launch

The essential invocation is:

```text
mod_relay.exe \
  --game-binary <absolute-Darktide.exe> \
  --mod-path <caller-selected-parent>
```

`--mod-path` points at the parent directory; the launcher expects
`<mod-path>/mods/` to contain the mod folders and `mods.lst`. Relay expects
`relay_shell.dll` and `mod_loader/` beside the launcher/runtime. The launcher
supports `--version`, log flags, Steam app-ID override, and a bare `--`
separator for forwarding later tokens to Darktide. Forwarded game arguments
are not required for the basic integration.

The extension bundles the latest Relay release at build time (skipping
drafts and pre-releases) and redistributes whatever Relay ships, verbatim.
Relay is NOT version-pinned: each build of the extension fetches the newest
non-draft, non-prerelease release via `release/bundle-relay.ts`.
The extension's only Relay contract is `mod_relay.exe`; it does NOT inspect,
enumerate, or verify Relay's internal files (no DLL name check, no
`mod_loader` Lua list, no legal-file check). Relay ships its own complete,
legally-compliant runtime (GPL-3.0 `LICENSE` and `THIRD_PARTY_NOTICES.md`
travel inside the release zip), and the extension preserves that bundle as
a tested unit rather than copying only the EXE/DLL or reconstructing a
partial bundle.

Relay exits after injecting and resuming Darktide. Vortex process tracking after
that handoff requires live validation.

## Agent ops

### Commands

Repo-root commands. Run with Node 24 and pnpm 11.15+ (see `docs/development.md`
for the toolchain versions and grounding date):

- `pnpm install` -- install dependencies (uses `pnpm-lock.yaml`).
- `pnpm typecheck` -- type-check sources without emitting (`tsc --noEmit`).
- `pnpm lint` -- run ESLint.
- `pnpm format:check` -- verify Prettier formatting without writing.
- `pnpm format` -- apply Prettier formatting in place.
- `pnpm test` -- run the Vitest unit suite.
- `pnpm build` -- bundle `src/index.ts` to `dist/index.js` via Rolldown.
- `pnpm bundle:relay` -- fetch the latest Mod Relay release into `relay/`
  (`release/bundle-relay.ts`). Optional `GITHUB_TOKEN` raises the API rate
  limit; `--out <dir>` overrides the target directory.
- `pnpm package` -- assemble the distributable extension archive into
  `dist-package/` (`release/package.ts`). Runs `pnpm build` first unless
  `--no-build`; `--out <path>` overrides the output archive path.
- `pnpm clean` -- remove `dist/`.

CI (`.github/workflows/pr.yml`) runs install, typecheck, lint, format, test,
and build on pull request to `main`, and uploads `dist/index.js` as
an artifact. The release workflow (`.github/workflows/release.yml`) runs on
push to main, invokes release-please to cut release PRs and tags, and when
a release is created, chains into a build job that bundles Relay, packages the
extension archive, and uploads it to the release. Markdown (`*.md`) is excluded
from Prettier enforcement via `.prettierignore`; format those files by hand.
The auto-format job reforms same-repo PRs in place (committing as
`github-actions[bot]` with `[skip ci]`) and verifies formatting on fork PRs
and dispatch.

### Live integration environment

End-to-end validation requires operator-owned software/data:

- Vortex 2.3 on Windows;
- a Steam Darktide installation;
- representative mod archives;
- a compatible Mod Relay runtime; and
- optionally a second Windows machine/user profile for portability testing.

Never guess or hardcode the operator's Vortex, Darktide, Steam, staging, or mod
paths. Ask for the path or have the operator configure it through the tested
interface. Never commit local paths, game files, downloaded mods, credentials,
Nexus tokens, or API keys.

## Testing expectations

### Offline/unit coverage

Design pure seams so most behavior does not require Vortex or Darktide:

- archive support detection;
- wrapper-directory normalization;
- canonical `.mod` name/path derivation;
- traversal/rooted/separator/case-collision rejection;
- Vortex install-instruction generation;
- Vortex mod ID -> canonical Darktide name mapping;
- load-order reconciliation for enable/disable/update/remove;
- profile-specific order persistence;
- `mods.lst` serialization and atomic replacement;
- Relay argument assembly as distinct tokens; and
- start-hook filtering/validation (removed: Vortex's built-in
  pending-deployment check handles pre-launch validation).

Prefer fixtures representing real archive shapes, but do not commit third-party
mod payloads without permission. Minimal synthetic fixtures should encode the
shape being tested.

### Windows integration proof

The minimum complete proof covers:

1. Darktide discovery through Steam metadata.
2. Nexus/NXM download association with the selected internal game ID.
3. DMF and representative mods normalized into the caller-selected parent.
4. No extension action writes inside the Darktide installation.
5. Reordering produces the same order in `mods.lst`.
6. Two profiles retain different enabled sets and order.
7. Pending deployment is resolved before launch.
8. Relay receives the correct game and mod paths and logs bootstrap `OK`.
9. Darktide's console log shows DMF/mod load order.
10. Purge removes deployment artifacts without changing Darktide.
11. Direct Steam launch remains vanilla.
12. Vortex's running-state behavior is observed after Relay exits.

Test same-volume and split-volume staging/deployment layouts. Follow Vortex's
80/20 guidance by validating representative popular mod archive shapes rather
than one hand-authored happy path.

## Key docs

- `docs/architecture/design.md` -- selected production design and
  component/lifecycle contracts.
- `docs/development.md` -- human-facing developer guide: build, test, develop,
  package, release.
- `docs/reference/README.md` -- reference baseline, evidence labels, and index.
- `docs/reference/vortex-extension-development.md` -- Vortex package, API,
  discovery, installer, deployment, profile, load-order, tool, and test facts.
- `docs/reference/darktide-mods-and-relay.md` -- Relay and Darktide mod
  contracts, responsibilities, and unresolved extension policies.
- [Mod Relay](https://github.com/ModifAmorphic/darktide-mod-relay)
  -- separate runtime source, releases, architecture, and operator docs.

## Conventions

- **Conventional Commits** (`type(scope): subject`). Commit only when explicitly
  requested. Use branch + PR flow; never merge without explicit instruction.
- Do not commit secrets, Nexus credentials/tokens, downloaded mods, Darktide
  binaries, Vortex user data, Relay logs, or machine-specific paths.
- **Do not copy another Darktide Vortex extension.** Build from official
  Vortex documentation/types/source and Relay's public contract.
- **Do not trust training data for version-specific APIs.** Ground the exact
  Vortex API, Node/Electron runtime, TypeScript, bundler, and test versions
  before implementation or review.
- **Discuss non-trivial or hacky approach decisions before implementing.** Do
  not hide workarounds in installer path logic, profile event ordering, process
  tracking, or package assembly.
- **Do not commit a change as a fix before the operator verifies it.** Leave
  fixes uncommitted or clearly pending until operator testing confirms them.
- **Do not surface plumbing-only questions without context.** Ask the operator
  only about genuine user-visible or irreversible choices. Explain the behavior
  at stake first; decide equivalent internal plumbing yourself.
- **PR descriptions describe only what was done.** State the change and why. Do
  not add an “Out of scope” section listing non-actions.
- **No em dashes in prose** (docs, code comments, commits, PRs, or chat). Use a
  comma, colon, semicolon, parentheses, or period.
- **AGENTS.md tweaks ride in the current PR.** Update this file alongside the
  change that makes its guidance stale.
- **Each PR to `main` delivers observable functionality.** No scaffolding-only
  PRs (e.g., pure functions that nothing calls yet). Build toward a complete
  feature in local commits, then ship the feature as one PR.
- **Do not auto-create PRs.** Commit and push branches. The operator opens
  PRs when ready. If an instruction says "as part of the X PR," it means the
  doc updates should ride in the eventual PR, not that the agent should open
  one immediately.

## Naming convention

- **Public products:** "Vortex" is Nexus Mods' manager. "Mod Relay" or
  "Relay" is the separate runtime. This repository is "the Darktide Relay
  Vortex extension" or "the extension" until a different public display name is
  explicitly selected.
- **Code:** use plain, descriptive names for modules, functions, types, events,
  settings, installer attributes, and paths. Avoid themed or cryptic names.
- **Folders/filenames:** lowercase except ecosystem-mandated names such as
  `README.md`, `AGENTS.md`, and `LICENSE`.
- **Canonical mod identity:** use “Darktide mod name” or “canonical folder name”
  for the `<name>` in `<name>/<name>.mod`; do not call a Nexus title or Vortex
  mod ID the mod name without qualification.

## README and docs pattern

- **Root `README.md`** -- general/user-facing summary, status, installation, and
  links. Keep build internals out once user documentation grows.
- **Component/source README** (when implementation exists) -- developer build,
  test, package, and component details. Link it from the root README rather than
  duplicating it.
- **`docs/reference/`** -- durable external contracts and reconciled facts,
  versioned and source-linked. Keep design proposals labeled as derived/open.
- **`docs/architecture/`** (when created) -- the selected production design and
  component/lifecycle contracts. Do not put unsettled alternatives there.

## Before opening a PR: keep docs current

Docs are part of the work, written while the code is written, not deferred
to a polishing pass. A PR that ships code with stale docs is incomplete.

For changes affecting structure, build, architecture, contracts, packaging,
or operations, update as applicable:

- **`AGENTS.md`** -- repository state, tree, commands, contracts, and ops.
- **`README.md`** -- user-facing status, installation, and links.
- **`release/README.md`** (or component README) -- build, test, package, and
  developer workflow.
- **`docs/architecture/`** -- selected architecture or lifecycle changes.
- **`docs/reference/`** -- external contract/API/version changes and their
  sources.

Two consistency checks catch the stale-doc failure modes this repo has hit.
Run them before requesting review:

1. **Scan for stale references, not just the section you edited.** A change
   that lands a command, a step, or a contract invalidates wording
   elsewhere. After editing, search the repo for the subject of your change
   and confirm every mention is consistent. If you added a command, no
   "expected future commands" or "still to come" list may still name it. If
   you landed an implementation step, the progress tracker and any
   forward-looking sections must reflect it. If you changed a contract,
   every doc that restates it must agree. Editing one section while leaving
   a contradicting one elsewhere is a stale doc.
2. **Cross-check sections that describe the same thing.** The
   Implementation progress tracker, any "future" or "expected" sections, the
   Commands list, the Directory structure tree, and the contract sections
   must not contradict each other. If they do, one of them is stale.

Run every canonical format, lint, type-check, unit-test, build,
package-layout, and applicable integration command before requesting review
(see the Commands section). State explicitly when a change is docs-only and
does not exercise the executable suite.

Outdated docs in a PR are a review blocker, including this file.

**No project phase/stage labels in committed docs or code comments.** Describe
the current feature or architecture directly. Planning history belongs in
research, issues, and git history, not labels such as “Phase 2” or “Stage 4” in
current-system documentation.
