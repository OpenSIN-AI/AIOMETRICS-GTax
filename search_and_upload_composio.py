import requests
import os

# Composio config
COMPOSIO_API_KEY = os.environ.get("COMPOSIO_API_KEY", "").strip()
DRIVE_FOLDER_ID = "1xoOfpTUwxMa_pIHoP71aCDH0Eb03tzyf"
GOOGLE_CREDENTIALS_PATH = "/Users/jeremy/dev/Meine-Google-Credentials/credentials.json"

# Search config
CONTRACT_KEYWORDS = [
    "Vertrag", "Vereinbarung", "Mitgliedschaft", "Subscription", 
    "Abonnement", "Kaufvertrag", "Mietvertrag", "Arbeitsvertrag",
    "Versicherung", "Darlehen", "Kredit", "Leasing"
]
EXCLUDE_KEYWORDS = ["rechnung", "beleg", "invoice", "receipt", "quittung"]

def get_gmail_accounts():
    resp = requests.get(
        "https://backend.composio.dev/api/v3/connected_accounts?status=ACTIVE",
        headers={"x-api-key": COMPOSIO_API_KEY},
    )
    items = resp.json().get("items", [])
    return [acc for acc in items if "gmail" in acc.get("toolkit", {}).get("slug", "")]

def execute_action(action, params, account_id):
    url = "https://backend.composio.dev/api/v1/execute"
    payload = {
        "action": action,
        "parameters": params,
        "connectedAccountId": account_id
    }
    resp = requests.post(url, headers={"x-api-key": COMPOSIO_API_KEY}, json=payload)
    if resp.status_code != 200:
        print(f"  Error {resp.status_code}: {resp.text}")
        return None
    return resp.json()

def main():
    if not COMPOSIO_API_KEY:
        raise SystemExit("Missing COMPOSIO_API_KEY environment variable")

    accounts = get_gmail_accounts()
    print(f"Found {len(accounts)} active Gmail accounts in Composio.")

    for acc in accounts:
        acc_id = acc["id"]
        email = acc.get("connectionParams", {}).get("email", acc_id)
        print(f"\nProcessing account: {email}")

        for kw in CONTRACT_KEYWORDS:
            query = f"{kw} " + " ".join([f"-{ex}" for ex in EXCLUDE_KEYWORDS]) + " has:attachment"
            print(f"  Searching for: {kw}")
            
            res = execute_action("GMAIL_FETCH_EMAILS", {"query": query, "maxResults": 10}, acc_id)
            if not res: continue
            
            # The structure of res['output'] can vary. Based on typical Composio responses:
            messages = res.get("output", {}).get("messages", [])
            if not messages and "data" in res.get("output", {}):
                messages = res["output"]["data"]
            
            if not isinstance(messages, list):
                print(f"    Unexpected response format: {type(messages)}")
                continue

            print(f"    Found {len(messages)} potential contract emails.")

            for msg in messages:
                msg_id = msg.get("id")
                # To get attachments, we usually need the message details or use a specific tool
                # Let's try to get details for each message
                details = execute_action("GMAIL_GET_MAIL", {"messageId": msg_id}, acc_id)
                if not details: continue
                
                # Extract attachments from details
                payload = details.get("output", {}).get("payload", {})
                parts = payload.get("parts", [])
                
                def find_attachments(parts_list, found=None):
                    if found is None: found = []
                    for p in parts_list:
                        if p.get("filename") and p.get("body", {}).get("attachmentId"):
                            found.append(p)
                        if p.get("parts"):
                            find_attachments(p["parts"], found)
                    return found

                attachments = find_attachments(parts)
                for att in attachments:
                    fname = att["filename"]
                    att_id = att["body"]["attachmentId"]
                    print(f"      Downloading attachment: {fname}")
                    
                    # Download attachment
                    att_res = execute_action("GMAIL_GET_ATTACHMENT", {
                        "messageId": msg_id,
                        "attachmentId": att_id
                    }, acc_id)
                    
                    if att_res and "output" in att_res:
                        # Upload to Drive using the Drive logic from earlier (but in Python)
                        # For now, let's just log the success if we have the data
                        # Actually, I should use the Google Drive API directly here to be sure.
                        print(f"      Ready to upload {fname} to Drive folder {DRIVE_FOLDER_ID}")
                        # I will implement the actual upload in the next step when I have the data
                        pass

if __name__ == "__main__":
    main()
