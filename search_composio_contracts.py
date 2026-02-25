import requests
import os
import json
import base64
from datetime import datetime

API_KEY = "ak_d7C_5oCKr5NS0gDyANN-"
DRIVE_FOLDER_ID = "1xoOfpTUwxMa_pIHoP71aCDH0Eb03tzyf"
TEMP_DIR = "/tmp/composio_contracts"

# Keywords for contracts and liabilities (excluding invoices/receipts as requested)
CONTRACT_KEYWORDS = [
    "Vertrag", "Vereinbarung", "Mitgliedschaft", "Subscription", 
    "Abonnement", "Kaufvertrag", "Mietvertrag", "Arbeitsvertrag",
    "Versicherung", "Darlehen", "Kredit", "Leasing"
]

EXCLUDE_KEYWORDS = ["rechnung", "beleg", "invoice", "receipt", "quittung"]

def get_connected_accounts():
    resp = requests.get(
        "https://backend.composio.dev/api/v3/connected_accounts?status=ACTIVE&toolkit=gmail",
        headers={"x-api-key": API_KEY},
    )
    return resp.json().get("items", [])

def execute_composio_action(action_name, params):
    resp = requests.post(
        f"https://backend.composio.dev/api/v1/execute",
        headers={"x-api-key": API_KEY, "Content-Type": "application/json"},
        json={"action": action_name, "parameters": params}
    )
    if resp.status_code != 200:
        print(f"Error executing {action_name}: {resp.text}")
        return None
    return resp.json()

def upload_to_drive(file_path, file_name):
    # Use standard Google Drive API via service account if possible, 
    # but since user asked for Composio, we check if there's a drive action
    # However, for simplicity and reliability with the given folder, 
    # we might need to use the previously seen drive logic or composio drive actions.
    # Let's see if Composio has a DRIVE_UPLOAD_FILE action.
    
    # Actually, the user wants me to use Composio for searching in THREE accounts.
    # I'll first fetch the files.
    pass

def main():
    if not os.path.exists(TEMP_DIR):
        os.makedirs(TEMP_DIR)

    accounts = get_connected_accounts()
    print(f"Found {len(accounts)} active Gmail accounts in Composio.")
    
    gmail_accounts = [acc for acc in accounts if "gmail" in acc.get("toolkit", {}).get("slug", "")]
    
    all_attachments = []

    for acc in gmail_accounts:
        acc_id = acc["id"]
        # Try to identify email address from data if available
        email_addr = acc.get("connectionParams", {}).get("email", acc_id)
        print(f"\nSearching account: {email_addr} (ID: {acc_id})")
        
        for keyword in CONTRACT_KEYWORDS:
            # Construct query: keyword -exclusions has:attachment
            query = f"{keyword} " + " ".join([f"-{ex}" for ex in EXCLUDE_KEYWORDS]) + " has:attachment"
            print(f"  Query: {query}")
            
            # GMAIL_FETCH_EMAILS
            params = {"query": query, "maxResults": 20}
            # We need to specify the account. In Composio API, we usually pass connectedAccountId
            # The structure for execute is slightly different depending on the SDK/API version.
            # Based on COMPOSIO.md: composio execute GMAIL_FETCH_EMAILS --params '...'
            
            # Using direct proxy/execute if possible
            resp = requests.post(
                "https://backend.composio.dev/api/v1/execute",
                headers={"x-api-key": API_KEY},
                json={
                    "action": "GMAIL_FETCH_EMAILS",
                    "parameters": params,
                    "connectedAccountId": acc_id
                }
            )
            
            if resp.status_code == 200:
                data = resp.json()
                # The structure of data depends on the action output
                # Usually it's a list of messages or a data object
                messages = data.get("output", {}).get("data", [])
                if not messages and "messages" in data.get("output", {}):
                     messages = data["output"]["messages"]
                
                print(f"    Found {len(messages)} messages.")
                
                for msg in messages:
                    msg_id = msg.get("id")
                    if not msg_id: continue
                    
                    # We need to get details to find attachments
                    # Or use an action that list attachments if available
                    # For now, let's assume we can use the messages directly if they have attachment info
                    # Actually, we need to call GMAIL_GET_ATTACHMENT for each attachment.
                    
                    # This requires parsing the message payload.
                    # Since I'm an AI, I will generate a more robust script that handles this.
                    pass

if __name__ == "__main__":
    # The user wants me to actually DO it.
    # I will write a script that does:
    # 1. List accounts
    # 2. For each account, search
    # 3. For each hit, get attachments
    # 4. Upload to the specific drive folder
    main()
