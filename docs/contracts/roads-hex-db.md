# Hex database: roads and bridges contract

Roads/Bridges V1 adds a per-tile list of the road and bridge buildings that may be built on the tile. The Map Editor writes it into the hex database files (`hex_database.json` of the base package and of every content package). The change is additive: a build that does not know the new fields ignores them, and the editor keeps writing the legacy `roadAllowed` flag next to them.

## Record field `allowedRoads`

```json
{ "id": "Decameroon_Plain_1", "type": "Plains", "roadAllowed": true, "allowedRoads": ["road", "road_2"] }
{ "id": "Decameroon_River_L_1", "type": "Rivers", "roadAllowed": false, "allowedRoads": ["bridge"] }
{ "id": "Mountain_1", "type": "Hills/Mountains", "roadAllowed": false, "allowedRoads": [] }
```

- `allowedRoads` is `string[]`: ids of road and bridge buildings of the **base** Building DB (`isRoad: true`, or `buildingCategory: "Bridge"`) that may be built on this tile.
- **Missing, `null` and `[]` all mean "nothing is allowed".** There is no "inherit".
- Every id appears at most once. The editor orders the list like the base Building DB (roads and bridges interleaved in the order of that file); a reader must not depend on the order.
- Roads and bridges are global: the base package defines them, a content package cannot (the editor refuses to publish or import a package whose Building DB contains one).
- Which terrain a bridge crosses is decided only by these lists (a river bridge is listed on `Rivers` tiles, a water bridge on `Water` tiles). The editor warns, but does not forbid, a bridge on a land tile or a road on a water tile.

## Legacy field `roadAllowed`

`roadAllowed` stays in every record and is **derived**: it is `true` exactly when `allowedRoads` contains at least one id whose Building DB record has `isRoad: true`. A tile that lists only bridges (a `Rivers` or `Water` tile) keeps `roadAllowed: false`, so builds that still read the flag never allow the plain road on water. A record without `allowedRoads` keeps its authored boolean. The flag is removed only after every build understands `allowedRoads`.

## File fields

- `roadsSchema` (top level, integer): **absent** = the file is in the legacy form and a reader must use `roadAllowed`; `1` = `allowedRoads` is authoritative for every record of this file. The marker is per file, so the base file and a package file switch independently. It is written right after `version`.
- `common.roadDefaults` (base file only, `{ "<tile type group>": ["road", ...] }`): presets for the editor's "apply defaults" actions. Game builds ignore it. It is not a record field.

## Write modes (Map Editor, per browser)

The editor writes according to a setting the owner controls (HEX DB toolbar, "Roads data"); publishing never changes it.

| Mode | `roadAllowed` | `allowedRoads` on records | `roadsSchema` | `common.roadDefaults` |
|---|---|---|---|---|
| `off` (default) | as before (derived when the tile has a list) | never written | never | never |
| `stage` | derived | written for every record that has a list | never | never |
| `active` | derived | written for every record that has a list | `1` | written when present |

`off` produces exactly the files the editor wrote before Roads V1. A record without a list never gets a synthetic `[]` in any mode. In `stage` and `active` the editor refuses to publish while a record of the published file has no list, lists an unknown or duplicate id, or a package contains a road or bridge building.

## Transition order

1. Game build with the `allowedRoads` parser is released (until then `stage`/`active` data would fail the game repository's daily schema check).
2. Editor in `stage`: both fields are published, game builds keep reading `roadAllowed`.
3. Backfill the lists (a record that has none gets today's effective rule), then switch to `active`: the game switches that file to the new path.
4. After every build understands `allowedRoads`, the game and the editor drop `roadAllowed`.

## Record keys the editor may write

The game repository's `scripts/check-building-schema-sync.js` compares the keys of `hexes[]` records of the base file with its parser. `allowedRoads` is the **only** new record key. `roadsSchema` and `roadDefaults` are not record keys. The editor-side twin of that check is `tests/roads-contract.spec.ts` (a stray new record key fails it).
