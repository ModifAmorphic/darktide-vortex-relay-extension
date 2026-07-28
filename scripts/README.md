# scripts/

Operator-facing dev tooling for the Darktide Relay Vortex extension. Run these
from the repo root on your Windows machine where Vortex and Steam Darktide
are installed.

- `bundle-relay.ts` fetches the latest Mod Relay release into the repo-root
  `relay/` directory. Run once before `package` (and again whenever you want
  to refresh the bundled Relay runtime).
- `package.ts` assembles the distributable Vortex extension archive into
  `dist-package/`. Builds first, then zips. Install the archive into Vortex
  by drag-dropping it onto the Vortex window.
- `package.json` scopes this folder to ESM so Node 24 type-strips the `.ts`
  files directly. The repo root stays CommonJS for the built extension output.

## Install a build into Vortex

Builds install the same way end users install releases: package the archive
and drop it into Vortex. Vortex manages where extensions are stored; these
scripts never write into Vortex's plugin directory directly.

```powershell
pnpm bundle:relay   # once, to populate repo-root relay/
pnpm package        # builds and writes dist-package\<archive>.zip
```

Then drag-drop the produced `.zip` onto the Vortex window. Vortex installs it
over any previous version (the manifest carries a stable `id`, so an update
replaces the old one; no uninstall needed) and prompts you to restart.

### Restart Vortex after each install

Vortex loads extension code at startup. A window reload is not enough; the
Node extension host that serves `require("@nexusmods/vortex-api")` only
re-initializes on a full restart. Close Vortex completely and reopen it when
Vortex prompts.

## Verification checklist

Run these checks after installing the current build. Each is pass/fail. If
anything fails, capture what you saw before reporting back:

- Vortex log at `%APPDATA%\Vortex\vortex.log` (tail the last 100 lines).
- Any error dialog text.
- Filesystem state at the relevant paths.

The checklist accumulates as capabilities land. Each new implementation step
adds its own section below so you can regression-test earlier steps alongside
the new one.

### Step 2: Game registration

Verifies PR #3 (`feat/game-registration`).

1. `pnpm package`, then drop the archive into Vortex and restart when prompted.
2. Manage Darktide in Vortex.

Verify:
- Extension is loaded and enabled in Vortex.
- Darktide is discovered via Steam app ID `1361210`.
- `%APPDATA%\Vortex\warhammer40kdarktide-relay\deploy\` exists.
- `%APPDATA%\Vortex\warhammer40kdarktide-relay\deploy\mods\` exists
  (Relay expects the mod folders and `mods.lst` under here).
- `%APPDATA%\Vortex\warhammer40kdarktide-relay\load-order\` exists.
- Darktide install directory is unchanged (no new files).

The sibling `mods\` directory directly under
`warhammer40kdarktide-relay\` is Vortex's staging folder, distinct from
the extension-owned `deploy\mods\` content directory. Vortex creates
the staging folder, not the extension. If the extension fails to load,
check `%APPDATA%\Vortex\vortex.log`.

### Step 3: Installer

Verifies PR #4 (`feat/mod-installer`).

The installer stages `.mod` archives under Vortex's staging folder in the
canonical layout, and Vortex then deploys them under our deploy directory.
Both live under `%APPDATA%\Vortex\warhammer40kdarktide-relay\`:

- `deploy\mods\<name>\<name>.mod` - deployed tree, written by Vortex's
  deploy step. Relay reads from here (its launcher expects `<mod-path>\mods\`
  to contain the mod folders). This is the authoritative output to check.
- `mods\<installationPath>\<name>\<name>.mod` - staged source tree,
  written by our installer. Vortex's `<installationPath>` is human-readable
  and embeds the mod's display name plus metadata (Nexus mod id, version,
  install timestamp, short id); e.g.
  `Darktide Mod Framework 8 26.06.24 2026-06-24T18-31Z SDWlwDHJj`. Check
  this only when deploy is wrong and you need to isolate whether the
  installer or Vortex's deployment is at fault.

`<name>` is the canonical name: the `.mod` basename and its containing
folder. For `mymod/mymod.mod`, `<name>` is `mymod`.

Setup:
1. Remove all installed Darktide mods from Vortex.
2. Stop managing Darktide, then re-manage it (re-creates `deploy\`,
   `deploy\mods\`, and `load-order\`).
3. `pnpm package`, then drop the archive into Vortex and restart
   when prompted.

A. Canonical-layout archive.
1. Install a mod whose archive layout is `<name>/<name>.mod` plus
   optional sibling files (e.g. `scripts/foo.lua`).
2. After Vortex finishes the install (auto-deploys by default), in
   `deploy\mods\`:
   - `<name>\<name>.mod` exists.
   - Sibling files are preserved under `<name>\`.

B. Wrapper-directory archive.
1. Install an archive whose layout is `<wrapper>/<name>/<name>.mod`
   (the mod subtree nested inside one or more non-canonical directories).
2. Same check as A. The wrapper must be stripped from the deployed path:
   no `<wrapper>\` segment above `<name>\` in `deploy\mods\`.
3. If no real-world wrapper archive is handy, this case is covered by
   unit tests in `test/util/archive.test.ts`.

C. Duplicate canonical name rejected.
1. With one mod installed (canonical name N), install a second archive
   that also derives to canonical name N. Simplest reproducer: re-download
   and install the same mod file under a different archive filename.
2. Expected: install fails with
   `Darktide mod "N" is already installed (Vortex mod id "<id>")`.

D. Unsafe archive rejected.
1. Install an archive with two unrelated `.mod` roots
   (`foo/foo.mod` and `bar/bar.mod`), or whose `.mod` basename disagrees
   with its containing folder (`foo/example.mod`).
2. Expected: install fails with a fatal error naming the specific
   problem (multiple roots, ambiguous basename, unsafe name).

E. No Darktide writes.
- Darktide install directory has no new files at any point during these
  checks.

If a "Download with Manager" click does not arrive in Vortex at all, the
`details.nexusPageId` setting in `src/game.ts` is wrong, or another
Darktide extension is claiming the same Nexus domain.

### Step 4: mods.lst projection

Verifies PR #5 (`feat/mods-lst-projection`).

Ships the pure projection function and atomic write helper. Live
verification that `mods.lst` is actually written during Vortex use is
deferred to step 5, when the `did-deploy`, `profile-did-change`, and
start-hook call sites land. For this step, unit tests are the
verification:

- `pnpm test` passes (covers `src/modsLst.ts` and `src/util/fs.ts`).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build`
  all pass.

### Step 5: Auto DMF rules and sortMods-based mods.lst projection

Verifies the pivot to Vortex's native mod sort.

The installer now auto-emits an `after DMF` rule on every non-DMF mod, and
the `did-deploy` and `profile-did-change` handlers write
`<deployDir>\mods\mods.lst` from the active profile's enabled mods in
Vortex-sorted order. There is no custom load-order page on this branch.

Setup:

1. Remove all installed Darktide mods from Vortex (or stop managing and
   re-manage Darktide to start clean).
2. `pnpm package`, then drop the archive into Vortex and restart
   when prompted.

Both `deploy\` and `load-order\` live under
`%APPDATA%\Vortex\warhammer40kdarktide-relay\`. The relevant outputs:

- `deploy\mods\mods.lst` - the projected load order Relay reads at launch.
  This is the authoritative output to check after each step below.
- Vortex's per-mod `rules` array - visible in each mod's details dialog as
  the auto-emitted `after DMF` dependency entry. (Mod details -> rules tab,
  or whatever Vortex exposes for editing mod rules in the current version.)

`<name>` is the canonical name: the `.mod` basename and its containing
folder. For `mymod/mymod.mod`, `<name>` is `mymod`.

A. Non-DMF mod carries the auto DMF rule.

1. Install a non-DMF mod (any single-mod archive whose canonical name is
   not `dmf`).
2. Open the mod's details in Vortex and inspect its rules.
3. Expected: one `after` rule referencing DMF (Nexus mod id 8). No
   user interaction was required to add it.

B. Deploy writes mods.lst with DMF first.

1. Install DMF.
2. Trigger a deploy (Vortex auto-deploys by default after install).
3. Check `%APPDATA%\Vortex\warhammer40kdarktide-relay\deploy\mods\mods.lst`:
   - The file exists.
   - The first line is `dmf`.
   - The non-DMF mod from step A appears after DMF.

C. Multiple non-DMF mods all sort after DMF.

1. Install a second non-DMF mod.
2. Deploy.
3. Check `deploy\mods\mods.lst`:
   - `dmf` is still the first line.
   - Both non-DMF mods appear after DMF (in whatever order Vortex's
     `util.sortMods` produced; only relative-to-DMF order is asserted
     here, since mod-to-mod order with no rules between them is
     insertion-stable but not guaranteed).

D. Disabling a mod omits it from mods.lst.

1. Disable one of the non-DMF mods in the active profile.
2. Deploy (or let auto-deploy run).
3. Check `deploy\mods\mods.lst`:
   - The disabled mod's canonical name is absent.
   - The still-enabled mods remain, with `dmf` first if DMF is still
     enabled.

E. No Darktide writes.

- Darktide install directory has no new files at any point during these
  checks. Everything the extension writes lives under
  `%APPDATA%\Vortex\warhammer40kdarktide-relay\`.

If a "Download with Manager" click does not arrive in Vortex at all, the
`details.nexusPageId` setting in `src/game.ts` is wrong, or another
Darktide extension is claiming the same Nexus domain.

### Step 6: Relay tool and launch guard

Verifies the Relay supported-tool registration, the launch-time tool
variables, and the start hook that validates state and regenerates
`mods.lst` immediately before launch.

The extension ships the Relay runtime as a directory beside the built
`index.js` (`relay/`). That directory is gitignored and is bundled into the
release archive by `scripts/package.ts`. To populate it, run
`pnpm bundle:relay`, which fetches the latest Mod Relay release and extracts
it verbatim into `repo-root/relay/`. `pnpm package` then includes the
`relay/` tree in the archive, and Vortex installs it beside the built
extension.

Setup:

1. Populate `relay/` in the repo root by running `pnpm bundle:relay`. This
   fetches the latest Relay release and extracts the full runtime tree
   (`mod_relay.exe`, `relay_shell.dll`, `mod_loader/`, `LICENSE`,
   `THIRD_PARTY_NOTICES.md`, and whatever else Relay ships).

   The directory is gitignored; never commit Relay binaries. If `relay/` is
   absent, `pnpm package` fails with a specific error (it gates on
   `relay/mod_relay.exe`); the start hook also blocks launch until you
   populate it.

2. `pnpm package`, then drop the archive into Vortex and restart
   when prompted.

The Relay runtime sits beside the built `index.js` in the extension's
install directory (Vortex-managed; open it via the extension's "Open Relay
log directory" action on the Games tab). The extension resolves this
directory at runtime via `__dirname`.

A. Relay appears as the primary tool in Vortex.

   - In Vortex, with Darktide managed, the Mods page's primary tool
     selector shows "Mod Relay" as the default primary tool.
   - Selecting it shows the resolved command line in the tool details
     (if Vortex exposes it): `mod_relay.exe --game-binary
     <RELAY_GAME_BINARY> --mod-path <RELAY_MOD_PATH>`.

B. Launch attempt without mods: start hook runs, passes all hard
   checks, Relay launches and logs bootstrap OK.

   - With no Darktide mods installed (or all disabled), click the
     primary tool launch button.
    - Expected: Relay starts, Darktide launches modded, and the Relay
      log directory's `relay.log` (open via the "Open Relay log
      directory" action) shows the bootstrap `OK` line from Relay's
      trampoline.
   - Darktide's install directory is unchanged throughout.

C. Launch attempt with missing Relay files: start hook blocks with a
   specific error.

   - Stop Vortex, delete one required file from the install directory's
     `relay/` (for example `relay/LICENSE`), and restart Vortex.
   - Click launch.
   - Expected: launch is blocked with a message listing every missing
      file. Restore the file (or reinstall the extension) to proceed.

D. DMF warning fires once when DMF is absent or misordered, then does
   not re-fire.

   - With at least one non-DMF mod enabled and DMF not enabled (or not
     first in `mods.lst`), launch Relay.
   - Expected: a non-blocking info notification about DMF load order
     fires; `%APPDATA%\Vortex\warhammer40kdarktide-relay\.dmf-warning-state.json`
     is written.
   - Launch a second time.
   - Expected: no notification re-fires. The flag file persists across
     Vortex restarts; deleting it re-arms the warning.

E. `<deployDir>\mods\mods.lst` is regenerated before launch.

   - Delete or hand-edit
     `%APPDATA%\Vortex\warhammer40kdarktide-relay\deploy\mods\mods.lst`,
     then launch Relay.
   - Expected: the start hook re-runs the projection; on launch,
     `mods.lst` reflects the current enabled-mod set in Vortex-sorted
     order (DMF first when enabled).

F. No Darktide install directory writes.

   - Darktide install directory has no new files at any point during
     these checks. Everything the extension writes lives under
      `%APPDATA%\Vortex\warhammer40kdarktide-relay\` (mod state,
      warning flag) or the extension's install directory (the bundled
      runtime and its `relay.log`).

### Step 7: User-facing open-directory actions

Verifies the two custom open-directory actions plus the `getModPaths`
change that enables Vortex's built-in "Open Mod Folder".

Custom actions render on the Games tab Darktide tile, in the Open
submenu behind the tile's vertical "..." kebab button (Games tab, then
the Darktide tile, then "...", then Open). They register on the
`game-managed-buttons` group, the same group that carries Vortex's own
Open Game Folder, Open Mod Folder, Open Nexus Page, Manually Set
Location, and Stop Managing actions. They are gated on the game id, so
they do not appear on other games' tiles.

Setup:

1. `pnpm package`, then drop the archive into Vortex and restart
   when prompted.
2. Manage Darktide if it is not already managed.

A. Two custom actions appear under the Games tab Darktide tile.

   - On the Games tab, click the Darktide tile's vertical "..."
     kebab button, then click Open.
   - "Open Relay log directory" sits alongside Vortex's built-in
     actions (position 200 in the group).
   - "Open Darktide console-log directory" sits next to it
     (position 210).
   - Both icons are the same Material icon Vortex uses for its
     built-in open-folder actions.

B. Open Relay log directory opens the bundled Relay runtime directory.

   - Click the action.
    - Expected: Explorer opens the extension's bundled Relay runtime
      directory, where `relay.log` is written beside the launcher. If
      `relay.log` is present, Relay has run at least once on this install.

C. Open Darktide console-log directory opens the console-log folder when
   it exists.

   - Click the action after Darktide has been launched at least once
     (modded or vanilla).
   - Expected: Explorer opens
     `%APPDATA%\Fatshark\Darktide\console_logs\`, which contains
     `console-*.log` files with `[mod_loader]`, DMF, and user-mod
     output.

D. Open Darktide console-log directory surfaces a notification when
   Darktide has never been launched.

   - On a machine or user profile where Darktide has not generated
     console logs (delete `%APPDATA%\Fatshark\Darktide\console_logs\`
     to reproduce), click the action.
   - Expected: no Explorer window opens; a non-blocking info
     notification appears with the text
     "Darktide has not generated console logs yet. Launch Darktide
     once to create them."

E. Vortex's built-in "Open Mod Folder" opens the deployed-mods
   directory.

   - This is a Vortex built-in action that previously did nothing for
     Darktide; it now works because the game registration defines
     `getModPaths` returning `modsContentDir`.
   - Click Open Game Mods Folder in the active-game dashboard
     toolbar's Open menu.
   - Expected: Explorer opens
     `%APPDATA%\Vortex\warhammer40kdarktide-relay\deploy\mods\`, which
     is where Vortex deploys each mod tree (`<name>\<name>.mod` and
     siblings) and where `mods.lst` is projected.

F. Actions do not render on other games' tiles.

   - Switch to a different game's tile on the Games tab in Vortex.
   - Expected: the two custom actions do not appear. The condition
     `instanceIds[0] === GAME_ID` gates them to the Darktide tile
     only.

G. "Launch modded with Mod Relay" remains Vortex's built-in primary-tool
   launch.

   - The Play button still launches the primary tool (Mod Relay). No
     custom duplicate is registered.

H. No Darktide install directory writes.

   - Darktide install directory has no new files at any point during
      these checks. Everything the actions touch lives under the
      extension's install directory (`relay/`, bundled runtime,
      `relay.log`) or
     `%APPDATA%\Fatshark\Darktide\console_logs\` (Darktide's own
     log directory, which the extension reads but does not create).

If the two custom actions do not appear on the Games tab Darktide tile,
the `ACTION_GROUP` constant in `src/actions.ts` is the one-line fix
point: the value must be `game-managed-buttons` (the API types accept
any string for the group parameter; only Vortex's renderer knows the
valid values).

## Bundle the Mod Relay runtime

Fetch the latest Mod Relay release into the repo-root `relay/` directory.
This is needed before `pnpm package` (so the archive contains a complete
runtime; `package` gates on `relay/mod_relay.exe`).

PowerShell:

```powershell
pnpm bundle:relay
```

The script:

1. Fetches the releases list from the GitHub API (no auth needed for a
   single run; set `GITHUB_TOKEN` in CI to raise the 60/hr limit to
   5000/hr).
2. Selects the newest non-draft release (pre-release inclusive) by
   `published_at`, then selects the asset matching
   `vX.Y.Z-windows-x64.zip`.
3. Downloads the zip and extracts it verbatim into `relay/`, replacing
   any existing directory.
4. Verifies `relay/mod_relay.exe` exists at the target root. The
   extension's only Relay contract is `mod_relay.exe`; it does not
   inspect or enumerate Relay's internal files.

`--out <dir>` overrides the target directory (default `<repo>/relay`).
`pnpm bundle:relay --help` shows the full usage.

### Common errors

- `HTTP 403` from the GitHub API: you are rate-limited. Wait and retry,
  or set `GITHUB_TOKEN`.
- `did not contain mod_relay.exe at the archive root`: the release zip
  layout changed. Inspect the extracted directory and report this.

## Assemble the distributable archive

Build the `.zip` archive that a user drops into Vortex.

PowerShell:

```powershell
pnpm package
```

The script:

1. Runs `pnpm build` first (pass `--no-build` to skip if you already
   built).
2. Stages `info.json`, `gameart.png`, `dist/index.js` (as `index.js`),
   and the `relay/` tree in a temp directory.
3. Zips it so the four entries sit at the archive root with no wrapper
   directory (Vortex rejects archives wrapped in a top-level folder).
4. Reads the zip's central directory to verify the root layout
   (`info.json`, `gameart.png`, `index.js`, `relay/mod_relay.exe`).
5. Cleans the staging dir and prints the output path and size.

Default output:
`<repo>/dist-package/darktide-relay-vortex-extension-<info-version>.zip`.
`--out <path>` overrides the output archive path.
`pnpm package --help` shows the full usage.

### Common errors

- `dist/index.js does not exist`: run `pnpm build` first, or drop
  `--no-build`.
- `relay/mod_relay.exe does not exist`: run `pnpm bundle:relay` first to
  fetch the runtime.
- `Archive root layout verification failed`: a packaging bug. The error
  lists the zip's entries; report it with that list.

### Verify the archive root layout manually

After `pnpm package`, the archive should contain, at the root, with no
wrapper directory:

```text
info.json
gameart.png
index.js
relay/
  mod_relay.exe
  (whatever Relay shipped)
```

To inspect:

```powershell
$zip = "dist-package\darktide-relay-vortex-extension-<version>.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::OpenRead($zip).Entries |
  ForEach-Object { $_.FullName }
```

The first four entries (`info.json`, `gameart.png`, `index.js`,
`relay/...`) must have no directory prefix. A wrapper directory (e.g.
`my-extension/info.json`) means Vortex will reject the archive.

## Release pipeline

Push to `main` triggers release-please, which opens a release PR proposing
the next version from the conventional commits since the last release.
Merging that release PR cuts the tag and GitHub release, and the release
workflow then runs `bundle:relay` and `package` in CI and uploads the
archive to the release. A release ships only when you merge the release
PR; feature PR merges do not release. Add a `Release-As: X.Y.Z` footer to
a merge commit only if you want to override the version release-please
computed.

Releases are marked as pre-release until Mod Relay ships 1.0.0 stable
(`prerelease: true` in `.release-please-config.json`). Flip that flag off
when the extension is ready for a stable release.
