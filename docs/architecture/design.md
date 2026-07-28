# Darktide Relay Vortex extension architecture

**Status:** selected production design
**Baseline:** Vortex 2.3+ on Windows (verified on 2.4); Mod Relay (current
release of https://github.com/ModifAmorphic/darktide-mod-relay)

This document describes the architecture of the Darktide Relay Vortex
extension: the components, how they fit together, the contracts between the
extension and Vortex/Relay, and the design decisions behind them. Grounded
external contracts (Vortex API behavior, the Relay launcher contract, the
Darktide mod shape) are in [`../reference/`](../reference/README.md).

For build, test, and development workflow, see
[`../development.md`](../development.md).

## Overview

The extension adapts Vortex's existing download, install, deploy, profile,
and load-order systems to Darktide mods, and adapts Relay's launcher contract
to Vortex's supported-tool and launch-hook systems. Vortex does the heavy
lifting (download, staging, deployment, profiles, the mod list UI); the
extension adds the Darktide-specific glue (archive recognition, the canonical
mod layout, `mods.lst` projection, Relay registration, and launch guarding).

The end-to-end flow:

1. **Download.** A user clicks "Download with Manager" on a Darktide mod on
   Nexus. Vortex downloads the archive and associates it with this
   extension's game registration via `details.nexusPageId`.
2. **Install.** Vortex invokes the extension's installer. The installer
   recognizes the `.mod` entry, derives the canonical Darktide folder name,
   normalizes the archive into `<name>/<name>.mod` plus siblings, persists
   the name as a mod attribute, and emits an `after DMF` rule.
3. **Deploy.** Vortex deploys each enabled mod's staged tree to the
   Vortex-managed mod directory (`<deployDir>/mods/<name>/`). The
   extension's `did-deploy` and `profile-did-change` handlers project the
   sorted, enabled mods into `<deployDir>/mods/mods.lst`.
4. **Launch.** The user clicks Play. Vortex resolves the primary tool
   (Mod Relay). The extension's start hook validates state, regenerates
   `mods.lst` one final time, and (when all hard checks pass) hands off.
   Relay creates Darktide suspended, injects its shell, resumes, and exits.

Mod Relay owns injection and the Lua mod loader. The extension never writes
inside the Darktide installation and never reimplements Relay's runtime.

## Design invariants

These hold across the extension; the component sections below implement them.

- The extension never writes inside the Darktide installation. Mods deploy to
  a Vortex-managed directory under Vortex userData (Game registration and the
  mod directory).
- The extension bundles Relay as a complete runtime inside the archive,
  fetched at build time from the latest release (Relay tool; Distribution).
- The installer does not special-case DMF for install. DMF is a normal mod
  (Installer, DMF).
- The installer auto-emits an `after DMF` rule for every non-DMF mod so
  Vortex's sort places DMF first (Installer, DMF dependency rule).
- The extension does not register a custom load-order page. Users add further
  `after`/`before` rules via Vortex's built-in mod details UI (Mod ordering).
- The extension never blocks launch based on DMF state. DMF-absent and
  DMF-misordered cases surface as a single non-blocking warning that fires at
  most once per Vortex install (Launch guard).
- The Darktide folder name is persisted as a mod attribute distinct from the
  Vortex mod ID and the Nexus title. Only the canonical name appears in
  `mods.lst` (Installer).
- Profile enable/disable is the single source of enabled state. The extension
  does not maintain a second enabled-state anywhere (Mod ordering).

## Version baseline

The extension targets Vortex's stable extension API, not a specific patch.
The design is grounded against the Vortex 2.3 line (verified on 2.3 and 2.4)
and the matching API types package. A Vortex minor bump should not require
changes here unless Nexus ships a breaking change the extension depends on.

| Component | Version | Source |
| --- | --- | --- |
| Vortex | 2.3+ (verified on 2.3 and 2.4) | stable extension API line |
| Extension API types | 2.3.0-beta.1 | npm `@nexusmods/vortex-api` (build dep) |
| Mod Relay | current release of https://github.com/ModifAmorphic/darktide-mod-relay | Relay release archive |
| Target host | Windows | Vortex Windows build |

Vortex API behavior referenced in this document comes from the Vortex 2.3
source line and the 2.3.0-beta.1 types package. The scoped `@nexusmods/vortex-api`
import is supported at runtime by Vortex's extension require wrapper, which
intercepts both the scoped and the legacy unscoped name.

## Components

### Extension entry

The entry function receives an `IExtensionContext` and registers every
capability the extension owns. The default export is the entry function.

Capabilities registered:

- `context.registerGame(game)`. The Darktide `IGame` registration's
  `supportedTools` array carries the Mod Relay tool (Relay tool); Vortex 2.3
  has no separate `context.registerTool` method.
- `context.registerInstaller(id, priority, testSupported, install)`.
- `context.registerToolVariables(callback)`.
- `context.registerStartHook(priority, id, hook)`.
- `context.registerAction(...)` for each custom user-facing action
  (User-facing actions).

The extension does not call `context.registerLoadOrder`. Vortex's built-in
mod sort and mod-details rule editor handle ordering (Mod ordering).

Long-lived event handlers (`did-deploy`, `profile-did-change`) register in
`context.once(...)`. No file I/O runs at module load. Non-active games receive
no side effects.

### Game registration and the mod directory

The `IGame` registration and the mod-directory layout are coupled: `queryModPath`
returns the deployment target, and `setup` creates it.

The `IGame` registration:

- `id: "warhammer40kdarktide-relay"`. Distinct internal ID; the Nexus domain
  association is via `details.nexusPageId`.
- `name: "Warhammer 40,000: Darktide"`.
- `executable: () => "binaries/Darktide.exe"` relative to the discovered game
  root.
- `requiredFiles:` includes `binaries/Darktide.exe` and
  `launcher/Launcher.exe`. These identify the install without making discovery
  expensive.
- `queryModPath: () => paths.modsContentDir()` returning the absolute path
  below.
- `details.nexusPageId: "warhammer40kdarktide"` for Nexus download and NXM
  resolution.
- `details.steamAppId: 1361210`.
- `queryArgs: { steam: { id: "1361210" } }` for Steam discovery. The outer key
  is the store id per `IGame.queryArgs`'s `{ [storeId: string]: ... }` shape;
  the bare `{ id: ... }` form would typecheck but never match a real store.
- `setup:` the callback below.
- `mergeMods: true`.

The distinct internal ID reduces collision risk if another extension is
active. The NXM link proof confirms the `nexusPageId` association actually
routes downloads to this registration.

The extension never writes inside the Darktide installation directory. Mods
deploy to a Vortex-managed directory under Vortex userData; Steam verify and
Darktide reinstalls leave mod state untouched.

Path constants, resolved dynamically (never hardcoded as user literals):

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

`loadOrderDir` is a vestigial placeholder from the dropped custom-load-order
design. `setup` still creates it for forward compatibility with any future
per-profile state, but nothing writes to it.

The bundled Relay runtime is resolved at runtime relative to the loaded
extension module. Because the built `index.js` sits in the extension directory
alongside `relay/`, `path.resolve(__dirname, "relay")` is correct in CommonJS
output.

The `setup(discovery)` callback uses `fs.ensureDirWritableAsync(...)` to create
`deployDir`, `modsContentDir`, and `loadOrderDir` before game-mode activation.
A failure in `setup` prevents the game from being managed, which is the
correct behavior when the deployment target cannot be written.

`mergeMods: true` is correct because installer copy destinations already start
with the canonical mod folder name. `mergeMods: false` would inject a Vortex
mod-ID directory and break the layout. The extension does not call
`registerMerge`; that solves a different problem (combining conflicting
structured files) this extension does not have.

### Installer

One installer is registered:

- `id: "darktide-relay-mod-installer"`.
- `priority: 25` (within the 21 to 99 game-specific range, below FOMOD at 20).

**Support test.** Returns `supported: false` if `gameId` is not the registered
Darktide ID. Finds every `.mod` entry in `files`. Returns `supported: false`
if there are zero candidates. Returns `supported: true` with empty
`requiredFiles` if at least one `.mod` candidate exists. Multiple-root
detection and all other validation run in the install function so the user
receives an actionable error message rather than a silent decline.

**Install plan.**

1. Find the single canonical `.mod` entry path.
2. Derive the canonical name from its basename: strip the `.mod` extension.
3. Validate the name (Safe-name validation).
4. Determine the subtree root: the directory containing the `.mod` entry. If
   the `.mod` is at the archive root, the install synthesizes the canonical
   directory.
5. Strip only wrapper ancestor directories above the subtree root.
6. Emit `copy` instructions. For each file in the subtree, destination is
   `<canonicalName>/<path relative to subtree root>`.
7. Emit an `attribute` instruction with `key: "relayModName"`,
   `value: <canonicalName>`.

The installer always emits the attribute on every install. Vortex preserves
attributes across mod updates when the installer sets them on each install, so
`relayModName` survives an update.

**DMF.** DMF is treated as a normal mod for installation and attribute
purposes. The canonical name for DMF is `dmf` because the DMF archive contains
`dmf/dmf.mod` (or `dmf.mod` at the root, which normalizes to `dmf/dmf.mod`).

DMF does get a special sort position. The installer emits an `after DMF` rule
on every non-DMF install (DMF dependency rule) so Vortex's native mod sort
places DMF first in deployment order. Users may add further `after`/`before`
rules between specific mods via Vortex's built-in mod details UI; the
extension does not need a custom load-order page for that. DMF-absent and
DMF-misordered cases are surfaced as a once-per-install non-blocking
launch-time warning (Launch guard), never as a hard block.

**Safe-name validation.** The canonical name must:

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

**Multiple `.mod` roots.** Two `.mod` candidates are unrelated if their
containing subtree roots are neither the same directory nor an ancestor or
descendant of one another in a way that indicates one wrapper layout. The
installer rejects unrelated roots instead of picking the first candidate. The
rejection is an `error` instruction identifying the multiple roots, so the
user sees an actionable message in the Vortex UI rather than a silent decline.

Optional sibling documentation or preview images outside the canonical mod
subtree are not copied. An archive the extension does not understand remains
unsupported rather than being copied into the mod directory.

**Duplicate canonical names.** With `mergeMods: true` and installer staging
under `<name>/...`, two archives that normalize to the same canonical folder
would clobber each other at deploy. The extension detects this at install time
by querying the active Vortex mod state for existing mods with the same
`relayModName` (case-insensitive). A collision is reported as an install error
identifying both mods.

**DMF dependency rule.** The installer emits one `rule` instruction on every
non-DMF install. The rule is `{ type: "after", reference: { repo: {
repository: "nexus", modId: "8" }, versionMatch: "*" } }`, declaring an
`after` dependency on DMF (Nexus mod id `8`,
https://www.nexusmods.com/warhammer40kdarktide/mods/8). DMF itself does not get
the rule; a self-reference would be nonsensical.

Vortex persists the rule on the mod's `rules` array via
`InstallManager.processRule` (`InstallManager.ts` around lines 4096-4107 in
the v2.3.0 source). Vortex's built-in `util.sortMods` reads each mod's `rules`
and produces a DAG edge from the rule's reference to the rule-bearing mod, so
a mod carrying this rule sorts after DMF. With every non-DMF mod declaring
`after DMF`, the sort places DMF first in deployment order without user
intervention.

The reference uses DMF's stable Nexus mod id rather than its file id or file
version. The Vortex v2.3.0 `testModReference` matcher takes the `fuzzyVersion`
path when `versionMatch === "*"`, which matches any installed mod whose
`attributes.source === "nexus"` and `attributes.modId === 8` regardless of
file version or file id. The `IModRepoId` installed type marks
`fileId: string` as required, but the runtime matcher's fuzzy-version branch
skips the `fileId` equality check, so the omission is type-level only. Under
`skipLibCheck`, the `IRule` property of `IInstruction` resolves to `any`, so
the rule literal type-checks without a cast.

Users who want a specific mod-to-mod ordering beyond DMF-first add their own
`after` or `before` rules via Vortex's mod details UI. The extension does not
emit those rules itself.

### Mod ordering

The extension does not register a custom load order page and does not call
`context.registerLoadOrder`. Vortex's built-in mod sort resolves deployment
order from the rules the installer emits plus any user-added rules.

Three pieces make this work:

1. **Installer-emitted DMF rule.** Every non-DMF install gets an `after DMF`
   rule. `util.sortMods` therefore places DMF first in deployment order
   without user interaction.
2. **User-added mod rules.** Users add `after`/`before` rules between specific
   mods via Vortex's built-in mod details UI when they want ordering beyond
   DMF-first. Vortex already provides the UI and the rule storage.
3. **`util.sortMods`-based projection.** The `mods.lst` projection calls
   `util.sortMods` to resolve the deploy order during `did-deploy` and
   `profile-did-change`, then writes the sorted, enabled mods to
   `<deployDir>/mods/mods.lst`.

There is no per-profile JSON. The deployment order is recomputed from current
mod state on every projection; the only persisted inputs are the per-mod
`rules` arrays (which Vortex owns) and the profile's `modState` enable/disable
bits.

`util.sortMods` throws `CycleError` (api.d.ts line 943) when the rule graph
contains a cycle. The projection rethrows with a message naming the cycle; the
deploy and profile-change handlers surface this via a non-blocking
notification. The Relay start hook is the final blocking gate before launch.

### mods.lst projection

A single function projects the active profile's enabled, ordered mods to:

```text
<deployDir>/mods/mods.lst
```

Format: one folder name per line, ending with a single newline. Disabled mods
are omitted entirely (not emitted as `--` comments), because profile
enable/disable controls deployment, so a disabled mod is not on disk anyway.

**Atomic write.** Write a tmp file at `<modsContentDir>/.mods.lst.tmp`, fsync,
rename to `<modsContentDir>/mods.lst`. On Windows, rename replaces an existing
destination atomically when the destination is not held open. Relay reads
`mods.lst` only at launch, and the start hook runs before spawn, so there is
no open handle to race.

**Projection orchestrator.** `projectActiveProfileModsLst(api: IExtensionApi):
Promise<void>` wires the pure projection helper to live Vortex state and
`util.sortMods`. It:

1. Reads the active profile via `selectors.activeProfile(state)`. Returns
   silently when there is no active profile or its `gameId` is not this
   extension's game id, so a non-Darktide active game receives no side effect.
2. Reads installed mods via `selectors.modsForGame(state, GAME_ID)`.
3. Filters to mods profile-enabled in the active profile's `modState`
   (`profile.modState[modId]?.enabled === true`).
4. Calls `util.sortMods(GAME_ID, enabledMods, api)` to resolve deploy order
   from the mods' `rules` arrays.
5. Maps each sorted mod to its canonical name via the `relayModName` attribute,
   dropping any mod whose attribute is missing or not a string.
6. Writes the names via the atomic helper.

Throws on sort or write failure. `CycleError` from `util.sortMods` is rethrown
with a message naming the offending cycle.

**Call sites.** Three share the orchestrator:

1. `did-deploy` handler, registered via `api.onAsync('did-deploy', ...)`
   inside `context.once(...)`.
2. `profile-did-change` handler, registered via
   `api.events.on('profile-did-change', ...)` inside `context.once(...)`.
3. The Relay start hook (Launch guard).

The deploy and profile-change handlers catch projection failures and surface
them via `api.showErrorNotification` (non-blocking). The start hook is the
final blocking gate and re-runs the projection as part of its hard checks.

### Relay tool

The extension bundles the current Mod Relay runtime as an opaque unit at build
time. The only Relay file the extension names is `mod_relay.exe`, the binary
Vortex launches. Relay's internal runtime layout (the injected DLL, the
`mod_loader` Lua files, the legal files) is Relay's concern; the extension
does not inspect or enumerate it, so a Relay release that adds, removes,
renames, or rearranges internal files cannot break the extension.

Registered as an entry in the Darktide `IGame.supportedTools` array (api.d.ts
line 4214). Vortex 2.3 has no separate `context.registerTool` method; tools
ride along with their owning game registration. The `ITool` object:

- `id: "mod-relay"`.
- `name: "Mod Relay"`.
- `shortName: "Relay"`.
- `relative: false`.
- `queryPath: () => paths.relayDir()` resolving to the bundled
  `<extensionDir>/relay`.
- `executable: (base?) => "mod_relay.exe"`.
- `requiredFiles:` includes only `mod_relay.exe`. This is a quick-discovery
  sanity check that picks the bundled Relay directory and rejects look-alikes.
  The extension does not enumerate Relay's internal runtime files here or
  anywhere else; the start hook likewise verifies only the launcher binary.
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

**Tool variables.** `context.registerToolVariables(callback)` returns
uppercase, extension-namespaced values at launch time:

- `RELAY_GAME_BINARY`: the discovered `<gamePath>/binaries/Darktide.exe`.
- `RELAY_MOD_PATH`: the absolute mod directory from `paths.deployDir()`.
  Relay consumes this directory via `--mod-path`; the launcher expects
  `<mod-path>/mods/` to contain the mod folders and `mods.lst`.

Both resolve from current Vortex state (active game discovery and the
extension's path constants). Neither depends on profile-specific values that
change between profile switches.

**Relay flags and forwarded Darktide arguments.** The extension ships only
the two required parameters (`--game-binary`, `--mod-path`) as static
defaults. Users add optional Relay flags (`--lua-logs`, `--skip-splash`) and
forwarded game arguments (after Relay's `--` separator) through Vortex's
built-in tool editor (Tools page -> Mod Relay -> Edit -> Command Line). The
extension deliberately does not add a custom UI for this; it meets Vortex at
the contract surface Vortex already provides for per-tool command-line
editing. Vortex pre-fills the field with the static parameters, so the user
appends to them and preserves the `{RELAY_GAME_BINARY}` / `{RELAY_MOD_PATH}`
placeholders, which the extension resolves at launch (User-facing actions).

**Working directory and child lifetime.** Vortex uses the executable's parent
directory as the working directory when no tool working directory is supplied.
A bundled Relay therefore starts with the runtime directory as its working
directory. Relay accepts absolute game and mod paths, so this is fine.

Relay exits after injecting and resuming Darktide. Vortex initially tracks the
launched tool process, not necessarily the child game lifetime. Whether
Vortex detects the `Darktide.exe` child after the launcher exits is a UX
detail to observe; if it does not, that is a UX issue to address later, not a
blocker.

### Launch guard

Registered via `context.registerStartHook(5, "mod-relay-launch-guard", hook)`.
The priority is a low positive integer; start hooks all run before Vortex's
variable expansion and spawn, so the exact value only orders among multiple
hooks.

Grounded API signatures (verified against the installed
`@nexusmods/vortex-api@2.3.0-beta.1` types and the v2.3.0 Vortex source
`src/renderer/src/ExtensionManager.ts`):

- `IExtensionContext.registerStartHook: (priority: number, id: string, hook:
  (call: IRunParameters) => PromiseLike<IRunParameters>) => void` (api.d.ts
  line 3805). The hook returns a `PromiseLike<IRunParameters>`, so an `async`
  function is the natural shape.
- `IRunParameters = { executable: string; args: string[]; options:
  IRunOptions }` (api.d.ts lines 6043-6047). The call object does not carry a
  tool id; the hook filters by executable path. Confirmed in the v2.3.0 source
  `ExtensionManager.applyStartHooks` (lines around 2218-2245) and
  `runExecutable` (lines around 2247-2325): the `executable` field is the
  resolved absolute path Vortex will pass to `child_process.spawn`.
- Rejection: `applyStartHooks` calls `.catch` on the hook promise for
  `UserCanceled`, `ProcessCanceled`, and any other error, then re-rejects with
  the same error. The launch is aborted and the error surfaces through
  Vortex's standard error dialog. The hook rejects with
  `util.ProcessCanceled` (api.d.ts line 7691; re-exported via the `util`
  namespace at line 9376), the semantically correct "the launch was canceled
  because of a known precondition" signal.
- Discovered game path: `selectors.discoveryByGame` is a
  `ParametricSelector<IState, string, IDiscoveryResult>` (api.d.ts line 1027);
  `IDiscoveryResult.path?: string` (api.d.ts line 2827) holds the discovered
  install directory.
- Notification: `api.sendNotification?: (notification: INotification) =>
  string` (api.d.ts line 3129). `INotification.type` is one of `activity`,
  `global`, `success`, `info`, `error` (api.d.ts lines 5541-5558); the soft
  warning uses `info` so it does not block.

Tool identity: Vortex 2.3 has no separate `context.registerTool` method.
Supported tools are declared per-game via `IGame.supportedTools: ITool[]`
(api.d.ts line 4214). `ITool` (api.d.ts lines 6824-6955) carries `id`, `name`,
`shortName`, `queryPath`, `executable`, `requiredFiles`, `parameters`,
`environment`, `relative`, `shell`, `exclusive`, `detach`, `defaultPrimary`,
and `onStart`.

`context.registerToolVariables: (callback: ToolParameterCB) => void` (api.d.ts
line 3889) registers a single callback. `ToolParameterCB = (options:
IRunParameters) => { [key: string]: string }` (api.d.ts line 8974). Vortex
invokes the callback at launch time, after start hooks have run but before
argument-token expansion; the returned object is merged with other callbacks'
results and substituted into each parameter token via `string-template`
formatting (`ExtensionManager.ts` lines around 2320-2324 in v2.3.0).

The hook filters by Relay's executable path (the only tool identity available
on the call object). If the launch is not for Relay, the hook returns the call
unchanged.

For Relay launches, the hook runs hard checks (reject on failure) and at most
one soft warning (never blocks).

**Hard checks (reject on failure):**

1. Confirms the active profile belongs to this game.
2. Confirms `mod_relay.exe` exists in the bundled Relay directory. Relay's
   internal runtime layout is Relay's responsibility; the extension verifies
   only the launcher binary it actually invokes, and any further runtime
   failure is surfaced by Relay at launch.
3. Confirms the discovered Darktide binary exists.
4. Regenerates `mods.lst` via the projection orchestrator and validates the
   result against deployed state:
   - every enabled mod's deployed `<name>/<name>.mod` exists on disk;
   - the projected list matches what `util.sortMods` produces from current
     mod state (the deploy and profile-change handlers may have written an
     earlier version; the start hook re-runs the projection so a stale
     `mods.lst` cannot reach Relay);
   - no duplicate `relayModName` values in the projected list
     (case-insensitive);
   - no `relayModName` contains path separators or traversal components; and
   - every listed canonical name passed the installer's safe-name validation.

**Soft warning (warn-once-per-install):** if at least one non-DMF mod is
enabled and (DMF is not enabled or DMF is not the first name in the projected
`mods.lst` content), and the persisted warn-flag file does not exist, the
hook surfaces a non-blocking notification via the Vortex API and writes the
flag file.

Flag file path: `<modRoot>/.dmf-warning-state.json`.
Flag file contents: `{ "version": 1, "warnedAt": "<ISO 8601 timestamp>" }`.

Once written, the warning never re-fires on this Vortex install, regardless of
subsequent state changes (DMF later removed, mods added or removed, profile
switched, Vortex restarted). The first release does not expose a reset action.
Deleting the file manually re-arms the warning.

**Outcome:** returns the call if all hard checks pass, or rejects with an
actionable Vortex error identifying which check failed. Soft warnings never
block. Each hard check produces a distinct message so the user can act on it.

### User-facing actions

Four user-facing capabilities are exposed for Darktide. Two are Vortex
built-ins, configured indirectly through the game and tool registrations
rather than via `context.registerAction`; Vortex surfaces them on the
managed-game dashboard toolbar and on the Games tab Darktide tile. The other
two are custom actions the extension registers on the `game-managed-buttons`
action group; they render only on the Games tab Darktide tile, in the Open
submenu behind the tile's vertical "..." kebab button, alongside Vortex's
built-in Open Game Folder and Open Mod Folder actions. They do not appear on
the active-game dashboard, whose toolbar is a hardcoded Vortex component no
`registerAction` group can extend.

- **Launch modded with Mod Relay**: Vortex's built-in primary-tool launch. The
  Relay tool is registered with `defaultPrimary: true`, so Vortex's standard
  Play action launches Relay.
- **Open Relay mod directory**: Vortex's built-in "Open Mod Folder" action.
  `game.getModPaths` returns `{ '': paths.modsContentDir(...) }`, so the
  built-in action opens `modsContentDir`, the directory that holds the
  deployed `<name>/<name>.mod` trees and `mods.lst`. This is deliberate over
  `deployDir` (Relay's `--mod-path` target), which contains only the `mods/`
  child and is not what the user means by "the mod folder."
- **Open Relay log directory**: a custom action that opens `paths.relayDir()`
  via `util.opn` (the bundled Relay runtime directory where `relay.log` is
  written beside the launcher).
- **Open Darktide console-log directory**: a custom action that opens
  `%APPDATA%\Fatshark\Darktide\console_logs\` via `util.opn` when it exists.
  When Darktide has not yet generated console logs (the directory is missing),
  the action surfaces a non-blocking `info` notification instead of opening
  Explorer on a nonexistent path.

Steam launch remains vanilla. Relay's C log and Darktide's Lua, DMF, and mod
output are separate logs.

## Distribution

GitHub release. No Nexus or Vortex manifest submission is required for the
extension to work or to be publicly released.

Release archive layout (files at the archive root, no enclosing wrapper
directory):

```text
info.json
gameart.png
index.js
relay/
  mod_relay.exe             the only Relay file the extension names
  <other Relay runtime files, shipped verbatim>
```

`info.json` carries mandatory name, author, SemVer version, and description,
plus a stable `id` (the extension's machine identity). Vortex derives the
install directory from `id` and recognizes prior installs by it, so a new
release replaces the old one cleanly without an uninstall first.
`gameart.png` is 640 x 360, PNG, no more than 1 MB, no title text. Vortex
loads built JavaScript; TypeScript source compiles to `index.js`. The Vortex
2.3 runtime resolves both `vortex-api` and `@nexusmods/vortex-api`; new code
uses the scoped package. Own runtime dependencies bundle into `index.js`;
Vortex/Electron/Node-provided modules and the Vortex API remain external.

Relay is not version-pinned: each build of the extension fetches the newest
non-draft release (pre-release inclusive). Relay ships its own complete,
legally-compliant runtime (GPL-3.0 `LICENSE` and `THIRD_PARTY_NOTICES.md`
travel inside the release zip), and the extension redistributes whatever Relay
ships verbatim; the only file the extension gates on is `mod_relay.exe`.

Installation is by drag-dropping the release archive onto Vortex (or manual
extraction into `%APPDATA%\Vortex\Plugins`) followed by a Vortex restart.
Because the manifest carries a stable `id`, installing a new version over an
old one replaces it in place; no uninstall is required. The build commands
and release workflow are documented in [`../development.md`](../development.md).
