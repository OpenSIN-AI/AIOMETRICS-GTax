# Context Fulltext

- source_path: src/orchestrator/micro_swarm_tick.ts
- source_sha256: bead56dde71ab42d2b02af3608a73f5ccfd5ff7083e441998e8f83ceffe38196
- chunk: 1/1

```text
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

interface TaskDef {
  name: string;
  cmd: string[];
  env?: Record<string, string>;
  timeoutMs: number;
}

interface TaskResult {
  name: string;
  status: 'ok' | 'timeout' | 'error' | 'skipped_budget' | 'skipped_precondition';
  durationMs: number;
  code?: number | null;
  error?: string;
}

interface ContractSyncGuardReport {
  gates?: {
    gateA?: { pass?: boolean };
    gateB?: { pass?: boolean };
    gateC?: { pass?: boolean };
  };
}

const BUDGET_MS = Number.parseInt(process.env.MICRO_SWARM_BUDGET_MS || '170000', 10);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICRO_SWARM_TICK.md');
const CONTRACT_REPORT_PATH = path.join(process.cwd(), 'docs', 'CONTRACT_SYNC_GUARD.json');

export function parseEnabledFlag(raw: string | undefined, defaultEnabled = true): boolean {
  const normalized = String(raw ?? (defaultEnabled ? '1' : '0')).trim().toLowerCase();
  if (normalized === '') return defaultEnabled;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return defaultEnabled;
}

const RISK_STAGE_ENABLED = parseEnabledFlag(process.env.MICRO_SWARM_ENABLE_RISK_STAGE, true);

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

function loadContractReport(): ContractSyncGuardReport | null {
  if (!fs.existsSync(CONTRACT_REPORT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONTRACT_REPORT_PATH, 'utf8')) as ContractSyncGuardReport;
  } catch {
    return null;
  }
}

function gateABPass(report: ContractSyncGuardReport | null): boolean {
  return Boolean(report?.gates?.gateA?.pass && report?.gates?.gateB?.pass);
}

async function runWithBudget(task: TaskDef, tickStarted: number, results: TaskResult[]): Promise<void> {
  const elapsed = nowMs() - tickStarted;
  const remaining = BUDGET_MS - elapsed;
  if (remaining <= 10000) {
    results.push({
      name: task.name,
      status: 'skipped_budget',
      durationMs: 0
    });
    return;
  }
  const adjustedTask: TaskDef = {
    ...task,
    timeoutMs: Math.min(task.timeoutMs, Math.max(10000, remaining - 2000))
  };
  const result = await runTask(adjustedTask);
  results.push(result);
}

async function main(): Promise<void> {
  const stageS1: TaskDef[] = [
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
    }
  ];

  const stageS2: TaskDef[] = [
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
      name: 'contract_sync_guard',
      cmd: ['npm', 'run', '-s', 'contract-sync-guard'],
      timeoutMs: 90000,
      env: { CONTRACT_SCOPE_YEARS: process.env.CONTRACT_SCOPE_YEARS || '2022,2023,2024,2025,2026' }
    }
  ];

  const stageS3Risk: TaskDef = {
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
  };

  const tickStarted = nowMs();
  const results: TaskResult[] = [];

  for (const task of stageS1) {
    await runWithBudget(task, tickStarted, results);
  }
  for (const task of stageS2) {
    await runWithBudget(task, tickStarted, results);
  }

  const contract = loadContractReport();
  const contractABOk = gateABPass(contract);
  if (!RISK_STAGE_ENABLED) {
    results.push({
      name: stageS3Risk.name,
      status: 'skipped_precondition',
      durationMs: 0,
      error: 'risk_stage_disabled'
    });
  } else if (!contractABOk) {
    results.push({
      name: stageS3Risk.name,
      status: 'skipped_precondition',
      durationMs: 0,
      error: 'gate_a_or_b_not_green'
    });
  } else {
    await runWithBudget(stageS3Risk, tickStarted, results);
  }

  const elapsedTotal = nowMs() - tickStarted;
  const count = (status: TaskResult['status']) => results.filter((r) => r.status === status).length;

  const lines: string[] = [];
  lines.push('# MICRO Swarm Tick');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Budget ms: ${BUDGET_MS}`);
  lines.push(`- Elapsed ms: ${elapsedTotal}`);
  lines.push(`- Risk stage enabled: ${RISK_STAGE_ENABLED}`);
  lines.push(`- Contract Gate A+B pass: ${contractABOk}`);
  lines.push(`- ok: ${count('ok')}, timeout: ${count('timeout')}, error: ${count('error')}, skipped_budget: ${count('skipped_budget')}, skipped_precondition: ${count('skipped_precondition')}`);
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
    riskStageEnabled: RISK_STAGE_ENABLED,
    contractGateABPass: contractABOk,
    results,
    reportPath: REPORT_PATH
  }, null, 2));
}

const isDirectExecution = (() => {
  try {
    const argvPath = process.argv[1];
    if (!argvPath) return false;
    return path.resolve(argvPath) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
})();

if (isDirectExecution) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

```
