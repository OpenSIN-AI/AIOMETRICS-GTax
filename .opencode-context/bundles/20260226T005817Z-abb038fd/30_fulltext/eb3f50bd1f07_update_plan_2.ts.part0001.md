# Context Fulltext

- source_path: update_plan_2.ts
- source_sha256: 3ef1fd5d564fca242b2e88c9b7b1bbdd773f8b4893b5c9ba136329b53970c1ec
- chunk: 1/1

```text
import * as fs from 'fs';

let content = fs.readFileSync('LASTPLAN.md', 'utf8');

// Replace "Fuer 2023 muessen Einnahmen_2023 und Ausgaben_2023:"
content = content.replace(
  'Fuer 2023 muessen `Einnahmen_2023` und `Ausgaben_2023`:',
  'Fuer ALLE JAHRE (z.B. `Einnahmen_2023`, `Ausgaben_2024`, etc.) muessen die Tabellen:'
);

// Add task for Finanz-Cockpit in section B
content = content.replace(
  '## C) Sync + Audit + Report',
  '- [ ] B4 (Gemini): Datenstruktur und Plausibilität für alle Jahre uebersichtbar machen (0 fehlende Daten).\n- [ ] B5 (Gemini): Finanz-Cockpit Layout evaluieren und Fehlerfreiheit sicherstellen (Formeln prÃ¼fen).\n\n## C) Sync + Audit + Report'
);

fs.writeFileSync('LASTPLAN.md', content);
console.log('Plan updated 2.');

```
