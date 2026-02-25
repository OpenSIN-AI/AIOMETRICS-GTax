import * as dotenv from 'dotenv';
import * as path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { appendPipelineEvent, withPipelineLock } from './pipeline_lock.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

interface Stage {
  name: string;
  scriptPath: string;
  env?: Record<string, string>;
  enabled: boolean;
}

function isTruthy(raw: string | undefined, fallback = false): boolean {
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function getEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function runNodeScript(scriptPath: string, env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...env,
        PIPELINE_LOCK_BYPASS: '1'
      },
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Stage failed (${path.basename(scriptPath)}): code=${code ?? 'null'}, signal=${signal ?? 'null'}`));
    });
  });
}

async function main(): Promise<void> {
  const continueOnError = isTruthy(process.env.PIPELINE_CONTINUE_ON_ERROR, true);
  const syncOnly = isTruthy(process.env.PIPELINE_SYNC_ONLY, true) ? '1' : '0';
  const batchSize = getEnv('BATCH_SIZE', getEnv('MAX_FILES_PER_RUN', '50'));
  const ocrMinTextLength = getEnv('OCR_MIN_TEXT_LENGTH', '20');
  const applyMoveRules = getEnv('APPLY_MOVE_RULES', 'false');
  const renameFiles = getEnv('RENAME_FILES', 'false');
  const runYearlyReorganize = isTruthy(process.env.PIPELINE_RUN_YEARLY_REORGANIZE, false);
  const runSoftAudit = isTruthy(process.env.PIPELINE_RUN_SOFT_AUDIT, false);
  const runHardAudit = isTruthy(process.env.PIPELINE_RUN_HARD_AUDIT, false);

  const stages: Stage[] = [
    {
      name: 'sync_drive_to_sheets',
      scriptPath: path.join(PROJECT_ROOT, 'dist/orchestrator/main.js'),
      env: { SYNC_ONLY: syncOnly },
      enabled: true
    },
    {
      name: 'yearly_reorganize',
      scriptPath: path.join(PROJECT_ROOT, 'dist/orchestrator/yearly_reorganize.js'),
      enabled: runYearlyReorganize
    },
    {
      name: 'accounting_enrichment',
      scriptPath: path.join(PROJECT_ROOT, 'dist/orchestrator/accounting_enrichment.js'),
      env: {
        MAX_FILES_PER_RUN: batchSize,
        OCR_MIN_TEXT_LENGTH: ocrMinTextLength,
        APPLY_MOVE_RULES: applyMoveRules,
        RENAME_FILES: renameFiles
      },
      enabled: true
    },
    {
      name: 'soft_audit',
      scriptPath: path.join(PROJECT_ROOT, 'dist/orchestrator/soft_audit.js'),
      env: { AUDIT_LEVEL: 'soft' },
      enabled: runSoftAudit
    },
    {
      name: 'hard_audit',
      scriptPath: path.join(PROJECT_ROOT, 'dist/orchestrator/soft_audit.js'),
      env: { AUDIT_LEVEL: 'hard' },
      enabled: runHardAudit
    }
  ];

  const activeStages = stages.filter((stage) => stage.enabled);
  if (activeStages.length === 0) {
    console.log('[pipeline] No active stages configured.');
    return;
  }

  const pipelineRunId = randomUUID();
  console.log(`[pipeline] Starting with ${activeStages.length} stage(s): ${activeStages.map((s) => s.name).join(', ')}`);

  await withPipelineLock('pipeline_sync', async () => {
    for (const stage of activeStages) {
      const started = Date.now();
      appendPipelineEvent('pipeline_sync', 'stage_start', pipelineRunId, { stage: stage.name });
      console.log(`[pipeline] Stage start: ${stage.name}`);
      try {
        await runNodeScript(stage.scriptPath, stage.env || {});
        appendPipelineEvent('pipeline_sync', 'stage_success', pipelineRunId, {
          stage: stage.name,
          durationMs: Date.now() - started
        });
        console.log(`[pipeline] Stage success: ${stage.name}`);
      } catch (error: any) {
        appendPipelineEvent('pipeline_sync', 'stage_error', pipelineRunId, {
          stage: stage.name,
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error)
        });
        console.error(`[pipeline] Stage failed: ${stage.name}`, error);
        if (!continueOnError) {
          throw error;
        }
      }
    }
  });

  console.log('[pipeline] Completed.');
}

main().catch((error) => {
  console.error('pipeline_sync failed:', error);
  process.exit(1);
});
