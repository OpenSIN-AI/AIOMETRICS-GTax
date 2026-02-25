import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'ZIO_GUARD_STATUS.md');
const MAX_MONOLITH_ELAPSED_SEC = Number.parseInt(process.env.ZIO_MAX_MONOLITH_SEC || '180', 10);
const KILL_STALE = ['1', 'true', 'yes', 'on'].includes(String(process.env.ZIO_KILL_STALE || '0').toLowerCase());

interface PsRow {
  pid: number;
  etime: string;
  cmd: string;
}

function etimeToSec(etime: string): number {
  // Formats: [[dd-]hh:]mm:ss
  const s = String(etime || '').trim();
  if (!s) return 0;
  const daySplit = s.split('-');
  let days = 0;
  let timePart = s;
  if (daySplit.length === 2) {
    days = Number.parseInt(daySplit[0], 10) || 0;
    timePart = daySplit[1];
  }
  const parts = timePart.split(':').map((p) => Number.parseInt(p, 10) || 0);
  let h = 0; let m = 0; let sec = 0;
  if (parts.length === 3) [h, m, sec] = parts;
  else if (parts.length === 2) [m, sec] = parts;
  else if (parts.length === 1) [sec] = parts;
  return days * 86400 + h * 3600 + m * 60 + sec;
}

async function main(): Promise<void> {
  const { stdout } = await execFileAsync('ps', ['-Ao', 'pid,etime,command']);
  const lines = stdout.split('\n').slice(1);
  const rows: PsRow[] = [];
  for (const line of lines) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    rows.push({ pid: Number.parseInt(m[1], 10), etime: m[2], cmd: m[3] });
  }

  const monolithMatchers = [
    'dist/orchestrator/main.js',
    'dist/orchestrator/pipeline_sync.js',
    'src/orchestrator/main.ts',
    'src/orchestrator/pipeline_sync.ts'
  ];
  const stale = rows.filter((r) =>
    monolithMatchers.some((m) => r.cmd.includes(m)) && etimeToSec(r.etime) > MAX_MONOLITH_ELAPSED_SEC
  );

  const killed: number[] = [];
  if (KILL_STALE) {
    for (const s of stale) {
      try {
        process.kill(s.pid, 'SIGTERM');
        killed.push(s.pid);
      } catch {
        // ignore
      }
    }
  }

  const lockPath = path.join(process.cwd(), '.pipeline.lock');
  const lockExists = fs.existsSync(lockPath);

  const linesOut: string[] = [];
  linesOut.push('# ZIO GUARD STATUS');
  linesOut.push('');
  linesOut.push(`- Timestamp: ${new Date().toISOString()}`);
  linesOut.push(`- Max monolith elapsed sec: ${MAX_MONOLITH_ELAPSED_SEC}`);
  linesOut.push(`- Kill stale enabled: ${KILL_STALE}`);
  linesOut.push(`- pipeline lock exists: ${lockExists}`);
  linesOut.push(`- stale monolith processes: ${stale.length}`);
  linesOut.push(`- killed: ${killed.length}`);
  linesOut.push('');
  linesOut.push('| pid | etime | cmd |');
  linesOut.push('|---:|---|---|');
  for (const s of stale) {
    linesOut.push(`| ${s.pid} | ${s.etime} | ${s.cmd.replace(/\|/g, '/')} |`);
  }
  fs.writeFileSync(REPORT_PATH, linesOut.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    lockExists,
    staleCount: stale.length,
    killed,
    reportPath: REPORT_PATH
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

