#!/usr/bin/env python3
"""
Migrate map JSON files into the gh-pages repo's maps/ folder.

Usage:
    python3 migrate_maps.py <zip-file-or-folder>

Examples:
    python3 migrate_maps.py ~/Downloads/maps.zip
    python3 migrate_maps.py ~/Downloads/maps-folder/
"""

import sys
import os
import json
import shutil
import zipfile
import subprocess
from datetime import date
from pathlib import Path

REPO = Path(__file__).parent
MAPS_DIR = REPO / "maps"
MAP_LIST = MAPS_DIR / "map_list.json"


def find_json_maps(source_dir):
    """Return all .json files that look like maps (have width/height/data)."""
    maps = []
    for path in sorted(Path(source_dir).rglob("*.json")):
        if path.name == "map_list.json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data.get("data"), list) and data.get("width") and data.get("height"):
                maps.append((path, data))
        except Exception:
            pass
    return maps


def safe_filename(name):
    """Convert a display name to a safe filename."""
    return "".join(c if c.isalnum() or c in "-_. " else "_" for c in name).strip()


def update_map_list(entries):
    """Merge new entries into map_list.json (upsert by fileName)."""
    existing = []
    if MAP_LIST.exists():
        try:
            existing = json.loads(MAP_LIST.read_text(encoding="utf-8")).get("maps", [])
        except Exception:
            pass

    by_file = {m["fileName"]: m for m in existing}
    for e in entries:
        by_file[e["fileName"]] = e

    MAP_LIST.write_text(
        json.dumps({"maps": list(by_file.values())}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )
    print(f"  Updated map_list.json ({len(by_file)} total entries)")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    source = Path(sys.argv[1]).expanduser()
    if not source.exists():
        print(f"ERROR: {source} not found")
        sys.exit(1)

    # Extract ZIP if needed
    tmp_dir = None
    if source.suffix.lower() == ".zip":
        import tempfile
        tmp_dir = tempfile.mkdtemp(prefix="map_migrate_")
        print(f"Extracting {source.name}…")
        with zipfile.ZipFile(source) as z:
            z.extractall(tmp_dir)
        scan_dir = tmp_dir
    else:
        scan_dir = source

    print(f"Scanning for map files in {scan_dir}…")
    maps = find_json_maps(scan_dir)

    if not maps:
        print("No map files found (need JSON with width/height/data fields).")
        if tmp_dir:
            shutil.rmtree(tmp_dir)
        sys.exit(1)

    print(f"Found {len(maps)} map(s):\n")
    MAPS_DIR.mkdir(exist_ok=True)

    today = date.today().isoformat()
    new_entries = []

    for path, data in maps:
        # Derive display name: use json["name"] if present, else stem
        display_name = data.get("name") or path.stem
        file_name = safe_filename(path.stem).replace(" ", "_") + ".json"
        dest = MAPS_DIR / file_name

        # Copy file
        shutil.copy2(path, dest)
        size = str(dest.stat().st_size)

        entry = {
            "name": display_name,
            "fileName": file_name,
            "size": size,
            "uploadedTime": today,
        }
        new_entries.append(entry)
        print(f"  ✓ {display_name}  →  maps/{file_name}  ({int(size)//1024} KB)")

    print()
    update_map_list(new_entries)

    if tmp_dir:
        shutil.rmtree(tmp_dir)

    # Commit and deploy
    print("\nCommitting…")
    subprocess.run(["git", "add", "maps/"], cwd=REPO, check=True)
    msg = f"chore(maps): migrate {len(new_entries)} map(s) from Drive"
    subprocess.run(["git", "commit", "-m", msg], cwd=REPO, check=True)

    print("\nDeploying to gh-pages…")
    subprocess.run(["bash", "deploy.sh"], cwd=REPO, check=True)

    print(f"\nDone — {len(new_entries)} map(s) live on the server.")


if __name__ == "__main__":
    main()
