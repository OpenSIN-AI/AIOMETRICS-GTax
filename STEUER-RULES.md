# STEUER-RULES.md - Zoe Solar Belegverarbeitung

## 1. Dokumentenanalyse und OCR-Verarbeitung

Um sicherzustellen, dass KEINE Daten von Belegen übersehen werden, wird ein umfassender OCR-Prozess angewendet:

### 1.1 PDF- und Bildkonvertierung
*   **Alle Seiten verarbeiten:** Für jede PDF-Datei werden **alle vorhandenen Seiten** einzeln in hochauflösende Bilder konvertiert.
*   **Bild-Scanning:** Auf jedes dieser konvertierten Bilder wird eine optische Zeichenerkennung (OCR) durchgeführt, um sämtlichen sichtbaren Text zu erfassen.
*   **Textkombination:** Der direkt aus dem PDF extrahierte Text (falls vorhanden) und der mittels OCR aus den Bildern gewonnene Text werden kombiniert, um eine maximale Texterfassung zu gewährleisten. Dies schließt auch schwer lesbare oder gescannte Dokumente ein.

### 1.2 Datenextraktion
*   Aus dem kombinierten Text werden **alle relevanten Informationen** extrahiert. Dazu gehören Absender, Empfänger, Adressen, Steuernummern, Rechnungsnummern, Daten, Beträge (Netto, MwSt, Brutto), Währungen, Zahlungsmethoden, detaillierte Posten und alle sonstigen relevanten Daten.
*   Es darf **NICHTS fehlen**! Jede sichtbare Information auf dem Dokument muss erfasst und verarbeitet werden.

## 2. Dateinamenskonvention

Nach der Analyse und Extraktion der Daten werden die Belegdateien umbenannt, um eine klare Identifikation und Sortierung zu ermöglichen. Dies hilft, den Bearbeitungsstatus und den Inhalt auf einen Blick zu erkennen.

### 2.1 Formatierung
*   Der neue Dateiname folgt dem Schema: `[RECHNUNGSNUMMER]_[BELEGBEZEICHNUNG_SANITIZED].pdf`
    *   `[RECHNUNGSNUMMER]`: Die eindeutige Rechnungs- oder Belegnummer des Dokuments. Wenn keine explizite Rechnungsnummer gefunden wird, wird ein geeigneter Platzhalter (z.B. `UNBEKANNT_RECHNUNGSNR`) verwendet.
    *   `[BELEGBEZEICHNUNG_SANITIZED]`: Eine kurze, prägnante Beschreibung des Beleginhalts, die für Dateinamen geeignet ist (Sonderzeichen werden entfernt oder ersetzt, Leerzeichen durch Unterstriche).

### 2.2 Beispiele
*   `123456789_Tankbeleg_Jet_Super_E5.pdf`
*   `INV-2023-001_Rechnung_Webdesign_Kunde_XYZ.pdf`
*   `UNBEKANNT_RECHNUNGSNR_Kassenbon_Baumarkt.pdf`

## 3. Verzeichnisstruktur und Dateiverschiebung

Belege werden nach ihrer Klassifizierung (Einnahme oder Ausgabe) und dem Rechnungsjahr in eine strukturierte Ordnerhierarchie verschoben.

### 3.1 Zielverzeichnisse
*   **Einnahmen:** `/Users/jeremy/NotebookLM/JS - Belegdokumente 2023/Einnahmen/[JAHR]/`
*   **Ausgaben:** `/Users/jeremy/NotebookLM/JS - Belegdokumente 2023/Ausgaben/[JAHR]/`
    *   `[JAHR]`: Das vierstellige Jahr des Rechnungsdatums (z.B. `2023`, `2024`).

### 3.2 Verschiebe-Regeln
*   Nach erfolgreicher Analyse, Datenextraktion und Umbenennung wird die Originaldatei in das entsprechende Jahresverzeichnis innerhalb des `Einnahmen`- oder `Ausgaben`-Ordners verschoben.
*   Die Datei wird aus dem Quellverzeichnis (`/Users/jeremy/dev/Neuer Ordner/server/data/jerry-belege/`) entfernt.
*   Es wird vor dem Verschieben geprüft, ob das Zielverzeichnis (`[JAHR]`) existiert. Falls nicht, wird es automatisch erstellt.

## 4. Datenbankregeln (`belege.db`)

Alle extrahierten Daten werden in der `belege.db` SQLite-Datenbank gespeichert, um eine zentrale, durchsuchbare und strukturierte Knowledge Base zu gewährleisten.

### 4.1 Datenbankstruktur
*   Die Datenbank `belege.db` enthält die Tabelle `belege` mit den in der `DB.md` definierten Spalten.
*   Jede Spalte ist mit einem spezifischen Datentyp und einer detaillierten Beschreibung versehen, um die Datenintegrität und -verständlichkeit zu maximieren.

### 4.2 Datenintegrität
*   **Parametrisierte Abfragen:** Alle Datenbankeinfügungen erfolgen über parametrisierte Abfragen, um SQL-Injection-Angriffe zu verhindern und die korrekte Maskierung von Sonderzeichen in den Daten zu gewährleisten.
*   **Einzigartigkeit:** Der `filename` in der Datenbank ist `UNIQUE`, um Duplikate zu vermeiden.
*   **Vollständigkeit:** Alle extrahierten Daten werden in die entsprechenden Spalten eingefügt. `line_items` und `additional_data` werden als JSON-Strings gespeichert, um Flexibilität für detaillierte und nicht-standardisierte Informationen zu bieten.

### 4.3 Fehlerbehandlung
*   Fehler bei der Datenbankeinfügung oder Dateiverschiebung werden protokolliert und führen nicht zum Abbruch des Gesamtprozesses. Stattdessen wird versucht, die nächste Datei zu verarbeiten.
*   Bei kritischen Fehlern wird eine Meldung ausgegeben, die eine manuelle Überprüfung erfordert.

---

**Letzte Aktualisierung:** 2026-02-22
