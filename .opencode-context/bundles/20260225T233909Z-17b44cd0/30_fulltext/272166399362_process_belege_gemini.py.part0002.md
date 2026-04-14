# Context Fulltext

- source_path: process_belege_gemini.py
- source_sha256: fc1e2e4c7a66075de192736f7569b4d3aee68fa15a96bbe6dee28801ff1cb198
- chunk: 2/2

```text
R"] += 1
                    try:
                        if file_path.exists():
                            shutil.move(str(file_path), str(ERROR_DIR / file_path.name))
                    except Exception:
                        pass
                    continue
                
                target_dir = (AUSGABEN_DIR_BASE if category == "AUSGABE" else EINNAHMEN_DIR_BASE) / year
                ensure_dir(target_dir)
                target_path = target_dir / new_filename
                
                try:
                    if file_path.exists():
                        shutil.move(str(file_path), str(target_path))
                        stats[category] = stats.get(category, 0) + 1
                        print(f"[{done}/{total}] ✅ {category}: {file_path.name} -> {new_filename}")
                except Exception as e:
                    print(f"[{done}/{total}] ❌ FEHLER beim Verschieben von {file_path.name}: {e}")
                    stats["FEHLER"] += 1
            else:
                print(f"[{done}/{total}] 💥 KI-FEHLER bei {file_path.name}: {result_data}")
                stats["FEHLER"] += 1
                try:
                    if file_path.exists():
                        shutil.move(str(file_path), str(ERROR_DIR / file_path.name))
                except Exception:
                    pass

    print("\n" + "=" * 80)
    print("📊 ERGEBNIS KI-DURCHLAUF")
    print("=" * 80)
    for k, v in stats.items():
        print(f"{k}: {v}")
    print("=" * 80)

if __name__ == "__main__":
    main()

```
