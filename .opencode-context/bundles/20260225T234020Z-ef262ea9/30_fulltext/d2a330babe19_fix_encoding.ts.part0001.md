# Context Fulltext

- source_path: fix_encoding.ts
- source_sha256: 9c87f9de9def41b4ccaf646510064c3bf8378fcbb9c9156a5ad06c5fc712bea6
- chunk: 1/1

```text
import * as fs from 'fs';
let content = fs.readFileSync('LASTPLAN.md', 'utf8');
content = content.replace('prÃ¼fen', 'pruefen');
fs.writeFileSync('LASTPLAN.md', content);

```
