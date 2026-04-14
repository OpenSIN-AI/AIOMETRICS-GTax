# Context Fulltext

- source_path: docs/NVIDIA_QWEN_FALLBACK.md
- source_sha256: 63f55aea4c921e6090e3260fbb7e40701f797fb4fd64e3b7d24c1eb15935e312
- chunk: 1/1

```text
# Nvidia Qwen 3.5 Fallback Strategy

If local OCR (Tesseract) or Gemini Flash fails to extract text, use Nvidia API with Qwen 3.5.

## Python Example
```python
import requests, base64

invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
stream = True

def read_b64(path):
  with open(path, "rb") as f:
    return base64.b64encode(f.read()).decode()

headers = {
  "Authorization": [REDACTED]
  "Accept": "text/event-stream" if stream else "application/json"
}

payload = {
  "model": "qwen/qwen3.5-397b-a17b",
  "messages": [{"role":"user","content":"Analyze this receipt."}],
  "max_tokens": [REDACTED]
  "temperature": 0.60,
  "top_p": 0.95,
  "top_k": 20,
  "presence_penalty": 0,
  "repetition_penalty": 1,
  "stream": stream,
  "chat_template_kwargs": {"enable_thinking":True},
}

response = requests.post(invoke_url, headers=headers, json=payload, stream=stream)
```

## Node Example (Axios)
```javascript
import axios from 'axios';

const invokeUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
const stream = true;

const headers = {
  "Authorization": [REDACTED]
  "Accept": stream ? "text/event-stream" : "application/json"
};

const payload = {
  "model": "qwen/qwen3.5-397b-a17b",
  "messages": [{"role":"user","content":"Analyze this receipt content."}],
  "max_tokens": [REDACTED]
  "temperature": 0.60,
  "top_p": 0.95,
  "top_k": 20,
  "stream": stream,
  "chat_template_kwargs": {"enable_thinking":true},
};

axios.post(invokeUrl, payload, { headers, responseType: stream ? 'stream' : 'json' })
  .then(response => {
     // handle response
  });
```

**Instruction:** Integrate this into `accounting_enrichment.ts` as a fallback if `extracted_text` remains empty after standard attempts.

```
