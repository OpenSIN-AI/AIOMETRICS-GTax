import os
import shutil
import json
import re
import sys
import unicodedata
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- CONFIGURATION ---
IMPORT_DIR = Path("/Users/jeremy/dev/AIOMETRICS-GTax/import_queue")
DRIVE_BASE = Path("/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Meine Ablage/Ablage Jeremy Schulze")
MAX_WORKERS = 8

MAPPING = {
    "Rechnungen": "01_Rechnungen",
    "Bank": "02_Bank",
    "Vertraege": "03_Vertraege",
    "Personal": "04_Personal",
    "Versicherung": "05_Versicherung",
    "Projekte": "06_Projekte",
    "Rechtliches": "07_Rechtliches",
    "Sonstiges": "08_Sonstiges"
}

# --- GOOGLE GENAI SETUP ---
from google import genai
from google.genai import types
from pydantic import BaseModel
from typing import List, Optional

api_key = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if api_key else genai.Client()

class DocumentAnalysis(BaseModel):
    category: str
    year: str
    suggested_filename: str

def make_safe_filename(s):
    if not s: return "Unbekannt"
    s = str(s)
    s = s.replace('ü', 'ue').replace('ä', 'ae').replace('ö', 'oe').replace('ß', 'ss')
    s = s.replace('Ü', 'Ue').replace('Ä', 'Ae').replace('Ö', 'Oe')
    s = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', s)
    return s.strip("_")

def process_document(file_path):
    temp_path = None
    try:
        # SDK requires ASCII-only or very clean filenames for the upload part
        safe_upload_name = f"up_{os.urandom(4).hex()}.pdf"
        temp_path = file_path.parent / safe_upload_name
        shutil.copy2(file_path, temp_path)
        
        uploaded_file = client.files.upload(file=str(temp_path))
        prompt = """Analysiere dieses PDF. 
        Wähle EINE Kategorie: Rechnungen, Vertraege, Bank, Rechtliches, Versicherung, Projekte, Personal, Sonstiges.
        Nenne das Jahr des Dokuments.
        Erstelle Dateiname: YYYY-MM-DD_KATEGORIE_SENDER_TITEL.pdf (kurz & prägnant).
        Antworte NUR JSON."""
        
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[uploaded_file, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=DocumentAnalysis,
                temperature=0.1,
            ),
        )
        if uploaded_file.name:
            client.files.delete(name=uploaded_file.name)
            
        data = json.loads(response.text)
        return True, file_path, data
    except Exception as e:
        return False, file_path, str(e)
    finally:
        if temp_path and temp_path.exists():
            try: os.remove(temp_path)
            except: pass

def main():
    if not IMPORT_DIR.exists(): return
    files = [f for f in IMPORT_DIR.iterdir() if f.is_file() and f.suffix.lower() == ".pdf" and not f.name.startswith("up_")]
    print(f"Organizing {len(files)} PDFs...")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_document, f): f for f in files}
        for future in as_completed(futures):
            success, original_path, result = future.result()
            if success:
                try:
                    cat = MAPPING.get(result.get("category"), "08_Sonstiges")
                    year = make_safe_filename(result.get("year", "Unbekannt"))
                    fname = make_safe_filename(result.get("suggested_filename", original_path.name))
                    if not fname.lower().endswith(".pdf"): fname += ".pdf"
                    
                    target_dir = DRIVE_BASE / cat / year
                    target_dir.mkdir(parents=True, exist_ok=True)
                    target_path = target_dir / fname
                    
                    if target_path.exists():
                        target_path = target_dir / f"{target_path.stem}_{os.urandom(2).hex()}.pdf"
                    
                    shutil.move(str(original_path), str(target_path))
                    print(f"DONE: {fname}")
                except Exception as e:
                    print(f"Error organizing {original_path.name}: {e}")
            else:
                # If AI fails, move to 'Unbekannt' category to clear the queue
                target_dir = DRIVE_BASE / "08_Sonstiges" / "Unbekannt"
                target_dir.mkdir(parents=True, exist_ok=True)
                shutil.move(str(original_path), str(target_dir / original_path.name))
                print(f"AI FAIL (moved to Sonstiges): {original_path.name}")

if __name__ == "__main__":
    main()
