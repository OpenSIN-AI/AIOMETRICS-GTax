import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const GOOGLE_CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || './meine-google-credentials/credentials.json';
const DRIVE_FOLDER_ID = '1xoOfpTUwxMa_pIHoP71aCDH0Eb03tzyf';

async function main() {
  const credentials = JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, 'utf-8'));
  const serviceAccountEmail = credentials.client_email;
  
  console.log(`Service Account: ${serviceAccountEmail}`);

  // Versuche es mit jeremy.schulze@gmail.com
  const user = 'jeremy.schulze@gmail.com';
  console.log(`Trying subject: ${user}...`);
  
  const userAuth = new JWT({
    keyFile: GOOGLE_CREDENTIALS_PATH,
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/drive.file'
    ],
    subject: user
  });

  try {
    const gmail = google.gmail({ version: 'v1', auth: userAuth });
    await gmail.users.getProfile({ userId: 'me' });
    console.log(`Success! Subject ${user} is working.`);
    await searchAndUpload(userAuth, user);
  } catch (e: any) {
    console.log(`Failed for ${user}: ${e.message}`);
    
    // Letzter Versuch: info@zoe-solar.de ohne Delegation (unwahrscheinlich, aber wer weiß)
    console.log('Trying without subject (direct Service Account access)...');
    const directAuth = new JWT({
      keyFile: GOOGLE_CREDENTIALS_PATH,
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/drive.file'
      ]
    });
    try {
      const directGmail = google.gmail({ version: 'v1', auth: directAuth });
      await directGmail.users.getProfile({ userId: 'me' });
      console.log('Success! Direct Service Account access is working.');
      await searchAndUpload(directAuth, 'Service Account');
    } catch (e2: any) {
      console.log(`Direct access failed: ${e2.message}`);
    }
  }
}

async function searchAndUpload(auth: JWT, email: string) {
  const gmail = google.gmail({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });
  
  // Breitere Suche
  const query = 'Vertrag OR Vereinbarung OR Mitgliedschaft OR Subscription OR Abonnement OR "Kaufvertrag" OR "Mietvertrag"';
  const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 100 });
  const messages = res.data.messages || [];
  
  console.log(`Searching for contracts in ${email}... Found ${messages.length} messages.`);

  for (const message of messages) {
    const msg = await gmail.users.messages.get({ userId: 'me', id: message.id! });
    const subject = msg.data.payload?.headers?.find(h => h.name === 'Subject')?.value;
    
    // Filtere Rechnungen im Skript, um flexibler zu sein
    if (subject?.toLowerCase().includes('rechnung') || subject?.toLowerCase().includes('beleg') || subject?.toLowerCase().includes('invoice')) {
      continue;
    }

    console.log(`Processing: ${subject}`);

    const findAttachments = (partsList: any[], attachments: any[] = []) => {
      for (const part of partsList) {
        if (part.filename && part.body?.attachmentId) attachments.push(part);
        if (part.parts) findAttachments(part.parts, attachments);
      }
      return attachments;
    };
    
    const attachments = findAttachments(msg.data.payload?.parts || []);

    for (const part of attachments) {
      if (part.filename.toLowerCase().includes('rechnung') || part.filename.toLowerCase().includes('invoice')) continue;

      console.log(`  Found attachment: ${part.filename}`);
      const attachment = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: message.id!,
        id: part.body.attachmentId
      });
      const data = Buffer.from(attachment.data.data!, 'base64');
      const tempPath = path.join('/tmp', part.filename);
      fs.writeFileSync(tempPath, data);
      
      console.log(`  Uploading ${part.filename} to Drive...`);
      await drive.files.create({
        requestBody: { name: part.filename, parents: [DRIVE_FOLDER_ID] },
        media: { mimeType: part.mimeType!, body: fs.createReadStream(tempPath) }
      });
      fs.unlinkSync(tempPath);
    }
  }
}

main().catch(() => {});
