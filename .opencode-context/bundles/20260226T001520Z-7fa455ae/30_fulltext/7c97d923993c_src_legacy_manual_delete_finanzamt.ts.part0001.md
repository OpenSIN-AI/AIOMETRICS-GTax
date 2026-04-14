# Context Fulltext

- source_path: src/legacy/manual/delete_finanzamt.ts
- source_sha256: 8880feeb40f7ee6ad7420131daf2a8c58b8e73afe5421bfa5d4e251c6adb4c8a
- chunk: 1/1

```text
import * as fs from 'fs';
import * as path from 'path';

const FOLDER = "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud";

const KEYWORDS = [
    'finanzamt', 'finanzamt berlin', 'finanzbrandenburg',
    'bescheid', 'steuerbescheid', 'einkommensteuerbescheid',
    'steuermitteilung', 'mitteilung vom finanzamt',
    'elster', 'lohnsteuerbescheinigung',
    'steuererklärung', 'steuererklärung 202',
    'vorausgefüllte steuererklärung', 'vaSt'
];

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
    console.log('[FINANZAMT] Starting scan...');
    const files = getLocalFiles(FOLDER);
    let deleted = 0;
    
    for (const f of files) {
        const bn = path.basename(f).toLowerCase();
        if (KEYWORDS.some(k => bn.includes(k))) {
            try {
                fs.unlinkSync(f);
                console.log(`[FINANZAMT] DELETED: ${path.basename(f)}`);
                deleted++;
            } catch (e) { console.error(`[FINANZAMT] Failed: ${f}`); }
        }
    }
    console.log(`[FINANZAMT] Done. Deleted: ${deleted}`);
}

main();

```
