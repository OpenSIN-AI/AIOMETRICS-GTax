# Context Fulltext

- source_path: src/orchestrator/check_vertex_ai.ts
- source_sha256: 004cc938693429d704d0634e869d43cde0610c1b56550ce80fd82caaa767e520
- chunk: 1/1

```text
import * as dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

dotenv.config();

async function check() {
  console.log(`KeyFile: [REDACTED]
  const auth = new GoogleAuth({
    keyFile: [REDACTED]
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  
  const client = await auth.getClient();
  const projectId = await auth.getProjectId();
  console.log(`Project: ${projectId}`);
  
  const token = [REDACTED] client.getAccessToken();
  console.log(`Token obtained: [REDACTED]
  
  const location = 'us-central1';
  const modelId = 'gemini-1.5-flash-001';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
  
  console.log(`Calling ${url}...`);
  const response = await fetch(url, {
      method: 'POST',
      headers: {
          'Authorization': [REDACTED]
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hello' }] }]
      })
  });
  
  console.log(`Status: ${response.status}`);
  if (response.ok) {
      const data = await response.json();
      console.log('Success!');
      // console.log(JSON.stringify(data));
  } else {
      console.log('Error Body:', await response.text());
  }
}

check().catch(console.error);

```
