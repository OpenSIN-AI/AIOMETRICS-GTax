# Context Fulltext

- source_path: src/orchestrator/aiometrics_worker.ts
- source_sha256: 0ee9887d5e1848f56dbdd04ce9c9fb440a07a9494ad4e4fd0d1ce75a28389c00
- chunk: 1/1

```text
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const REPORT_PATH = path.join(process.cwd(), 'docs', 'AIOMETRICS_STATUS.md');

function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function extractInt(text: string, label: string): number | null {
  const re = new RegExp(`${label}\\s*:\\s*(\\d+)`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function fileMtimeIso(filePath: string): string {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const ocr = readText(path.join(process.cwd(), 'docs', 'MICRO_OCR_AUDIT_1NM.md'));
  const local = readText(path.join(process.cwd(), 'docs', 'MICRO_LOCAL_118_TESSERACT_FILTER.md'));
  const swarm = readText(path.join(process.cwd(), 'docs', 'MICRO_SWARM_TICK.md'));
  const sync = readText(path.join(process.cwd(), 'docs', 'MICRO_SYNC_DRIVE_CHANGES.md'));

  const ocrUpdates = extractInt(ocr, 'OCR text updates in sheet') ?? 0;
  const ocrMoved = extractInt(ocr, 'Moved to private') ?? 0;
  const localProcessed = extractInt(local, 'Processed now') ?? 0;
  const syncChanges = extractInt(sync, 'Changes fetched') ?? 0;

  const health =
    swarm.includes('timeout: 0') && swarm.includes('error: 0')
      ? 'GREEN'
      : swarm ? 'YELLOW' : 'UNKNOWN';

  const lines: string[] = [];
  lines.push('# AIOMETRICS STATUS');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Swarm health: ${health}`);
  lines.push(`- OCR updates (latest batch): ${ocrUpdates}`);
  lines.push(`- OCR moved private (latest batch): ${ocrMoved}`);
  lines.push(`- Local processed (latest batch): ${localProcessed}`);
  lines.push(`- Drive delta changes fetched (latest batch): ${syncChanges}`);
  lines.push('');
  lines.push('## Report freshness');
  lines.push('');
  lines.push(`- MICRO_OCR_AUDIT_1NM.md: ${fileMtimeIso(path.join(process.cwd(), 'docs', 'MICRO_OCR_AUDIT_1NM.md'))}`);
  lines.push(`- MICRO_LOCAL_118_TESSERACT_FILTER.md: ${fileMtimeIso(path.join(process.cwd(), 'docs', 'MICRO_LOCAL_118_TESSERACT_FILTER.md'))}`);
  lines.push(`- MICRO_SWARM_TICK.md: ${fileMtimeIso(path.join(process.cwd(), 'docs', 'MICRO_SWARM_TICK.md'))}`);
  lines.push(`- MICRO_SYNC_DRIVE_CHANGES.md: ${fileMtimeIso(path.join(process.cwd(), 'docs', 'MICRO_SYNC_DRIVE_CHANGES.md'))}`);

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
  console.log(JSON.stringify({
    status: 'ok',
    health,
    ocrUpdates,
    ocrMoved,
    localProcessed,
    syncChanges,
    reportPath: REPORT_PATH
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


```
