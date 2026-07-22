# Reference

Durable technical facts used to design and implement the Darktide Relay Vortex
extension. These documents summarize and reconcile upstream documentation,
version-pinned Vortex source, and Mod Relay's public contracts. They do
not copy upstream documentation.

## Baseline

The initial investigation was performed on 2026-07-18 against:

- Vortex `v2.3.0` (commit `a5a9583`), the current stable Windows release at
  the time;
- `@nexusmods/vortex-api` `2.3.0-beta.1`, the API package published for the
  Vortex 2.3 line; and
- Mod Relay (current release of
  https://github.com/ModifAmorphic/darktide-mod-relay) and its current `main`
  architecture/launcher contract.

Re-ground these references before implementation if the target Vortex or Relay
version changes. Vortex's extension API is source-compatible across many
releases, but defaults, types, events, and build tooling do change.

## Documents

- [`vortex-extension-development.md`](vortex-extension-development.md):
  extension package/build shape, game discovery, Nexus association, mod
  installers, deployment, profiles, load order, supported tools, launch hooks,
  manual distribution, and testing.
- [`darktide-mods-and-relay.md`](darktide-mods-and-relay.md): the exact
  caller-supplied mod-directory contract, Darktide mod folder/entry shape,
  `mods.lst`, DMF behavior, Relay CLI/runtime layout, logging, and legal bundle
  requirements.

## Evidence labels

The reference docs distinguish:

- **Documented** — stated in Nexus/Vortex or Relay documentation.
- **Source-observed** — verified in the exact Vortex 2.3.0 or Relay source.
- **Derived consequence** — follows from combining two or more documented or
  source-observed facts.
- **Open design decision** — deliberately left for the specification.
- **Needs live validation** — cannot be settled by documentation/source alone.

This distinction matters particularly for profile switching and launch timing:
the APIs exist, but the final ordering of extension-owned writes must be proven
inside a real Vortex + Darktide installation.
