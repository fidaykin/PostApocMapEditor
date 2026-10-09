# Task report: Reskin+ prefixed copy (ClickUp 869fcktcj)

## What changed
- `Packages.openReskinPicker` now has a keyboard accessible `role=radiogroup` with two modes: "Copy with package prefix" (default, preselected) and "Override the same id (runtime reskin)" (explanation line plus warning). Arrow keys switch the mode; Escape closes without creating. The "already reskinned" (disabled) state follows the mode: prefixed id exists in the package (a) or the same id exists (b). `onPick(baseId, mode)`.
- New `Packages.reskinTargetId(baseId, mode)`: prefix + baseId (not added twice) or baseId.
- `HexDB.addReskin(baseId, mode)` and `BldDB.addReskin(baseId, mode)`: structuredClone of the base with the new id and `package` set. An existing id+package entry is never duplicated in either mode: toast "<id> already exists in package ..." and that entry is selected. Toasts name the created id and say "prefixed copy" or "same-id override". Non-default package still required.
- `HexDB.add()` / `BldDB.add()` prefix logic and `migrateToBuilding` checked: consistent, unchanged.
- Sprites: the copy keeps the base `spriteName`; `Terrain.getUploadedUrl` falls back to the default package key, verified by a test.
- Docs: Reskin+ paragraph in editor-guide EN/UK (HTML regenerated), CHANGELOG (Unreleased, Packages), owner question 6 in the game map format decision record (no decision).

## basedOn decision
SKIPPED. The game-side loader and the other consumers of published hex/building JSON cannot be verified from this repo, and the link is derivable (strip the prefix). Adding a field to published JSON risks a breaking change for no verified benefit; recorded as owner question 6.

## Tests
- RED first: reskin tests asserted the new behaviour and failed (14 of 33) before the fix.
- tests/packages-reskin.spec.ts updated to the prefixed default and extended: default preselected and explained, hyphenated package (`SciFi_`), already prefixed base, mode (a) collision, disabled state per mode, mode (b) once and refused twice, radio keyboard and Escape, building kind, default package refusal, autosave persistence, base sprite resolution, export then import round-trip (prefixed copy re-prefixed, same-id reskin keeps id, `reskinCount` 1). Hostile ids stay text.
- tests/no-native-dialogs.spec.ts reskin tests updated to the prefixed id.
- Focused run: packages-*, package-*, final-wave-a-packages, no-native-dialogs, phase5-helpers, registry-fresh-read, startup-sync, sync-merge, modal, palette-accordion, docs-lint, help-menu, tests/unit: 318 passed, 0 failed.

## Not done
- Mode choice is not persisted in localStorage (optional, and a persisted override mode would break "mode (a) preselected").
- No separate publish round-trip test (publish writes the same entries that export serialises).
