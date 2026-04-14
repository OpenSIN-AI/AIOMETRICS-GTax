# Context Fulltext

- source_path: GOOGLE_DIENSTKONTO.md
- source_sha256: 0dbef5593a243ef86f91623502a1205175d03c6ed737385bd0f8d28454f104ec
- chunk: 1/1

```text
# GOOGLE_DIENSTKONTO.md

Praktische Schritt-fuer-Schritt Anleitung (Stand: Februar 2026) fuer:
- Google Dienstkonto korrekt aufsetzen
- APIs aktivieren
- Drive/Sheets/Docs fuer Dienstkonto freigeben
- Sichere Nutzung im KI-Agent-Workflow
- Erweiterung auf Gmail API / Google Tasks API / Google Keep API

Diese Anleitung ist so geschrieben, dass du sie direkt "von oben nach unten" durchgehen kannst, ohne Zwischenschritte zu raten.

## 1) Zielbild in 30 Sekunden

Du willst, dass dein KI-Agent mit einem Dienstkonto automatisiert:
- Drive-Ordner lesen/verschieben/klassifizieren
- Google Sheets schreiben/synchronisieren
- Optional: Docs erzeugen/aktualisieren
- Optional (Workspace): Gmail/Tasks/Keep im Namen von Nutzern bearbeiten

## 2) Wichtige Grundregel vorab

Es gibt zwei Modi:
1. `Ressourcenzugriff per Freigabe`: Du teilst konkrete Dateien/Ordner/Sheets mit der Dienstkonto-E-Mail.
2. `Domain-Wide Delegation (DWD)`: Nur fuer Google Workspace Domains (Admin-Konsole), damit ein Dienstkonto Nutzer impersonieren darf.

Wichtig:
- Fuer private @gmail.com Konten ist DWD nicht verfuegbar.
- Fuer Gmail-Nutzerdaten im privaten Konto brauchst du OAuth-Client-Flow (nicht nur Dienstkonto).

Quelle:
- [Auth Overview (Workspace)](https://developers.google.com/workspace/guides/auth-overview)

## 3) Cloud Projekt erstellen

1. Google Cloud Console oeffnen.
2. Neues Projekt erstellen (z. B. `belege-automation`).
3. Projektname + Abrechnung/Organisation sauber zuordnen.

Quelle:
- [Create a Cloud project](https://developers.google.com/workspace/guides/create-project)

## 4) APIs aktivieren (ohne das geht nichts)

Im Projekt aktivieren:
- Google Drive API
- Google Sheets API
- Google Docs API (falls Docs erzeugt werden)
- Gmail API (nur wenn benoetigt)
- Google Tasks API (optional)
- Google Keep API (optional, i. d. R. Enterprise/Workspace Use-Cases)

CLI Beispiel:
```bash
gcloud services enable \
  drive.googleapis.com \
  sheets.googleapis.com \
  docs.googleapis.com \
  gmail.googleapis.com \
  tasks.googleapis.com \
  keep.googleapis.com
```

Quelle:
- [Enable Google Workspace APIs](https://developers.google.com/workspace/guides/enable-apis)

## 5) Dienstkonto erstellen

1. `IAM & Admin -> Service Accounts`
2. `Create service account`
3. Name vergeben (z. B. `belege-agent`)
4. E-Mail merken: `belege-agent@<PROJECT_ID>.iam.gserviceaccount.com`
5. Fertigstellen

Quelle:
- [Create service accounts](https://cloud.google.com/iam/docs/service-accounts-create)
- [Create access credentials](https: [REDACTED]

## 6) JSON Key erzeugen (nur wenn wirklich noetig)

1. Dienstkonto oeffnen
2. `Keys -> Add key -> Create new key -> JSON`
3. Datei sichern, nicht in Git committen
4. Lokal ablegen, z. B.:
   - `/Users/jeremy/dev/Meine-Google-Credentials/credentials.json`

Hinweis 2026 Best Practice:
- Google empfiehlt, Key-Einsatz zu minimieren (lieber kurzlebige Credentials/WIF wo moeglich).
- Wenn Key noetig ist: streng absichern, rotieren, alte Keys loeschen.

Quellen:
- [Create and delete service account keys](https://docs.cloud.google.com/iam/docs/keys-create-delete)
- [Service account credentials](https: [REDACTED]

## 7) Zugriff geben: Drive/Sheets/Docs fuer Dienstkonto freigeben

### 7.1 Google Sheet freigeben
1. Ziel-Sheet oeffnen
2. `Freigeben`
3. Dienstkonto-E-Mail als `Bearbeiter` eintragen
4. Speichern

### 7.2 Drive Ordner freigeben
1. Zielordner (z. B. `Belege`) oeffnen
2. `Freigeben`
3. Dienstkonto-E-Mail als `Bearbeiter` eintragen
4. Bei Shared Drives: Dienstkonto als Mitglied mit passender Rolle hinzufuegen

### 7.3 Docs freigeben (wenn noetig)
Genauso wie Sheet: Dienstkonto-E-Mail als Bearbeiter freigeben.

Quelle:
- [Share files, folders, and drives](https://developers.google.com/workspace/drive/api/guides/manage-sharing)

## 8) Projekt lokal konfigurieren

In `.env`:
```bash
GOOGLE_CREDENTIALS_PATH=/Users/jeremy/dev/Meine-Google-Credentials/credentials.json
GOOGLE_SHEET_ID=<deine_sheet_id>
SOURCE_DRIVE_FOLDER_ID=<dein_import_ordner>
TARGET_DRIVE_FOLDER_ID=<dein_ziel_ordner>
```

Dann:
```bash
npm install
npm run build
npm run sync-chain
```

## 9) Domain-Wide Delegation (nur Workspace Admin)

Nur falls dein Agent im Namen von Nutzern handeln soll (Gmail/Tasks/Keep etc.):

1. Im Dienstkonto `Show advanced settings -> Domain-wide delegation` aktivieren
2. Client-ID kopieren
3. Admin-Konsole:
   - `Security -> Access and data control -> API controls`
   - `Manage Domain Wide Delegation -> Add new`
   - Client-ID eintragen
   - OAuth Scopes kommasepariert eintragen
4. Nur minimal notwendige Scopes erlauben

Wichtige Security-Hinweise:
- DWD nur fuer dedizierte Projekte
- moeglichst wenige Admins mit Bearbeitungsrechten
- Scope-Minimierung strikt durchsetzen

Quellen:
- [Create access credentials (DWD steps)](https: [REDACTED]
- [Domain-wide delegation best practices](https://support.google.com/a/answer/14437356)

## 10) Gmail API sauber einordnen

Wichtig:
- Dienstkonto allein kann nicht automatisch private Gmail-Nutzerdaten lesen.
- Fuer Workspace Nutzerdaten brauchst du DWD + Admin-Freigabe + passende Scopes.
- Fuer private @gmail.com brauchst du OAuth User Consent Flow.

Typische Gmail Scopes:
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.send`

Quellen:
- [Auth overview (service account + DWD)](https://developers.google.com/workspace/guides/auth-overview)
- [OAuth scopes list](https://developers.google.com/identity/protocols/oauth2/scopes)

## 11) Google Tasks API / Keep API

### Tasks
- API vorhanden, gut fuer Todo-Automation
- typische Scopes:
  - `https://www.googleapis.com/auth/tasks`
  - `https://www.googleapis.com/auth/tasks.readonly`

Quelle:
- [Tasks API Overview](https://developers.google.com/workspace/tasks/overview)
- [Tasks Scopes](https://developers.google.com/workspace/tasks/auth)

### Keep
- API vorhanden, primar fuer Workspace/Enterprise Use-Cases
- bei org-weitem Zugriff ebenfalls DWD-Kontext

Quelle:
- [Google Keep API Overview](https://developers.google.com/workspace/keep/api/guides)

## 12) KI-Agent Befehle (copy/paste Prompts)

### 12.1 Vollsync Drive -> Sheet
```text
Bitte synchronisiere alle Dateien aus SOURCE_DRIVE_FOLDER_ID in das Sheet, aktualisiere 2023 Einnahmen/Ausgaben, und gib mir nur die Abweichungen (Drive-only, Sheet-only, Duplikate).
```

### 12.2 Stundliche Kette
```text
Richte den Dauerlauf so ein, dass alle 60 Minuten sync-chain laeuft, mit Locking und Log-Ausgabe.
```

### 12.3 2023 Sonderpruefung
```text
Fuehre einen Integritaetscheck fuer Einnahmen_2023 und Ausgaben_2023 aus: Drive vs Sheet, private Marker, Dubletten, fehlende OCR-Felder. Erstelle einen Report in docs/.
```

### 12.4 Gmail/Tasks Workflow (Workspace)
```text
Nutze DWD-Scopes, lese neue Rechnungs-Mails, schreibe erkannte Aufgaben in Google Tasks, und verlinke die zugehoerigen Drive-Dateien im Sheet.
```

## 13) Sicherheits-Checkliste (Best Practices 2026)

1. JSON Key nie in Git, nie im Chat teilen.
2. Key in Secret Manager/OS-Keychain oder strengem lokalen Pfad speichern.
3. Rechteprinzip: nur minimal benoetigte Rollen/Scopes.
4. DWD nur wenn zwingend.
5. Alte Keys rotieren und loeschen.
6. Logs ohne sensible Inhalte (keine API Keys, keine vollen Tokens).
7. Monitoring aktivieren (API-Fehler, Quota, Security Alerts).

## 14) Troubleshooting Kurzliste

- `403 The caller does not have permission`
  - Sheet/Ordner nicht mit Dienstkonto-E-Mail geteilt
- `404 not found`
  - falsche Sheet-ID/Folder-ID oder kein Zugriff
- `insufficientPermissions`
  - Scope fehlt oder API nicht aktiviert
- `delegation denied`
  - DWD nicht korrekt in Admin-Konsole freigegeben

## 15) Bezug zu diesem Projekt

In diesem Repo laeuft die Kette ueber:
- `npm run sync-chain`
- globaler Lock: `.pipeline.lock`
- Laufprotokoll: `logs/pipeline_events.jsonl`
- 2023 Integritaetscheck: `npm run check-2023`


```
