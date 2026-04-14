# Context Fulltext

- source_path: src/legacy/manual/delete_zoe_19pct_invoices.ts
- source_sha256: 3c9857032ea7029e386f858e9780758ed1ff70442367a30af737f11de9749798
- chunk: 1/1

```text
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';

const LOCAL_FOLDERS_TO_CLEAN = [
    "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud",
    "/Users/jeremy/NotebookLM/JS - Belegdokumente 2023"
];

async function getPdfText(filePath: string): Promise<string> {
    try {
        const fileBuffer = await fs.promises.readFile(filePath);
        const data = new Uint8Array(fileBuffer);
        const doc = await pdfjs.getDocument(data).promise;
        let text = '';
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => ('str' in item ? item.str : '')).join(' ');
        }
        return text;
    } catch (error: any) {
        // Skip files that can't be read (cloud storage timeouts, etc.)
        if (error.code === 'ETIMEDOUT' || error.message?.includes('ETIMEDOUT')) {
            console.log(`SKIPPED (timeout): ${filePath}`);
            return 'SKIP';
        }
        console.error(`Error reading PDF ${filePath}:`, error.message || error);
        return '';
    }
}

function getLocalFiles(dirPath: string): string[] {
    let allFiles: string[] = [];
    try {
        if (!fs.existsSync(dirPath)) {
            console.log(`Directory does not exist, skipping: ${dirPath}`);
            return [];
        }
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                allFiles = allFiles.concat(getLocalFiles(fullPath));
            } else {
                allFiles.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dirPath}:`, error);
    }
    return allFiles;
}

async function processFiles(files: string[]) {
    let deletedCount = 0;
    let keptCount = 0;

    for (const localFile of files) {
        if (path.extname(localFile).toLowerCase() !== '.pdf') {
            keptCount++;
            continue;
        }

        const text = await getPdfText(localFile);
        
        // Skip files that couldn't be read
        if (text === 'SKIP') {
            keptCount++;
            continue;
        }
        
        const lowerText = text.toLowerCase();

        const isZoeInvoice = lowerText.includes('zoe solar') || lowerText.includes('zukunftsorientierte energie');
        const has19PercentVat = /19,00\s*%|19\s*%|mwst\.\s*19%/.test(lowerText);
        const has0PercentVat = /0,00\s*%|0\s*%|mwst\.\s*0%/.test(lowerText);

        if (isZoeInvoice && has19PercentVat && !has0PercentVat) {
            try {
                fs.unlinkSync(localFile);
                console.log(`DELETED (is ZOE invoice with 19% VAT): ${localFile}`);
                deletedCount++;
            } catch (error) {
                console.error(`Failed to delete ${localFile}:`, error);
                keptCount++;
            }
        } else {
            keptCount++;
        }
    }
    return { deletedCount, keptCount };
}

async function main(): Promise<void> {
    let totalDeleted = 0;
    let totalKept = 0;
    let totalProcessed = 0;
    const chunkSize = 100;

    console.log('Starting ZOE 19% VAT invoice deletion process...');

    for (const folder of LOCAL_FOLDERS_TO_CLEAN) {
        console.log(`\nProcessing folder: ${folder}`);
        const localFiles = getLocalFiles(folder);
        totalProcessed += localFiles.length;

        for (let i = 0; i < localFiles.length; i += chunkSize) {
            const chunk = localFiles.slice(i, i + chunkSize);
            console.log(`Processing chunk ${i / chunkSize + 1} of ${Math.ceil(localFiles.length / chunkSize)}...`);
            const { deletedCount, keptCount } = await processFiles(chunk);
            totalDeleted += deletedCount;
            totalKept += keptCount;
        }
    }

    console.log(`\nDeletion process complete.`);
    console.log(`Files processed: ${totalProcessed}`);
    console.log(`Deleted: ${totalDeleted} files`);
    console.log(`Kept: ${totalKept} files`);
}

main();

```
