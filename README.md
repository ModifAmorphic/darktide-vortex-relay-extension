# darktide-vortex-relay-extension

An unofficial Vortex extension for Warhammer 40,000: Darktide.

## Status

v0.1.0 is the first public release, available on the
[GitHub Releases](https://github.com/ModifAmorphic/darktide-vortex-relay-extension/releases)
page.

The release covers the full Darktide mod lifecycle through Mod Relay:
Darktide game registration, the `.mod` archive installer (with auto DMF
dependency rules), `mods.lst` projection from Vortex's built-in mod sort,
the Mod Relay tool registration with launch-time variable resolution,
user-facing open-directory actions, and Relay
bundling plus the release-archive pipeline.

## Install

The extension is distributed through GitHub Releases (it is not on Nexus),
so installation is manual.

1. Download the latest release archive (`.zip`) from the
   [Releases](https://github.com/ModifAmorphic/darktide-vortex-relay-extension/releases)
   page. The v0.1.0 asset is
   `darktide-relay-vortex-extension-0.1.0.zip`.
2. Extract the archive so its contents (`info.json`, `gameart.png`,
   `index.js`, and the `relay/` directory) sit directly under
   `%APPDATA%\Vortex\Plugins`. Do not nest them inside an extra
   subfolder; Vortex only loads extensions whose files are immediate
   children of a plugins directory. `%APPDATA%` is typically
   `C:\Users\<you>\AppData\Roaming`.
3. Restart Vortex.
4. In Vortex, manage Darktide and let it discover your Steam install.

To update, install the new release archive over the old one (drag-drop it
onto Vortex again). The previous version is replaced in place; you do not
need to uninstall first.

## Launch options

Mod Relay supports optional launch flags (`--lua-logs`, `--skip-splash`, and
forwarded game arguments after `--`). The extension does not add a custom UI
for these; you set them through Vortex's built-in tool editor, the same way
you would for any Vortex tool.

To edit Mod Relay's command line:

1. Select **Warhammer 40,000: Darktide** from the left nav.
2. Click **Tools**.
3. Open the vertical **...** menu on the **Mod Relay** row and click
   **Edit**.
4. In the **Command Line** field, add the flags you want, keeping the
   existing `--game-binary {RELAY_GAME_BINARY} --mod-path {RELAY_MOD_PATH}`
   tokens. Relay needs those to locate Darktide and your mod directory;
   removing them breaks launch.
5. Click **Save**.

The `{RELAY_GAME_BINARY}` and `{RELAY_MOD_PATH}` placeholders are resolved
by the extension at launch; leave them as-is.

Relay flags (see the Mod Relay documentation for the full list):

- `--lua-logs`: copy Lua `print` output into `relay.log` (a tee; Darktide's
  console log is unaffected).
- `--skip-splash`: skip Darktide's intro splash state.
- `-- <args>`: forward everything after the `--` separator to Darktide
  verbatim. Relay's own flags must come before the `--`; anything after it is
  passed straight to the game.

For example, to enable Lua logging, skip the splash, and forward
`--lua-heap-mb-size 2048` to Darktide, the Command Line field should read:

```text
--game-binary {RELAY_GAME_BINARY} --mod-path {RELAY_MOD_PATH} --lua-logs --skip-splash -- --lua-heap-mb-size 2048
```

## Documentation

- [`docs/architecture/design.md`](docs/architecture/design.md) - selected
  production design and component/lifecycle contracts.
- [`docs/development.md`](docs/development.md) - developer guide: build, test,
  develop, package, release.
- [`docs/reference/`](docs/reference/) - version-grounded Vortex extension and
  Mod Relay integration references.

## Development

To iterate on the extension locally, package it and install the archive into
Vortex the same way end users do:

```bash
pnpm bundle:relay   # once, to populate relay/
pnpm package        # builds and writes dist-package/<archive>.zip
```

Drop the produced `.zip` onto the Vortex window; it installs over any
previous version (no uninstall needed) and prompts you to restart. Vortex
manages where extensions are stored, so the extension never writes into the
plugins directory itself. Released builds are produced by the GitHub release pipeline; see
[`docs/development.md`](docs/development.md) for the full build, package, and
release workflow.
