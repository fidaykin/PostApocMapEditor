#!/usr/bin/env python3
"""
Migrate sprite PNG files from a Drive ZIP or folder into sprites/ on gh-pages.

Category detection (in priority order):
  1. If the PNG lives inside a folder named 'hex' or 'buildings' → that category
  2. Otherwise → defaults to 'hex'

Usage:
    python3 migrate_sprites.py <zip-file-or-folder>

Examples:
    python3 migrate_sprites.py ~/Downloads/sprites.zip
    python3 migrate_sprites.py ~/Downloads/sprites-folder/
"""

import sys
import shutil
import zipfile
import subprocess
import tempfile
from pathlib import Path

REPO        = Path(__file__).parent
CATEGORIES  = {"hex", "buildings"}


def category_for(path: Path) -> str:
    for part in reversed(path.parts):
        if part.lower() in CATEGORIES:
            return part.lower()
    return "hex"


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
        tmp_dir = tempfile.mkdtemp(prefix="sprite_migrate_")
        print(f"Extracting {source.name}…")
        with zipfile.ZipFile(source) as z:
            z.extractall(tmp_dir)
        scan_dir = Path(tmp_dir)
    else:
        scan_dir = source

    sprites = sorted(scan_dir.rglob("*.png"))

    if not sprites:
        print("No PNG files found.")
        if tmp_dir:
            shutil.rmtree(tmp_dir)
        sys.exit(1)

    print(f"Found {len(sprites)} PNG(s):\n")
    copied, skipped = 0, 0

    for path in sprites:
        cat  = category_for(path)
        dest_dir = REPO / "sprites" / cat
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / path.name

        if dest.exists() and dest.stat().st_size == path.stat().st_size:
            print(f"  = sprites/{cat}/{path.name}  (unchanged, skip)")
            skipped += 1
            continue

        shutil.copy2(path, dest)
        print(f"  ✓ sprites/{cat}/{path.name}  ({path.stat().st_size // 1024} KB)")
        copied += 1

    if tmp_dir:
        shutil.rmtree(tmp_dir)

    if not copied:
        print(f"\nNo new sprites — nothing to commit. ({skipped} unchanged)")
        return

    print(f"\nCopied {copied} sprite(s), skipped {skipped} unchanged.")
    print("\nCommitting…")
    subprocess.run(["git", "add", "sprites/"], cwd=REPO, check=True)
    subprocess.run(
        ["git", "commit", "-m", f"chore(sprites): migrate {copied} sprite(s) from Drive"],
        cwd=REPO, check=True,
    )

    print("\nDeploying to gh-pages…")
    subprocess.run(["bash", "deploy.sh"], cwd=REPO, check=True)

    print(f"\nDone — {copied} sprite(s) live on the server.")


if __name__ == "__main__":
    main()
