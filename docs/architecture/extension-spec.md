# Darktide Relay Vortex extension implementation spec

**Status:** selected production design
**Date:** 2026-07-18
**Baseline:** Vortex 2.3.0 on Windows; Mod Relay (current release of
https://github.com/ModifAmorphic/darktide-mod-relay)

This is the implementation spec for the Darktide Relay Vortex extension. It
records the selected production design, component contracts, lifecycle, and
acceptance criteria. Grounded external contracts are in
[`../reference/vortex-extension-development.md`](../reference/vortex-extension-development.md)
and
[`../reference/darktide-mods-and-relay.md`](../reference/darktide-mods-and-relay.md).

## 1. Scope

The extension adapts Vortex's existing download, install, deploy, profile, and
load-order systems to Darktide mods, and adapts Relay's launcher contract to
Vortex's supported-tool and launch-hook systems.

The extension is responsible for:

1. Registering Darktide with Vortex and associating it with the Nexus domain.
2. Installing Darktide mod archives into a normalized canonical layout.
3. Deploying installed mods to a Vortex-managed mod directory outside Darktide.
4. Auto-emitting an `after DMF` rule on every non-DMF install so Vortex's
   native mod sort places DMF first.
5. Projecting the active profile's enabled, sorted mods into `mods.lst`.
6. Registering Mod Relay as the primary supported tool.
7. Validating state and regenerating `mods.lst` immediately before launch.

Out of scope: game-directory patching, DML and `dtkit-patch` integration,
bundle-database changes, file merging, custom load-order UI, arbitrary
mod-to-mod dependency solving, Linux Vortex, and migration from another
extension.

### Design invariants

These invariants hold across the extension. Specific sections implement them.

- The extension never writes inside the Darktide installation. Mods deploy
  to a Vortex-managed directory under Vortex userData (Section 7).
- The extension ships Relay as a pinned, tested runtime inside the archive.
  One extension install equals one tested Relay runtime set (Section 11,
  Section 15).
- The installer does not special-case DMF for install. DMF is a normal mod
  (Section 8.1).
- The installer auto-emits an `after DMF` rule for every non-DMF mod so
  Vortex's sort places DMF first (Section 8.5).
- The extension does NOT register a custom load-order page. Users add
  further `after`/`before` rules via Vortex's built-in mod details UI
  (Section 9).
- The extension never blocks launch based on DMF state. DMF-absent and
  DMF-misordered cases surface as a single non-blocking warning that fires
  at most once per Vortex install (Section 12).
- The Darktide folder name is persisted as a mod attribute distinct from the
  Vortex mod ID and the Nexus title. Only the canonical name appears in
  `mods.lst` (Section 8).
- Profile enable/disable is the single source of enabled state. The
  extension does not maintain a second enabled-state anywhere (Section 9).

## 2. Version grounding

Established baseline (re-ground before implementation if the target Vortex or
Relay version changes):

| Component | Version | Source |
| --- | --- | --- |
| Vortex | 2.3.0 (commit `a5a9583`) | git tag `v2.3.0` |
| Extension API types | 2.3.0-beta.1 | npm `@nexusmods/vortex-api` |
| Mod Relay | current release of https://github.com/ModifAmorphic/darktide-mod-relay | Relay release archive |
| Target host | Windows | Vortex 2.3 release |

Toolchain versions pinned by the first implementation task's lockfile, grounded
against the npm registry on 2026-07-18 and the Vortex 2.3 build runtime
(Node 24.15.0, pnpm 11.5.1 per Vortex's own `package.json`):

| Tool | Pinned version | Notes |
| --- | --- | --- |
| Node | 24 LTS | Matches the Vortex 2.3 runtime; required by pnpm 11.15+. CI uses Node 24. |
| pnpm | 11.15.0 | Matches Vortex's 11.x line. Activated via corepack. |
| TypeScript | 6.0.3 | `typescript-eslint` 8.x peer-requires TS `<6.1.0`; TS 7 support was closed as `not_planned` ([typescript-eslint#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518)). The TS 7 upgrade is blocked on `typescript-eslint` adopting tsgo/typescript-go ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940), no ETA). |
| Rolldown | 1.2.0 | Post-1.0 stable bundler. |
| Vitest | 4.1.10 | Current major. |
| ESLint | 9.x current stable | Flat config format. |
| `typescript-eslint` | 8.x current stable | ESLint 9 compatible. |
| Prettier | 3.x current stable | |
| `@nexusmods/vortex-api` | 2.3.0-beta.1 | devDependency for types only; do not use 2.4.x. |
| `@types/node` | 24.x | Matches Node 24. |

Resolved versions are recorded in `pnpm-lock.yaml`; the lockfile is the source
of truth from this point on. Re-ground before implementation if the target
Vortex, Relay, or Node version changes.

Vortex API behavior referenced in this spec comes from the v2.3.0 source and
the 2.3.0-beta.1 types package. The scoped `@nexusmods/vortex-api` import is
supported at runtime by Vortex's extension require wrapper, which intercepts
both the scoped and legacy unscoped names.

## 3. Toolchain

Selected:

- **Language:** TypeScript.
- **Bundler:** Rolldown, emitting CommonJS for a Node platform.
- **Package manager:** pnpm.
- **Test runner:** Vitest.
- **Lint and format:** ESLint and Prettier with TypeScript rules. Exact
  configs are the coder's call, pinned in the first task.

Build output is a single `dist/index.js` with these externals:

- `@nexusmods/vortex-api` and the legacy `vortex-api`. Vortex supplies the
  runtime proxy.
- Node, Electron, and Vortex-provided modules.

The extension's own runtime dependencies bundle into `dist/index.js`. Source
imports use `@nexusmods/vortex-api`.

## 4. Repository layout

```text
README.md
AGENTS.md
LICENSE
info.json
gameart.png
package.json
pnpm-lock.yaml
tsconfig.json
rolldown.config.ts        (or .js, coder's call)
eslint.config.<ext>
.prettierrc
src/
  index.ts                entry; registers all capabilities
  constants.ts            game id, nexus domain, attribute names, pinned Relay version
  game.ts                 IGame registration and setup
  installer.ts            .mod archive installer (auto-emits after-DMF rule)
  modsLst.ts              mods.lst projection, atomic write, and sortMods orchestrator
  relayTool.ts            ITool registration
  toolVariables.ts        registerToolVariables callback
  startHook.ts            registerStartHook handler
  actions.ts              user-facing actions
  paths.ts                path resolution helpers
  util/
    archive.ts            .mod candidate discovery and name derivation
    names.ts              safe-name validation
    fs.ts                 ensureDirWritable and atomic write helpers
test/
  installer.test.ts
  modsLst.test.ts
  archive.test.ts
  names.test.ts
  paths.test.ts
  startHook.test.ts
  fixtures/
    archives/             synthetic .zip shapes
scripts/
  build.ts                build dist/index.js
  bundle-relay.ts         fetch pinned Relay release into relay/
  package.ts              assemble the release archive
relay/                    vendored at build time, gitignored
  mod_relay.exe
  relay_shell.dll
  mod_loader/
    init.lua
    file.lua
    class_registry.lua
    require_bridge.lua
    lifecycle.lua
    mod_manager.lua
    dmf_adapter.lua
  LICENSE
  THIRD_PARTY_NOTICES.md
docs/
  architecture/
    extension-spec.md     this file
  reference/
    README.md
    vortex-extension-development.md
    darktide-mods-and-relay.md
dist/                     build output, gitignored
  index.js
```

Final paths and module decomposition are the coder's call within these
constraints:

- `src/index.ts` is the entry.
- Build output is `dist/index.js`.
- The Relay runtime is vendored at build time, never checked in.
- `info.json`, `gameart.png`, and the built `index.js` are the archive root.

## 5. Extension entry and package

The entry function receives an `IExtensionContext` and registers every
capability the extension owns. The default export is the entry function.

`info.json`:

```json
{
  "name": "Game: Warhammer 40,000: Darktide",
  "author": "ModifAmorphic",
  "version": "0.1.0",
  "description": "Darktide support for Vortex through Mod Relay"
}
```

Capabilities registered in the entry function:

- `context.registerGame(game)`. The Darktide `IGame` registration's
  `supportedTools` array carries the Mod Relay tool (Section 11);
  Vortex 2.3 has no separate `context.registerTool` method.
- `context.registerInstaller(id, priority, testSupported, install)`.
- `context.registerToolVariables(callback)`.
- `context.registerStartHook(priority, id, hook)`.
- `context.registerAction(...)` for each custom user-facing action. The
  other dashboard actions are Vortex built-ins configured via the game and
  tool registrations (Section 13).

The extension does NOT call `context.registerLoadOrder`. Vortex's built-in
mod sort and mod-details rule editor handle ordering (Section 9).

Long-lived event handlers (`did-deploy`, `profile-did-change`) register in
`context.once(...)`. No file I/O runs at module load. Non-active games must
not receive side effects.

## 6. Game registration

The `IGame` registration uses:

- `id: "warhammer40kdarktide-relay"`. Distinct internal ID; the Nexus domain
  association is via `details.nexusPageId`.
- `name: "Warhammer 40,000: Darktide"`.
- `executable: () => "binaries/Darktide.exe"` relative to the discovered game
  root.
- `requiredFiles:` includes `binaries/Darktide.exe` and
  `launcher/Launcher.exe`. These identify the install without making discovery
  expensive.
- `queryModPath: () => paths.modsContentDir()` returning the absolute path from
  Section 7.
- `details.nexusPageId: "warhammer40kdarktide"` for Nexus download and NXM
  resolution.
- `details.steamAppId: 1361210`.
- `queryArgs: { steam: { id: "1361210" } }` for Steam discovery. The outer
  key is the store id per `IGame.queryArgs`'s `{ [storeId: string]: ... }`
  shape; the bare `{ id: ... }` form would typecheck but never match a real
  store.
- `setup:` the callback described in Section 7.
- `mergeMods: true`.

The distinct internal ID reduces collision risk if another extension is
active. The NXM link proof in the integration matrix confirms the
`nexusPageId` association actually routes downloads to this registration.

## 7. Vortex-managed mod directory

The extension never writes inside the Darktide installation directory. Mods
deploy to a Vortex-managed directory under Vortex userData; Steam verify and
Darktide reinstalls leave mod state untouched.

Path constants (resolved dynamically, never hardcoded as user literals):

```text
modRoot        = <vortexUserData>/warhammer40kdarktide-relay
deployDir      = <modRoot>/deploy
modsContentDir = <modRoot>/deploy/mods
loadOrderDir   = <modRoot>/load-order
```

`<vortexUserData>` comes from `util.getVortexPath("userData")`.

`deployDir` is the value passed to Relay via `--mod-path`. Relay's launcher
expects that directory to contain a `mods/` subdirectory holding the mod
folders and `mods.lst`; `modsContentDir` is that content directory.
`queryModPath` returns `modsContentDir` so Vortex deploys each mod tree to
`<deployDir>/mods/<name>/`.

`loadOrderDir` is currently a vestigial placeholder from the dropped
custom-load-order design. The setup callback still creates it for forward
compatibility with any future per-profile state the extension may need, but
nothing writes to it on this branch.

The bundled Relay runtime is resolved at runtime relative to the loaded
extension module. Because the built `index.js` sits in the extension
directory alongside `relay/`, `path.resolve(__dirname, "relay")` is correct
in CommonJS output.

The game's `setup(discovery)` callback uses
`fs.ensureDirWritableAsync(...)` to create `deployDir`, `modsContentDir`,
and `loadOrderDir` before game-mode activation. A failure in `setup`
prevents the game from being managed, which is the correct behavior when
the deployment target cannot be written.

The extension never creates a directory or marker inside the Darktide
installation. `queryModPath` returns `modsContentDir` only.

`mergeMods: true` is correct because installer copy destinations already
start with the canonical mod folder name (Section 8). `mergeMods: false`
would inject a Vortex mod-ID directory and break the layout. The extension
does not call `registerMerge`; that solves a different problem (combining
conflicting structured files) this extension does not have.

## 8. Darktide mod installer

One installer is registered.

- `id: "darktide-relay-mod-installer"`.
- `priority: 25` (within the 21 to 99 game-specific range, below FOMOD at 20).

### Support test

Signature:

```text
(files, gameId, archivePath?, details?) -> PromiseLike<{ supported: boolean; requiredFiles: string[] }>
```

The test:

1. Returns `supported: false` if `gameId` is not the registered Darktide ID.
2. Finds every `.mod` entry in `files`.
3. Returns `supported: false` if there are zero candidates.
4. Returns `supported: true` with empty `requiredFiles` if at least one `.mod`
   candidate exists. Multiple-root detection (Section 8.3) and all other
   validation run in the install function so the user receives an actionable
   error message rather than a silent decline.

### Install function

The install plan:

1. Find the single canonical `.mod` entry path.
2. Derive the canonical name from its basename: strip the `.mod` extension.
3. Validate the name (Section 8.2).
4. Determine the subtree root: the directory containing the `.mod` entry. If
   the `.mod` is at the archive root, the install synthesizes the canonical
   directory.
5. Strip only wrapper ancestor directories above the subtree root.
6. Emit `copy` instructions. For each file in the subtree, destination is
   `<canonicalName>/<path relative to subtree root>`.
7. Emit an `attribute` instruction with `key: "relayModName"`,
   `value: <canonicalName>`.

The installer always emits the attribute on every install. Vortex preserves
attributes across mod updates when the installer sets them on each install,
so `relayModName` survives an update.

### 8.1 DMF

DMF is treated as a normal mod for installation and attribute purposes. The
canonical name for DMF is `dmf` because the DMF archive contains
`dmf/dmf.mod` (or `dmf.mod` at the root, which normalizes to `dmf/dmf.mod`).

DMF does, however, get a special sort position. The installer emits an
`after DMF` rule on every non-DMF install (Section 8.5) so Vortex's native
mod sort places DMF first in deployment order. Users may add further
`after`/`before` rules between specific mods via Vortex's built-in mod
details UI; the extension does not need a custom load-order page for that.
DMF-absent and DMF-misordered cases are surfaced as a once-per-install
non-blocking launch-time warning (Section 12), never as a hard block.

### 8.2 Safe-name validation

The canonical name must:

- be non-empty;
- not be `.` or `..`;
- contain no `/` and no `\`;
- not be an absolute or rooted value (reject anything that resolves absolute
  on Windows or POSIX);
- match the containing directory name when the `.mod` entry is not at the
  archive root. An archive whose layout is `foo/example.mod` (containing
  directory disagrees with the `.mod` basename) is rejected rather than
  guessing which name is canonical; and
- be unique case-insensitively within the current Vortex install state.

A name that fails any check is rejected with an `unsupported` or `error`
instruction carrying an actionable message.

### 8.3 Multiple `.mod` roots

Two `.mod` candidates are unrelated if their containing subtree roots are
neither the same directory nor an ancestor or descendant of one another in a
way that indicates one wrapper layout. The installer rejects unrelated roots
instead of picking the first candidate. The rejection is an `error`
instruction with message data identifying the multiple roots, so the user
sees an actionable message in the Vortex UI rather than a silent decline.

Optional sibling documentation or preview images outside the canonical mod
subtree are not copied. The installer does not implement a fallback for
archives with no `.mod` entry. An archive the extension does not understand
remains unsupported rather than being copied into the mod directory.

### 8.4 Duplicate canonical names across installs

With `mergeMods: true` and installer staging under `<name>/...`, two archives
that normalize to the same canonical folder would clobber each other at
deploy. The extension detects this at install time by querying the active
Vortex mod state for existing mods with the same `relayModName`
(case-insensitive). A collision is reported as an install error identifying
both mods.

### 8.5 DMF dependency rule

The installer emits one `rule` instruction on every non-DMF install. The
rule is `{ type: "after", reference: { repo: { repository: "nexus", modId:
"8" }, versionMatch: "*" } }`, declaring an `after` dependency on DMF (Nexus
mod id `8`, https://www.nexusmods.com/warhammer40kdarktide/mods/8). DMF
itself (canonical name `dmf`) does not get the rule; a self-reference would
be nonsensical.

Vortex persists the rule on the mod's `rules` array via
`InstallManager.processRule` (`InstallManager.ts` around lines 4096-4107 in
the v2.3.0 source). Vortex's built-in `util.sortMods` reads each mod's
`rules` and produces a DAG edge from the rule's reference to the rule-bearing
mod, so a mod carrying this rule sorts after DMF. With every non-DMF mod
declaring `after DMF`, the sort places DMF first in deployment order without
user intervention.

The reference uses DMF's stable Nexus mod id rather than its file id or file
version. The Vortex v2.3.0 `testModReference` matcher takes the
`fuzzyVersion` path when `versionMatch === "*"`, which matches any installed
mod whose `attributes.source === "nexus"` and `attributes.modId === 8`
regardless of file version or file id. The `IModRepoId` installed type marks
`fileId: string` as required, but the runtime matcher's fuzzy-version branch
skips the `fileId` equality check, so the omission is type-level only.

The `IModRepoId.fileId` requirement is the only type/runtime gap in the rule
shape. The installed `IRule` type is imported from `modmeta-db`, which is not
a runtime dependency of this extension; under `skipLibCheck`, the `IRule`
property of `IInstruction` resolves to `any`, so the rule literal
type-checks without a cast.

Users who want a specific mod-to-mod ordering beyond DMF-first add their own
`after` or `before` rules via Vortex's mod details UI. The extension does
not emit those rules itself.

## 9. Mod ordering

The extension does NOT register a custom load order page and does NOT call
`context.registerLoadOrder`. Vortex's built-in mod sort resolves deployment
order from the rules the installer emits plus any user-added rules.

Three pieces make this work:

1. **Installer-emitted DMF rule.** Every non-DMF install gets an
   `after DMF` rule (Section 8.5). Vortex's `util.sortMods` therefore
   places DMF first in deployment order without user interaction.
2. **User-added mod rules.** Users add `after`/`before` rules between
   specific mods via Vortex's built-in mod details UI when they want
   ordering beyond DMF-first. The extension does not need a custom page
   for this; Vortex already provides the UI and the rule storage.
3. **`util.sortMods`-based projection.** The `mods.lst` projection calls
   `util.sortMods` to resolve the deploy order during `did-deploy` and
   `profile-did-change`, then writes the sorted, enabled mods to
   `<deployDir>/mods/mods.lst` (Section 10).

There is no per-profile JSON. There is no `loadOrder.ts` module. The
deployment order is recomputed from current mod state on every projection;
the only persisted inputs are the per-mod `rules` arrays (which Vortex owns)
and the profile's `modState` enable/disable bits.

`util.sortMods` throws `CycleError` (api.d.ts line 943) when the rule graph
contains a cycle. The projection rethrows with a message naming the cycle;
the deploy and profile-change handlers surface this via a non-blocking
notification. The Relay start hook (step 6) is the final blocking gate
before launch.

## 10. mods.lst projection

A single function projects the active profile's enabled, ordered mods to:

```text
<deployDir>/mods/mods.lst
```

Format:

```text
<canonical-name-1>
<canonical-name-2>
...
```

One folder name per line. No trailing data. The file ends with a single
newline.

Disabled mods are omitted entirely, not emitted as `--` comments. Profile
enable/disable controls deployment, so a disabled mod is not on disk anyway.

### 10.1 Atomic write

```text
write tmp file <modsContentDir>/.mods.lst.tmp
fsync
rename to <modsContentDir>/mods.lst
```

On Windows, rename replaces an existing destination atomically when the
destination is not held open. Relay reads `mods.lst` only at launch, and the
start hook runs before spawn, so there is no open handle to race.

### 10.2 Projection orchestrator

`projectActiveProfileModsLst(api: IExtensionApi): Promise<void>` is the
single orchestrator that wires the pure {@link projectModsLst} helper to
live Vortex state and `util.sortMods`. It:

1. Reads the active profile via `selectors.activeProfile(state)`. Returns
   silently when there is no active profile or the active profile's
   `gameId` is not this extension's game id, so a non-Darktide active
   game receives no side effect (spec Section 5).
2. Reads installed mods via `selectors.modsForGame(state, GAME_ID)`.
3. Filters to mods that are profile-enabled in the active profile's
   `modState` (`profile.modState[modId]?.enabled === true`). Profile
   enable/disable is the single source of enabled state.
4. Calls `util.sortMods(GAME_ID, enabledMods, api)` to resolve the deploy
   order from the mods' `rules` arrays (the installer's auto `after DMF`
   rule plus any user-added rules).
5. Maps each sorted mod to its canonical name via the `relayModName`
   attribute, dropping any mod whose attribute is missing or not a
   string (defense in depth).
6. Calls `projectModsLst(paths.modsContentDir(util.getVortexPath('userData')), names)`.

Throws on sort or write failure. `CycleError` from `util.sortMods` is
rethrown with a message naming the offending cycle. Other errors
propagate unchanged.

### 10.3 Call sites

Three call sites share the orchestrator:

1. `did-deploy` event handler, registered via `api.onAsync('did-deploy', ...)`
   inside `context.once(...)`.
2. `profile-did-change` synchronous event handler, registered via
   `api.events.on('profile-did-change', ...)` inside `context.once(...)`.
3. Relay start hook (Section 12).

The deploy and profile-change handlers catch projection failures and
surface them via `api.showErrorNotification` (non-blocking). The Relay
start hook is the final blocking gate before launch and re-runs the
projection as part of its hard checks.

## 11. Relay primary tool

The extension ships Relay as a pinned, tested runtime inside the archive. One
extension install equals one tested Relay runtime set; release coupling
between the extension and Relay is intentional because the extension exists
only to drive Relay.

Registered as an entry in the Darktide `IGame.supportedTools` array
(api.d.ts line 4214). Vortex 2.3 has no separate `context.registerTool`
method; tools ride along with their owning game registration. The
`ITool` object:

- `id: "mod-relay"`.
- `name: "Mod Relay"`.
- `shortName: "Relay"`.
- `relative: false`.
- `queryPath: () => paths.relayDir()` resolving to the bundled
  `<extensionDir>/relay`.
- `executable: (base?) => "mod_relay.exe"`.
- `requiredFiles:` includes `mod_relay.exe`, `relay_shell.dll`,
  `mod_loader/init.lua`, `mod_loader/file.lua`, `mod_loader/mod_manager.lua`,
  `LICENSE`, and `THIRD_PARTY_NOTICES.md`. This is a quick-discovery sanity
  check, not the complete file-set verification. The complete set, including
  all seven `mod_loader/` Lua files, is verified by the start hook (Section
  12, hard check 2).
- `defaultPrimary: true`.
- `exclusive: true`.
- `parameters: ["--game-binary", "{RELAY_GAME_BINARY}", "--mod-path",
  "{RELAY_MOD_PATH}"]`.
- `environment:` Relay publishes its own Steam child environment. The
  extension does not set Steam environment for the tool.

Vortex's quick discovery constructs
`path.join(queryPathResult, executable(queryPathResult))`, so the bundled
layout resolves correctly.

Each parameter token stays a separate array element. Vortex passes tokens as
spawn arguments and strips literal quotes; no shell quoting is added around
paths containing spaces.

### 11.1 Tool variables

`context.registerToolVariables(callback)` returns uppercase,
extension-namespaced values at launch time:

- `RELAY_GAME_BINARY`: the discovered
  `<gamePath>/binaries/Darktide.exe`.
- `RELAY_MOD_PATH`: the absolute mod directory from `paths.deployDir()`.
  Relay consumes this directory via `--mod-path`; the launcher expects
  `<mod-path>/mods/` to contain the mod folders and `mods.lst`.

Both resolve from current Vortex state (active game discovery and the
extension's path constants). Neither depends on profile-specific values that
change between profile switches.

### 11.2 Forwarded Darktide arguments

None in the first release. The `--` separator is documented in Relay's
contract; future releases can forward Darktide arguments after it.

### 11.3 Working directory and child lifetime

Vortex uses the executable's parent directory as the working directory when
no tool working directory is supplied. A bundled Relay therefore starts with
the runtime directory as its working directory. Relay accepts absolute game
and mod paths, so this is fine.

Relay exits after injecting and resuming Darktide. Vortex initially tracks
the launched tool process, not necessarily the child game lifetime. The
integration matrix observes whether Vortex detects the `Darktide.exe` child
after the launcher exits. If not, that is a UX issue to address after core
proof, not a blocker.

## 12. Launch guard

Registered via `context.registerStartHook(5, "mod-relay-launch-guard",
hook)`. The priority is a low positive integer; start hooks all run before
Vortex's variable expansion and spawn, so the exact value only orders among
multiple hooks.

Grounded API signatures (verified against the installed
`@nexusmods/vortex-api@2.3.0-beta.1` types and the v2.3.0 Vortex source
`src/renderer/src/ExtensionManager.ts`):

- `IExtensionContext.registerStartHook: (priority: number, id: string, hook:
  (call: IRunParameters) => PromiseLike<IRunParameters>) => void`
  (api.d.ts line 3805). The hook returns a `PromiseLike<IRunParameters>`
  so an `async` function is the natural shape.
- `IRunParameters = { executable: string; args: string[]; options:
  IRunOptions }` (api.d.ts lines 6043-6047). The call object does NOT
  carry a tool id; the hook filters by executable path. Confirmed in
  the v2.3.0 source `ExtensionManager.applyStartHooks` (lines around
  2218-2245) and `runExecutable` (lines around 2247-2325): the
  `executable` field is the resolved absolute path Vortex will pass to
  `child_process.spawn`.
- Rejection: `ExtensionManager.applyStartHooks` calls `.catch` on the
  hook promise for `UserCanceled`, `ProcessCanceled`, and any other
  error, then re-rejects with the same error. The launch is aborted
  and the error surfaces through Vortex's standard error dialog. We
  reject with `util.ProcessCanceled` (api.d.ts line 7691; re-exported
  via the `util` namespace at line 9376) because it is the
  semantically correct "the launch was canceled because of a known
  precondition" signal.
- Discovered game path: `selectors.discoveryByGame` is a
  `ParametricSelector<IState, string, IDiscoveryResult>` (api.d.ts
  line 1027); `IDiscoveryResult.path?: string` (api.d.ts line 2827)
  holds the discovered install directory.
- Notification: `api.sendNotification?: (notification: INotification)
  => string` (api.d.ts line 3129). `INotification.type` is one of
  `activity`, `global`, `success`, `info`, `error` (api.d.ts lines
  5541-5558); the soft warning uses `info` so it does not block.

Tool identity: Vortex 2.3 has no separate `context.registerTool`
method. Supported tools are declared per-game via
`IGame.supportedTools: ITool[]` (api.d.ts line 4214). The extension
therefore adds the Relay tool to the Darktide `IGame` registration's
`supportedTools` array rather than registering it through a context
call. `ITool` (api.d.ts lines 6824-6955) carries `id`, `name`,
`shortName`, `queryPath`, `executable`, `requiredFiles`, `parameters`,
`environment`, `relative`, `shell`, `exclusive`, `detach`,
`defaultPrimary`, and `onStart`.

`context.registerToolVariables: (callback: ToolParameterCB) => void`
(api.d.ts line 3889) registers a single callback. `ToolParameterCB =
(options: IRunParameters) => { [key: string]: string }` (api.d.ts
line 8974). Vortex invokes the callback at launch time, after start
hooks have run but before argument-token expansion; the returned
object is merged with other callbacks' results and substituted into
each parameter token via `string-template` formatting
(`ExtensionManager.ts` lines around 2320-2324 in v2.3.0).

The hook filters by Relay's executable path (the only tool identity
available on the call object). If the launch is not for Relay, the
hook returns the call unchanged.

For Relay launches, the hook runs hard checks (reject on failure) and at most
one soft warning (never blocks).

### Hard checks (reject on failure)

1. Confirms the active profile belongs to this game.
2. Confirms `mod_relay.exe`, `relay_shell.dll`, all seven
   `mod_loader/` Lua files (`init.lua`, `file.lua`, `class_registry.lua`,
   `require_bridge.lua`, `lifecycle.lua`, `mod_manager.lua`,
   `dmf_adapter.lua`), `LICENSE`, and `THIRD_PARTY_NOTICES.md` exist in the
   bundled Relay directory.
3. Confirms the discovered Darktide binary exists.
4. Regenerates `mods.lst` via the projection orchestrator (Section 10.2)
   and validates the result against deployed state. The launch-time
   validation set is:
   - every enabled mod's deployed `<name>/<name>.mod` exists on disk;
   - the projected list matches what `util.sortMods` produces from
     current mod state (the deploy and profile-change handlers may have
     written an earlier version; the start hook re-runs the projection
     so a stale `mods.lst` cannot reach Relay);
   - no duplicate `relayModName` values in the projected list
     (case-insensitive);
   - no `relayModName` contains path separators or traversal components; and
   - every listed canonical name passed the installer's safe-name validation
     (defense in depth; the installer should already have rejected unsafe
     names).

### Soft warning (warn-once-per-install)

5. If at least one non-DMF mod is enabled AND (DMF is not enabled OR DMF is
   not the first name in the projected `mods.lst` content), AND the
   persisted warn-flag file does not exist, surfaces a non-blocking
   notification via the Vortex API and writes the flag file.

   Flag file path:

   ```text
   <modRoot>/.dmf-warning-state.json
   ```

   Flag file contents:

   ```json
   { "version": 1, "warnedAt": "<ISO 8601 timestamp>" }
   ```

   Once written, the warning never re-fires on this Vortex install,
   regardless of subsequent state changes (DMF later removed, mods added or
   removed, profile switched, Vortex restarted). The first release does not
   expose a reset action. Deleting the file manually re-arms the warning.

### Outcome

6. Returns the call if all hard checks pass, or rejects with an actionable
   Vortex error identifying which check failed. Soft warnings never block.

The error is surfaced through Vortex's standard error dialog. Each hard
check produces a distinct message so the user can act on it.

## 13. User-facing actions

Four user-facing capabilities are exposed on the Darktide dashboard tile. Two
are Vortex built-ins, configured indirectly through the game and tool
registrations rather than via `context.registerAction`; the other two are
custom actions the extension registers on the `game-managed-buttons` action
group so they render alongside Vortex's built-in Open Game Folder and Open
Mod Folder actions.

- **Launch modded with Mod Relay**: Vortex's built-in primary-tool launch.
  The Relay tool is registered with `defaultPrimary: true` (Section 11), so
  Vortex's standard Play action launches Relay.
- **Open Relay mod directory**: Vortex's built-in "Open Mod Folder" action.
  `game.getModPaths` returns `{ '': paths.modsContentDir(...) }`, so the
  built-in action opens `modsContentDir`, the directory that holds the
  deployed `<name>/<name>.mod` trees and `mods.lst`. This is deliberate
  over `deployDir` (Relay's `--mod-path` target), which contains only the
  `mods/` child and is not what the user means by "the mod folder."
- **Open Relay log directory**: a custom action that opens
  `paths.relayDir()` via `util.opn` (the bundled Relay runtime directory
  where `relay.log` is written beside the launcher).
- **Open Darktide console-log directory**: a custom action that opens
  `%APPDATA%\Fatshark\Darktide\console_logs\` via `util.opn` when it
  exists. When Darktide has not yet generated console logs (the directory
  is missing), the action surfaces a non-blocking `info` notification
  instead of opening Explorer on a nonexistent path.

Documentation calls out that Steam launch remains vanilla and that Relay's C
log and Darktide's Lua, DMF, and mod output are separate logs.

## 14. Offline test seams

Pure functions with no Vortex or Darktide dependency. Vitest, no integration
environment required.

- Archive support detection: given a file list and game ID, returns supported
  or unsupported per Section 8.
- Wrapper-directory normalization: given archive shapes (root, single
  wrapper, nested wrapper), produces the canonical staged tree.
- Canonical `.mod` name derivation: given a `.mod` entry path, produces the
  canonical name.
- Safe-name validation: rejects empty, `.`, `..`, separator-containing,
  absolute or rooted, and case-insensitive-duplicate names.
- Installer instruction generation: given an archive file list, produces
  copy, attribute, and rule instructions matching the canonical layout.
- DMF rule emission: the installer emits an `after DMF` rule for non-DMF
  mods and omits it for DMF.
- Multiple `.mod` root detection: rejects unrelated roots; accepts related
  ancestor or descendant wrapper layouts.
- Duplicate `relayModName` detection: given existing mod state, flags a
  collision.
- sortMods-based projection: given enabled mods and a `util.sortMods`
  result, produces the correct canonical-name list for `mods.lst`. Mods
  without a `relayModName` attribute are filtered out. `CycleError` from
  `sortMods` is rethrown with an actionable message.
- DMF warn-once logic: given the enabled set, DMF position, and the persisted
  flag state, returns whether to warn and whether to write the flag. Confirms
  the flag suppresses all subsequent warnings regardless of state changes.
- `mods.lst` serialization: round-trips the active order through atomic
  write.
- Relay argument assembly: confirms parameters are distinct tokens with no
  shell quoting.
- Start-hook checks: each hard-check validation branch rejects with the
  expected error.

Synthetic fixtures encode each real archive shape. Third-party mod payloads
are not committed; the operator supplies a representative corpus for the
integration matrix.

## 15. Distribution

GitHub release. No Nexus or Vortex manifest submission for the first release.

Release archive layout (root of the archive):

```text
info.json
gameart.png
index.js
relay/
  mod_relay.exe
  relay_shell.dll
  mod_loader/
    init.lua
    file.lua
    class_registry.lua
    require_bridge.lua
    lifecycle.lua
    mod_manager.lua
    dmf_adapter.lua
  LICENSE
  THIRD_PARTY_NOTICES.md
```

Build pipeline:

1. `pnpm install`.
2. `pnpm typecheck`.
3. `pnpm lint`.
4. `pnpm test`.
5. `pnpm build` produces `dist/index.js`.
6. `scripts/bundle-relay.ts` fetches the pinned Relay release into `relay/`
   and verifies required files plus legal files.
7. `scripts/package.ts` assembles the archive with `info.json`, `gameart.png`,
   `dist/index.js` renamed to `index.js`, and `relay/` at the root.

The pinned Relay version is recorded in `src/constants.ts` and surfaced by a
`--version` invocation in the integration matrix. Relay updates ship as
extension releases that bump the pinned version and update the bundle script.

Installation instructions document manual extraction to
`%APPDATA%\Vortex\Plugins` and a Vortex restart.

## 16. Acceptance criteria

The extension is acceptable when every item passes on a clean Windows
machine. This section captures the per-component acceptance criteria the coder
and qa work against.

### Game registration

- Vortex discovers the Steam Darktide install via app ID `1361210`.
- A Nexus "Download with Manager" link for a Darktide mod routes to this
  extension's game registration.
- `setup` creates `deployDir`, `modsContentDir`, and `loadOrderDir` under
  Vortex userData.

### Installer

- A no-wrapper archive (`.mod` at root) installs to `<name>/<name>.mod` plus
  siblings.
- A single-wrapper archive installs to the same canonical layout.
- A nested-wrapper archive installs to the same canonical layout.
- An archive with multiple unrelated `.mod` roots is rejected with an
  actionable message.
- An archive whose `.mod` basename disagrees with its containing directory
  (for example `foo/example.mod`) is rejected with an actionable message.
- An archive with no `.mod` entry is unsupported.
- The `relayModName` attribute is persisted on the installed Vortex mod.
- A second install with the same canonical name (case-insensitive) is
  rejected.

### Mod ordering

- Every non-DMF install emits an `after DMF` rule on the installed Vortex
  mod. DMF installs do not.
- DMF sorts first in deployment order without user interaction, driven by
  the auto-emitted rules and `util.sortMods`.
- Users can add additional `after`/`before` rules between mods via Vortex's
  built-in mod details UI; `util.sortMods` honors them.
- If the rule graph contains a cycle, the projection fails with a message
  naming the cycle and the deploy/profile-change handlers surface it
  non-blocking.

### mods.lst projection

- Atomic write leaves no partial file on failure.
- `mods.lst` is regenerated after `did-deploy`, on profile change, and in the
  Relay start hook.
- Disabled mods are omitted, not commented.
- Mods whose `relayModName` attribute is missing or not a string are
  omitted.

### Relay tool and launch guard

- The primary tool launches with `--game-binary` and `--mod-path` resolved
  from the registered tool variables.
- The start hook blocks launch when any Section 12 hard check fails, with a
  specific message per check.
- The start hook emits the DMF warning at most once per Vortex install when
  at least one non-DMF mod is enabled and DMF is absent or not first in the
  projected `mods.lst`. Once the flag file is written, the warning never
  re-fires. It never blocks.
- Relay's `relay.log` shows the bootstrap `OK`.
- Darktide's console log shows DMF and mods in the projected order.

### Distribution

- The release archive has `info.json`, `gameart.png`, `index.js`, and
  `relay/` at its root.
- `relay/` contains the EXE, DLL, `mod_loader/` Lua files, `LICENSE`, and
  `THIRD_PARTY_NOTICES.md`.
- Manual installation to `%APPDATA%\Vortex\Plugins` and a Vortex restart
  loads the extension.

## 17. Implementation order

The order attacks integration risk early and avoids building UI before the
core path works.

1. Toolchain scaffolding: `package.json`, `tsconfig.json`, Rolldown config,
   Vitest, ESLint, Prettier, GitHub Actions CI skeleton.
2. Game registration with `setup` and `queryModPath`. Prove Nexus download
   association with a real NXM link.
3. Installer with full unit-test coverage. Synthetic fixtures for each
   archive shape.
4. `mods.lst` projection as a pure function. Atomic write helper.
5. Auto DMF dependency rules and sortMods-based mods.lst projection.
6. Relay tool registration, tool variables, and start hook.
7. User-facing actions.
8. Bundle Relay via `scripts/bundle-relay.ts`. Package via
   `scripts/package.ts`.
9. Integration matrix on a clean Windows machine.
10. Documentation polish and GitHub release.

Each step is one or more coder tasks handed off with the relevant section of
this spec as the contract.

## 18. Out of scope

Explicitly deferred or excluded:

- Game-directory patching, DML, `dtkit-patch`, bundle-database changes.
- File merging or live patch generation.
- Custom load-order UI. The extension relies on Vortex's built-in mod sort
  and mod-details rule editing.
- Inferring arbitrary mod-to-mod dependencies. The single auto-emitted
  `after DMF` rule is a hardcoded convention, not a dependency solver;
  users add any further rules themselves.
- Native Linux Vortex support.
- Migration from another Darktide extension.
- Nexus or Vortex manifest submission (a later discoverability option).
- Forwarded Darktide arguments after Relay's `--` separator.
- Coexistence with another active Darktide extension registration.
