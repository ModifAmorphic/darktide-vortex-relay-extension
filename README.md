# darktide-vortex-relay-extension

An unofficial Vortex extension for Warhammer 40,000: Darktide.

## Status

Darktide game registration, the `.mod` archive installer (with auto DMF
dependency rules), sortMods-based `mods.lst` projection, the Relay tool
registration, tool variables, the launch guard start hook, and user-facing
open-directory actions are all in place. The Relay bundling
(`pnpm bundle:relay`), release-archive packaging (`pnpm package`), and the
GitHub release pipeline (release-please + build/bundle/package/upload on
push to main) have landed. No release has been cut yet.

## Development

To iterate on the extension against a local Vortex install, run:

```bash
pnpm dev:install --target <your-vortex-plugins-dir>
```

The default Vortex plugins directory on Windows is `%APPDATA%\Vortex\Plugins`.
The script builds the extension and copies the artifacts into a
`darktide-relay/` subdirectory of the target. Restart Vortex to load the new
build.

## Documentation

- [`docs/architecture/design.md`](docs/architecture/design.md) - selected
  production design and component/lifecycle contracts.
- [`docs/development.md`](docs/development.md) - developer guide: build, test,
  develop, package, release.
- [`docs/reference/`](docs/reference/) - version-grounded Vortex extension and
  Mod Relay integration references.
