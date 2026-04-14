# Context Fulltext

- source_path: src/legacy/manual/scan_ocr.ts
- source_sha256: 7fb44eb3db179c91441f1e515c6cfc2241a5e7d013ddd02a3b1ff2aa5368b0ab
- chunk: 1/1

```text
import * as fs from 'fs';
import * as path from 'path';

const FOLDER = "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud";

// Files that need OCR (small, possibly scanned images)
const OCR_SIZE_KB = 100;

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
    console.log('[OCR-SCAN] Scanning for files needing OCR...');
    const files = getLocalFiles(FOLDER);
    
    let smallFiles: {path: string, size: number}[] = [];
    let totalSize = 0;
    
    for (const f of files) {
        try {
            const stats = fs.statSync(f);
            totalSize += stats.size;
            if (stats.size < OCR_SIZE_KB * 1024) {
                smallFiles.push({ path: f, size: stats.size });
            }
        } catch (e) { /* ignore */ }
    }
    
    console.log(`\nTotal PDFs: ${files.length}`);
    console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
    console.log(`Small files (<${OCR_SIZE_KB}KB): ${smallFiles.length}`);
    
    smallFiles.sort((a, b) => a.size - b.size);
    
    console.log(`\nTop 20 smallest files (likely OCR candidates):`);
    smallFiles.slice(0, 20).forEach(f => {
        console.log(`  ${(f.size/1024).toFixed(1)}KB - ${path.basename(f.path)}`);
    });
}

main();

```
