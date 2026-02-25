import { google } from 'googleapis';
import * as fs from 'fs';

const FOLDER_ID = '1n750UVJdcNSV-1Uo0vjKv2gAtS8jegfz';
const CREDENTIALS_PATH = '/Users/jeremy/dev/Meine-Google-Credentials/credentials.json';

async function main() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive']
    });
    
    const drive = google.drive({ version: 'v3', auth });
    
    console.log(`[DRIVE] Fetching files from folder: ${FOLDER_ID}`);
    
    let files: any[] = [];
    let pageToken: string | null = null;
    
    do {
        const response = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageSize: 100,
            pageToken: pageToken || undefined
        });
        
        if (response.data.files) {
            files = files.concat(response.data.files);
        }
        pageToken = response.data.nextPageToken || null;
    } while (pageToken);
    
    console.log(`[DRIVE] Found ${files.length} files`);
    
    let deleted = 0;
    let errors = 0;
    
    for (const file of files) {
        try {
            await drive.files.delete({ fileId: file.id! });
            console.log(`[DRIVE] DELETED: ${file.name}`);
            deleted++;
        } catch (e: any) {
            console.error(`[DRIVE] ERROR: ${file.name} - ${e.message}`);
            errors++;
        }
    }
    
    console.log(`\n=== DONE ===`);
    console.log(`Deleted: ${deleted}`);
    console.log(`Errors: ${errors}`);
}

main().catch(console.error);
