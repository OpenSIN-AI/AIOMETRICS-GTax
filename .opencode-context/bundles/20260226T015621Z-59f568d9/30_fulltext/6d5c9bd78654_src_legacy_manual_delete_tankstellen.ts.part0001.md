# Context Fulltext

- source_path: src/legacy/manual/delete_tankstellen.ts
- source_sha256: 7c68dfdf62e16bea08981db55c0bd58389563ef5287b4c5baf68244c0b75b403
- chunk: 1/1

```text
import * as fs from 'fs';
import * as path from 'path';

const FOLDER = "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud";

const GAS_STATIONS = ['shell', 'totalenergies', 'aral', 'bp', 'esso', 'star', 'orlen', 'jet', 'shell re', 'tanken', 'tankstelle'];

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
    console.log('[TANKSTELLEN] Starting scan...');
    const files = getLocalFiles(FOLDER);
    console.log(`Found ${files.length} PDF files`);
    
    let deleted = 0;
    let batch = 0;
    
    for (const f of files) {
        const bn = path.basename(f).toLowerCase();
        if (GAS_STATIONS.some(k => bn.includes(k))) {
            try {
                fs.unlinkSync(f);
                console.log(`[TANKSTELLEN] DELETED: ${bn}`);
                deleted++;
            } catch (e) { console.error(`Failed: ${bn}`); }
        }
        batch++;
        if (batch % 50 === 0) {
            console.log(`[TANKSTELLEN] Processed ${batch} files...`);
        }
    }
    
    console.log(`\n[TANKSTELLEN] Done. Deleted: ${deleted}`);
}

main();

```
