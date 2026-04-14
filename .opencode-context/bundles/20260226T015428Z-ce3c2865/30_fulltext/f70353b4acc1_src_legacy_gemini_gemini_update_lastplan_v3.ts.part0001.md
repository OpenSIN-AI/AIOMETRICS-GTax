# Context Fulltext

- source_path: src/legacy/gemini/gemini_update_lastplan_v3.ts
- source_sha256: 03ad0e05f78b132c0d1fc67f9bf5a01e2f9c6d363a91d5bf16815fa61770a52b
- chunk: 1/1

```text
import * as fs from 'fs';

const planPath = '/Users/jeremy/dev/AIOMETRICS-GTax/LASTPLAN.md';
let plan = fs.readFileSync(planPath, 'utf8');

const updatedRequirements = `
## 19) Update Requirements & Qwen Fallback (User Directives 2026-02-24)

**Harte Anforderungen (Update):**
1. **Globaler Scope:** Nicht nur 2023! Alle Belege aller Jahre müssen geprüft und korrekt sortiert sein (keine falsch-jahrierten Belege).
2. **1:1 Synchronität:** Einnahmen/Ausgaben Sheet vs. Drive muss 100% übereinstimmen. Eigenbelege, Finanzcockpit, EÜR müssen konsistent sein.
3. **Zahlungsnachweise:** Ordner \`1V0hfwXyvtzcWvb7INdf7z7jYdytyk9zU\` erneut prüfen. Falls leer (aktuell der Fall), User informieren oder warten. Falls Dateien da sind -> Abgleich mit Einnahmen -> Rest nach "Fehlende Belege".
4. **OCR Fallback:** Wenn Tesseract/Gemini-Flash fehlschlägt, **MUSS** auf **Nvidia Qwen 3.5** (\`qwen/qwen3.5-397b-a17b\`) zurückgegriffen werden (siehe \`docs/NVIDIA_QWEN_FALLBACK.md\`). Das Modell kann auch Bilder/Videos verstehen.

**Anweisungen für Batch C (Codex):**
1. **OCR-Lauf:** Fortsetzen, aber Qwen 3.5 Fallback einbauen.
2. **Global Audit:** Prüfe auf falsch sortierte Jahre in *allen* Ordnern.
3. **Sync:** Stelle sicher, dass Sheets und Drive 1:1 sind.
4. **Zoe Solar:** Sobald Text da ist, Deep Analysis fahren.
`;

plan += updatedRequirements;
fs.writeFileSync(planPath, plan);
console.log('LASTPLAN.md updated with Qwen fallback and global requirements.');

```
