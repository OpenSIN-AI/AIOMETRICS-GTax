# Context Fulltext

- source_path: inspect_single_folder.ts
- source_sha256: 638fffe6f6c2ce2b136f294812eb27aa04521534dc26df75a43ef3e3bd475fb2
- chunk: 1/1

```text
import 'dotenv/config';
import { google } from 'googleapis';

async function main(): Promise<void> {
  const folderId = '1ksurKQAYf9vxSg9SV-KYYqV0ojKMuJge';
  const auth = new google.auth.GoogleAuth({ keyFile: [REDACTED]
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

```
