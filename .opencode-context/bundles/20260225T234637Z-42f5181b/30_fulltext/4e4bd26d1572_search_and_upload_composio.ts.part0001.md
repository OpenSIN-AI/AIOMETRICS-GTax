# Context Fulltext

- source_path: search_and_upload_composio.ts
- source_sha256: 624328d6d0d5245a256deea00c5afe52e2df1091648d7dfb04aa248d1a86e088
- chunk: 1/1

```text
import axios from 'axios';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

const COMPOSIO_API_KEY = [REDACTED];
const DRIVE_FOLDER_ID = "1xoOfpTUwxMa_pIHoP71aCDH0Eb03tzyf";
const GOOGLE_CREDENTIALS_PATH = "/Users/jeremy/dev/Meine-Google-Credentials/credentials.json";

const CONTRACT_KEYWORDS = [
    "Vertrag", "Vereinbarung", "Mitgliedschaft", "Subscription", 
    "Abonnement", "Kaufvertrag", "Mietvertrag", "Versicherung"
];
const EXCLUDE_KEYWORDS = ["rechnung", "beleg", "invoice", "receipt", "quittung"];

async function main() {
    const auth = new JWT({
        keyFile: [REDACTED]
        scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    const drive = google.drive({ version: 'v3', auth });

    console.log("Fetching connected Gmail accounts from Composio...");
    const accountsResp = await axios.get("https://backend.composio.dev/api/v3/connected_accounts?status=ACTIVE", {
        headers: [REDACTED]
    });
    const gmailAccounts = accountsResp.data.items.filter((acc: any) => acc.toolkit.slug.includes("gmail"));

    console.log(`Found ${gmailAccounts.length} active Gmail accounts.`);

    for (const acc of gmailAccounts) {
        console.log(`\nSearching account: ${acc.id}`);
        
        for (const kw of CONTRACT_KEYWORDS) {
            const query = `${kw} ${EXCLUDE_KEYWORDS.map(ex => `-${ex}`).join(" ")} has:attachment`;
            console.log(`  Query: ${query}`);
            
            try {
                const fetchResp = await axios.post("https://backend.composio.dev/api/v1/execute", {
                    action: "gmail_fetch_emails", // lowercase attempt
                    parameters: { query, max_results: 10 },
                    connectedAccountId: acc.id
                }, { headers: [REDACTED]

                const messages = fetchResp.data.output?.data || fetchResp.data.output?.messages || [];
                if (!Array.isArray(messages)) continue;

                for (const msg of messages) {
                    console.log(`    Processing message ID: ${msg.id}`);
                    
                    const detailsResp = await axios.post("https://backend.composio.dev/api/v1/execute", {
                        action: "gmail_get_mail",
                        parameters: { message_id: msg.id },
                        connectedAccountId: acc.id
                    }, { headers: [REDACTED]

                    const payload = detailsResp.data.output?.payload || {};
                    const parts = payload.parts || [];
                    
                    const findAttachments = (partsList: any[], found: any[] = []) => {
                        for (const p of partsList) {
                            if (p.filename && p.body?.attachmentId) found.push(p);
                            if (p.parts) findAttachments(p.parts, found);
                        }
                        return found;
                    };

                    const attachments = findAttachments(parts);
                    for (const att of attachments) {
                        console.log(`      Found attachment: ${att.filename}`);
                        
                        const attResp = await axios.post("https://backend.composio.dev/api/v1/execute", {
                            action: "gmail_get_attachment",
                            parameters: { message_id: msg.id, attachment_id: att.body.attachmentId },
                            connectedAccountId: acc.id
                        }, { headers: [REDACTED]

                        const base64Data = attResp.data.output?.data || attResp.data.output?.attachmentData;
                        if (base64Data) {
                            const tempPath = path.join("/tmp", att.filename);
                            fs.writeFileSync(tempPath, Buffer.from(base64Data, 'base64'));
                            
                            console.log(`      Uploading ${att.filename} to Drive...`);
                            await drive.files.create({
                                requestBody: { name: att.filename, parents: [DRIVE_FOLDER_ID] },
                                media: { mimeType: att.mimeType, body: fs.createReadStream(tempPath) }
                            });
                            fs.unlinkSync(tempPath);
                        }
                    }
                }
            } catch (err: any) {
                console.error(`  Error searching for ${kw}: ${err.message}`);
                if (err.response?.data) console.error("  Details:", err.response.data);
            }
        }
    }
}

main().catch(console.error);

```
