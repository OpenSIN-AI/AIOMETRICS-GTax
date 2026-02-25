import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

dotenv.config();

type WorkerConfig = {
  name: string;
  command: string;
  args: string[];
  intervalMs: number;
  enabled: boolean;
  env?: Record<string, string>;
};

const LOG_PATH = path.join(process.cwd(), 'logs', 'micro_workers.jsonl');

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function toMinutes(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function ensureLogDir(): void {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
}

function logEvent(payload: Record<string, unknown>): void {
  ensureLogDir();
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(payload)}\n`, 'utf8');
}

function runCommand(worker: WorkerConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(worker.command, worker.args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(worker.env || {})
      }
    });

    child.on('error', (error) => {
      logEvent({
        timestamp: new Date().toISOString(),
        worker: worker.name,
        event: 'spawn_error',
        startedAt,
        error: String(error?.message || error)
      });
      reject(error);
    });

    child.on('exit', (code, signal) => {
      const finishedAt = new Date().toISOString();
      const ok = code === 0;
      logEvent({
        timestamp: finishedAt,
        worker: worker.name,
        event: 'finished',
        startedAt,
        finishedAt,
        ok,
        code,
        signal
      });
      if (ok) {
        resolve();
        return;
      }
      reject(new Error(`${worker.name} failed with code=${code ?? 'null'} signal=${signal ?? 'null'}`));
    });
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorker(worker: WorkerConfig, once: boolean, stopRef: { value: boolean }): Promise<void> {
  if (!worker.enabled) {
    logEvent({
      timestamp: new Date().toISOString(),
      worker: worker.name,
      event: 'disabled'
    });
    return;
  }

  do {
    const started = Date.now();
    try {
      await runCommand(worker);
    } catch (error: any) {
      logEvent({
        timestamp: new Date().toISOString(),
        worker: worker.name,
        event: 'run_error',
        error: String(error?.message || error)
      });
    }

    if (once || stopRef.value) break;

    const elapsedMs = Date.now() - started;
    const waitMs = Math.max(1000, worker.intervalMs - elapsedMs);
    await sleep(waitMs);
  } while (!stopRef.value);
}

async function main(): Promise<void> {
  const once = toBool(process.env.MICRO_WORKERS_ONCE, false);
  const stopRef = { value: false };

  process.on('SIGINT', () => {
    stopRef.value = true;
  });
  process.on('SIGTERM', () => {
    stopRef.value = true;
  });

  const workers: WorkerConfig[] = [
    {
      name: 'drive_sync_worker',
      command: 'npm',
      args: ['run', 'start'],
      intervalMs: toMinutes(process.env.MICRO_WORKER_SYNC_MINUTES, 20) * 60_000,
      enabled: toBool(process.env.MICRO_WORKER_SYNC_ENABLED, false)
    },
    {
      name: 'acceptance_worker',
      command: 'npm',
      args: ['run', 'final-acceptance'],
      intervalMs: toMinutes(process.env.MICRO_WORKER_ACCEPTANCE_MINUTES, 60) * 60_000,
      enabled: toBool(process.env.MICRO_WORKER_ACCEPTANCE_ENABLED, true)
    },
    {
      name: 'assurance_worker',
      command: 'npm',
      args: ['run', 'post-closure-assurance'],
      intervalMs: toMinutes(process.env.MICRO_WORKER_ASSURANCE_MINUTES, 60) * 60_000,
      enabled: toBool(process.env.MICRO_WORKER_ASSURANCE_ENABLED, true),
      env: {
        ASSURANCE_SKIP_ACCEPTANCE: process.env.MICRO_WORKER_ASSURANCE_SKIP_ACCEPTANCE || '1'
      }
    }
  ];

  logEvent({
    timestamp: new Date().toISOString(),
    event: 'supervisor_start',
    once,
    workers: workers.map((worker) => ({
      name: worker.name,
      intervalMs: worker.intervalMs,
      enabled: worker.enabled,
      args: worker.args
    }))
  });

  if (once) {
    for (const worker of workers) {
      await runWorker(worker, true, stopRef);
      if (stopRef.value) break;
    }
  } else {
    await Promise.all(workers.map((worker) => runWorker(worker, false, stopRef)));
  }

  logEvent({
    timestamp: new Date().toISOString(),
    event: 'supervisor_stop',
    once
  });
}

main().catch((error) => {
  console.error('micro_workers failed:', error);
  process.exit(1);
});
