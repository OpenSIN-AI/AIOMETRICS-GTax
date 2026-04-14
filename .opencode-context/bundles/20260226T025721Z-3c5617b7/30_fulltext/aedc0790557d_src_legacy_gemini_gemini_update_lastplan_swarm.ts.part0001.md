# Context Fulltext

- source_path: src/legacy/gemini/gemini_update_lastplan_swarm.ts
- source_sha256: 6cb575936e2342a6c098aedf87f2d8640ed4f864c253045d403f6ce20c2c74d7
- chunk: 1/1

```text
import * as fs from 'fs';

const planPath = '/Users/jeremy/dev/AIOMETRICS-GTax/LASTPLAN.md';
let plan = fs.readFileSync(planPath, 'utf8');

const swarmUpdate = `
## 23) OCR Swarm Active (Gemini, 2026-02-24)

**Maßnahme:**
- OCR-Prozess parallelisiert ("Swarm").
- Skript \`start_ocr_swarm.sh\` startet 3 Worker gleichzeitig (\`gemini_ocr_worker.ts\`).
- Jeder Worker wählt zufällig 20 offene Dateien aus, um Kollisionen zu vermeiden.
- Ziel: Schnellerer Durchsatz der 4000+ fehlenden Texte.

**Anweisung an Codex:**
- Bitte \`./start_ocr_swarm.sh\` regelmäßig ausführen oder in den Cron/Loop aufnehmen, bis "Missing Text" auf 0 sinkt.
- Erst danach macht der "Zoe Solar Audit" Sinn.
`;

plan += swarmUpdate;
fs.writeFileSync(planPath, plan);
console.log('LASTPLAN.md updated with OCR Swarm info.');

```
