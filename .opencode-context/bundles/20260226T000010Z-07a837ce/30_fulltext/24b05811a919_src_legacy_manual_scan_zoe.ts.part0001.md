# Context Fulltext

- source_path: src/legacy/manual/scan_zoe.ts
- source_sha256: b2701382965a0fbdcd718ce161e1fd19c3f7e61ddb79c9e80dbe732a8a5138b1
- chunk: 1/1

```text
import * as fs from 'fs';
import * as path from 'path';

const FOLDER = "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud";

const ZOE_KEYWORDS = ['zoe', 'z.e50', 'zoe50', 'renault zoe', 'zoe solar'];

function getLocalFiles(dirPath: string): string[] {
    let allFiles: string[] = [];
    try {
        if (!fs.existsSync(dirPath)) return [];
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                allFiles = allFiles.concat(getLocalFiles(fullPath));
            } else if (entry.name.toLowerCase().endsWith('.pdf')) {
                allFiles.push(fullPath);
            }
        }
    } catch (e) { /* ignore */ }
    return allFiles;
}

async function main() {
    console.log('[ZOE] Starting scan...');
    const files = getLocalFiles(FOLDER);
    console.log(`Found ${files.length} PDF files total`);
    
    let zoeFiles: string[] = [];
    let batch = 0;
    
    for (const f of files) {
        const bn = path.basename(f).toLowerCase();
        if (ZOE_KEYWORDS.some(k => bn.includes(k))) {
            zoeFiles.push(bn);
        }
        batch++;
    }
    
    console.log(`\nFound ${zoeFiles.length} ZOE-related files:`);
    zoeFiles.forEach(f => console.log(`  - ${f}`));
    
    console.log(`\n[ZOE] Total remaining: ${zoeFiles.length}`);
}

main();

```
