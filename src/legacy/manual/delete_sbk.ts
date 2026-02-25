import * as fs from 'fs';
import * as path from 'path';

const FOLDER = "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud";

const KEYWORDS = ['sbk', 'sbk.de', 'sparkassen briefkopf', 'sparkasse'];

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
    console.log('[SBK] Starting scan...');
    const files = getLocalFiles(FOLDER);
    let deleted = 0;
    
    for (const f of files) {
        const bn = path.basename(f).toLowerCase();
        if (KEYWORDS.some(k => bn.includes(k))) {
            try {
                fs.unlinkSync(f);
                console.log(`[SBK] DELETED: ${path.basename(f)}`);
                deleted++;
            } catch (e) { console.error(`[SBK] Failed: ${f}`); }
        }
    }
    console.log(`[SBK] Done. Deleted: ${deleted}`);
}

main();
