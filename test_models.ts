import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const resp = await axios.get('https://integrate.api.nvidia.com/v1/models', {
    headers: { 'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}` }
  });
  const models = resp.data.data.map((m: any) => m.id);
  console.log("Nvidia models:", models.slice(0, 10)); // just print 10
}
run().catch(console.error);
