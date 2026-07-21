# Feedback 14.05.2026 — Editor Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 issues from the NEW (14.05.2026) feedback block: Max Levels crash, Income Idle duplicate removal, Income Constant resource types, and disabled-field visual polish in Build and Special sections.

**Architecture:** All changes are in a single file — `MapEditorPro.html` — a vanilla JS single-file editor using IIFE modules (HexDB, BldDB, SttDB). Changes are isolated: one CSS addition, two IIFE edits (BldDB + SttDB), and three HexDB IIFE edits.

**Tech Stack:** Vanilla JS, HTML/CSS, single-file editor at `/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorPro.html`

---

## Files

- **Modify:** `/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorPro.html`
- **Modify:** `/Users/sergii.tyshchenko/Post Apo Map Editor/CHANGELOG.md`

---

## Task 1: Fix Max Levels crash in BldDB and SttDB

**Problem:** Typing a large number (e.g. `12345`) into Max Levels triggers a `while` loop that creates thousands of level objects, hanging/crashing the browser tab.

**Root cause lines:**
- BldDB `_readRecord` ~line 4219: `const n = Math.max(1, bld.maxLevel || 1);`
- BldDB `levelCards` ~line 4106: `const n = Math.max(1, bld.maxLevel || 1);`
- SttDB `_readRecord` ~line 4546: `const n = Math.max(1, stt.maxLevel || 1);`
- SttDB `levelCards` ~line 4444: `const n = Math.max(1, stt.maxLevel || 1);`
- BldDB input ~line 4147: `<input id="bld-f-maxLevel" type="number" step="1" min="1" style="width:110px"`
- SttDB input ~line 4487: `<input id="stt-f-maxLevel" type="number" step="1" min="1" style="width:110px"`

**Files:** Modify `MapEditorPro.html`

- [ ] **Step 1: Cap maxLevel in BldDB `_readRecord`**

Find (line ~4219):
```js
const n = Math.max(1, bld.maxLevel || 1);
while (bld.levels.length < n) bld.levels.push(_blankLevel(bld.levels.length + 1));
if (bld.levels.length > n) bld.levels.length = n;
```
Replace with:
```js
const n = Math.min(9999, Math.max(1, bld.maxLevel || 1));
while (bld.levels.length < n) bld.levels.push(_blankLevel(bld.levels.length + 1));
if (bld.levels.length > n) bld.levels.length = n;
```

- [ ] **Step 2: Cap maxLevel in BldDB `levelCards`**

Find (line ~4106):
```js
const n = Math.max(1, bld.maxLevel || 1);
```
Replace with:
```js
const n = Math.min(9999, Math.max(1, bld.maxLevel || 1));
```

- [ ] **Step 3: Add `max` attribute to BldDB input**

Find (line ~4147):
```html
<input id="bld-f-maxLevel" type="number" step="1" min="1" style="width:110px" value="${_esc(bld.maxLevel)}">
```
Replace with:
```html
<input id="bld-f-maxLevel" type="number" step="1" min="1" max="9999" style="width:110px" value="${_esc(bld.maxLevel)}">
```

- [ ] **Step 4: Cap maxLevel in SttDB `_readRecord`**

Find (line ~4546):
```js
const n = Math.max(1, stt.maxLevel || 1);
while (stt.levels.length < n) stt.levels.push(_blankLevel(stt.levels.length + 1));
if (stt.levels.length > n) stt.levels.length = n;
```
Replace with:
```js
const n = Math.min(9999, Math.max(1, stt.maxLevel || 1));
while (stt.levels.length < n) stt.levels.push(_blankLevel(stt.levels.length + 1));
if (stt.levels.length > n) stt.levels.length = n;
```

- [ ] **Step 5: Cap maxLevel in SttDB `levelCards`**

Find (line ~4444):
```js
const n = Math.max(1, stt.maxLevel || 1);
```
Replace with:
```js
const n = Math.min(9999, Math.max(1, stt.maxLevel || 1));
```

- [ ] **Step 6: Add `max` attribute to SttDB input**

Find (line ~4487):
```html
<input id="stt-f-maxLevel" type="number" step="1" min="1" style="width:110px" value="${_esc(stt.maxLevel)}">
```
Replace with:
```html
<input id="stt-f-maxLevel" type="number" step="1" min="1" max="9999" style="width:110px" value="${_esc(stt.maxLevel)}">
```

- [ ] **Step 7: Verify in browser**

Open `MapEditorPro.html` → Buildings editor → select any building → type `99999` in Max Levels → tab out.
Expected: field snaps to 9999, no hang, level cards render normally.

- [ ] **Step 8: Commit**
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "fix: cap Max Levels at 9999 in BldDB and SttDB to prevent browser hang"
```

---

## Task 2: Remove "Income Idle" from HexDB Income section

**Problem:** `Income Idle` and `Income per Turn` are semantically identical. The duplicate causes confusion. Remove `Income Idle` entirely.

**Files:** Modify `MapEditorPro.html`

- [ ] **Step 1: Remove `incomeIdle` from `_blank()`**

Find (line ~3202):
```js
incomeIdle:[], incomeConstant:[],
```
Replace with:
```js
incomeConstant:[],
```

- [ ] **Step 2: Remove `Income Idle` row from `incomeBody`**

Find (lines ~3502-3504):
```js
      // Income Idle
      _row('Income Idle',
        _resourceBlockHTML('incomeIdle', hex.incomeIdle ?? [], false)),
```
Delete these 3 lines entirely.

- [ ] **Step 3: Remove `incomeIdle` migration in `_migrateIncomeFields`**

Find (line ~3945):
```js
      if (!Array.isArray(h.incomeIdle))      h.incomeIdle = [];
```
Delete this line entirely.

- [ ] **Step 4: Verify in browser**

Open `MapEditorPro.html` → Hex Editor → select any hex → open INCOME section.
Expected: Income Idle row is gone. Per Turn, Income Constant, Spend Constant rows still present.

- [ ] **Step 5: Commit**
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "fix: remove duplicate Income Idle field from HexDB Income section"
```

---

## Task 3: Add Energy and Pollution to "Income Constant" resource types

**Problem:** `Income Constant` currently uses `DESTROY_RES_TYPES` (no Energy/Pollution). Tiles need to be able to produce (not only consume) energy and pollution, so the block must use `SPEND_RES_TYPES`.

**`SPEND_RES_TYPES`** is already defined (line ~3362):
```js
const SPEND_RES_TYPES = ['Pollution','Energy','Gold','Gems','Food',
  'Lumber','Stone','Steel','Oil','Chips','Clay'];
```

**Files:** Modify `MapEditorPro.html`

- [ ] **Step 1: Pass `SPEND_RES_TYPES` to `incomeConstant` resource block**

Find (line ~3506-3508):
```js
      // Income Constant
      _row('Income Constant',
        _resourceBlockHTML('incomeConstant', hex.incomeConstant ?? [], false)),
```
Replace with:
```js
      // Income Constant
      _row('Income Constant',
        _resourceBlockHTML('incomeConstant', hex.incomeConstant ?? [], false, SPEND_RES_TYPES)),
```

- [ ] **Step 2: Verify in browser**

Open `MapEditorPro.html` → Hex Editor → any hex → INCOME section → click **+ Add Resource** under Income Constant.
Expected: dropdown contains Pollution, Energy at the top, followed by Gold, Gems, Food, Lumber, Stone, Steel, Oil, Chips, Clay.

- [ ] **Step 3: Commit**
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "fix: use SPEND_RES_TYPES for Income Constant so Energy and Pollution are available"
```

---

## Task 4: Stronger disabled-field visual for Build and Special sections

**Problem:** When `Can Build = false` or `Bonus Drop = false`, blocked inputs look nearly identical to active ones. Need clear visual distinction: disabled inputs should be grayed out.

**Approach:** Add a single CSS rule. Native `[disabled]` already suppresses interaction; we just need a more visible style for `.hexdb-input:disabled` and `.hexdb-select:disabled`.

**Files:** Modify `MapEditorPro.html`

- [ ] **Step 1: Add CSS rule for disabled hexdb controls**

Find (line ~622):
```css
.hexdb-input:focus, .hexdb-select:focus { outline: none; border-color: var(--accent); }
```
Add immediately after:
```css
.hexdb-input:disabled, .hexdb-select:disabled {
  opacity: 0.35; background: var(--border); cursor: not-allowed;
}
```

- [ ] **Step 2: Verify Build section in browser**

Open `MapEditorPro.html` → Hex Editor → any hex → BUILD section.
With `Can Build` unchecked: all gated inputs (Road, Min Level, Price, Premium Price, Placement Rule) should appear grayed out with noticeably reduced opacity.
Check `Can Build`: inputs should return to normal appearance.

- [ ] **Step 3: Verify Special section in browser**

SPECIAL section → `Bonus Drop` unchecked: Triggers select and Bonuses resource block buttons should appear grayed out.
Check `Bonus Drop`: they return to normal.

- [ ] **Step 4: Commit**
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html
git commit -m "polish: stronger disabled-field visual for Build and Special sections"
```

---

## Task 5: Version bump, CHANGELOG, and publish

**Files:** Modify `MapEditorPro.html`, `CHANGELOG.md`; copy to publish folder.

- [ ] **Step 1: Bump version to 0.5.0**

Three occurrences to update in `MapEditorPro.html`:
```
<title>MapEditorPro v0.4.6</title>  →  <title>MapEditorPro v0.5.0</title>
v0.4.6  (in status bar)             →  v0.5.0
const VERSION = "0.4.6";            →  const VERSION = "0.5.0";
```

- [ ] **Step 2: Add CHANGELOG entry**

Prepend to `/Users/sergii.tyshchenko/Post Apo Map Editor/CHANGELOG.md`:
```markdown
## v0.5.0 — 2026-05-16

### Fixes
- BldDB / SttDB: Max Levels field no longer crashes browser when values > 5 chars — capped at 9999 with `Math.min` guard and `max="9999"` on input
- HexDB Income: removed duplicate `Income Idle` field (identical to `Income per Turn`)
- HexDB Income: `Income Constant` now uses full resource list including Energy and Pollution

### Polish
- HexDB Build / Special: disabled inputs (gated by Can Build / Bonus Drop) now rendered with 35% opacity and gray background for clear visual distinction

---
```

- [ ] **Step 3: Copy to publish folder**
```bash
cp "/Users/sergii.tyshchenko/Post Apo Map Editor/MapEditorPro.html" \
   "/Users/sergii.tyshchenko/MapEditorPublish/MapEditorPro.html"
```

- [ ] **Step 4: Commit**
```bash
cd "/Users/sergii.tyshchenko/Post Apo Map Editor"
git add MapEditorPro.html CHANGELOG.md
git commit -m "release: v0.5.0 — feedback 14.05 fixes"
```

---

## Self-Review

**Spec coverage:**
- T1 ✅ Max Levels crash (Критично — Buildings and Settlements editor)
- T2 ✅ Remove Income Idle (Важно — Hex Editor.Income)
- T3 ✅ Energy + Pollution in Income Constant (Важно — Hex Editor.Income)
- T4 ✅ Disabled field visual for Build + Special (Полишинг — both sections)
- T5 ✅ Version + changelog + publish

**Not in this plan (intentionally deferred):**
- Tooltips — explicitly marked "На будущее" in feedback doc
