import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { RUNTIME_POLICY, envInt } from './shared/runtime_policy.js';

const PROFILE = (process.env.MICIO_PROFILE || 'core').toLowerCase();
const BUDGET_MS = envInt('MICIO_BUDGET_MS', RUNTIME_POLICY.defaultRunBudgetMs);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICIO_SCHEDULER.md');

interface Step {
  name: string;
  cmd: string[];
  env?: Record<string, string>;
  timeoutMs: number;
}

type StepStatus = 'ok' | 'timeout' | 'error' | 'skipped_budget';

function runStep(step: Step): Promise<{ name: string; status: StepStatus; ok: boolean; ms: number; code: number | null }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(step.cmd[0], step.cmd.slice(1), {
      cwd: process.cwd(),
      env: { ...process.env, ...(step.env || {}) },
      stdio: 'inherit'
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, step.timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({
        name: step.name,
        status: timedOut ? 'timeout' : (code === 0 ? 'ok' : 'error'),
        ok: !timedOut && code === 0,
        ms: Date.now() - started,
        code
      });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({
        name: step.name,
        status: 'error',
        ok: false,
        ms: Date.now() - started,
        code: null
      });
    });
  });
}

function resolveWorkerCmd(nodeEntry: string, npmScript: string): string[] {
  const jsPath = path.join(process.cwd(), 'dist-micro', 'orchestrator', `${nodeEntry}.js`);
  if (fs.existsSync(jsPath)) {
    return ['node', jsPath];
  }
  return ['npm', 'run', '-s', npmScript];
}

function buildProfile(profile: string): Step[] {
  if (profile === 'ocr') {
    return [
      {
        name: 'micro_ocr_1nm',
        cmd: resolveWorkerCmd('micro_ocr_audit_1nm', 'micro-ocr-audit-1nm'),
        env: { MICRO_1NM_OCR_BATCH: '2', OCR_EMERGENCY_TESSERACT: '0' },
        timeoutMs: 100000
      },
      {
        name: 'micro_local_118',
        cmd: resolveWorkerCmd('micro_local_118_tesseract_filter', 'micro-local-118-filter'),
        env: { LOCAL_118_BATCH: '5', LOCAL_118_UPLOAD: '0', LOCAL_118_OCR_TIMEOUT_MS: '12000', LOCAL_118_MAX_FILE_MB: '8' },
        timeoutMs: 100000
      }
    ];
  }
  if (profile === 'qa') {
    return [
      {
        name: 'micro_plausibility',
        cmd: resolveWorkerCmd('micro_plausibility_duplicate', 'micro-plausibility-duplicate'),
        timeoutMs: 60000
      },
      {
        name: 'audit_2023_strict',
        cmd: resolveWorkerCmd('audit_2023_strict', 'audit-year-strict'),
        env: { AUDIT_YEAR: '2023' },
        timeoutMs: 60000
      }
    ];
  }
  // core
  return [
    {
      name: 'micro_sync',
      cmd: resolveWorkerCmd('micro_sync_drive_changes', 'micro-sync-drive-changes'),
      timeoutMs: 50000
    },
    {
      name: 'micro_enrich',
      cmd: resolveWorkerCmd('micro_enrich_buchhaltung_db', 'micro-enrich-buchhaltung-db'),
      env: { MICRO_ENRICH_BATCH: '20' },
      timeoutMs: 90000
    },
    {
      name: 'micro_tax',
      cmd: resolveWorkerCmd('micro_tax_category_assign', 'micro-tax-category-assign'),
      env: { MICRO_TAX_BATCH: '40' },
      timeoutMs: 60000
    },
    {
      name: 'micro_konto',
      cmd: resolveWorkerCmd('micro_konto_assign', 'micro-konto-assign'),
      env: { MICRO_KONTO_BATCH: '50' },
      timeoutMs: 60000
    },
    {
      name: 'micro_formula_guard',
      cmd: resolveWorkerCmd('micro_sheet_formula_guard', 'micro-sheet-formula-guard'),
      timeoutMs: 40000
    }
  ];
}

async function main(): Promise<void> {
  const steps = buildProfile(PROFILE);
  const tickStart = Date.now();
  const out: Array<{ name: string; status: StepStatus; ok: boolean; ms: number; code: number | null }> = [];
  for (const step of steps) {
    const elapsed = Date.now() - tickStart;
    const remaining = BUDGET_MS - elapsed;
    if (remaining <= RUNTIME_POLICY.budgetReserveMs) {
      out.push({ name: step.name, status: 'skipped_budget', ok: false, ms: 0, code: null });
      continue;
    }
    const r = await runStep({
      ...step,
      timeoutMs: Math.min(step.timeoutMs, Math.max(10000, remaining - 1500))
    });
    out.push(r);
  }
  const okCount = out.filter((r) => r.ok).length;
  const timeoutCount = out.filter((r) => r.status === 'timeout').length;
  const errorCount = out.filter((r) => r.status === 'error').length;
  const skippedCount = out.filter((r) => r.status === 'skipped_budget').length;
  const lines: string[] = [];
  lines.push('# MICIO Scheduler');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Profile: ${PROFILE}`);
  lines.push(`- Budget ms: ${BUDGET_MS}`);
  lines.push(`- Elapsed ms: ${Date.now() - tickStart}`);
  lines.push(`- Steps: ${out.length}, ok: ${okCount}, timeout: ${timeoutCount}, error: ${errorCount}, skipped_budget: ${skippedCount}`);
  lines.push('');
  lines.push('| step | status | ok | ms | code |');
  lines.push('|---|---|---|---:|---:|');
  for (const r of out) lines.push(`| ${r.name} | ${r.status} | ${r.ok} | ${r.ms} | ${r.code ?? ''} |`);
  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    profile: PROFILE,
    budgetMs: BUDGET_MS,
    elapsedMs: Date.now() - tickStart,
    steps: out,
    reportPath: REPORT_PATH
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
