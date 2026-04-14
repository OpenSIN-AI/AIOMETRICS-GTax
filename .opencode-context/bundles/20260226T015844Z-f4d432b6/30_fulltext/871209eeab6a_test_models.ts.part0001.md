# Context Fulltext

- source_path: test_models.ts
- source_sha256: 510dd0ca029673da8429cdcce4b8ea55ad0a124945996068a5efc9da07a26ae7
- chunk: 1/1

```text
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const resp = await axios.get('https://integrate.api.nvidia.com/v1/models', {
    headers: [REDACTED]
  });
  const models = resp.data.data.map((m: any) => m.id);
  console.log("Nvidia models:", models.slice(0, 10)); // just print 10
}
run().catch(console.error);

```
