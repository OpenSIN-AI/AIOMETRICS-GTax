# Context Fulltext

- source_path: GEMINI-OCR.md
- source_sha256: 4a2ccb0c3ecadc8877b1d0a292e364732c9ba591929ebe1b88504f896cd5a37c
- chunk: 1/1

```text
# GEMINI-OCR.md - Jerry Belege Verarbeitung

## API Konfiguration (WICHTIG!)

### RICHTIGE Initialisierung
```python
import os
from google import genai

# Methode 1: Environment Variable (EMPFOHLEN)
os.environ['GEMINI_API_KEY'] = "YOUR_API_KEY"
client = genai.Client()  # Ohne api_key Parameter!

# Methode 2: Alternative mit http_options
client = genai.Client(
    api_key=[REDACTED],
    http_options={'api_version': 'v1'}
)
```

### FALSCH (funktioniert nicht!)
```python
# NICHT MACHEN:
client = genai.Client(api_key=[REDACTED])  # Funktioniert nicht richtig!
```

## Modell
- **Modell:** `gemini-2.5-flash-lite`
- **Kostenloser Free Tier:** Ja
- **Nachfolger von:** `gemini-2.0-flash-lite` (für neue User gesperrt)

## Verarbeitungs-Status

### Datei 1/969
- **Original:** `0832714b-501c-4804-a6c8-8bca90f29df7.pdf`
- **Neuer Name:** `5761_003_00001_Tankquittung.pdf`
- **Kategorie:** AUSGABE
- **Rechnungsnummer:** 5761/003/00001
- **Datum:** 18.04.2023
- **Betrag:** 38.72 EUR
- **Sender:** Gordon Firley
- **Empfänger:** Jeremy Schulze
- **Status:** ✅ ERFOLG

### Datei 2/969
- **Original:** `089eec94-9d08-4688-8684-8146827fbf7c.pdf`
- **Neuer Name:** `3185_00002_011_Fuel and coffee purchase.pdf`
- **Kategorie:** AUSGABE (fuel)
- **Rechnungsnummer:** 3185/00002/011
- **Datum:** 20.09.2023
- **Betrag:** 22.59 EUR
- **Status:** ✅ ERFOLG

### Datei 3/969
- **Original:** `15684baf-6759-4a3b-8f4a-547591281322.pdf`
- **Neuer Name:** `7154_022_00001_Fuel and other items purchased at Shell Station..pdf`
- **Kategorie:** AUSGABE (fuel receipt)
- **Rechnungsnummer:** 7154/022/00001
- **Datum:** 26.10.2023
- **Betrag:** 13.85 EUR
- **Status:** ✅ ERFOLG

### Ausstehende Dateien
- Datei 4/969: `1603a2c1-f86d-45dc-a719-c6f8d0b240ec.pdf`
- ... (965 weitere)

## Probleme & Lösungen

### Problem 1: API Key als "leaked" gemeldet
- **Fehler:** 403 PERMISSION_DENIED - "API key was reported as leaked"
- **Lösung: [REDACTED]

### Problem 2: API Key expired
- **Fehler:** 400 INVALID_ARGUMENT - "API key expired"
- **Lösung: [REDACTED]

### Problem 3: Invoice-Number mit Pfad-Trennzeichen
- **Fehler:** `[Errno 2] No such file or directory` bei `/` im Dateinamen
- **Lösung:** `.replace('/', '_').replace('\\', '_')` auf invoice_number

## Rate Limits (Free Tier)
- **Requests pro Minute:** 15
- **Requests pro Tag:** 1000
- **Empfehlung:** Datei für Datei verarbeiten, nicht im Batch

## Datenbank Schema
Siehe: `DB.md`

## Verarbeitungsregeln
Siehe: `STEUER-RULES.md`

## Nächste Schritte
1. Datei 2 verarbeiten
2. Datei 3 verarbeiten
3. ... alle 969 Dateien nacheinander

```
