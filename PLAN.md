# PLAN.md - KI-Native Belegverarbeitung (Februar 2026)

## Ziel
Verarbeitung von ~1184 Belegen (PDFs/Bilder) in wenigen Minuten statt Stunden. Extraktion aller Daten, Klassifizierung (Einnahme/Ausgabe), Umbenennung, Speicherung in SQLite und Verschiebung in Jahresordner.

## Die "Drecks-Technik" von gestern vs. Best Practices Heute
*   **FALSCH (Gestern):** PDFs mühsam in Bilder umwandeln -> Tesseract OCR (langsam, fehleranfällig) -> Regex-Parsing -> Sequenzielle Verarbeitung.
*   **RICHTIG (Heute):** PDF direkt an die **Gemini 2.5 Flash API** senden -> KI liest das Dokument nativ -> KI gibt direkt ein validiertes JSON-Objekt zurück -> Parallele Verarbeitung (Multithreading).

## Architektur des neuen Workflows

### 1. KI-Modell (Gemini 2.5 Flash)
Wir nutzen das offizielle `google-genai` SDK. Wir übergeben das PDF direkt an das Modell mit dem Prompt, alle Rechnungsdaten zu extrahieren und strikt als JSON zurückzugeben.

### 2. Parallele Ausführung (Multithreading)
Das Skript `process_belege_gemini.py` nutzt `ThreadPoolExecutor` mit 10-20 parallelen Workern. Dadurch werden mehrere PDFs gleichzeitig an die API gesendet.

### 3. Datenbank (`belege.db`)
Die Datenbankstruktur aus `DB.md` bleibt bestehen. Das Skript nutzt strikte parametrisierte SQL-Queries (`?`), um Syntaxfehler (wie zuvor bei Anführungszeichen) zu 100% auszuschließen.

### 4. Dateiverwaltung
*   **Namenskonvention:** `[Rechnungsnummer]_[Kurzbeschreibung].pdf`
*   **Ordnerstruktur:** `/Einnahmen/[JAHR]/` oder `/Ausgaben/[JAHR]/`
*   **Sicherheit:** Dateien werden erst verschoben, wenn der DB-Eintrag erfolgreich war.

## Ablaufplan (Execution Steps)

1.  **Abhängigkeiten installieren:** `pip install google-genai pypdf2` (falls noch nicht vorhanden).
2.  **API Key setzen:** Sicherstellen, dass `GEMINI_API_KEY` in der Umgebungsvariable existiert.
3.  **Skript ausführen:** `python3 /tmp/process_belege_gemini.py` starten.
4.  **Validierungslauf:** Ein separates Skript (`validate_belege.py`) prüft am Ende, ob alle DB-Einträge physisch im richtigen Ordner liegen.

## Code-Beispiel (Kernlogik)
```python
# Sende PDF direkt an Gemini 2.5 Flash und fordere JSON an
response = client.models.generate_content(
    model='gemini-2.5-flash',
    contents=[
        document_part, # Das PDF
        "Extrahiere alle Daten. Klassifiziere als EINNAHME (wenn Zoe Solar/Jeremy Schulze der Absender ist) oder AUSGABE (wenn Empfänger). Antworte NUR in JSON."
    ],
    config=GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=BelegSchema # Pydantic Modell für garantiertes Format
    )
)
```