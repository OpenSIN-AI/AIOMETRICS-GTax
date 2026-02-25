import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function checkDashboard() {
  console.log('--- STARTING DASHBOARD EVALUATION ---');
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetTitles = meta.data.sheets?.map(s => s.properties?.title) || [];
    
    if (sheetTitles.includes('Finanz-Cockpit')) {
       console.log('Finanz-Cockpit exists. Checking content...');
       const resp = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Finanz-Cockpit!A1:Z50'
       });
       
       if (resp.data.values && resp.data.values.length > 0) {
           console.log(`Found ${resp.data.values.length} rows of data. Generating report on structure...`);
           
           // A quick summary of what is in there to decide on the next steps
           for (let i = 0; i < Math.min(10, resp.data.values.length); i++) {
               console.log(`Row ${i+1}: ${resp.data.values[i].join(' | ')}`);
           }
       } else {
           console.log('Finanz-Cockpit is empty.');
       }
    } else {
       console.log('Finanz-Cockpit does not exist. Needs to be created.');
    }
    
    if (sheetTitles.includes('Dashboard_Daten')) {
       console.log('\nDashboard_Daten exists. This is likely the backend logic. Checking...');
       const resp = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Dashboard_Daten!A1:Z20'
       });
       if (resp.data.values) {
           for (let i = 0; i < Math.min(5, resp.data.values.length); i++) {
               console.log(`Row ${i+1}: ${resp.data.values[i].join(' | ')}`);
           }
       }
    }
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

checkDashboard().catch(console.error);
