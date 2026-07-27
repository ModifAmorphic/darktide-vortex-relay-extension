# Darktide mod layout and Mod Relay integration contract

> **Status:** Reference derived from Mod Relay's public architecture,
> launcher documentation, and loader source. It describes what a caller such as
> Vortex must provide. It does not prescribe where Vortex stores mods.

## 1. The key boundary

Relay is directory-agnostic. It does not install, discover, choose, create, or
own the user's mod directory.

The caller passes any stable, writable parent directory through:

```text
mod_relay.exe --game-binary <Darktide.exe> --mod-path <mod-directory>
```

That directory must contain a `mods/` subdirectory holding the load-order file
and the deployed mod trees:

```text
<mod-directory>/
  mods/
    mods.lst
    <listed-name>/
      <listed-name>.mod
      ...
```

In other words, `--mod-path` points at the parent of the `mods/` content
directory; the launcher looks for `<mod-path>/mods/mods.lst` and
`<mod-path>/mods/<listed-name>/`. (The Mod Relay README phrases this as
`--mod-path "C:\Path\To\mods"`, but the value it means is the parent folder
that contains the `mods/` subfolder.)

Locating it under Vortex user data, beside a game, or elsewhere is a Vortex
extension design decision. The only Relay concern is receiving the same path in
`--mod-path` and finding a valid list/layout beneath `<mod-path>/mods/`.

## 2. Relay's two independent directories

Do not collapse the runtime and user mod directories.

### Runtime directory — Relay-controlled

A distributable Relay runtime contains:

```text
<runtime-directory>/
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

The launcher expects `relay_shell.dll` beside itself. The injected shell
self-locates `mod_loader/` beside the DLL and publishes that internal path as
`MOD_LOADER_DIR`. There is no launcher flag or environment variable for a
different loader directory.

### User mod directory — caller-controlled

`--mod-path`/`RELAY_MOD_PATH` selects the parent directory whose `mods/`
subdirectory contains `mods.lst`, DMF (if used), and user mods. Relay's
mod-facing file API is rooted at `<mod-path>/mods/`.

This split allows the Relay runtime to update independently of DMF/user mods.

**Derived consequence for a bundled Vortex extension:** preserve the Relay
runtime tree as one versioned unit, but pass the Vortex deployment directory as
the separate `--mod-path` value.

## 3. Launcher CLI contract

Relay resolves configuration with this precedence:

```text
flag > environment variable > default
```

| Flag | Environment | Default/meaning |
| --- | --- | --- |
| `--game-binary <path>` | `RELAY_GAME_BINARY` | Required |
| `--mod-path <path>` | `RELAY_MOD_PATH` | Optional; no configured mods if absent |
| `--log-file <path>` | `RELAY_LOG_FILE` | `<launcher-directory>\relay.log` |
| `--log-level <level>` | `RELAY_LOG_LEVEL` | `info`; accepts `error`, `warn`, `info`, `debug`, `trace` |
| `--steam-app-id <id>` | `RELAY_STEAM_APP_ID` | Darktide `1361210` |
| `--version` | — | Prints `mod_relay <version>` and exits successfully |
| `--` | — | Ends Relay options; remaining tokens go to Darktide |

The Vortex extension uses flags exclusively; no environment serialization
is required. The `RELAY_*` names above match this extension's Vortex tool
variable placeholders (`RELAY_GAME_BINARY`, `RELAY_MOD_PATH`); the other
env vars are documented for completeness even though the extension does
not set them.

### Argument tokenization

Every token after Relay's bare `--` is forwarded to Darktide in order. Relay
renders the game command line with MSVC CRT quoting. The separator itself is not
forwarded.

Relay currently uses `CreateProcessA`, so paths/arguments are limited by the
active Windows code page. Darktide's known game arguments are ASCII. The total
child command line is capped at 32,767 characters including the NUL.

No forwarded game arguments are required for Relay's normal Darktide launch.
If a caller later forwards relative values such as `--bundle-dir ../bundle`, it
must validate the child working-directory interpretation rather than assuming
the value is relative to `Darktide.exe`.

### Process lifecycle

Relay:

1. creates Darktide suspended;
2. injects `relay_shell.dll`;
3. waits for the shell's hook-ready event;
4. resumes the game's main thread; and
5. exits after successful handoff.

The short launcher lifetime is relevant to Vortex's running-tool UI and must be
validated live.

## 4. `mods.lst` contract

`mods.lst` is authoritative. Relay loads exactly the listed folder names in
order and does not inject implicit entries.

Example:

```text
dmf
scoreboard
numeric_ui
```

The list reader:

- trims surrounding whitespace;
- skips blank lines;
- skips lines whose first non-whitespace characters are `--`; and
- preserves the order of every remaining name.

Missing or unreadable `mods.lst` produces an empty mod set and a clear loader
log rather than a game crash. An empty file intentionally loads no mods.

### Disabled entries

Because `--` comment lines are ignored, this is a representable disabled entry:

```text
-- scoreboard
```

Whether the Vortex extension uses comments or excludes profile-disabled mods
entirely is an extension design decision. Profile disablement also controls
deployment, so exclusion is likely simpler.

### Safe names

Relay constructs a file path directly from each list entry:

```text
<name>/<name>.mod
```

The extension should therefore accept only a single safe path component:

- not empty;
- not `.` or `..`;
- no `/` or `\`;
- no absolute/rooted value; and
- unique case-insensitively on Windows.

Relay itself treats `mods.lst` as trusted caller input. The Vortex adapter is
the correct boundary at which to reject unsafe archive-derived names.

## 5. Darktide mod folder and entry shape

For a list entry `example`, Relay executes:

```text
example/example.mod
```

The containing directory and `.mod` basename must therefore agree with the
`mods.lst` name.

A minimal deployed shape is:

```text
<mod-directory>/
  mods/
    example/
      example.mod
      scripts/
        mods/
          example/
            ...
```

The files below the mod directory are mod-defined; the Vortex extension should
preserve the entire subtree rooted at the canonical `.mod` entry rather than
trying to understand scripts/assets individually.

### `.mod` runtime contract

Relay evaluates the `.mod` file and expects it to return a table containing a
`run` function.

At load time:

- an unreadable/missing `.mod` is logged and skipped;
- a return value without a `run` function is logged and skipped;
- an exception from `run` is isolated to that mod; and
- a successful `run` may either return an object for Relay's outer lifecycle or
  return `nil` after registering itself with DMF.

The Vortex installer does not need to parse Lua or validate this runtime table.
It only needs structural validation and faithful file placement; runtime
failure belongs in the Darktide console log.

## 6. Archive normalization implications

Nexus archives are not guaranteed to put the canonical mod directory at the
archive root. Representative shapes include:

```text
example.mod
scripts/...
```

```text
example/
  example.mod
  scripts/...
```

```text
release-wrapper/
  example/
    example.mod
    scripts/...
```

The installed/deployed result must always normalize to:

```text
example/example.mod
example/<preserved siblings and descendants>
```

**Derived installer algorithm:**

1. Find `.mod` candidates.
2. Derive the basename without `.mod`.
3. Determine the subtree that belongs to that entry.
4. Strip only wrapper ancestors above the canonical subtree.
5. Prefix staged destinations with the derived name when the archive itself
   does not already supply that canonical directory.
6. Preserve all files in the selected subtree.
7. Reject multiple unrelated roots instead of choosing the first candidate.

Archive fixtures from real popular mods are needed to settle edge cases such as
documentation alongside the canonical subtree and packages containing optional
variants.

## 7. DMF semantics

Darktide Mod Framework (DMF) is a normal mod from Relay's point of view. Relay
does not download it, inject it, or automatically put it first.

If DMF is used, the expected shape is:

```text
<mod-directory>/
  mods/
    dmf/
      dmf.mod
      ...
```

and `mods.lst` must list `dmf` before DMF-dependent mods.

DMF's `.mod` runs for side effects and registers the framework; returning no
outer object is a successful “DMF-driven” load, not an error.

**Important boundary:** Relay itself does not know which arbitrary user mods
require DMF. Requiring DMF globally, inferring dependencies, or merely warning
when it is absent are Vortex-extension policy decisions.

## 8. Load order versus Vortex identities

There are at least four names in play:

| Identity | Owner | Example |
| --- | --- | --- |
| Nexus mod/file metadata | Nexus | display title and numeric IDs |
| Vortex mod ID | Vortex | installation/profile key |
| Archive filename | uploader/download | `example-v1.2.zip` |
| Darktide folder/list name | Darktide mod package | `example` |

Only the last belongs in `mods.lst`.

**Derived consequence:** the custom installer should persist the canonical
Darktide folder name as an extension-owned Vortex mod attribute. Load-order
entries should retain the Vortex `modId` for profile/collection behavior while
carrying the canonical folder name separately for `mods.lst` projection.

## 9. Runtime failure and reload behavior

Relay loads mods in list order and isolates per-mod load/update/lifecycle
exceptions. A failed mod is skipped rather than aborting every later entry.

Developer-mode hot reload rereads the same `mods.lst`, so file/order changes can
be picked up without restarting when DMF developer mode is enabled. Reload is
best effort, not transactional; an error after teardown may require restarting
the game.

The Vortex extension does not need a live-patching or in-process reload API. It
only owns the on-disk directory and list supplied to Relay.

## 10. Logging contract

Relay and Lua/mod output go to different logs.

### `relay.log`

Contains launcher/shell/trampoline lines. Default location is beside the Relay
launcher unless overridden. The trampoline's one-line `OK`/`FAIL` is the
reliable injection/bootstrap check.

### Darktide console log

Contains:

- `[mod_loader]` Lua output;
- DMF output; and
- user mod output.

Windows location:

```text
%APPDATA%\Fatshark\Darktide\console_logs\console-*.log
```

**Derived diagnostic rule:** “Relay started correctly” and “mods loaded
correctly” are separate checks. A Vortex troubleshooting action should expose
both locations and explain the split.

## 11. Runtime bundle and legal files

Every distributed Relay runtime bundle must include:

- Relay's GPL-3.0 `LICENSE`; and
- `THIRD_PARTY_NOTICES.md` for statically linked MinHook and Capstone
  dependencies.

If the extension archive embeds Relay, preserve those files beside the runtime
artifacts. Do not reconstruct a partial runtime by copying only the EXE/DLL.

Bundling fixes the Relay runtime at extension build time: each build
fetches the latest Relay release (pre-release inclusive) and ships it as
an opaque unit. The extension is NOT version-pinned to a specific Relay
release. Provenance for diagnostics is available via
`mod_relay.exe --version`.

## 12. Responsibilities matrix

| Concern | Vortex extension | Relay |
| --- | --- | --- |
| Download from Nexus | Owns/uses Vortex core | No |
| Archive normalization | Owns | No |
| Installation/staging | Owns/uses Vortex core | No |
| Profile enablement | Owns/uses Vortex core | No |
| Load-order UI | Owns/uses Vortex core | No |
| Generate `mods.lst` | Owns | Reads only |
| Choose mod directory | Owns/caller choice | Receives path |
| Start Darktide suspended | No | Owns |
| DLL injection and hook readiness | No | Owns |
| Load `.mod` files | No | Owns |
| DMF/mod runtime lifecycle | No | Owns/coordinates |
| Dependency solving | Optional future policy | No |
| Game-directory patching | Must not do | Does not do |

## 13. Inputs still needed before specification

Relay leaves these policies to the extension:

1. the default/user-configurable mod-directory location;
2. bundled Relay runtime versus a separately installed dependency;
3. how a bundled Relay version is pinned and updated;
4. whether DMF is required, recommended, or inferred per mod;
5. whether profile-disabled mods are omitted from `mods.lst` or emitted as
   comments;
6. whether any Darktide arguments are forwarded after Relay's `--`; and
7. what archive layouts the first release promises to normalize.

The extension spec should make these choices explicitly; none is hidden inside
Relay.

## 14. Source index

- Relay user README:
  <https://github.com/ModifAmorphic/darktide-mod-relay/blob/main/README.md>
- Relay architecture and launcher contract:
  <https://github.com/ModifAmorphic/darktide-mod-relay/blob/main/docs/architecture/MOD-RELAY.md>
- Relay mod loader/DMF contract:
  <https://github.com/ModifAmorphic/darktide-mod-relay/blob/main/docs/architecture/MOD_LOADER-DMF.md>
- Relay list parsing and file behavior:
  <https://github.com/ModifAmorphic/darktide-mod-relay/blob/main/src/mod_loader/file.lua>
- Relay scan/load behavior and exact `<name>/<name>.mod` path:
  <https://github.com/ModifAmorphic/darktide-mod-relay/blob/main/src/mod_loader/mod_manager.lua>
- Relay build outputs/legal invariant:
  <https://github.com/ModifAmorphic/darktide-mod-relay/blob/main/src/README.md>
