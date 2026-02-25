#!/usr/bin/env python3
"""
Zoe Solar Belege Klassifizierer - KI-Native Version (Gemini 2.5 Flash)
Verarbeitet PDFs parallel, extrahiert Daten als JSON, speichert in DB und verschiebt.
"""

import os
import shutil
import sqlite3
import json
import re
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- KONFIGURATION ---
SOURCE_DIR = Path("/Users/jeremy/dev/AIOMETRICS-GTax")
EINNAHMEN_DIR_BASE = Path("/Users/jeremy/NotebookLM/JS - Belegdokumente 2023/Einnahmen")
AUSGABEN_DIR_BASE = Path("/Users/jeremy/NotebookLM/JS - Belegdokumente 2023/Ausgaben")
DB_PATH = Path("/tmp/belege.db")
ERROR_DIR = Path("/tmp/belege_errors")
MAX_WORKERS = 10  # Parallele API Aufrufe

# --- GOOGLE GENAI SETUP ---
try:
    from google import genai
    from google.genai import types
    from pydantic import BaseModel, Field
    from typing import List, Optional
    
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("WARNUNG: GEMINI_API_KEY nicht im Environment gefunden. Versuche ohne expliziten Key (Default Credentials).")
            
    client = genai.Client(api_key=api_key) if api_key else genai.Client()
except ImportError:
    print("FEHLER: 'google-genai' oder 'pydantic' fehlt. Bitte ausführen: pip install google-genai pydantic")
    exit(1)

# --- PYDANTIC SCHEMA FÜR STRUKTURIERTEN JSON OUTPUT ---
class LineItem(BaseModel):
    description: str
    total_amount: float

class BelegData(BaseModel):
    category: str
    sender_name: str
    sender_address: str
    sender_tax_id: Optional[str]
    sender_vat_id: Optional[str]
    receiver_name: str
    receiver_address: str
    receiver_tax_id: Optional[str]
    receiver_vat_id: Optional[str]
    invoice_number: str
    invoice_date: str
    due_date: Optional[str]
    net_amount: float
    tax_amount: float
    total_amount: float
    currency: str
    payment_method: str
    description: str
    line_items: List[LineItem]
    additional_data: str
    analysis_notes: str

# --- HILFSFUNKTIONEN ---
def ensure_dir(path):
    path.mkdir(parents=True, exist_ok=True)

def sanitize_filename(text):
    if not text: return "Beleg"
    sanitized = re.sub(r'[\\/:*?"<>|]', '_', text)
    sanitized = re.sub(r'\s+', '_', sanitized)
    return sanitized[:50]

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS belege (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE,
            original_path TEXT,
            category TEXT,
            sender_name TEXT,
            sender_address TEXT,
            sender_tax_id TEXT,
            sender_vat_id TEXT,
            receiver_name TEXT,
            receiver_address TEXT,
            receiver_tax_id TEXT,
            receiver_vat_id TEXT,
            invoice_number TEXT,
            invoice_date TEXT,
            due_date TEXT,
            net_amount REAL,
            tax_amount REAL,
            total_amount REAL,
            currency TEXT,
            payment_method TEXT,
            description TEXT,
            line_items TEXT,
            additional_data TEXT,
            raw_text_content TEXT,
            analysis_notes TEXT
        )
    """)
    conn.commit()
    conn.close()

def get_processed_files():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT original_path FROM belege")
    processed = {Path(row[0]).name for row in cursor.fetchall()}
    conn.close()
    return processed

def insert_beleg(data):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT OR REPLACE INTO belege (
            filename, original_path, category, sender_name, sender_address, 
            sender_tax_id, sender_vat_id, receiver_name, receiver_address, 
            receiver_tax_id, receiver_vat_id, invoice_number, invoice_date, 
            due_date, net_amount, tax_amount, total_amount, currency, 
            payment_method, description, line_items, additional_data, 
            raw_text_content, analysis_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data['filename'], data['original_path'], data['category'],
        data['sender_name'], data['sender_address'], data['sender_tax_id'],
        data['sender_vat_id'], data['receiver_name'], data['receiver_address'],
        data['receiver_tax_id'], data['receiver_vat_id'], data['invoice_number'],
        data['invoice_date'], data['due_date'], data['net_amount'],
        data['tax_amount'], data['total_amount'], data['currency'],
        data['payment_method'], data['description'], data['line_items'],
        data['additional_data'], data['raw_text_content'], data['analysis_notes']
    ))
    conn.commit()
    conn.close()

# --- KERN-LOGIK (GEMINI API) ---
def process_single_file(file_path):
    try:
        uploaded_file = client.files.upload(file=str(file_path))
        
        prompt = """
        Analysiere diesen Beleg/diese Rechnung genau. 
        WICHTIG: 
        - Wenn der Absender/Aussteller "Zoe Solar" oder "Jeremy Schulze" ist, ist es eine EINNAHME.
        - Wenn der Empfänger/Kunde "Zoe Solar" oder "Jeremy Schulze" ist, ist es eine AUSGABE.
        - Tankbelege, Kassenbons aus dem Baumarkt etc. sind immer AUSGABEN.
        Extrahiere alle Daten und antworte strikt im vorgegebenen JSON-Format.
        """
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[uploaded_file, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=BelegData,
                temperature=0.1
            )
        )
        
        client.files.delete(name=uploaded_file.name)
        
        data = json.loads(response.text)
        
        invoice_num = data.get('invoice_number', 'UNBEKANNT')
        if not invoice_num: invoice_num = "UNBEKANNT"
        
        desc = sanitize_filename(data.get('description', 'Beleg'))
        new_filename = f"{invoice_num}_{desc}{file_path.suffix}"
        
        year = "2023"
        date_str = data.get('invoice_date', '')
        if date_str and len(date_str) >= 4:
            year = date_str[:4]
            
        line_items_str = json.dumps(data.get('line_items', []))
        
        db_data = {
            "filename": new_filename,
            "original_path": str(file_path),
            "category": data.get('category', 'UNBEKANNT'),
            "sender_name": data.get('sender_name', ''),
            "sender_address": data.get('sender_address', ''),
            "sender_tax_id": data.get('sender_tax_id', ''),
            "sender_vat_id": data.get('sender_vat_id', ''),
            "receiver_name": data.get('receiver_name', ''),
            "receiver_address": data.get('receiver_address', ''),
            "receiver_tax_id": data.get('receiver_tax_id', ''),
            "receiver_vat_id": data.get('receiver_vat_id', ''),
            "invoice_number": invoice_num,
            "invoice_date": date_str,
            "due_date": data.get('due_date', ''),
            "net_amount": data.get('net_amount', 0.0),
            "tax_amount": data.get('tax_amount', 0.0),
            "total_amount": data.get('total_amount', 0.0),
            "currency": data.get('currency', 'EUR'),
            "payment_method": data.get('payment_method', ''),
            "description": data.get('description', ''),
            "line_items": line_items_str,
            "additional_data": str(data.get('additional_data', '{}')),
            "raw_text_content": "Gemini 2.5 Flash Native Analysis",
            "analysis_notes": data.get('analysis_notes', '')
        }
        
        return True, file_path, db_data, year, new_filename
        
    except Exception as e:
        return False, file_path, str(e), None, None

def main():
    init_db()
    ensure_dir(ERROR_DIR)
    
    processed_files = get_processed_files()
    all_files = sorted([f for f in SOURCE_DIR.glob("*.pdf") if f.name not in processed_files])
    total = len(all_files)
    
    if total == 0:
        print("Keine neuen Dateien zu verarbeiten.")
        return
        
    print(f"🚀 Starte KI-Analyse (Gemini 2.5 Flash) von {total} Dateien mit {MAX_WORKERS} Workern...")
    
    stats = {"EINNAHME": 0, "AUSGABE": 0, "UNBEKANNT": 0, "FEHLER": 0}
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_single_file, f): f for f in all_files}
        
        done = 0
        for future in as_completed(futures):
            done += 1
            success, file_path, result_data, year, new_filename = future.result()
            
            if success:
                db_data = result_data
                category = db_data['category']
                
                insert_beleg(db_data)
                
                target_dir = (AUSGABEN_DIR_BASE if category == "AUSGABE" else EINNAHMEN_DIR_BASE) / year
                ensure_dir(target_dir)
                target_path = target_dir / new_filename
                
                try:
                    if file_path.exists():
                        shutil.move(str(file_path), str(target_path))
                        stats[category] = stats.get(category, 0) + 1
                        print(f"[{done}/{total}] ✅ {category}: {file_path.name} -> {new_filename}")
                except Exception as e:
                    print(f"[{done}/{total}] ❌ FEHLER beim Verschieben von {file_path.name}: {e}")
                    stats["FEHLER"] += 1
            else:
                print(f"[{done}/{total}] 💥 KI-FEHLER bei {file_path.name}: {result_data}")
                stats["FEHLER"] += 1
                try:
                    if file_path.exists():
                        shutil.move(str(file_path), str(ERROR_DIR / file_path.name))
                except: pass

    print("\n" + "=" * 80)
    print("📊 ERGEBNIS KI-DURCHLAUF")
    print("=" * 80)
    for k, v in stats.items():
        print(f"{k}: {v}")
    print("=" * 80)

if __name__ == "__main__":
    main()
