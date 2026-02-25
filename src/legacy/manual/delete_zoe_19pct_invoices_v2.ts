import * as fs from 'fs';
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
            text += content.items.map((item: any) => ('str' in item ? item.str : '')).join(' ');
        }
        return text;
    } catch (error: any) {
        if (error.code === 'ETIMEDOUT' || error.message?.includes('ETIMEDOUT')) {
            console.log(`SKIP_TIMEOUT: ${path.basename(filePath)}`);
            return 'TIMEOUT';
        }
        console.error(`Error reading PDF ${path.basename(filePath)}:`, error.message || error);
        return 'ERROR';
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

async function main(): Promise<void> {
    console.log('Starting ZOE 19% VAT invoice scan...\n');
    
    let totalScanned = 0;
    let deletedCount = 0;
    let keptCount = 0;
    let timeoutCount = 0;
    let errorCount = 0;

    for (const folder of LOCAL_FOLDERS_TO_CLEAN) {
        console.log(`\nScanning folder: ${folder}`);
        const localFiles = getLocalFiles(folder);
        
        // First pass: find PDFs that might be ZOE invoices (by filename)
        const potentialZoeFiles = localFiles.filter(f => {
            const ext = path.extname(f).toLowerCase();
            const basename = path.basename(f).toLowerCase();
            return ext === '.pdf' && (
                basename.includes('zoe') || 
                basename.includes('solar') ||
                basename.includes('zukunftsorientierte')
            );
        });
        
        console.log(`Found ${potentialZoeFiles.length} potential ZOE PDF files (by filename)`);
        
        // Second pass: read content to check for 19% VAT
        for (const pdfFile of potentialZoeFiles) {
            totalScanned++;
            const text = await getPdfText(pdfFile);
            
            if (text === 'TIMEOUT') {
                timeoutCount++;
                continue;
            }
            if (text === 'ERROR') {
                errorCount++;
                continue;
            }
            
            const lowerText = text.toLowerCase();
            const isZoeInvoice = lowerText.includes('zoe solar') || lowerText.includes('zukunftsorientierte energie');
            const has19PercentVat = /19,00\s*%|19\s*%|mwst\.\s*19%/.test(lowerText);
            const has0PercentVat = /0,00\s*%|0\s*%|mwst\.\s*0%/.test(lowerText);
            
            if (isZoeInvoice && has19PercentVat && !has0PercentVat) {
                try {
                    fs.unlinkSync(pdfFile);
                    console.log(`DELETED: ${path.basename(pdfFile)}`);
                    deletedCount++;
                } catch (err) {
                    console.error(`Failed to delete ${pdfFile}:`, err);
                    keptCount++;
                }
            } else {
                keptCount++;
            }
        }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Total files scanned: ${totalScanned}`);
    console.log(`Deleted (19% VAT): ${deletedCount}`);
    console.log(`Kept: ${keptCount}`);
    console.log(`Timeout (cloud storage): ${timeoutCount}`);
    console.log(`Errors: ${errorCount}`);
}

main();
