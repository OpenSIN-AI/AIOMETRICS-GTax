# Context Fulltext

- source_path: docs/SESSION_AUDIT_2026-02-24.md
- source_sha256: b2dc34e42d929cc062101d111f4e9dce5be1d072cc73497e6f0f84d61c31b5dc
- chunk: 1/1

```text
# Session Audit - 2026-02-24

## 1) Kurzfazit (ehrlich)

Stand 2026-02-24: **nicht vollständig fertig**.

Folgendes ist umgesetzt und funktionsfähig:
- Dashboard-Basis (`Finanz-Cockpit`, `EÜR`, `Steuerreport`, `Plausibilitaet`, `Dashboard_Daten`) ist technisch stabil und ohne Formel-Fehler.
- Jahresblätter `Einnahmen_YYYY` / `Ausgaben_YYYY` sind auf erweitertes Buchhaltungs-Schema umgestellt (CSV-kompatible Kernfelder + Detailfelder).
- OCR/Extract-Pipeline wurde robuster gemacht (Fallback-Logik + `final_no_text` Markierung für nicht extrahierbare Dateien).

Folgendes ist **nicht** vollständig erreicht:
- Nicht alle Belege sind korrekt fachlich klassifiziert (viel `pending`, viel `Unklar`).
- Nicht alle privaten / nicht steuerlich abzugsfähigen Belege sind aus aktiven Buchhaltungslisten entfernt.
- Duplikate sind noch vorhanden (`duplicate_candidate` > 0).
- Drive-Zielstruktur ist noch nicht vollständig auf gewünschte Jahres-Unterordner konsolidiert.

## 2) Harte Ist-Zahlen (Sheets/Drive)

Quelle: Live-Abfragen gegen Google Sheets/Drive am 2026-02-24.

### 2.1 Belege gesamt
- `belege` Gesamt: **4120**
- Mit Text (`extracted_text` oder `ocr_text`): **433**
- `final_no_text`: **6**
- Noch ohne Text + nicht final markiert (also weiter zu verarbeiten): **3681**

### 2.2 Buchhaltung_DB
- Gesamt: **4120**
- `status=ok`: **358**
- `status=pending`: **3742**
- `status=duplicate_candidate`: **20**
- `belegart=Unklar/leer`: **3848**

### 2.3 2023 (Sonderprüfung relevant)
- `Einnahmen_2023`: 157 Zeilen
  - `ok`: 153
  - `duplicate_candidate`: 4
  - `pending`: 0
  - Private-ähnliche Treffer (Keyword-basiert): 4 (z.B. Wolt)
- `Ausgaben_2023`: 237 Zeilen
  - `ok`: 65
  - `pending`: 160
  - `duplicate_candidate`: 12
  - `Typ=Unklar`: 187

### 2.4 Drive-Zielordner-Verteilung (laut `belege.target_folder_id`)
Top-Verteilung aktuell:
- `neue-belege` (`1dve...`): **1791**
- `2023` (`11Oo...`): **1125**
- `Ausgaben_2026` (`16yJ...`): **866**
- `Mac I9` (`1GM7...`): **221**
- Rest kleinere Mengen in `Rechnungen`, `Ausgaben_2025`, `Ausgaben_2023`, `Sonstige_Belege`, etc.

=> Damit ist die gewünschte Endsortierung noch nicht erreicht.

## 3) Was heute konkret implementiert wurde

## 3.1 Dashboard-Reparatur + Stabilisierung
Datei:
- `src/orchestrator/setup_finance_dashboard.ts`

Umgesetzt:
- Fehlerhafte Formelbezüge (Sheet-Namen mit Sonderzeichen) korrigiert.
- Jahresauswahl gegen unrealistische Jahre gehärtet (Bug mit `2099` entfernt).
- Wiederholtes Chart-Anlegen behoben: bestehende Dashboard-Charts werden vor Neuaufbau gelöscht.

Ergebnis:
- `Finanz-Cockpit`, `EÜR`, `Steuerreport`, `Plausibilitaet`, `Dashboard_Daten` aktuell ohne `#NAME?/#ERROR`.

## 3.2 OCR/Extract Robustheit verbessert
Datei:
- `src/orchestrator/accounting_enrichment.ts`

Umgesetzt:
- PDF-Text-Extraction mit OCR-Fallback bei Fehlern.
- Binärsignatur-Prüfung (`pdf/image/other`) gegen falsch deklarierte Dateien.
- `final_no_text` Markierung in `belege.metadata`, damit nicht extrahierbare Dateien den Prozess nicht blockieren.
- `.DS_Store` in Archiv-Keywords aufgenommen.

Ergebnis:
- Pipeline stoppt nicht mehr an denselben kaputten Dateien.
- Text-Abdeckung wurde erhöht, aber große Restmenge bleibt offen.

## 3.3 Jahresblätter auf Buchhaltungs-Schema umgestellt
Datei:
- `src/db/googleSheetsService.ts`

Umgesetzt:
- Neue `yearlyAccountingHeaders` eingeführt.
- `syncYearlySheets()` liest jetzt primär aus `Buchhaltung_DB` statt altem `belege`-19-Spalten-Schema.
- `Einnahmen_YYYY` / `Ausgaben_YYYY` werden mit CSV-Kernfeldern + erweiterten Feldern befüllt.
- Bugfix für Betrags-Parsing (`.` / `,`) in Steuerbeträgen.

Ergebnis:
- Jahresblätter haben jetzt 39 Spalten, Kernspalten kompatibel mit deinem Beispiel-CSV.

## 4) APIs, Konten, Integrationen

## 4.1 Genutzte Google APIs
- **Google Sheets API v4**
- **Google Drive API v3**

## 4.2 Authentifizierung
- Service-Account über JSON-Keyfile (`GOOGLE_CREDENTIALS_PATH`).
- In den Skripten via `google-auth-library` (`JWT`) authentifiziert.

## 4.3 Hauptskripte
- `npm start` -> `dist/orchestrator/main.js`
  - Drive->Sheets Sync (inkl. Jahresblätter und Ordner-Tabs)
- `npm run accounting-enrichment`
  - OCR/Extraktion + Buchhaltungsanreicherung in `Buchhaltung_DB`
- `npm run setup-finance-dashboard`
  - Dashboard-/Report-/QA-Blätter aufsetzen
- `npm run yearly-reorganize`
  - Reorganisationslogik für Jahres-/Cashflow-Struktur

## 4.4 Weitere Services
- Tesseract OCR (`tesseract.js`) lokal
- PDF-Text via `pdfjs-dist`
- PDF->Bild Fallback via `pdftoppm` (Poppler)

## 5) Automatisierung / Betrieb

Vorhanden:
- `continuous_sync.sh` als Loop-Betrieb (Sync + Enrichment im Intervall)
- Log-Datei: `logs/continuous_sync.log`
- PID-Datei: `.continuous_sync.pid`

Ist-Status heute:
- PID-Datei war vorhanden, Prozess selbst lief **nicht** (stale PID).
- Es gibt aktuell **keinen aktiv laufenden** Dauerprozess/Daemon.

Wichtiger Default in `continuous_sync.sh`:
- `APPLY_MOVE_RULES=false`
- `RENAME_FILES=false`

=> Dadurch werden zwar Daten aktualisiert, aber keine automatische Verschiebung/Umbenennung erzwungen.

## 6) Warum Sonderprüfung 2023 aktuell noch riskant ist

1. Viele `pending`/`Unklar` in 2023-Ausgaben.
2. `duplicate_candidate` ist nicht 0.
3. Private-ähnliche Belege sind noch in aktiven 2023-Listen sichtbar.
4. Hauptteil der Belege liegt noch in Sammelordnern (`neue-belege`, `2023`, `Ausgaben_2026`) statt strikt finaler Zielstruktur.

## 7) Was für „wirklich fertig“ noch zwingend gemacht werden muss

1. Vollscan aller offenen Belege (`pending`) in Batches bis `pending=0` oder `final_no_text`.
2. Harte Duplikatbereinigung bis `duplicate_candidate=0` (mit tatsächlicher Verschiebung in Duplikate-Ordner).
3. Private-/nicht abzugsfähige Belege aus aktiven Jahreslisten entfernen (in Privat/Archiv).
4. Re-Klassifizierung 2023 (insb. Einnahme/Ausgabe und Steuerkategorie) mit QA-Regeln.
5. Drive-Endsortierung erzwingen (pro Jahr + Einnahmen/Ausgaben-Unterordner) und danach erneuter Full-Sync.
6. Dauerbetrieb sauber als LaunchAgent/cron/systemd (nicht nur manuelles Script) mit Monitoring.

## 8) Was bereits „best practices“ entspricht und was nicht

Entspricht teilweise:
- Reproduzierbare Scripts (`npm`), klarer Pipeline-Aufbau.
- Dashboard mit KPIs/QA/Charts.
- Retry-Handling gegen API Rate Limits.
- Trennung Sync/Enrichment/Reporting.

Noch nicht auf Zielniveau:
- Datenqualität (zu viele `pending/Unklar`).
- Durchgehende End-to-End-Konsistenzregeln (insb. private/duplikat).
- Produktionsreifer Dauerbetrieb/Observability.

## 9) Änderungsübersicht (heute bearbeitet)

- `src/orchestrator/setup_finance_dashboard.ts`
- `src/orchestrator/accounting_enrichment.ts`
- `src/db/googleSheetsService.ts`


```
