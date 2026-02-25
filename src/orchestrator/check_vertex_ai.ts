import * as dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';

dotenv.config();

async function check() {
  console.log(`KeyFile: ${process.env.GOOGLE_CREDENTIALS_PATH}`);
  const auth = new GoogleAuth({
    keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  
  const client = await auth.getClient();
  const projectId = await auth.getProjectId();
  console.log(`Project: ${projectId}`);
  
  const token = await client.getAccessToken();
  console.log(`Token obtained: ${!!token.token}`);
  
  const location = 'us-central1';
  const modelId = 'gemini-1.5-flash-001';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
  
  console.log(`Calling ${url}...`);
  const response = await fetch(url, {
      method: 'POST',
      headers: {
          'Authorization': `Bearer ${token.token}`,
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
