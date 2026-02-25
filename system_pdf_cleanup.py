import os
import shutil
from pathlib import Path

target_dir = Path(
    "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Meine Ablage/Ablage Jeremy Schulze/08_Sonstiges/Unbekannt/From_System_Cleanup"
)
target_dir.mkdir(parents=True, exist_ok=True)

search_roots = [
    Path("/Users/jeremy/Library/Mobile Documents/com~apple~CloudDocs"),
    Path.home() / "Documents",
    Path.home() / "Desktop",
    Path.home() / "Downloads",
]

exclude_patterns = [
    "JS - Belegdokumente 2023",
    "Ablage Jeremy Schulze",
    "GoogleDrive",
    "node_modules",
    "/.",  # Hidden folders
]

print("🚀 Starting final system cleanup...")

total_moved = 0
for root in search_roots:
    print(f"Scanning {root}...")
    for path in root.rglob("*.pdf"):
        if not path.is_file():
            continue

        # Check exclusions
        path_str = str(path)
        if any(exc in path_str for exc in exclude_patterns):
            continue

        try:
            dest = target_dir / path.name
            if dest.exists():
                dest = target_dir / f"{path.stem}_{os.urandom(2).hex()}.pdf"

            shutil.move(str(path), str(dest))
            total_moved += 1
            if total_moved % 100 == 0:
                print(f"  Moved {total_moved} files...")
        except Exception:
            # print(f"  Error moving {path}: {e}")
            pass

print(f"✅ Cleanup complete. Total documents moved to Drive: {total_moved}")
