# Vortex 2.3 game-extension development reference

> **Status:** Version-grounded reference for this project. It records what the
> Vortex 2.3 documentation and source establish, plus the design consequences
> relevant to Darktide and Mod Relay. It is not an implementation spec.

## 1. Source hierarchy and version grounding

Use this evidence order when sources disagree:

1. Vortex `v2.3.0` source and generated API types.
2. `@nexusmods/vortex-api` `2.3.0-beta.1` package/types.
3. Current focused Vortex Wiki pages (packaging, testing).
4. Migrated `MODDINGWIKI-*` and `LEGACY-*` pages only as examples.

The Vortex Wiki home warns that migrated documentation may be outdated. Several
examples still import the old unscoped `vortex-api` package even though the
repository migration banner says new work should use
`@nexusmods/vortex-api`. Treat the exact 2.3 source/types as authoritative for
signatures and runtime behavior.

### Baseline inventory

| Component | Version | Ground truth |
| --- | --- | --- |
| Vortex | `2.3.0` | Git tag `v2.3.0`, commit `a5a9583` |
| Extension API | `2.3.0-beta.1` | npm `@nexusmods/vortex-api` |
| Vortex build runtime | Node `24.15.0`, pnpm `11.5.1` | Vortex 2.3 root `package.json` |
| Supported host for this project | Windows | Vortex 2.3 release publishes a Windows installer |

Node/pnpm versions above describe Vortex's own build. A third-party extension
does not automatically have to clone that toolchain, but matching the API line
and producing Vortex-compatible CommonJS output is important.

## 2. Extension package versus source repository

The source repository may use TypeScript, tests, fixtures, a bundler, and
release scripts. Vortex consumes a much smaller built extension archive.

### Required archive root

The package guide requires these files at the archive root, with no single
wrapper directory above them:

```text
info.json
gameart.png
index.js
<optional assets and subdirectories>
```

Additional assets and libraries may be in subdirectories. That permits a
bundled Relay runtime directory if this project chooses that distribution
model.

### `info.json`

All four fields are documented as mandatory:

```json
{
  "name": "Game: Warhammer 40,000: Darktide",
  "author": "ModifAmorphic",
  "version": "0.1.0",
  "description": "Darktide support for Vortex through Mod Relay"
}
```

- Use SemVer.
- Versions below `1.0.0` appear as beta in Vortex.
- Keep the display name stable; do not put the version in the name.

### `gameart.png`

Current packaging requirements:

- PNG;
- 640 × 360 pixels;
- no more than 1 MB;
- landscape 16:9;
- visible on a dark background; and
- no title text, because Vortex overlays the game name.

The package guide's example tree accidentally says `gameart.jpg`; its prose and
specification table say `gameart.png`. Use PNG.

### `index.js` entry

Vortex loads JavaScript and passes an `IExtensionContext` to the extension's
entry function. Supported export styles are a default function or named
`init`; established examples compile to CommonJS and export `default`.

Source may be TypeScript, but the archive needs built `index.js`, not raw
TypeScript.

## 3. Development dependency and bundling model

### Current API package

The old `Nexus-Mods/vortex-api` repository is archived. New development should
depend on the scoped package:

```text
@nexusmods/vortex-api@2.3.0-beta.1
```

Its migration guide recommends imports conceptually equivalent to:

```ts
import { fs, selectors, types, util } from "@nexusmods/vortex-api";
```

Many snippets in the migrated guide still spell the runtime module
`vortex-api`; that is legacy documentation, not a reason to select the archived
package.

The npm package provides the generated types rather than a standalone runtime
implementation. Vortex 2.3's extension `require` wrapper explicitly intercepts
both `vortex-api` and `@nexusmods/vortex-api` and returns the host application's
API proxy. The scoped name is therefore supported by the exact target runtime,
not merely by the type package.

### Bundling consequence

The Vortex API package declares Vortex-provided runtime packages as peers. The
extension should:

- bundle its own runtime dependencies into `index.js`;
- leave Vortex/Electron/Node-provided modules external;
- leave `@nexusmods/vortex-api` external so Vortex supplies its API proxy;
- emit CommonJS for a Node platform; and
- include source maps only if the packaging/release policy wants them.

Webpack remains supported. The migration guide also supplies a Rolldown example
with `src/index.ts` → `dist/index.js`, `format: "cjs"`, and Node/platform
externals. pnpm is recommended but not required.

**Open tooling decision:** choose the package manager and bundler during the
implementation spec. Whichever bundler is chosen must preserve the scoped API
import as an external CommonJS require; smoke-test that built output in
production Vortex 2.3.

## 4. Initialization phases

Register static extension capabilities in the entry function:

- game registration;
- installers;
- load-order support;
- tool variables;
- start hooks; and
- any settings/actions.

Register long-lived event handlers in `context.once(...)`. The API event guide
says this runs after all extensions have loaded and avoids initialization-order
assumptions.

Do not perform game-specific file I/O merely because the extension module was
loaded. Use the game's `setup` callback or lifecycle events so a non-active game
does not receive side effects.

## 5. Registering Darktide

`context.registerGame(game)` takes `IGame`, which extends `ITool`.

### Required core fields

The API guide identifies these as the minimal registration:

- `id` — Vortex's internal game ID;
- `name` — display name;
- `executable(discoveredPath?)` — path relative to the discovered game root;
- `requiredFiles` — relative paths that validate the discovered root; and
- `queryModPath(gamePath)` — deployment destination, relative or absolute.

Discovery metadata and visual fields are optional in the type but necessary for
a useful extension.

### Grounded Darktide values

| Item | Value |
| --- | --- |
| Nexus domain | `warhammer40kdarktide` |
| Steam app ID | `1361210` |
| Game executable | `binaries/Darktide.exe` relative to install root |
| Additional identifying file | `launcher/Launcher.exe` |

Use enough `requiredFiles` to reject a false-positive directory without making
discovery unnecessarily expensive.

### Store discovery

Vortex 2.3 supports `queryArgs` as the concise discovery form. Each store value
may be:

- a string app ID;
- one `{ id?, name?, prefer? }` object; or
- an array of those objects.

For Steam Darktide, the relevant query is the string ID or
`{ steam: { id: "1361210" } }`. The outer key is the store id (the type is
`{ [storeId: string]: IQueryArgEntry }`); a bare `{ id: "1361210" }` would
typecheck via the index signature but never match a real store.
Manual `queryPath` via `GameStoreHelper.findByAppId` also exists, but
`queryArgs` is the newer declarative surface.

### Nexus download association

`details.nexusPageId` decouples the internal Vortex game ID from the Nexus URL
slug. Vortex 2.3's Nexus conversion code uses it in both directions and for NXM
link resolution.

**Derived consequence:** a greenfield internal ID does not have to equal
`warhammer40kdarktide`; setting
`details.nexusPageId: "warhammer40kdarktide"` is the explicit association that
allows Darktide Nexus links/download metadata to map to the registration.

This must still be tested with an actual “Download with manager” NXM link,
because multiple active registrations for one Nexus domain are ambiguous.

### Steam metadata and environment

The API examples distinguish:

- `environment.SteamAppId` — a string used when directly starting a Steam game;
- `details.steamAppId` — numeric metadata used by integrations.

Relay publishes `SteamAppId` and `SteamGameId` into its child itself, so the
extension's direct game registration and the Relay supported-tool registration
have separate environment responsibilities. Do not assume the game
registration's environment automatically reaches a separately registered tool.

## 6. Deployment path semantics

### Relative and dynamically absolute paths

`queryModPath(gamePath)` may return:

- a relative path, which Vortex resolves against the discovered game root; or
- an absolute path, which Vortex uses directly.

The testing guide warns against absolute paths because machine-specific
literals such as `C:\games\...` do not work for other users. This does **not**
contradict the API's absolute-path support. A dynamically resolved absolute path
from `util.getVortexPath("userData")`, Documents, or another system API is
portable; a hard-coded user's path is not.

Built-in Vortex extensions use dynamically resolved absolute application-data
and Documents paths.

### Directory creation

Vortex does not create a `queryModPath` target merely because it was declared.
Use the game's `setup(discovery)` callback and
`fs.ensureDirWritableAsync(...)`. Setup runs before game-mode activation and a
failure prevents the game from being managed.

### Staging versus deployment

Do not conflate:

- the Vortex **staging/install path**, where each installed mod has its source
  copy; and
- `queryModPath`, the **deployment target** into which enabled profile files are
  linked/moved by the selected deployment method.

Vortex's settings UI recommends a staging location on the same volume as the
actual deployment target. Split-volume behavior still needs live testing for
the deployment method selected by a user.

### `mergeMods` is deployment-tree routing

Vortex 2.3 resolves `mergeMods` as follows:

- `true` (also the source default) → every mod deploys at the target root;
- `false` → each mod deploys under its Vortex mod ID; or
- function `(mod) => string` → the function supplies each mod's target
  subdirectory.

This setting does not itself generate a merged patch or combine file contents.
It determines the subdirectory passed to the deployment activator.

**Derived consequence for Darktide:** if installer copy destinations already
start with the canonical Darktide mod folder (`<name>/...`), `mergeMods: true`
places those trees correctly under the common parent. `false` would introduce
an additional Vortex-ID directory and break the expected layout.

Do not register `registerMerge`; it solves a different problem (combining
conflicting structured files) that this extension does not have.

## 7. Custom installer contract

### Registration and priority

```text
registerInstaller(id, priority, testSupported, install)
```

Vortex 2.3 documents these priority boundaries:

- scripted FOMOD installer: priority 20;
- game-specific installers should normally use 21–99;
- generic fallback: priority 100;
- smaller number wins among supported installers.

An installer below 20 would take precedence over FOMOD and should only do so
deliberately.

### Support test

The exact 2.3 type is:

```text
(files, gameId, archivePath?, details?)
  -> PromiseLike<{ supported: boolean; requiredFiles: string[] }>
```

The support test must check `gameId`; otherwise the installer can claim another
game's archive. `files` are archive-relative entries, including directory
entries.

### Install function

The exact 2.3 type receives:

```text
files,
destinationPath,
gameId,
progressDelegate,
choices?,
unattended?,
archivePath?,
options?
```

and returns `{ instructions }`.

Relevant instruction forms:

| Type | Relevant fields | Use here |
| --- | --- | --- |
| `copy` | `source`, `destination` | Stage archive files at normalized paths |
| `mkdir` | `destination`/`path` | Explicit empty directory, rarely needed |
| `attribute` | `key`, `value` | Persist canonical Darktide folder name |
| `setmodtype` | `value` | Only if a custom deployment root/type is introduced |
| `error` / `unsupported` | message data | Reject a recognized but invalid layout |
| `rule` | dependency rule | Optional future dependency metadata |

Custom attributes are persisted on `IMod.attributes`; the type permits
extension-owned keys.

### Darktide archive normalization outcome

The loader contract (documented separately) means the installer needs to derive
one canonical `name` and stage:

```text
<name>/<name>.mod
<name>/<all sibling/descendant mod files>
```

The archive may contain wrapper directories above this subtree. The support
test and install plan should therefore reason from the `.mod` entry path rather
than the archive root.

The installer should reject rather than guess when:

- there is no `.mod` entry;
- `.mod` basename and containing folder disagree in a way normalization cannot
  resolve;
- multiple unrelated `.mod` roots exist; or
- the derived name is empty, absolute, `.`/`..`, or contains a separator.

Store the derived folder name in an attribute such as `relayModName`. A Vortex
mod ID, Nexus mod title, archive filename, and Darktide folder name are distinct
identities and must not be substituted for one another.

## 8. Profile state

Vortex stores installed mods by game, while enablement is profile-specific:

```text
state.persistent.mods[gameId][modId]
state.persistent.profiles[profileId].modState[modId].enabled
```

An `IProfile` has `id`, `gameId`, `name`, `modState`, and activation metadata.
The extension should use public selectors such as `activeProfile` and
`profileById` rather than reaching through state paths where a selector exists.

**Derived consequence:** “installed” is not equivalent to “enabled for the
active profile,” and neither is equivalent to “currently deployed.” Load-order
generation must choose the correct set deliberately.

## 9. File-based load order

Use `registerLoadOrder`, not deprecated `registerLoadOrderPage`.

### Entry shape

Each load-order entry requires:

- `id` — arbitrary unique load-order identity;
- `enabled` — load-order-level enabled state;
- `name` — display name;
- `modId` — Vortex mod ID when managed by Vortex; and
- optional `locked` and extension-owned `data`.

Setting `modId` is important for collections and update behavior. Do not use the
Darktide folder name as `modId`; retain it separately in `data` or the mod
attribute.

### Registration callbacks

`registerLoadOrder` takes:

- `gameId`;
- `serializeLoadOrder(current, previous)`;
- `deserializeLoadOrder()`;
- `validate(previous, current)`;
- optional `toggleableEntries` (default true);
- optional `clearStateOnPurge` (default true);
- optional instructions/renderer/condition; and
- optional collections behavior.

Validation succeeds when it returns no invalid entries (established examples
return `undefined` despite the stricter generated return type). Invalid entries
carry the entry ID and a user-facing reason.

### When Vortex calls the callbacks

The API contract says deserialization occurs:

- when the load-order page mounts;
- after a game/tool exits;
- on profile change; and
- on deploy/purge.

Serialization occurs after an accepted drag/drop or property change, and only
after validation.

The 2.3 source further shows:

- load-order state is persisted by profile ID;
- `will-purge` snapshots the current order into an update set;
- `did-deploy` deserializes from disk and restores order/update positions; and
- profile changes force a new deserialize into the active profile's state.

### Profile persistence alternatives

The load-order UI stores state per profile, but its disk callbacks are provided
by the game extension. A single shared `mods.lst` can therefore be stale during
a profile transition unless profile synchronization is designed explicitly.

Two grounded options exist:

1. **Vortex profile file:** register `mods.lst` with
   `registerProfileFile(gameId, ...)`; Vortex copies the outgoing file to its
   profile storage and restores the incoming profile's file. Built-in plugin
   management uses this for `plugins.txt` and `loadorder.txt`.
2. **Extension-owned profile file:** store a JSON/order file keyed by profile
   ID, then project the active one to `mods.lst` after deployment and before
   launch.

**Open design decision:** select one during specification after a live event-
ordering probe. The first option is less custom code; the second makes ownership
and atomic projection explicit.

### Enablement model

`toggleableEntries` defaults to true, but Vortex profiles already enable and
disable mods. A second load-order checkbox creates two independent notions of
enabled state.

**Open design decision:** likely set `toggleableEntries: false` and order only
profile-enabled mods, unless there is a demonstrated need to leave a mod
deployed but comment it out of `mods.lst`.

## 10. Deployment events

Vortex supports synchronous events through `api.events` and awaitable events
through `api.onAsync` / `api.emitAndAwait`. Register handlers in
`context.once()`.

Relevant awaitable events:

| Event | Timing |
| --- | --- |
| `will-deploy(profileId, deployment?)` | before deployment begins |
| `did-deploy(profileId, deployment?)` | after deployment completes |
| `will-purge(profileId, lastDeployment?)` | before undeploy begins |
| `did-purge(profileId)` | after purge completes |
| `discover-tools(gameId)` | refresh supported-tool discovery |

Relevant synchronous event: `profile-did-change(profileId)`.

**Derived consequence:** write a runtime `mods.lst` no earlier than
`did-deploy` if it validates deployed files. A pre-launch guard should still
reconcile it because automatic deployment and profile changes create multiple
paths into launch.

## 11. Supported tools and Relay launch

### `ITool` fields

Relevant fields:

- `id`, `name`, optional `shortName`/`logo`;
- `queryPath()` — returns a tool base directory or promise;
- `executable(base?)` — executable relative to that base;
- `requiredFiles`;
- `parameters` — array of argument tokens;
- `environment`;
- `relative` — true means discover under the game directory;
- `shell`;
- `exclusive`;
- `detach`;
- `defaultPrimary`; and
- `onStart`.

For a non-relative tool with `queryPath`, Vortex 2.3 quick discovery constructs:

```text
path.join(queryPathResult, executable(queryPathResult))
```

This supports a Relay runtime bundled under the extension directory or installed
at another known location.

### Static versus launch-time values

`ITool.executable` is evaluated during discovery and should not depend on a
profile value that changes later. `parameters`, however, may contain variables
resolved when the tool starts.

`registerToolVariables(callback)` runs at launch and returns uppercase,
extension-namespaced variables. Vortex applies `string-template` formatting to
each argument token.

Example conceptual parameter array:

```text
["--game-binary", "{RELAY_GAME_BINARY}",
 "--mod-path", "{RELAY_MOD_PATH}"]
```

Keep each flag and value as its own array element. Vortex passes non-shell
arguments as spawn arguments and strips literal quote characters; do not add
shell quotes around a path containing spaces.

### Start-hook order

`registerStartHook(priority, id, hook)` may modify or cancel an executable
launch. In Vortex 2.3 source:

1. start hooks run;
2. launch variables are expanded in argument tokens; and
3. the process is spawned.

A Relay-specific hook can therefore inspect the unresolved call, validate the
active profile/deployment, materialize `mods.lst`, and return the call. It
should filter by Relay executable/tool identity so it does not affect unrelated
tools.

### Working directory and child lifetime

When no tool working directory is supplied, Vortex uses the executable's parent
directory. A bundled Relay therefore starts with the runtime directory as its
working directory. Relay itself accepts absolute game/mod paths, so this is
fine; any future forwarded Darktide argument containing a relative path must be
tested deliberately.

Relay exits after injecting and resuming Darktide. Vortex initially tracks the
launched tool process, not necessarily the child game lifetime.

**Needs live validation:** determine whether Vortex's process monitor separately
detects the registered `Darktide.exe` child. If not, the UI may clear “running”
too early and permit duplicate launches.

## 12. Manual/GitHub distribution

Approval is not needed for a working or publicly distributed extension.

The Vortex testing guide explicitly permits sending the package directly to
testers without uploading it to Nexus. A user can extract the extension to a
folder under:

```text
%APPDATA%\Vortex\Plugins
```

and restart Vortex. Vortex also exposes a manual extension drop area.

For a GitHub release:

- archive files must have `info.json`, `gameart.png`, and `index.js` at their
  root;
- include every non-bundled runtime asset/subdirectory;
- use a SemVer filename/version;
- publish source and the built archive; and
- provide explicit install, update, disable, and uninstall instructions.

Nexus/Vortex manifest review is only a later discoverability and one-click-
installation option.

## 13. Testing guidance carried forward

Vortex's current testing guidance recommends:

- test the most popular mods (an 80/20 coverage strategy), excluding unrelated
  formats such as ReShade/executable installers where appropriate;
- use a clean game installation;
- test on another user's computer;
- create every nonstandard target directory in setup;
- avoid machine-specific paths; and
- tell users clearly about required frameworks/tools.

Project-specific proof coverage should add:

- wrapper/no-wrapper archive layouts;
- ambiguous multiple `.mod` roots;
- spaces and nontrivial characters in all caller-selected paths;
- game and Vortex data on the same and different volumes;
- mod enable/disable/update/remove;
- two profiles with different sets and orders;
- deploy, purge, and launch with a pending deployment;
- manual Steam launch remains unmodified; and
- Vortex process state after Relay exits.

## 14. Inputs still needed before specification

Documentation/source settled feasibility, but not these choices:

1. **Internal game ID:** use the Nexus domain as the ID or a distinct ID plus
   `details.nexusPageId`; prove the selected form with a real NXM link.
2. **Build tooling:** choose Webpack or Rolldown, externalize the scoped API
   name, and smoke-test the minimal compiled extension in production Vortex 2.3.
3. **Mod-directory policy:** choose the dynamically resolved default and whether
   users may configure it. Relay imposes no location.
4. **Profile-file strategy:** Vortex `registerProfileFile` versus extension-owned
   per-profile serialization. Probe switch/deploy callback ordering first.
5. **Load-order enablement:** profile enablement only versus a second
   `toggleableEntries` state.
6. **Installer corpus:** collect representative Nexus archives and classify
   wrapper, variant, documentation, and ambiguous-multiple-root shapes.
7. **Deployment methods:** prove supported methods on same-volume and split-
   volume game/staging/data layouts.
8. **Relay process tracking:** observe Vortex after the launcher exits and the
   Darktide child remains running.

These are targeted spike outcomes, not reasons to re-research the API.

## 15. Source index

### Version and API

- Vortex 2.3.0 release:
  <https://github.com/Nexus-Mods/Vortex/releases/tag/v2.3.0>
- Vortex 2.3 `package.json`:
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/package.json>
- API package 2.3.0-beta.1:
  <https://registry.npmjs.org/@nexusmods%2fvortex-api/2.3.0-beta.1>
- API migration guide (archived repository, with scoped-package banner):
  <https://github.com/Nexus-Mods/vortex-api/blob/master/docs/MIGRATION.md>

### Package and testing

- Package a game extension:
  <https://github.com/Nexus-Mods/Vortex/wiki/How-to-package-a-game-extension>
- Test a game extension:
  <https://github.com/Nexus-Mods/Vortex/wiki/How-to-test-a-game-extension>
- Migrated game-extension guide (examples; potentially outdated):
  <https://github.com/Nexus-Mods/Vortex/wiki/MODDINGWIKI-Developers-General-Creating-a-game-extension>

### Exact Vortex 2.3 source contracts

- `IGame`:
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/src/renderer/src/types/IGame.ts>
- `ITool`:
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/src/renderer/src/types/ITool.ts>
- `IExtensionContext`:
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/src/renderer/src/types/IExtensionContext.ts>
- Extension runtime API-module resolution (accepts scoped and unscoped names):
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/src/renderer/src/util/extensionRequire.ts>
- Store-query types:
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/src/renderer/src/util/GameStoreHelper.ts>
- Nexus/internal game-ID conversion:
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/src/renderer/src/extensions/nexus_integration/util/convertGameId.ts>
- Installer support and install-result types:
  <https://github.com/Nexus-Mods/Vortex/tree/v2.3.0/src/renderer/src/extensions/mod_management/types>
- Deployment subdirectory (`mergeMods`) resolution:
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/src/renderer/src/extensions/mod_management/util/deploy.ts>
- File-based load-order type and implementation:
  <https://github.com/Nexus-Mods/Vortex/tree/v2.3.0/src/renderer/src/extensions/file_based_loadorder>
- Tool discovery:
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/src/renderer/src/extensions/gamemode_management/util/discovery.ts>
- Tool launch/argument-variable order:
  <https://github.com/Nexus-Mods/Vortex/blob/v2.3.0/src/renderer/src/ExtensionManager.ts>
