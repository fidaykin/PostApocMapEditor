# Package manifest contract

Every published content package has a verifiable manifest at `packages/<id>/manifest.json` on `gh-pages`. It is written by the Map Editor (`GitHubSync.publishManifest`) and is additive: builds that do not know it ignore it.

## Manifest shape

```json
{
  "schemaVersion": 1,
  "id": "decameroon",
  "version": "1.0.11",
  "minAppVersion": "0.0.0",
  "generatedAt": "2026-10-09T10:00:00.000Z",
  "totalBytes": 2183,
  "dependencies": ["postapoc"],
  "files": [
    { "path": "building_database.json", "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "size": 0 },
    { "path": "hex_database.json", "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "size": 3 }
  ]
}
```

Field rules:

- `path` is relative to `packages/<id>/`, uses forward slashes, and the list is sorted ascending.
- `sha256` is the lowercase hex SHA-256 of the exact bytes stored on the server; `size` is their length in bytes (>= 0); `totalBytes` is the sum of all `size`.
- `id` and `version` match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. `dependencies` entries are safe ids and never the package itself.
- **Path rules (identical to the game's `PackageManifest.Parse` / `IsSafeRelativePath`).** A path is refused when it is empty, starts with `/`, contains `\` or `:`, or has an empty, `.` or `..` segment. A sprite file name may not start with `.`. No two paths may differ only by case (case-insensitive uniqueness). Spaces, `+`, `&`, `%`, `#`, `?` and non-ASCII are allowed: the client escapes every segment (`Uri.EscapeDataString`). No Windows-only rules are applied (the clients are Android/iOS). One offending name makes the editor abort the manifest build with an error naming it; the game would otherwise reject the whole package.

## What the manifest lists

The two databases (`hex_database.json`, `building_database.json`) and **only the sprites those databases reference** by `spriteName`: for every referenced name, `sprites/hex/<name>.png` and/or `sprites/buildings/<name>.png`, whichever exist on the server (a Bridge building's sprite lives in the hex folder). Referenced names with no file on the server are not listed (the editor logs a warning). Sprites in the folders that nothing references (orphans, other packages' sprites sitting in the shared pool) are **not** listed and are therefore never mandatory downloads. Not listed either: `preview.png`, `package.json`, the legacy `sprites/hex/manifest.json` array, terrain/roads/coastline sprites. A package without sprite folders gets a manifest of its databases only. A database that is not valid JSON aborts the build.

Everything is read from the server through the authenticated Contents API with `cache: no-store` (never the Pages CDN, which lags), and hashed byte for byte.

## Registry additions (optional fields)

In the package's entry in `packages/registry.json`: `manifestUrl` (`packages/<id>/manifest.json`), `totalBytes`, `minAppVersion` (`"0.0.0"`), `schemaVersion` (`1`).

## Write order

Package publish: databases -> sprites -> preview -> **manifest** -> registry -> `package.json`. The manifest exists before anything advertises it. A manifest failure (including an unsafe name, a failed read, or a registry that changed since it was read) aborts the publish before the registry is written. Note that a failed package publish has already written the databases, sprites and preview: those files then no longer match the previous manifest until the next successful publish (retrying converges; the next version is derived from `package.json`, which is written last).

Package import (new, replace or merge): `package.json` -> databases -> sprites -> preview -> **manifest** -> registry; the manifest is compensated like every other import file if a later step fails.

Base package (`postapoc`): after the database/sprite publish the editor writes manifest -> registry entry -> `packages/postapoc/package.json` with a new patch version that is above the registry's, the existing manifest's and `package.json`'s version (a version number is never reused with different content). A manifest failure there only shows a sticky warning (the publish itself already succeeded). Flows that run two publishes (the Publish postapoc confirm, hex-to-building migration) refresh once at the end.

## Any write to a covered file must be followed by a manifest rewrite

The client verifies every listed file by sha256, so a covered file changed without a manifest rewrite makes the whole package uninstallable (and a new, unlisted sprite is silently never downloaded). The editor does this for: package publish, package import, Publish HexDB / Buildings DB / Sprites (base), sprite-picker uploads to postapoc (one refresh per batch), Content Manager sprite uploads (one refresh per batch) and the hex-to-building migration. The Content Manager DB upload only writes root files (`hex_database.json` ...), which no manifest covers.

Writers the editor cannot protect: `deploy.sh`, the `repository_dispatch` / publish-content workflow of the game repository, and manual git pushes to `gh-pages` that touch `packages/<id>/hex_database.json`, `building_database.json` or `sprites/**`. After any of those, rebuild the manifest (`GitHubSync.publishManifest(id, version)` from the editor console, or publish the package/base again).

## Legacy clients

Older builds read only the databases, sprites, `registry.json` and `package.json`; they ignore `manifest.json` and the extra registry fields. No existing path, field or root-level copy was changed.

## Legacy mode vs manifest mode (Unity)

Without a manifest the game's legacy mode downloads only sprites whose names are plain tokens (it derives the list from the databases). In manifest mode it downloads exactly what is listed, whatever the name, so the manifest is authoritative once it exists.

## Client rules

- Reject any `path` the path rules above refuse (absolute, `:`, backslash, empty / `.` / `..` segment) and any case-insensitive duplicate.
- Verify `sha256` and `size` of every downloaded file before using it.
- Write `manifest.json` to local storage last, so an interrupted install is detected and retried.
- Without `manifestUrl` the default location `packages/<id>/manifest.json` applies.
