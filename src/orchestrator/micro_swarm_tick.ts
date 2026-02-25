import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

interface TaskDef {
  name: string;
  cmd: string[];
  env?: Record<string, string>;
  timeoutMs: number;
}

interface TaskResult {
  name: string;
  status: 'ok' | 'timeout' | 'error' | 'skipped_budget';
  durationMs: number;
  code?: number | null;
  error?: string;
}

const BUDGET_MS = Number.parseInt(process.env.MICRO_SWARM_BUDGET_MS || '170000', 10);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_SWARM_TICK.md');

function nowMs(): number {
  return Date.now();
}

function runTask(task: TaskDef): Promise<TaskResult> {
  const started = nowMs();
  return new Promise((resolve) => {
    const child = spawn(task.cmd[0], task.cmd.slice(1), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...(task.env || {})
      },
      stdio: 'inherit'
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 4000);
    }, task.timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timer);
      const durationMs = nowMs() - started;
      if (timedOut) {
        resolve({ name: task.name, status: 'timeout', durationMs, code });
        return;
      }
      if (code === 0) {
        resolve({ name: task.name, status: 'ok', durationMs, code });
      } else {
        resolve({ name: task.name, status: 'error', durationMs, code });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        name: task.name,
        status: 'error',
        durationMs: nowMs() - started,
        error: err.message
      });
    });
  });
}

async function main(): Promise<void> {
  const tasks: TaskDef[] = [
    {
      name: 'micro_sync_drive_changes',
      cmd: ['npm', 'run', '-s', 'micro-sync-drive-changes'],
      timeoutMs: 45000
    },
    {
      name: 'micro_sheet_delete_archive_sync',
      cmd: ['npm', 'run', '-s', 'micro-sheet-delete-archive-sync'],
      timeoutMs: 45000,
      env: { MICRO_SHEET_DELETE_MAX_MOVES: process.env.MICRO_SHEET_DELETE_MAX_MOVES || '20' }
    },
    {
      name: 'micro_enrich_buchhaltung_db',
      cmd: ['npm', 'run', '-s', 'micro-enrich-buchhaltung-db'],
      timeoutMs: 90000,
      env: { MICRO_ENRICH_BATCH: process.env.MICRO_ENRICH_BATCH || '20' }
    },
    {
      name: 'micro_tax_category_assign',
      cmd: ['npm', 'run', '-s', 'micro-tax-category-assign'],
      timeoutMs: 45000
    },
    {
      name: 'micro_konto_assign',
      cmd: ['npm', 'run', '-s', 'micro-konto-assign'],
      timeoutMs: 45000
    },
    {
      name: 'micro_plausibility_duplicate',
      cmd: ['npm', 'run', '-s', 'micro-plausibility-duplicate'],
      timeoutMs: 45000
    },
    {
      name: 'micro_sheet_formula_guard',
      cmd: ['npm', 'run', '-s', 'micro-sheet-formula-guard'],
      timeoutMs: 30000
    },
    {
      name: 'micro_ocr_audit_1nm',
      cmd: ['npm', 'run', '-s', 'micro-ocr-audit-1nm'],
      timeoutMs: 100000,
      env: {
        MICRO_1NM_OCR_BATCH: process.env.MICRO_1NM_OCR_BATCH || '2',
        OCR_EMERGENCY_TESSERACT: process.env.OCR_EMERGENCY_TESSERACT || '0'
      }
    },
    {
      name: 'micro_local_118_filter',
      cmd: ['npm', 'run', '-s', 'micro-local-118-filter'],
      timeoutMs: 100000,
      env: {
        LOCAL_118_BATCH: process.env.LOCAL_118_BATCH || '5',
        LOCAL_118_UPLOAD: process.env.LOCAL_118_UPLOAD || '0',
        LOCAL_118_OCR_TIMEOUT_MS: process.env.LOCAL_118_OCR_TIMEOUT_MS || '12000',
        LOCAL_118_MAX_FILE_MB: process.env.LOCAL_118_MAX_FILE_MB || '8',
        LOCAL_118_DELETE_DUPLICATES: process.env.LOCAL_118_DELETE_DUPLICATES || '1'
      }
    },
    {
      name: 'micro_repair_2023_policy_flow',
      cmd: [
        'node',
        '--import',
        'tsx',
        'src/orchestrator/repair_2023.ts'
      ],
      timeoutMs: 120000,
      env: {
        REPAIR_YEAR: '2023',
        REPAIR_STAGE_MAX_MOVES: process.env.REPAIR_STAGE_MAX_MOVES || '20',
        REPAIR_STAGE_RESTORE_ARCHIVE: 'false',
        REPAIR_STAGE_DEDUPE: 'false',
        REPAIR_STAGE_MOVE_POLICY: 'true',
        REPAIR_STAGE_MOVE_FLOW: 'true',
        REPAIR_STAGE_MOVE_YEAR: 'true',
        REPAIR_STAGE_REBUILD: 'true',
        REPAIR_STAGE_PAYMENT_PROOF: 'false'
      }
    }
  ];

  const tickStarted = nowMs();
  const results: TaskResult[] = [];

  for (const task of tasks) {
    const elapsed = nowMs() - tickStarted;
    const remaining = BUDGET_MS - elapsed;
    if (remaining <= 10000) {
      results.push({
        name: task.name,
        status: 'skipped_budget',
        durationMs: 0
      });
      continue;
    }
    const adjustedTask: TaskDef = {
      ...task,
      timeoutMs: Math.min(task.timeoutMs, Math.max(10000, remaining - 2000))
    };
    const r = await runTask(adjustedTask);
    results.push(r);
  }

  const elapsedTotal = nowMs() - tickStarted;
  const count = (status: TaskResult['status']) => results.filter((r) => r.status === status).length;

  const lines: string[] = [];
  lines.push('# MICRO Swarm Tick');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Budget ms: ${BUDGET_MS}`);
  lines.push(`- Elapsed ms: ${elapsedTotal}`);
  lines.push(`- ok: ${count('ok')}, timeout: ${count('timeout')}, error: ${count('error')}, skipped_budget: ${count('skipped_budget')}`);
  lines.push('');
  lines.push('| task | status | duration_ms | code | error |');
  lines.push('|---|---|---:|---:|---|');
  for (const r of results) {
    lines.push(`| ${r.name} | ${r.status} | ${r.durationMs} | ${r.code ?? ''} | ${(r.error || '').replace(/\|/g, '/')} |`);
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    budgetMs: BUDGET_MS,
    elapsedMs: elapsedTotal,
    results,
    reportPath: REPORT_PATH
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
