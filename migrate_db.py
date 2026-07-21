#!/usr/bin/env python3
"""
Migrate database JSON files from a Drive ZIP or folder to the repo root on gh-pages.

Looks for: hex_database.json, building_database.json, upgrade_database.json,
           common_settings.json, localization.json

Usage:
    python3 migrate_db.py <zip-file-or-folder>

Examples:
    python3 migrate_db.py ~/Downloads/db.zip
    python3 migrate_db.py ~/Downloads/db-folder/
"""

import sys
import os
import json
import shutil
import zipfile
import subprocess
from pathlib import Path

REPO = Path(__file__).parent

DB_FILES = {
    "hex_database.json",
    "building_database.json",
    "upgrade_database.json",
    "common_settings.json",
    "localization.json",
}


def find_db_files(source_dir):
    found = []
    for path in sorted(Path(source_dir).rglob("*.json")):
        if path.name in DB_FILES:
            found.append(path)
    return found


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    source = Path(sys.argv[1]).expanduser()
    if not source.exists():
        print(f"ERROR: {source} not found")
        sys.exit(1)

    tmp_dir = None
    if source.suffix.lower() == ".zip":
        import tempfile
        tmp_dir = tempfile.mkdtemp(prefix="db_migrate_")
        print(f"Extracting {source.name}…")
        with zipfile.ZipFile(source) as z:
            z.extractall(tmp_dir)
        scan_dir = tmp_dir
    else:
        scan_dir = source

    print(f"Scanning for DB files in {scan_dir}…\n")
    all_found = find_db_files(scan_dir)

    if not all_found:
        print(f"No DB files found. Expected one of: {', '.join(sorted(DB_FILES))}")
        if tmp_dir:
            shutil.rmtree(tmp_dir)
        sys.exit(1)

    # Deduplicate: when multiple copies of the same filename exist, keep shallowest
    by_name: dict = {}
    for p in all_found:
        by_name.setdefault(p.name, []).append(p)

    db_files = []
    for name, paths in sorted(by_name.items()):
        if len(paths) == 1:
            db_files.append(paths[0])
        else:
            best = min(paths, key=lambda p: len(p.parts))
            others = [str(p.relative_to(scan_dir)) for p in paths if p != best]
            print(f"  ⚠ {name}: {len(paths)} copies — using shallowest: "
                  f"{best.relative_to(scan_dir)}")
            print(f"    ignored: {', '.join(others)}")
            db_files.append(best)

    copied = 0
    for path in db_files:
        dest = REPO / path.name
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            dest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"  ✓ {path.name}  ({dest.stat().st_size // 1024} KB)")
            copied += 1
        except Exception as e:
            print(f"  ✗ {path.name}  ERROR: {e}")

    if tmp_dir:
        shutil.rmtree(tmp_dir)

    if not copied:
        print("\nNothing copied.")
        return

    print(f"\nCopied {copied} DB file(s).")
    print("\nCommitting…")
    for f in DB_FILES:
        if (REPO / f).exists():
            subprocess.run(["git", "add", f], cwd=REPO, check=True)
    subprocess.run(
        ["git", "commit", "-m", f"chore(db): migrate {copied} DB file(s) from Drive"],
        cwd=REPO, check=True,
    )

    print("\nDeploying to gh-pages…")
    subprocess.run(["bash", "deploy.sh"], cwd=REPO, check=True)

    print(f"\nDone — {copied} DB file(s) live on the server.")


if __name__ == "__main__":
    main()
