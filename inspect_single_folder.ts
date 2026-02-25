import 'dotenv/config';
import { google } from 'googleapis';

async function main(): Promise<void> {
  const folderId = '1ksurKQAYf9vxSg9SV-KYYqV0ojKMuJge';
  const auth = new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_CREDENTIALS_PATH, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const drive = google.drive({ version: 'v3', auth });
  const r = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,mimeType,webViewLink,createdTime,modifiedTime)',
    pageSize: 1000,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  const files = r.data.files || [];
  console.log(JSON.stringify({ folderId, count: files.length, sample: files.slice(0, 20) }, null, 2));
}
main().catch((e)=>{console.error(e);process.exit(1);});
