import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

const GOOGLE_CREDENTIALS_PATH = "/Users/jeremy/dev/Meine-Google-Credentials/credentials.json";
const DRIVE_FOLDER_ID = "1xoOfpTUwxMa_pIHoP71aCDH0Eb03tzyf";

const USERS = [
    'j.schulze@zoe-solar.de',
    'js@zoe-solar.de',
    'jerry.schulze@zukunftsorientierte-energie.de',
    'jeremy.schulze@zukunftsorientierte-energie.de',
    'simone.schulze@zoe-solar.de',
    's.schulze@zoe-solar.de'
];

const CONTRACT_KEYWORDS = [
    "Vertrag", "Vereinbarung", "Mitgliedschaft", "Subscription", 
    "Abonnement", "Kaufvertrag", "Mietvertrag", "Versicherung"
];

async function main() {
    for (const email of USERS) {
        console.log(`\nTesting access for ${email}...`);
        const auth = new JWT({
            keyFile: GOOGLE_CREDENTIALS_PATH,
            scopes: [
                'https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/drive.file'
            ],
            subject: email
        });

        const gmail = google.gmail({ version: 'v1', auth });
        const drive = google.drive({ version: 'v3', auth });

        try {
            await gmail.users.getProfile({ userId: 'me' });
            console.log(`Access granted for ${email}. Searching...`);

            const query = `(${CONTRACT_KEYWORDS.join(' OR ')}) -rechnung -beleg -invoice -receipt -quittung has:attachment`;
            const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 50 });
            const messages = res.data.messages || [];
            console.log(`Found ${messages.length} messages.`);

            for (const message of messages) {
                const msg = await gmail.users.messages.get({ userId: 'me', id: message.id! });
                const subject = msg.data.payload?.headers?.find(h => h.name === 'Subject')?.value;
                console.log(`  Processing: ${subject}`);

                const findAttachments = (partsList: any[], found: any[] = []) => {
                    for (const p of partsList) {
                        if (p.filename && p.body?.attachmentId) found.push(p);
                        if (p.parts) findAttachments(p.parts, found);
                    }
                    return found;
                };

                const attachments = findAttachments(msg.data.payload?.parts || []);
                for (const att of attachments) {
                    if (att.filename.toLowerCase().includes('rechnung') || att.filename.toLowerCase().includes('invoice')) continue;
                    
                    console.log(`    Downloading: ${att.filename}`);
                    const attData = await gmail.users.messages.attachments.get({
                        userId: 'me',
                        messageId: message.id!,
                        id: att.body.attachmentId
                    });

                    const tempPath = path.join('/tmp', att.filename);
                    fs.writeFileSync(tempPath, Buffer.from(attData.data.data!, 'base64'));

                    console.log(`    Uploading to Drive...`);
                    await drive.files.create({
                        requestBody: { name: att.filename, parents: [DRIVE_FOLDER_ID] },
                        media: { mimeType: att.mimeType, body: fs.createReadStream(tempPath) }
                    });
                    fs.unlinkSync(tempPath);
                }
            }
        } catch (err: any) {
            console.log(`Access failed for ${email}: ${err.message}`);
        }
    }
}

main().catch(console.error);
