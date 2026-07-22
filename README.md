# darktide-vortex-relay-extension

An unofficial Vortex extension for Warhammer 40,000: Darktide.

## Status

Working implementation through step 6 of the spec. Darktide game registration,
the `.mod` archive installer (with auto DMF dependency rules), sortMods-based
`mods.lst` projection, the Relay tool registration, tool variables, and the
launch guard start hook are all in place and verified. User-facing actions,
Relay runtime bundling, and the release archive are still to come; see
`docs/architecture/extension-spec.md` Section 17 for the implementation
order.

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

- [`docs/architecture/extension-spec.md`](docs/architecture/extension-spec.md)
  - selected production design and component/lifecycle contracts for the
  extension.
- [`docs/reference/`](docs/reference/) - version-grounded Vortex extension and
  Mod Relay integration references.
