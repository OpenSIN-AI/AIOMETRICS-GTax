import os
import shutil
import sqlite3
import json
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- CONFIGURATION ---
BASE_DIR = Path("/Users/jeremy/NotebookLM/JS - Belegdokumente 2023")
SOURCE_DIRS = [
    Path("/Users/jeremy/dev/AIOMETRICS-GTax"),
    BASE_DIR / "Einnahmen",
    BASE_DIR / "Ausgaben",
]
DB_PATH = Path("/tmp/belege.db")
MAX_WORKERS = 10

# --- GOOGLE GENAI SETUP ---
from google import genai
from google.genai import types
from pydantic import BaseModel
from typing import List, Optional

api_key = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if api_key else genai.Client()


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


def sanitize_filename(text):
    if not text:
        return "Beleg"
    sanitized = re.sub(r'[\\/:*?"<>|]', "_", text)
    sanitized = re.sub(r"\s+", "_", sanitized)
    return sanitized[:50]


def get_db_connection():
    return sqlite3.connect(DB_PATH)


def insert_beleg(data):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT OR REPLACE INTO belege (
            filename, original_path, category, sender_name, sender_address, 
            sender_tax_id, sender_vat_id, receiver_name, receiver_address, 
            receiver_tax_id, receiver_vat_id, invoice_number, invoice_date, 
            due_date, net_amount, tax_amount, total_amount, currency, 
            payment_method, description, line_items, additional_data, 
            raw_text_content, analysis_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            data["filename"],
            data["original_path"],
            data["category"],
            data["sender_name"],
            data["sender_address"],
            data["sender_tax_id"],
            data["sender_vat_id"],
            data["receiver_name"],
            data["receiver_address"],
            data["receiver_tax_id"],
            data["receiver_vat_id"],
            data["invoice_number"],
            data["invoice_date"],
            data["due_date"],
            data["net_amount"],
            data["tax_amount"],
            data["total_amount"],
            data["currency"],
            data["payment_method"],
            data["description"],
            data["line_items"],
            data["additional_data"],
            data["raw_text_content"],
            data["analysis_notes"],
        ),
    )
    conn.commit()
    conn.close()


def process_file(file_path):
    # Check if already in DB
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT filename, category, invoice_date FROM belege WHERE original_path LIKE ?",
        (f"%{file_path.name}",),
    )
    row = cursor.fetchone()
    conn.close()

    if row:
        # Already analyzed, just needs renaming/moving
        db_filename, category, date_str = row
        year = date_str[:4] if date_str and len(date_str) >= 4 else "2023"
        return True, file_path, "ALREADY_IN_DB", category, year, db_filename

    # Not in DB, needs Gemini analysis
    try:
        uploaded_file = client.files.upload(file=str(file_path))
        prompt = "Analysiere diesen Beleg. Zoe Solar/Jeremy Schulze ist entweder Sender (EINNAHME) oder Empfänger (AUSGABE). Antworte NUR JSON."

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[uploaded_file, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=BelegData,
                temperature=0.1,
            ),
        )
        try:
            client.files.delete(name=uploaded_file.name)
        except Exception:
            pass
        data = json.loads(response.text)

        invoice_num = data.get("invoice_number", "UNBEKANNT") or "UNBEKANNT"
        desc = sanitize_filename(data.get("description", "Beleg"))
        new_filename = f"{invoice_num}_{desc}{file_path.suffix}"

        date_str = data.get("invoice_date", "")
        year = date_str[:4] if date_str and len(date_str) >= 4 else "2023"

        db_data = {
            "filename": new_filename,
            "original_path": str(file_path),
            "category": data.get("category", "UNBEKANNT"),
            "sender_name": data.get("sender_name", ""),
            "sender_address": data.get("sender_address", ""),
            "sender_tax_id": data.get("sender_tax_id", ""),
            "sender_vat_id": data.get("sender_vat_id", ""),
            "receiver_name": data.get("receiver_name", ""),
            "receiver_address": data.get("receiver_address", ""),
            "receiver_tax_id": data.get("receiver_tax_id", ""),
            "receiver_vat_id": data.get("receiver_vat_id", ""),
            "invoice_number": invoice_num,
            "invoice_date": date_str,
            "due_date": data.get("due_date", ""),
            "net_amount": data.get("net_amount", 0.0),
            "tax_amount": data.get("tax_amount", 0.0),
            "total_amount": data.get("total_amount", 0.0),
            "currency": data.get("currency", "EUR"),
            "payment_method": data.get("payment_method", ""),
            "description": data.get("description", ""),
            "line_items": json.dumps(data.get("line_items", [])),
            "additional_data": str(data.get("additional_data", "{}")),
            "raw_text_content": "Gemini 2.5 Flash Analysis",
            "analysis_notes": data.get("analysis_notes", ""),
        }
        insert_beleg(db_data)
        return (
            True,
            file_path,
            "NEWLY_ANALYZED",
            db_data["category"],
            year,
            new_filename,
        )
    except Exception as e:
        return False, file_path, str(e), None, None, None


def main():
    files_to_process = []
    for d in SOURCE_DIRS:
        if d.exists():
            # Only process files that look like UUIDs or are in the root
            files_to_process.extend(
                [f for f in d.iterdir() if f.is_file() and f.suffix.lower() == ".pdf"]
            )

    print(f"Starting processing of {len(files_to_process)} files...")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_file, f): f for f in files_to_process}
        for future in as_completed(futures):
            success, original_path, status, category, year, new_filename = (
                future.result()
            )
            if success:
                target_dir = (
                    BASE_DIR
                    / ("Ausgaben" if category == "AUSGABE" else "Einnahmen")
                    / year
                )
                target_dir.mkdir(parents=True, exist_ok=True)
                target_path = target_dir / new_filename

                try:
                    if original_path.exists():
                        shutil.move(str(original_path), str(target_path))
                        print(
                            f"OK [{status}]: {original_path.name} -> {target_path.relative_to(BASE_DIR)}"
                        )
                except Exception as e:
                    print(f"Error moving {original_path.name}: {e}")
            else:
                print(f"FAIL: {original_path.name} - {status}")


if __name__ == "__main__":
    main()
