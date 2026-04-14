# Context Fulltext

- source_path: src/orchestrator/pipeline_lock.ts
- source_sha256: 4e0eaaac5869de8df2d35151981af957511850990f5795302d6e24e3889aaeb3
- chunk: 1/1

```text
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_LOCK_FILE = path.join(PROJECT_ROOT, '.pipeline.lock');
const DEFAULT_EVENTS_LOG = path.join(PROJECT_ROOT, 'logs', 'pipeline_events.jsonl');

interface LockPayload {
  version: number;
  runId: string;
  task: string;
  pid: number;
  hostname: string;
  cwd: string;
  startedAt: string;
  heartbeatAt: string;
}

interface LockOptions {
  lockFilePath?: string;
  waitMs?: number;
  pollMs?: number;
  staleMs?: number;
}

interface LockHandle {
  runId: string;
  task: string;
  lockPath: string;
  release: () => Promise<void>;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

function readLock(lockPath: string): LockPayload | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as LockPayload;
    if (!parsed?.runId || !parsed?.task || !parsed?.pid) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getHeartbeatTime(payload: LockPayload): number {
  const hb = Date.parse(payload.heartbeatAt || payload.startedAt || '');
  if (!Number.isNaN(hb)) return hb;
  return 0;
}

function getMtimeMs(lockPath: string): number {
  try {
    return fs.statSync(lockPath).mtimeMs;
  } catch {
    return 0;
  }
}

function isStaleLock(lockPath: string, payload: LockPayload, staleMs: number): boolean {
  if (!isProcessAlive(payload.pid)) {
    return true;
  }
  const now = Date.now();
  const heartbeat = getHeartbeatTime(payload);
  if (heartbeat > 0 && now - heartbeat > staleMs) {
    return true;
  }
  const mtime = getMtimeMs(lockPath);
  if (mtime > 0 && now - mtime > staleMs) {
    return true;
  }
  return false;
}

function writeEvent(event: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(DEFAULT_EVENTS_LOG), { recursive: true });
    fs.appendFileSync(DEFAULT_EVENTS_LOG, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Logging must never break pipeline execution.
  }
}

export function appendPipelineEvent(
  task: string,
  event: string,
  runId: string,
  extra: Record<string, unknown> = {}
): void {
  writeEvent({
    ts: new Date().toISOString(),
    task,
    event,
    runId,
    pid: process.pid,
    ...extra
  });
}

async function acquirePipelineLock(task: string, options: LockOptions = {}): Promise<LockHandle> {
  const lockPath = options.lockFilePath || DEFAULT_LOCK_FILE;
  const waitMs = options.waitMs ?? parsePositiveInt(process.env.PIPELINE_LOCK_WAIT_MS, 15 * 60 * 1000);
  const pollMs = options.pollMs ?? parsePositiveInt(process.env.PIPELINE_LOCK_POLL_MS, 3000);
  const staleMs = options.staleMs ?? parsePositiveInt(process.env.PIPELINE_LOCK_STALE_MS, 2 * 60 * 60 * 1000);
  const runId = randomUUID();
  const startedAtIso = new Date().toISOString();
  const startedAt = Date.now();
  let lastBusyLog = 0;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  while (true) {
    const payload: LockPayload = {
      version: 1,
      runId,
      task,
      pid: process.pid,
      hostname: os.hostname(),
      cwd: process.cwd(),
      startedAt: startedAtIso,
      heartbeatAt: new Date().toISOString()
    };

    try {
      fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), { flag: 'wx' });
      appendPipelineEvent(task, 'lock_acquired', runId, { lockPath });

      let released = false;
      const heartbeatIntervalMs = Math.max(5000, Math.min(30000, Math.floor(staleMs / 4)));
      const timer = setInterval(() => {
        try {
          const current = readLock(lockPath);
          if (!current || current.runId !== runId) {
            return;
          }
          current.heartbeatAt = new Date().toISOString();
          fs.writeFileSync(lockPath, JSON.stringify(current, null, 2));
        } catch {
          // Ignore heartbeat write errors; stale lock recovery handles it.
        }
      }, heartbeatIntervalMs);
      timer.unref();

      const release = async (): Promise<void> => {
        if (released) return;
        released = true;
        clearInterval(timer);
        try {
          const current = readLock(lockPath);
          if (current && current.runId === runId) {
            fs.unlinkSync(lockPath);
          }
          appendPipelineEvent(task, 'lock_released', runId, { lockPath });
        } catch {
          // Nothing to do.
        }
      };

      return { runId, task, lockPath, release };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }

    const existing = readLock(lockPath);
    if (existing && existing.pid === process.pid) {
      appendPipelineEvent(task, 'lock_reused_same_pid', existing.runId, { lockPath });
      return {
        runId: existing.runId,
        task,
        lockPath,
        release: async () => { /* no-op for same-process nested lock */ }
      };
    }

    if (!existing || isStaleLock(lockPath, existing, staleMs)) {
      try {
        fs.unlinkSync(lockPath);
        appendPipelineEvent(task, 'lock_stale_removed', runId, {
          lockPath,
          staleOwnerTask: existing?.task || '',
          staleOwnerPid: existing?.pid || 0
        });
      } catch {
        // Another process might already have removed/replaced the lock.
      }
      continue;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= waitMs) {
      appendPipelineEvent(task, 'lock_timeout', runId, {
        lockPath,
        waitedMs: elapsedMs,
        ownerTask: existing.task,
        ownerPid: existing.pid,
        ownerStartedAt: existing.startedAt
      });
      throw new Error(
        `Pipeline lock timeout after ${elapsedMs}ms. Active: task=${existing.task}, pid=${existing.pid}, startedAt=${existing.startedAt}`
      );
    }

    const now = Date.now();
    if (now - lastBusyLog > 30000) {
      lastBusyLog = now;
      appendPipelineEvent(task, 'lock_waiting', runId, {
        lockPath,
        waitedMs: elapsedMs,
        ownerTask: existing.task,
        ownerPid: existing.pid,
        ownerStartedAt: existing.startedAt
      });
      console.log(
        `[pipeline-lock] Waiting for lock: owner task=${existing.task}, pid=${existing.pid}, waited=${elapsedMs}ms`
      );
    }

    await sleep(Math.min(pollMs, Math.max(1000, waitMs - elapsedMs)));
  }
}

export async function withPipelineLock<T>(task: string, fn: () => Promise<T>): Promise<T> {
  if (isTruthy(process.env.PIPELINE_LOCK_BYPASS)) {
    return await fn();
  }

  const lock = await acquirePipelineLock(task);
  const started = Date.now();
  appendPipelineEvent(task, 'run_start', lock.runId);

  try {
    const result = await fn();
    appendPipelineEvent(task, 'run_success', lock.runId, { durationMs: Date.now() - started });
    return result;
  } catch (error: any) {
    appendPipelineEvent(task, 'run_error', lock.runId, {
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    await lock.release();
  }
}

```
