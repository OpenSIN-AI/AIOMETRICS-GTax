import * as fs from 'fs';
import * as path from 'path';

const LOCAL_FOLDERS_TO_CLEAN = [
    "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Geteilte Ablagen/Belege/DAPNC Cloud",
    "/Users/jeremy/NotebookLM/JS - Belegdokumente 2023"
];

const KEYWORDS_TO_DELETE = [
    'lidl', 'rewe', 'ionos', 'wolt', 'flink', 
    'getränke hoffmann', 'edeka', 'miete', 'vattenfall', 
    'lieferando', 'hdi', 'woolworth'
];

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

function main(): void {
    let deletedCount = 0;
    let keptCount = 0;

    console.log('Starting specific file deletion process...');

    for (const folder of LOCAL_FOLDERS_TO_CLEAN) {
        console.log(`\nProcessing folder: ${folder}`);
        const localFiles = getLocalFiles(folder);

        for (const localFile of localFiles) {
            const fileName = path.basename(localFile).toLowerCase();
            const shouldDelete = KEYWORDS_TO_DELETE.some(keyword => fileName.includes(keyword));

            if (shouldDelete) {
                try {
                    fs.unlinkSync(localFile);
                    console.log(`DELETED: ${localFile}`);
                    deletedCount++;
                } catch (error) {
                    console.error(`Failed to delete ${localFile}:`, error);
                }
            } else {
                keptCount++;
            }
        }
    }

    console.log(`\nDeletion process complete.`);
    console.log(`Deleted: ${deletedCount} files`);
    console.log(`Kept: ${keptCount} files`);
}

main();
