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

- `path` is relative to `packages/<id>/`, uses forward slashes, and the list is sorted ascending and has no duplicates.
- `sha256` is the lowercase hex SHA-256 of the exact bytes stored on the server; `size` is their length in bytes; `totalBytes` is the sum of all `size`.
- Covered files: `hex_database.json`, `building_database.json`, `sprites/hex/*.png`, `sprites/buildings/*.png`. Not listed: `preview.png`, `package.json`, the legacy `sprites/hex/manifest.json` array, terrain/roads/coastline sprites.
- A package without sprite folders gets a manifest of its databases only.
- `id` and `version` match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Sprite file names may contain spaces, `+` and `&` (the editor publishes such names), but never separators, a leading dot or control characters.

## Registry additions (optional fields)

In the package's entry in `packages/registry.json`: `manifestUrl` (`packages/<id>/manifest.json`), `totalBytes`, `minAppVersion` (`"0.0.0"`), `schemaVersion` (`1`).

## Write order

Package publish: databases -> sprites -> preview -> **manifest** -> registry -> `package.json`. The manifest exists before anything advertises it. A manifest failure aborts a package publish before the registry is written.

Base package (`postapoc`): after the database/sprite publish the editor bumps the patch version, then writes manifest -> registry entry -> `packages/postapoc/package.json`. A manifest failure there only shows a sticky warning (the publish itself already succeeded).

## Legacy clients

Older builds read only the databases, sprites, `registry.json` and `package.json`; they ignore `manifest.json` and the extra registry fields. No existing path, field or root-level copy was changed.

## Client rules

- Reject any `path` that is absolute, contains `..`, a backslash or an empty segment.
- Verify `sha256` and `size` of every downloaded file before using it.
- Write `manifest.json` to local storage last, so an interrupted install is detected and retried.
- Without `manifestUrl` the default location `packages/<id>/manifest.json` applies.
