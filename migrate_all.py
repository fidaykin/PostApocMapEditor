#!/usr/bin/env python3
"""
Download a Google Drive folder and migrate all content to gh-pages.

Handles:
  sprites/hex/      — PNG files in a folder named 'hex'
  sprites/buildings/ — PNG files in a folder named 'buildings'
  maps/             — JSON files with width/height/data fields
  repo root         — hex_database.json, building_database.json,
                      upgrade_database.json, common_settings.json,
                      localization.json

Usage:
    python3 migrate_all.py <drive-folder-url-or-id>

Example:
    python3 migrate_all.py https://drive.google.com/drive/folders/1prksRhE6o1h6G9flPBl2mElyK6w4zXGQ

Requires:
    pip install gdown
"""

import sys
import json
import shutil
import subprocess
import tempfile
from datetime import date
from pathlib import Path

REPO        = Path(__file__).parent
MAPS_DIR    = REPO / "maps"
MAP_LIST    = MAPS_DIR / "map_list.json"
CATEGORIES  = {"hex", "buildings"}

DB_FILES = {
    "hex_database.json",
    "building_database.json",
    "upgrade_database.json",
    "common_settings.json",
    "localization.json",
}


# ── helpers ──────────────────────────────────────────────────────────────────

def extract_folder_id(url_or_id: str) -> str:
    if "drive.google.com" in url_or_id:
        for part in url_or_id.split("/"):
            if len(part) > 20 and "." not in part and "?" not in part:
                return part.split("?")[0]
    return url_or_id.strip()


def download_folder(folder_id: str, dest: Path) -> Path:
    try:
        import gdown
    except ImportError:
        print("ERROR: gdown not installed. Run:  pip install gdown")
        sys.exit(1)

    url = f"https://drive.google.com/drive/folders/{folder_id}"
    print(f"Downloading Drive folder {folder_id}…")
    gdown.download_folder(url, output=str(dest), quiet=False, use_cookies=False)
    # gdown creates a subfolder inside dest
    subdirs = [p for p in dest.iterdir() if p.is_dir()]
    return subdirs[0] if subdirs else dest


def category_for(path: Path) -> str:
    for part in reversed(path.parts):
        if part.lower() in CATEGORIES:
            return part.lower()
    return "hex"


def is_map_json(data: dict) -> bool:
    return isinstance(data.get("data"), list) and data.get("width") and data.get("height")


def safe_filename(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in name).strip()


# ── migrate functions ─────────────────────────────────────────────────────────

def migrate_sprites(scan_dir: Path):
    pngs = sorted(scan_dir.rglob("*.png"))
    if not pngs:
        return 0

    print(f"\n── Sprites ({len(pngs)} found) ──")
    copied = 0
    for path in pngs:
        cat      = category_for(path)
        dest_dir = REPO / "sprites" / cat
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / path.name
        if dest.exists() and dest.stat().st_size == path.stat().st_size:
            print(f"  = sprites/{cat}/{path.name}  (unchanged)")
            continue
        shutil.copy2(path, dest)
        print(f"  ✓ sprites/{cat}/{path.name}  ({path.stat().st_size // 1024} KB)")
        copied += 1

    return copied


def migrate_db_files(scan_dir: Path):
    found = [p for p in scan_dir.rglob("*.json") if p.name in DB_FILES]
    if not found:
        return 0

    # Group by filename; when duplicates exist, prefer shallowest path (fewest parts)
    by_name: dict[str, list[Path]] = {}
    for p in found:
        by_name.setdefault(p.name, []).append(p)

    chosen: list[Path] = []
    for name, paths in sorted(by_name.items()):
        if len(paths) == 1:
            chosen.append(paths[0])
        else:
            best = min(paths, key=lambda p: len(p.parts))
            others = [str(p.relative_to(scan_dir)) for p in paths if p != best]
            print(f"  ⚠ {name}: {len(paths)} copies found — using shallowest: "
                  f"{best.relative_to(scan_dir)}")
            print(f"    ignored: {', '.join(others)}")
            chosen.append(best)

    print(f"\n── DB files ({len(chosen)} unique, {len(found)} total) ──")
    copied = 0
    for path in chosen:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            dest = REPO / path.name
            dest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"  ✓ {path.name}  ({dest.stat().st_size // 1024} KB)")
            copied += 1
        except Exception as e:
            print(f"  ✗ {path.name}  ERROR: {e}")

    return copied


def migrate_maps(scan_dir: Path):
    candidates = [p for p in scan_dir.rglob("*.json")
                  if p.name not in DB_FILES and p.name != "map_list.json"]
    maps = []
    for path in sorted(candidates):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if is_map_json(data):
                maps.append((path, data))
        except Exception:
            pass

    if not maps:
        return 0

    print(f"\n── Maps ({len(maps)} found) ──")
    MAPS_DIR.mkdir(exist_ok=True)
    today    = date.today().isoformat()
    new_entries = []

    for path, data in maps:
        display_name = data.get("name") or path.stem
        file_name    = safe_filename(path.stem).replace(" ", "_") + ".json"
        dest         = MAPS_DIR / file_name
        shutil.copy2(path, dest)
        print(f"  ✓ {display_name}  →  maps/{file_name}  ({dest.stat().st_size // 1024} KB)")
        new_entries.append({
            "name": display_name,
            "fileName": file_name,
            "size": str(dest.stat().st_size),
            "uploadedTime": today,
        })

    # upsert into map_list.json
    existing = []
    if MAP_LIST.exists():
        try:
            existing = json.loads(MAP_LIST.read_text(encoding="utf-8")).get("maps", [])
        except Exception:
            pass
    by_file = {m["fileName"]: m for m in existing}
    for e in new_entries:
        by_file[e["fileName"]] = e
    MAP_LIST.write_text(
        json.dumps({"maps": list(by_file.values())}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"  Updated map_list.json ({len(by_file)} total)")
    return len(new_entries)


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    arg     = sys.argv[1]
    source  = Path(arg).expanduser()
    tmp_dir = None

    try:
        if source.exists():
            # Local ZIP or folder — no download needed
            if source.suffix.lower() == ".zip":
                tmp_dir  = Path(tempfile.mkdtemp(prefix="drive_migrate_"))
                print(f"Extracting {source.name}…")
                import zipfile
                with zipfile.ZipFile(source) as z:
                    z.extractall(tmp_dir)
                scan_dir = tmp_dir
            else:
                scan_dir = source
        else:
            # Drive URL or folder ID
            folder_id = extract_folder_id(arg)
            tmp_dir   = Path(tempfile.mkdtemp(prefix="drive_migrate_"))
            scan_dir  = download_folder(folder_id, tmp_dir)

        sprites_copied = migrate_sprites(scan_dir)
        db_copied      = migrate_db_files(scan_dir)
        maps_copied    = migrate_maps(scan_dir)

    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    total = sprites_copied + db_copied + maps_copied
    if not total:
        print("\nNothing new to commit.")
        return

    print(f"\n── Summary: {sprites_copied} sprite(s), {db_copied} DB file(s), {maps_copied} map(s) ──")
    print("\nCommitting…")
    # Stage directories first, then each DB file only if it exists
    for path in ["sprites/", "maps/"]:
        if (REPO / path.rstrip("/")).exists():
            subprocess.run(["git", "add", path], cwd=REPO, check=False)
    for f in DB_FILES:
        if (REPO / f).exists():
            subprocess.run(["git", "add", f], cwd=REPO, check=False)
    subprocess.run(
        ["git", "commit", "-m",
         f"chore: migrate from Drive — {sprites_copied} sprites, {db_copied} DBs, {maps_copied} maps"],
        cwd=REPO, check=True,
    )

    print("\nDeploying to gh-pages…")
    subprocess.run(["bash", "deploy.sh"], cwd=REPO, check=True)
    print(f"\nDone.")


if __name__ == "__main__":
    main()
