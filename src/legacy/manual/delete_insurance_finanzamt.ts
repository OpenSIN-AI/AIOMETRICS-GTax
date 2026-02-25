import * as fs from 'fs';
import * as path from 'path';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';

const FOLDER = "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud";

const INSURANCE_KEYWORDS = ['aok', 'sbk', 'hdi', 'arag', 'techniker krankenkasse', 'tk', 'barmer', 'dak', 'ik'];
const FINANZAMT_KEYWORDS = ['finanzamt', 'steuerbescheid', 'einkommensteuer', 'umsatzsteuer', 'bescheid', 'elster', 'lohnsteuer'];

async function getPdfText(filePath: string): Promise<string> {
    try {
        const fileBuffer = await fs.promises.readFile(filePath);
        const data = new Uint8Array(fileBuffer);
        const doc = await pdfjs.getDocument(data).promise;
        let text = '';
        for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map((item: any) => ('str' in item ? item.str : '')).join(' ');
        }
        return text;
    } catch (e: any) {
        if (e.code === 'ETIMEDOUT') return 'TIMEOUT';
        return 'ERROR';
    }
}

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
    console.log('[INSURANCE+FINANZAMT] Starting scan...');
    const files = getLocalFiles(FOLDER);
    console.log(`Found ${files.length} PDF files`);
    
    let insuranceDeleted = 0;
    let finanzamtDeleted = 0;
    let errors = 0;
    let timeouts = 0;

    for (const f of files) {
        const text = await getPdfText(f);
        if (text === 'TIMEOUT') { timeouts++; continue; }
        if (text === 'ERROR') { errors++; continue; }
        
        const lower = text.toLowerCase();
        
        // Insurance companies
        if (INSURANCE_KEYWORDS.some(k => lower.includes(k))) {
            try {
                fs.unlinkSync(f);
                console.log(`[INSURANCE] DELETED: ${path.basename(f)}`);
                insuranceDeleted++;
            } catch (e) { console.error(`Failed: ${f}`); }
        }
        // Finanzamt
        else if (FINANZAMT_KEYWORDS.some(k => lower.includes(k))) {
            try {
                fs.unlinkSync(f);
                console.log(`[FINANZAMT] DELETED: ${path.basename(f)}`);
                finanzamtDeleted++;
            } catch (e) { console.error(`Failed: ${f}`); }
        }
    }
    
    console.log(`\n=== DONE ===`);
    console.log(`Insurance deleted: ${insuranceDeleted}`);
    console.log(`Finanzamt deleted: ${finanzamtDeleted}`);
    console.log(`Errors: ${errors}, Timeouts: ${timeouts}`);
}

main();
