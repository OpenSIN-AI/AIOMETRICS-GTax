# Context Fulltext

- source_path: update_plan.ts
- source_sha256: 825c4f323ce87e42c3240c62b54171766b1f4719bccccb9058ce1e33f3e85ce0
- chunk: 1/1

```text
import * as fs from 'fs';

const content = fs.readFileSync('LASTPLAN.md', 'utf8');

let newContent = content.replace('## 1) Ziel (nicht verhandelbar)', '## 1) Ziel (nicht verhandelbar)\n\nFuer ALLE Jahre (nicht nur 2023) muessen ALLE Belege aus dem Hauptordner "Belege" vollstaendig verarbeitet werden:\n- **0 Belege ohne Datum (global)**\n- **0 Belege ohne Betrag (im Jahr)**\n- **0 Duplikat-Belege (im Jahr)**\n- Das Dashboard `Finanz-Cockpit` muss 100% perfekt, benutzerfreundlich und fehlerfrei sein (Finanz-Cockpit 2026 Dynamisch).\n- Einnahmen und Ausgaben Tabs muessen ueber alle Jahre synchronisiert und gepflegt werden.\n');

fs.writeFileSync('LASTPLAN.md', newContent);
console.log('Plan updated.');

```
