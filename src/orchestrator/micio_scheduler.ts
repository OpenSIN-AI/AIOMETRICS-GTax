import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { RUNTIME_POLICY, envInt } from './shared/runtime_policy.js';
import { getMicioProfileWorkers, MicioProfile, WorkerDefinition } from './worker_manifest.js';

const PROFILE = (process.env.MICIO_PROFILE || 'core').toLowerCase() as MicioProfile;
const BUDGET_MS = envInt('MICIO_BUDGET_MS', RUNTIME_POLICY.defaultRunBudgetMs);
const REPORT_PATH = path.join(process.cwd(), 'docs', 'MICIO_SCHEDULER.md');

interface Step {
  workerId: string;
  name: string;
  cmd: string[];
  env?: Record<string, string>;
  timeoutMs: number;
}

type StepStatus = 'ok' | 'timeout' | 'error' | 'skipped_budget' | 'skipped_precondition';

function runStep(step: Step): Promise<{ workerId: string; name: string; status: StepStatus; ok: boolean; ms: number; code: number | null }> {
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
        workerId: step.workerId,
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
        workerId: step.workerId,
        name: step.name,
        status: 'error',
        ok: false,
        ms: Date.now() - started,
        code: null
      });
    });
  });
}

function resolveWorkerCmdStrict(worker: WorkerDefinition): string[] {
  const entry = worker.distEntry;
  if (!entry) {
    throw new Error(`Worker ${worker.id} has no dist entry configured in manifest`);
  }
  const jsPath = path.join(process.cwd(), entry);
  if (!fs.existsSync(jsPath)) {
    throw new Error(`Missing worker artifact for ${worker.id}: ${entry}. Run: npm run -s build`);
  }
  return ['node', jsPath];
}

function buildEnvForWorker(worker: WorkerDefinition): Record<string, string> {
  if (worker.id === 'micro_ocr_audit_1nm') {
    return { MICRO_1NM_OCR_BATCH: '2', OCR_EMERGENCY_TESSERACT: '0' };
  }
  if (worker.id === 'micro_local_118_tesseract_filter') {
    return {
      LOCAL_118_BATCH: '5',
      LOCAL_118_UPLOAD: '0',
      LOCAL_118_OCR_TIMEOUT_MS: '12000',
      LOCAL_118_MAX_FILE_MB: '8'
    };
  }
  if (worker.id === 'micro_enrich_buchhaltung_db') {
    return { MICRO_ENRICH_BATCH: '20' };
  }
  if (worker.id === 'micro_tax_category_assign') {
    return { MICRO_TAX_BATCH: '40' };
  }
  if (worker.id === 'micro_konto_assign') {
    return { MICRO_KONTO_BATCH: '50' };
  }
  if (worker.id === 'audit_2023_strict') {
    return { AUDIT_YEAR: '2023' };
  }
  if (worker.id === 'check_2023_integrity') {
    return { CHECK_YEARS: process.env.CHECK_YEARS || '2022,2023,2024,2025,2026' };
  }
  return {};
}

function buildProfile(profile: MicioProfile): Step[] {
  const workers = getMicioProfileWorkers(profile);
  return workers.map((worker) => ({
    workerId: worker.id,
    name: worker.id,
    cmd: resolveWorkerCmdStrict(worker),
    env: buildEnvForWorker(worker),
    timeoutMs: worker.defaultTimeoutMs
  }));
}

async function main(): Promise<void> {
  if (!['core', 'ocr', 'qa'].includes(PROFILE)) {
    throw new Error(`Invalid MICIO_PROFILE=${PROFILE}. Allowed: core, ocr, qa`);
  }

  const steps = buildProfile(PROFILE);
  const tickStart = Date.now();
  const out: Array<{ workerId: string; name: string; status: StepStatus; ok: boolean; ms: number; code: number | null }> = [];
  for (const step of steps) {
    const elapsed = Date.now() - tickStart;
    const remaining = BUDGET_MS - elapsed;
    if (remaining <= RUNTIME_POLICY.budgetReserveMs) {
      out.push({ workerId: step.workerId, name: step.name, status: 'skipped_budget', ok: false, ms: 0, code: null });
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
  lines.push('| worker_id | status | ok | ms | code |');
  lines.push('|---|---|---|---:|---:|');
  for (const r of out) lines.push(`| ${r.workerId} | ${r.status} | ${r.ok} | ${r.ms} | ${r.code ?? ''} |`);
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
