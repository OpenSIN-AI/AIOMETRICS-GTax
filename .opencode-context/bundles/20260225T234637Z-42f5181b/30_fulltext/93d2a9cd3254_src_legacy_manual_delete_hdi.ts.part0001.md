# Context Fulltext

- source_path: src/legacy/manual/delete_hdi.ts
- source_sha256: aea00b097b09933521e016a43c7c2b2541f506905a8596100e3880db9eaa62f8
- chunk: 1/1

```text
import * as fs from 'fs';
import * as path from 'path';

const FOLDER = "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud";

const KEYWORDS = ['hdi', 'hdi.de', 'hdi versicherung', 'hdi direkt'];

function getLocalFiles(dirPath: string): string[] {
    let allFiles: string[] = [];
    try {
        if (!fs.existsSync(dirPath)) return [];
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                allFiles = allFiles.concat(getLocalFiles(fullPath));
            } else {
                allFiles.push(fullPath);
            }
        }
    } catch (e) { /* ignore */ }
    return allFiles;
}

async function main() {
    console.log('[HDI] Starting scan...');
    const files = getLocalFiles(FOLDER);
    let deleted = 0;
    
    for (const f of files) {
        const bn = path.basename(f).toLowerCase();
        if (KEYWORDS.some(k => bn.includes(k))) {
            try {
                fs.unlinkSync(f);
                console.log(`[HDI] DELETED: ${path.basename(f)}`);
                deleted++;
            } catch (e) { console.error(`[HDI] Failed: ${f}`); }
        }
    }
    console.log(`[HDI] Done. Deleted: ${deleted}`);
}

main();

```
