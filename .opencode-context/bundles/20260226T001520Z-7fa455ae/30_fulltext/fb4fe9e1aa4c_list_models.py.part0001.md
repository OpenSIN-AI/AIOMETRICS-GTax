# Context Fulltext

- source_path: list_models.py
- source_sha256: 6f748ec1147935e86055a8bc4aed792a3fb613b8556132263c723bb3845db9b9
- chunk: 1/1

```text
import os
from google import genai

api_key = [REDACTED])
client = genai.Client(api_key=[REDACTED])

try:
    print("Available models:")
    for model in client.models.list():
        print(f"- {model.name}")
except Exception as e:
    print(f"Error listing models: {e}")

```
