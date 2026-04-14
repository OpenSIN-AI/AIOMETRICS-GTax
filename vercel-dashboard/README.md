# GTax Vercel Drive/Sheets Workspace

Vercel page with a Drive-like explorer and a Sheets-like grid UI.

- Server-side only Google access via Service Account
- No credential material exposed to browser
- Endpoints:
  - `GET /api/health`
  - `GET /api/sheet` (`spreadsheets.values.get`)
  - `GET /api/sheet-batch` (`spreadsheets.values.batchGet`)
  - `GET /api/drive` (`files.list`)
  - `GET /api/drive-content` (`files.get?alt=media`)
  - `GET /api/drive-export` (`files.export`)

## 1) Google Dienstkonto und APIs

1. Google Cloud Projekt waehlen/erstellen.
2. APIs aktivieren:
   - Google Drive API
   - Google Sheets API
3. Dienstkonto erstellen und JSON-Key erzeugen.
4. Sheet und Drive-Ordner mit der Dienstkonto-E-Mail teilen.
   - Bei Shared Drive: Dienstkonto als Mitglied mit passender Rolle hinzufuegen.

## 2) Vercel Secrets setzen

Setze in Vercel Project Environment Variables:

- `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`
- `GOOGLE_SHEET_ID`
- `GOOGLE_DRIVE_FOLDER_ID`
- optional `GOOGLE_SHEET_RANGE`
- optional `DASHBOARD_API_TOKEN`

Base64 der JSON-Credential lokal erzeugen:

```bash
base64 -i /path/to/service-account.json | tr -d '\n'
```

## 3) Preview Deploy

```bash
cd vercel-dashboard
npm install
vercel deploy -y
```

## 4) Sicherheit

- Service Account ist server-to-server; Key nie im Client-Code.
- Falls `DASHBOARD_API_TOKEN` gesetzt ist, muessen API-Calls Bearer-Token senden.

## 5) Iframe-Hinweis

Echte iframe-Einbettung (Google Publish/Share Links) ist ein separater Pfad.
Sie ist nicht identisch mit privatem Service-Account-Zugriff auf geschuetzte Daten.
