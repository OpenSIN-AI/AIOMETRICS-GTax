# Context Fulltext

- source_path: consolidate_drive.py
- source_sha256: 173c1737d6c9e7911079556ec3c8783afb8827a869a9aecea34ef6d60295a208
- chunk: 1/1

```text
import shutil
from pathlib import Path

DRIVE_BASE = Path(
    "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Meine Ablage/Ablage Jeremy Schulze"
)

MAPPING = {
    "Rechnungen": "01_Rechnungen",
    "Rechnungen_(Einnahme_Ausgabe)": "01_Rechnungen",
    "Bank": "02_Bank",
    "Vertraege": "03_Vertraege",
    "VERTRAELGE": "03_Vertraege",
    "Personal": "04_Personal",
    "PERSONAL": "04_Personal",
    "Versicherung": "05_Versicherung",
    "VERSICHERUNG": "05_Versicherung",
    "Projekte": "06_Projekte",
    "Projects": "06_Projekte",
    "Rechtliches": "07_Rechtliches",
    "Sonstiges": "08_Sonstiges",
}

YEAR_NORM = {
    "N_A": "Unbekannt",
    "N/A": "Unbekannt",
    "Unknown": "Unbekannt",
    "Unbekannt": "Unbekannt",
    "Undated": "Unbekannt",
    "undated": "Unbekannt",
}


def consolidate():
    if not DRIVE_BASE.exists():
        print("Drive base not found.")
        return

    # Phase 1: Move files into new structure
    for old_cat_dir in DRIVE_BASE.iterdir():
        if not old_cat_dir.is_dir():
            continue

        old_name = old_cat_dir.name
        new_name = MAPPING.get(old_name)

        if new_name:
            target_cat_dir = DRIVE_BASE / new_name
            target_cat_dir.mkdir(parents=True, exist_ok=True)

            for year_dir in old_cat_dir.iterdir():
                if not year_dir.is_dir():
                    continue

                year_name = YEAR_NORM.get(year_dir.name, year_dir.name)
                target_year_dir = target_cat_dir / year_name
                target_year_dir.mkdir(parents=True, exist_ok=True)

                for file in year_dir.iterdir():
                    if file.is_file():
                        dest = target_year_dir / file.name
                        # Handle conflicts
                        if dest.exists():
                            dest = target_year_dir / f"{file.stem}_dup{file.suffix}"

                        try:
                            shutil.move(str(file), str(dest))
                        except Exception as e:
                            print(f"Error moving {file.name}: {e}")

            # Remove old year dirs if empty
            for year_dir in old_cat_dir.iterdir():
                if year_dir.is_dir() and not any(year_dir.iterdir()):
                    year_dir.rmdir()

    # Phase 2: Cleanup empty old category dirs
    for old_name in MAPPING.keys():
        old_dir = DRIVE_BASE / old_name
        if old_dir.exists() and old_dir.name not in MAPPING.values():
            if not any(old_dir.iterdir()):
                old_dir.rmdir()
                print(f"Cleaned up old directory: {old_name}")


if __name__ == "__main__":
    consolidate()

```
