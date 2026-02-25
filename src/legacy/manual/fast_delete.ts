import * as fs from 'fs';
import * as path from 'path';

const FOLDERS = [
    "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud",
    "/Users/jeremy/NotebookLM/JS - Belegdokumente 2023"
];

// Fast filename-only deletion
const DELETE_KEYWORDS = [
    'aok', 'sbk', 'hdi', 'arag', 'tk', 'barmer', 'dak', 'techniker',
    'finanzamt', 'steuerbescheid', 'elster', 'bescheid',
    'tankstelle', 'shell', 'total', 'aral', 'bp', 'esso', 'jet', 'orlen'
];

function getFiles(dir: string): string[] {
    let files: string[] = [];
    try {
        if (!fs.existsSync(dir)) return [];
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) files = files.concat(getFiles(p));
            else if (e.name.toLowerCase().endsWith('.pdf')) files.push(p);
        }
    } catch (e) {
        // ignore traversal error
    }
    return files;
}

function main() {
    let deleted = 0;
    for (const folder of FOLDERS) {
        const files = getFiles(folder);
        for (const f of files) {
            const bn = path.basename(f).toLowerCase();
            if (DELETE_KEYWORDS.some(k => bn.includes(k))) {
                try { fs.unlinkSync(f); deleted++; console.log(`DEL: ${bn}`); } catch (e) {
                    // ignore delete error
                }
            }
        }
    }
    console.log(`\n=== DONE: ${deleted} files deleted ===`);
}
main();
