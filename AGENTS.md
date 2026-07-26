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
surfaces exist. The architecture spec is the binding implementation design.

Production is built from the ground up with testability, review, and
production-readiness as first-class goals. Do not copy or adapt another Darktide
Vortex extension. Do not treat another extension's code or lifecycle as this
project's baseline.

Before planning implementation, read:

- `docs/reference/vortex-extension-development.md`
- `docs/reference/darktide-mods-and-relay.md`
- `docs/architecture/extension-spec.md`

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
  with `setup`, `queryModPath`, and a `dev:install` script for live
  iteration; the `.mod` archive installer that recognizes Darktide mods,
  normalizes them into the canonical `<name>/<name>.mod` layout, persists
  the `relayModName` attribute, auto-emits an `after DMF` dependency rule
  for non-DMF mods, and rejects ambiguous or unsafe archives; the pure
  `mods.lst` projection helpers and the `projectActiveProfileModsLst`
  orchestrator (which calls Vortex's built-in `util.sortMods`) wired
  into `did-deploy` and `profile-did-change` event handlers; the
  Relay supported tool (`IGame.supportedTools`), the
  `registerToolVariables` callback that resolves `RELAY_GAME_BINARY`
  and `RELAY_MOD_PATH` at launch, and the `registerStartHook`
  launch guard that validates state, regenerates `mods.lst`, and emits
  a once-per-install DMF warning; and two user-facing open-directory
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
  `mods.lst`). The bundled Relay runtime is gitignored and the
  bundling script (`scripts/bundle-relay.ts`) has not landed yet;
  operators populate `relay/` manually until then.
- Development is branch + PR. No unreviewed merges to `main`; changes should be
  reviewed, covered where executable behavior exists, QA'd, and CI-green.

The `feat/load-order` branch on the remote is preserved as a reference for the
abandoned `registerLoadOrder` design. Do not merge or delete it. The active
design uses Vortex's built-in `util.sortMods` instead (spec Section 9, PR #7).

## Implementation progress

Tracks which steps from spec Section 17 have landed. Each step ships in its
own PR.

- [x] Step 1: Toolchain scaffolding (PR #2)
- [x] Step 2: Game registration (PR #3)
- [x] Step 3: `.mod` archive installer (PR #4)
- [x] Step 4: `mods.lst` projection and atomic write (PR #6)
- [x] Step 5: Auto DMF dependency rules and sortMods-based mods.lst projection
  (PR #7)
- [x] Step 6: Relay tool, tool variables, and start hook (PR #8)
- [x] Step 7: User-facing actions (pending operator Vortex render
  verification; PR to be opened by the operator after the actions are
  confirmed to render on the Games tab Darktide tile)
- [ ] Step 8: Bundle Relay and package release archive
- [ ] Step 9: Integration matrix on a clean Windows machine
- [ ] Step 10: Documentation polish and release

## Directory structure (current `main`)

```text
README.md
  Human-facing project summary, status, and documentation links.
AGENTS.md
  Agent orientation and repository operating rules.
LICENSE
  GPL-3.0 project license.
info.json
  Vortex extension manifest (name, author, version, description).
gameart.png
  640x360 Vortex game art (placeholder pending real art).
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
.github/
  workflows/
    pr.yml
      GitHub Actions: install/typecheck/lint/test/build on pull request to
      `main`. The format job auto-formats same-repo PRs in place and verifies
      formatting on fork PRs and dispatch.
src/
  index.ts
    Entry; default-exports main(context). Registers the Darktide game and
    the `.mod` archive installer; registers the Relay tool variables
    callback and the launch-guard start hook; registers the two
    user-facing open-directory actions via registerActions; registers
    did-deploy and profile-did-change handlers inside context.once that
    project mods.lst. The Relay tool itself is registered via the
    Darktide game's supportedTools array, not a separate registerTool
    call.
  constants.ts
    Game ID, Nexus domain, Steam app ID, required files, mod attribute
    name, DMF canonical name, DMF Nexus mod id, mod-directory layout
    subdirectory names, Relay tool id/name/executable, Relay
    quick-discovery and full required-files lists, the seven mod_loader
    Lua file names, the DMF warning flag file name/version, and the
    Darktide console-log directory path segments.
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
    atomic write; projectAndValidateModsLst runs the same projection and
    additionally returns validation problems (duplicates, unsafe names)
    for the start hook. Imports util and selectors from
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
  startHook.ts
    The registerStartHook launch guard. createStartHook closes over the
    Vortex api; the hook filters by Relay's executable path, runs four
    hard checks (active profile game id, Relay runtime files present,
    discovered Darktide binary present, projected mods.lst validates
    and deployed <name>/<name>.mod files exist), and emits a
    once-per-install DMF soft warning via sendNotification +
    .dmf-warning-state.json flag file. Pure helpers (isRelayLaunch,
    missingRelayFiles, validateDeployedModsLstEntries, decideDmfWarning,
    readDmfWarningFlag, persistDmfWarningFlag) are exported for unit
    testing.
  actions.ts
    User-facing open-directory actions (spec Section 13).
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
scripts/
  package.json
    Scopes scripts/ to ES modules so Node 24 type-strips dev .ts files
    directly (the repo root remains "type": "commonjs" for built output).
  dev-install.ts
    Builds and copies artifacts into a Vortex plugins directory for live
    iteration. Copies info.json, gameart.png, dist/index.js (renamed to
    index.js), and (when present) the repo-root relay/ runtime directory.
    Run via `pnpm dev:install --target <dir>`.
  README.md
    Operator-facing verification checklist. Run `pnpm dev:install`, then
    work through the per-step checks documented there. Grows as
    implementation steps land.
test/
  paths.test.ts
    Unit tests for the path helpers exercising Windows path composition
    (modRoot, deployDir, modsContentDir, loadOrderDir).
  game.test.ts
    Unit tests for the game object and setup callback (mocked Vortex API),
    including queryModPath and getModPaths both returning modsContentDir.
  index.test.ts
    Unit tests for the entry's registerGame and registerInstaller wiring,
    the registerToolVariables and registerStartHook wiring, the
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
    executable, requiredFiles subset, parameter tokens, no shell quoting,
    no environment, defaultPrimary and exclusive flags) and the
    Relay-related constants (RELAY_REQUIRED_FILES, RELAY_DISCOVERY_FILES,
    MOD_LOADER_FILES, DMF_WARNING_FILE_NAME).
  toolVariables.test.ts
    Unit tests for createToolVariablesCallback (returns both
    RELAY_GAME_BINARY and RELAY_MOD_PATH, resolves the discovered
    game path and the Vortex userData deploy dir, returns empty for
    RELAY_GAME_BINARY when discovery is missing, scoped to the
    Darktide game id).
  startHook.test.ts
    Unit tests for the launch guard: isRelayLaunch filter (case-
    insensitive, separator-tolerant, basename-must-match-directory);
    missingRelayFiles (full, partial, directory-missing cases);
    validateProjectedNames (duplicates, separators, traversal, empty);
    validateDeployedModsLstEntries (present, missing, unsafe);
    projectAndValidateModsLst (clean projection, no active profile, wrong
    game, validation problems still write the file); every hard check's
    pass and fail path; the DMF soft warning's pure decision, flag-file
    read/write/parse, and fire-once hook wiring; rejection mechanism
    (ProcessCanceled with distinct per-check messages).
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
  stubs/
    vortex-api.ts
      Runtime stub for the types-only @nexusmods/vortex-api package so
      Vitest can resolve value imports (util, fs, selectors); per-test
      vi.mock overrides it. Provides default no-op sortMods, opn,
      activeProfile, discoveryByGame, and ProcessCanceled stubs.
docs/
  architecture/
    extension-spec.md
      Selected production design and component/lifecycle contracts for the
      extension. Binding for implementation.
  reference/
    README.md
      Reference index, version baseline, and evidence labels.
    vortex-extension-development.md
      Vortex 2.3 package/build/API/lifecycle facts and derived consequences.
    darktide-mods-and-relay.md
      Darktide mod shape and Relay launcher/mod-directory contracts.
dist/                     build output, gitignored
  index.js                produced by `pnpm build`
```

When implementation directories, build tooling, tests, workflows, or release
artifacts are added, update this tree in the same change. Do not document a
planned directory as if it already exists.

## Version grounding

The current reference baseline is:

- Vortex `2.3.0`, tag `v2.3.0`, commit `a5a9583`.
- `@nexusmods/vortex-api` `2.3.0-beta.1`.
- Mod Relay (current release of
  https://github.com/ModifAmorphic/darktide-mod-relay), using its current
  published launcher and loader contract.
- Windows as the only supported Vortex host.

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

- `info.json` carries mandatory name, author, SemVer version, and description.
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

If the extension embeds Relay, pin an exact Relay release and preserve the
runtime as a tested unit. Every distributed Relay bundle must include Relay's
GPL-3.0 `LICENSE` and `THIRD_PARTY_NOTICES.md`; never copy only the EXE/DLL or
reconstruct a partial bundle.

Relay exits after injecting and resuming Darktide. Vortex process tracking after
that handoff requires live validation.

## Agent ops

### Commands

Repo-root commands. Run with Node 24 and pnpm 11.15+ (see Section 2 of the
architecture spec for the version baseline and grounding date):

- `pnpm install` -- install dependencies (uses `pnpm-lock.yaml`).
- `pnpm typecheck` -- type-check sources without emitting (`tsc --noEmit`).
- `pnpm lint` -- run ESLint.
- `pnpm format:check` -- verify Prettier formatting without writing.
- `pnpm format` -- apply Prettier formatting in place.
- `pnpm test` -- run the Vitest unit suite.
- `pnpm build` -- bundle `src/index.ts` to `dist/index.js` via Rolldown.
- `pnpm dev:install` -- build and copy artifacts into a Vortex plugins
  directory (requires `--target <dir>` or `VORTEX_PLUGINS_DIR`; see
  `scripts/README.md`).
- `pnpm clean` -- remove `dist/`.

CI (`.github/workflows/pr.yml`) runs install, typecheck, lint, format, test,
and build on pull request to `main`, and uploads `dist/index.js` as
an artifact. Markdown (`*.md`) is excluded from Prettier enforcement via
`.prettierignore`; format those files by hand. The auto-format job reforms
same-repo PRs in place (committing as `github-actions[bot]` with `[skip ci]`)
and verifies formatting on fork PRs and dispatch.

### Expected future command categories

Still to introduce in later implementation steps:

- assembling the Vortex extension archive (scripts/package.ts); and
- bundling the Relay runtime (scripts/bundle-relay.ts).

The package manager, bundler, and test framework choices are settled
(pnpm 11, Rolldown, Vitest); they do not auto-track Vortex's own tooling.

A release workflow (`release.yml`) and release-please config files will land at Step 8.

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
- start-hook filtering/validation.

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

- `docs/architecture/extension-spec.md` -- selected production design and
  component/lifecycle contracts. Binding for implementation.
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

Docs must reflect the code in the PR. For changes affecting structure, build,
architecture, contracts, packaging, or operations, update as applicable:

- **`AGENTS.md`** -- repository state, tree, commands, contracts, and ops.
- **`README.md`** -- user-facing status, installation, and links.
- **Component/source README** -- build, test, package, and developer workflow.
- **`docs/architecture/`** -- selected architecture or lifecycle changes.
- **`docs/reference/`** -- external contract/API/version changes and their
  sources.

Run every canonical format, lint, type-check, unit-test, build, package-layout,
and applicable integration command before requesting review (see the Commands
section). State explicitly when a change is docs-only and does not exercise
the executable suite.

Outdated docs in a PR are a review blocker, including this file.

**No project phase/stage labels in committed docs or code comments.** Describe
the current feature or architecture directly. Planning history belongs in
research, issues, and git history, not labels such as “Phase 2” or “Stage 4” in
current-system documentation.
