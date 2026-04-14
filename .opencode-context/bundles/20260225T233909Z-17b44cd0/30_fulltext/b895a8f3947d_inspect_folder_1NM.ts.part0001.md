# Context Fulltext

- source_path: inspect_folder_1NM.ts
- source_sha256: f1358ac410b6c60afae2ed971b5aba8efedd4c37352433e136ecf25a8efd7dcb
- chunk: 1/1

```text
import 'dotenv/config';
import { google } from 'googleapis';

async function main(): Promise<void> {
  const id = '1NMlTFDw6SsyVEy5aimP0Awz3Tq3N1_vH';
  const auth = new google.auth.GoogleAuth({ keyFile: [REDACTED]
  const drive = google.drive({ version: 'v3', auth });
  const [meta, list] = await Promise.all([
    drive.files.get({ fileId: id, fields: 'id,name,parents', supportsAllDrives: true }),
    drive.files.list({
      q: `'${id}' in parents and trashed=false`,
      fields: [REDACTED]
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    })
  ]);
  const files = list.data.files || [];
  const privateWords = ['lidl','rewe','edeka','flink','wolt','lieferando','netflix','apotheke','tierfutter','drogerie','lebensmittel','zigarette','tabak','bier'];
  const hits = files.filter(f => privateWords.some(w => (f.name || '').toLowerCase().includes(w)));
  console.log(JSON.stringify({meta: meta.data, count: files.length, privateNameHits: hits.length, sample: files.slice(0,20), hitSample: hits.slice(0,30)}, null, 2));
}
main().catch((e)=>{console.error(e);process.exit(1);});

```
