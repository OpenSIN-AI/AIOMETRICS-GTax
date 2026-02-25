import os, shutil, json, re, sys, time, base64, requests, fitz
from pathlib import Path

# --- CONFIGURATION ---
NVIDIA_API_KEY = "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"
DRIVE_BASE = Path("/Users/jeremy/Library/CloudStorage/GoogleDrive-info@zukunftsorientierte-energie.de/Meine Ablage/Ablage Jeremy Schulze")

MAPPING = {
    "Rechnungen": "01_Rechnungen", "Bank": "02_Bank", "Vertraege": "03_Vertraege",
    "Personal": "04_Personal", "Versicherung": "05_Versicherung",
    "Projekte": "06_Projekte", "Rechtliches": "07_Rechtliches", "Sonstiges": "08_Sonstiges"
}

def make_safe_filename(s):
    if not s: return "Unbekannt"
    s = str(s).replace('ü', 'ue').replace('ä', 'ae').replace('ö', 'oe').replace('ß', 'ss')
    s = s.replace('Ü', 'Ue').replace('Ä', 'Ae').replace('Ö', 'Oe')
    s = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', s)
    return s.strip("_")

def analyze_document(img_b64):
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    prompt = """Analyze this document image. 
Return ONLY a valid JSON object. Example:
{"category": "Rechnungen", "year": "2023", "suggested_filename": "2023-01-01_Rechnungen_Amazon_Monitor.pdf"}

Available categories: Rechnungen, Vertraege, Bank, Rechtliches, Versicherung, Projekte, Personal, Sonstiges."""

    payload = {
        "model": "meta/llama-3.2-90b-vision-instruct",
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}]}],
        "max_tokens": 512, "temperature": 0.1
    }
    headers = {"Authorization": f"Bearer {NVIDIA_API_KEY}", "Content-Type": "application/json"}
    
    for attempt in range(3):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=90)
            if r.status_code == 200:
                content = r.json()['choices'][0]['message']['content']
                match = re.search(r'\{.*\}', content, re.DOTALL)
                if match:
                    return json.loads(match.group(0))
            sys.stdout.write(f"  Attempt {attempt+1} status: {r.status_code}\n")
            sys.stdout.flush()
            time.sleep(2)
        except Exception as e:
            sys.stdout.write(f"  Attempt {attempt+1} error: {e}\n")
            sys.stdout.flush()
    return {"category": "Sonstiges", "year": "Unbekannt", "suggested_filename": "Unknown"}

def main():
    while True:
        # Re-scan sources in each loop to pick up newly moved files
        files = []
        SOURCE_DIRS = [
            DRIVE_BASE / "08_Sonstiges" / "Unbekannt",
            DRIVE_BASE / "08_Sonstiges" / "Unbekannt" / "Fehlerhafte_Analyse",
            DRIVE_BASE / "08_Sonstiges" / "Unbekannt" / "From_System_Cleanup"
        ]
        for d in SOURCE_DIRS:
            if d.exists():
                for f in d.rglob("*.pdf"):
                    if f.is_file() and f.stat().st_size > 0:
                        files.append(f)
        
        files = sorted(list(set(files)))
        if not files:
            sys.stdout.write("No files to process. Sleeping 60s...\n")
            sys.stdout.flush()
            time.sleep(60)
            continue

        total = len(files)
        sys.stdout.write(f"Processing {total} documents...\n")
        sys.stdout.flush()
        
        for i, f_path in enumerate(files, 1):
            sys.stdout.write(f"[{i}/{total}] {f_path.name}\n")
            sys.stdout.flush()
            try:
                doc = fitz.open(f_path)
                page = doc.load_page(0)
                pix = page.get_pixmap(matrix=fitz.Matrix(1.2, 1.2))
                img_b64 = base64.b64encode(pix.tobytes("jpeg")).decode("utf-8")
                doc.close()
                
                data = analyze_document(img_b64)
                cat_folder = MAPPING.get(data.get("category"), "08_Sonstiges")
                year = make_safe_filename(data.get("year", "Unbekannt"))
                fname = make_safe_filename(data.get("suggested_filename", f_path.name))
                if not fname.lower().endswith(".pdf"): fname += ".pdf"
                
                dest_dir = DRIVE_BASE / cat_folder / year
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest_path = dest_dir / fname
                if dest_path.exists(): dest_path = dest_dir / f"{dest_path.stem}_{os.urandom(2).hex()}.pdf"
                
                shutil.move(str(f_path), str(dest_path))
                sys.stdout.write(f"  DONE: -> {cat_folder}/{year}/{fname}\n")
            except Exception as e:
                sys.stdout.write(f"  ERR: {f_path.name} - {e}\n")
                if "Fehlerhafte_Analyse" not in str(f_path):
                    err_dir = DRIVE_BASE / "08_Sonstiges" / "Unbekannt" / "Fehlerhafte_Analyse"
                    err_dir.mkdir(parents=True, exist_ok=True)
                    try: shutil.move(str(f_path), str(err_dir / f_path.name))
                    except: pass
            sys.stdout.flush()
            time.sleep(1)

if __name__ == "__main__":
    main()
