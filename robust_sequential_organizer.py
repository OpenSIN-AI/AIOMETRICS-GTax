import os
import shutil
import json
import re
import time
import random
from pathlib import Path

# --- CONFIGURATION ---
IMPORT_DIR = Path(
    "/Users/jeremy/dev/AIOMETRICS-GTax/import_queue"
)
DRIVE_BASE = Path(
    "/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Meine Ablage/Ablage Jeremy Schulze"
)

MAPPING = {
    "Rechnungen": "01_Rechnungen",
    "Bank": "02_Bank",
    "Vertraege": "03_Vertraege",
    "Personal": "04_Personal",
    "Versicherung": "05_Versicherung",
    "Projekte": "06_Projekte",
    "Rechtliches": "07_Rechtliches",
    "Sonstiges": "08_Sonstiges",
}

# --- GOOGLE GENAI SETUP ---
from google import genai
from google.genai import types
from pydantic import BaseModel

def parse_positive_int(raw, fallback):
    try:
        value = int(str(raw))
    except Exception:
        return fallback
    return value if value > 0 else fallback


GEMINI_MAX_RETRIES = parse_positive_int(os.environ.get("GEMINI_MAX_RETRIES"), 4)
GEMINI_RETRY_BASE_MS = parse_positive_int(os.environ.get("GEMINI_RETRY_BASE_MS"), 1500)

api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
client = genai.Client(api_key=api_key) if api_key else genai.Client()


class DocumentAnalysis(BaseModel):
    category: str
    year: str
    suggested_filename: str


def is_retryable_gemini_error(error):
    status = None
    response = getattr(error, "response", None)
    if response is not None:
        status = getattr(response, "status_code", None) or getattr(response, "status", None)
    code = getattr(error, "code", None)
    if status is None and isinstance(code, int):
        status = code
    message = str(error).lower()
    if status in {408, 409, 425, 429, 500, 502, 503, 504}:
        return True
    if any(token in message for token in ("rate limit", "quota", "timeout", "temporar", "backend", "unavailable", "connection reset")):
        return True
    return False


def generate_content_with_retry(uploaded_file, prompt):
    for attempt in range(1, GEMINI_MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",  # Use 2.0 as it's the fastest stable vision model
                contents=[uploaded_file, prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=DocumentAnalysis,
                ),
            )
            return response.text
        except Exception as error:
            if attempt >= GEMINI_MAX_RETRIES or not is_retryable_gemini_error(error):
                raise
            delay_ms = min(15000, GEMINI_RETRY_BASE_MS * attempt + random.randint(0, 250))
            print(f"  WARN: Gemini request failed (attempt {attempt}/{GEMINI_MAX_RETRIES}), retrying in {delay_ms}ms: {error}")
            time.sleep(delay_ms / 1000.0)


def make_safe_filename(s):
    if not s:
        return "Unbekannt"
    s = (
        str(s)
        .replace("ü", "ue")
        .replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ß", "ss")
    )
    s = s.replace("Ü", "Ue").replace("Ä", "Ae").replace("Ö", "Oe")
    s = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", s)
    return s.strip("_")


def process_sequentially():
    files = sorted(
        [
            f
            for f in IMPORT_DIR.iterdir()
            if f.is_file()
            and f.suffix.lower() == ".pdf"
            and not f.name.startswith("up_")
        ]
    )
    total = len(files)
    print(f"🚀 Starting sequential processing of {total} documents...")

    for i, file_path in enumerate(files, 1):
        print(f"[{i}/{total}] Analyzing: {file_path.name}")
        temp_path = None
        uploaded_file = None
        try:
            # Check file size - skip if 0
            if file_path.stat().st_size == 0:
                print("  Empty file, moving to Leere_Dateien")
                target = DRIVE_BASE / "08_Sonstiges" / "Unbekannt" / "Leere_Dateien"
                target.mkdir(parents=True, exist_ok=True)
                shutil.move(str(file_path), str(target / file_path.name))
                continue

            # Create safe upload name
            safe_upload_name = f"up_{os.urandom(4).hex()}.pdf"
            temp_path = file_path.parent / safe_upload_name
            shutil.copy2(file_path, temp_path)

            uploaded_file = client.files.upload(file=str(temp_path))
            prompt = "Analysiere dieses PDF. Kategorie (Rechnungen, Vertraege, Bank, Rechtliches, Versicherung, Projekte, Personal, Sonstiges), Jahr, und Dateiname YYYY-MM-DD_KATEGORIE_SENDER_TITEL.pdf. NUR JSON."

            response_text = generate_content_with_retry(uploaded_file, prompt)
            data = json.loads(response_text)
            cat_raw = data.get("category", "Sonstiges")
            cat_folder = MAPPING.get(cat_raw, "08_Sonstiges")
            year = make_safe_filename(data.get("year", "Unbekannt"))
            fname = make_safe_filename(data.get("suggested_filename", file_path.name))
            if not fname.lower().endswith(".pdf"):
                fname += ".pdf"

            target_dir = DRIVE_BASE / cat_folder / year
            target_dir.mkdir(parents=True, exist_ok=True)
            target_path = target_dir / fname

            if target_path.exists():
                target_path = (
                    target_dir / f"{target_path.stem}_{os.urandom(2).hex()}.pdf"
                )

            shutil.move(str(file_path), str(target_path))
            print(f"  DONE -> {cat_folder}/{year}/{fname}")

        except Exception as e:
            print(f"  ERROR: {e}")
            # Move to safety folder to keep queue moving
            err_target = (
                DRIVE_BASE / "08_Sonstiges" / "Unbekannt" / "Fehlerhafte_Analyse"
            )
            err_target.mkdir(parents=True, exist_ok=True)
            try:
                shutil.move(str(file_path), str(err_target / file_path.name))
            except Exception:
                pass

        finally:
            if uploaded_file is not None and getattr(uploaded_file, "name", None):
                try:
                    client.files.delete(name=uploaded_file.name)
                except Exception:
                    pass
            if temp_path and temp_path.exists():
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

        # Small sleep to be nice to the API
        time.sleep(1)


if __name__ == "__main__":
    process_sequentially()
