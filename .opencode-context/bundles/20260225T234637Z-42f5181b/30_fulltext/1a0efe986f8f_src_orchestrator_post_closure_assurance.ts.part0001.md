# Context Fulltext

- source_path: src/orchestrator/post_closure_assurance.ts
- source_sha256: 3e50566aa78f2f0a23a6f4f2bb7f7e93e49d36126a345da5083fd17affa0f854
- chunk: 1/5

```text
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { GoogleSheetsService, BelegRecord } from '../db/googleSheetsService.js';
import { withPipelineLock } from './pipeline_lock.js';

dotenv.config();

type FinalAcceptanceKpis = {
  totalDriveOnly: number;
  totalSheetOnly: number;
  totalDuplicateIds: number;
  forbiddenMarkerHits: number;
  qaSampleSize: number;
  qaSampleCriticalPassed: number;
  qaAccuracy: number;
  criticalQaIssues: number;
  idempotencyPass: boolean;
  dashboardFormulaDriftCount: number;
  dashboardValueDriftCount: number;
  bidirectionalDriftIncidents: number;
};

type FinalAcceptanceStage = {
  stage: string;
  ok: boolean;
  error?: string;
};

type GovernanceFinding = {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  code: string;
  tab: string;
  message: string;
  detail?: string;
};

type YearlyGateStatus = {
  year: string;
  driveOnly: number;
  sheetOnly: number;
  duplicateDriveIds: number;
  pass: boolean;
};

type FinalAcceptanceReport = {
  timestamp: string;
  runId: string;
  done: boolean;
  scopeYears: string[];
  kpis: FinalAcceptanceKpis;
  stages: FinalAcceptanceStage[];
  hardFailReasons: string[];
  yearlyGateStatus: YearlyGateStatus[];
  governanceFindings: GovernanceFinding[];
  contractSync?: {
    gates?: {
      gateA?: { pass?: boolean };
      gateB?: { pass?: boolean };
      gateC?: { pass?: boolean; formulaDriftCount?: number; valueDriftCount?: number };
    };
  };
  after: {
    records: number;
    categories: Record<string, number>;
    tabs: string[];
    forbiddenMarkerHits: number;
  };
  unresolvedIdsPath?: string | null;
  integrity?: {
    fullMismatchFiles?: Record<string, {
      driveOnlyFullPath?: string;
      sheetOnlyFullPath?: string;
      duplicateFullPath?: string;
    }>;
  };
};

type AssuranceAlertKind = 'quota' | 'schema' | 'drive_drift' | 'parser_drift' | 'unknown';
type WindowStatus = 'active' | 'completed' | 'broken';

type YearGateCounter = {
  driveOnly: number;
  sheetOnly: number;
  duplicateIds: number;
};

type AssuranceHistoryEntry = {
  timestamp: string;
  reportTimestamp: string;
  runId: string;
  done: boolean;
  kpis: FinalAcceptanceKpis;
  categories: Record<string, number>;
  yearCounters: Record<string, YearGateCounter>;
  hardFailReasons: string[];
  scopeYears: string[];
  alertKinds: AssuranceAlertKind[];
  incidentPath: string | null;
};

type SampleRow = {
  drive_file_id: string;
  original_name: string;
  year: string;
  category: string;
  file_url: string;
  target_folder_id: string;
  review_checklist: string[];
};

type SampleFile = {
  generatedAt: string;
  sampleType: 'daily' | 'weekly';
  sampleSize: number;
  sourceRows: number;
  rows: SampleRow[];
};

type ReviewRow = {
  drive_file_id: string;
  original_name: string;
  datum_ok: boolean | null;
  betrag_ok: boolean | null;
  category_ok: boolean | null;
  gegenpartei_ok: boolean | null;
  notes: string;
};

type DailyReview = {
  date: string;
  sample_file: string;
  expected_sample_size: number;
  reviewed_count: number;
  reviewer_primary: string;
  critical_mismatches: number;
  decision: 'approved' | 'blocked' | 'pending';
  created_at: string;
  updated_at: string;
  rows: ReviewRow[];
};

type WeeklyReview = {
  iso_week: string;
  sample_file: string;
  expected_sample_size: number;
  reviewed_count: number;
  reviewer_primary: string;
  reviewer_secondary: string;
  critical_mismatches: number;
  decision: 'approved' | 'blocked' | 'pending';
  created_at: string;
  updated_at: string;
  rows: ReviewRow[];
};

type ReviewSummary = {
  daily: {
    expected: number;
    filesPresent: number;
    completed: number;
    samplesReviewed: number;
    missingDates: string[];
  };
  weekly: {
    expected: number;
    filesPresent: number;
    completed: number;
    samplesReviewed: number;
    missingWeeks: string[];
  };
  criticalMismatches: number;
};

type AssuranceWindowState = {
  version: 1;
  daysTarget: number;
  periodStart: string;
  periodStartRunId: string;
  scopeYears: string[];
  definitionFingerprint: string;
  definitionFiles: string[];
  definitionChanged: boolean;
  scopeChanged: boolean;
  status: WindowStatus;
  failRunIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type WindowMetrics = {
  daysTarget: number;
  runs: number;
  failedRuns: number;
  consecutiveFailedRuns: number;
  consecutiveRedRuns: number;
  coverageHours: number;
  fullWindowCovered: boolean;
  passTechnicalWindow: boolean;
};

type ExecSignoff = {
  period_start: string;
  period_end: string;
  reviewer_primary: string;
  reviewer_secondary: string;
  daily_samples_reviewed: number;
  weekly_samples_reviewed: number;
  critical_mismatches: number;
  decision: 'approved' | 'blocked';
  decision_reasons: string[];
  generated_at: string;
};

const DOCS_DIR = path.join(process.cwd(), 'docs');
const ASSURANCE_DIR = path.join(DOCS_DIR, 'assurance');
const DAILY_DIR = path.join(ASSURANCE_DIR, 'daily');
const WEEKLY_DIR = path.join(ASSURANCE_DIR, 'weekly');
const SAMPLE_DIR = path.join(ASSURANCE_DIR, 'samples');
const INCIDENT_DIR = path.join(ASSURANCE_DIR, 'incidents');
const FINAL_REPORT_PATH = path.join(DOCS_DIR, 'FINAL_ACCEPTANCE_REPORT.json');
const HISTORY_PATH = path.join(DOCS_DIR, 'ASSURANCE_HISTORY.jsonl');
const ALERT_PATH = path.join(ASSURANCE_DIR, 'ASSURANCE_ALERT.json');
const WINDOW_STATE_PATH = path.join(ASSURANCE_DIR, 'WINDOW_STATE.json');
const EXEC_SIGNOFF_PATH = path.join(ASSURANCE_DIR, 'EXEC_SIGNOFF.json');
const DEFAULT_REVIEWER_PRIMARY = process.env.ASSURANCE_DEFAULT_REVIEWER_PRIMARY || 'UNASSIGNED_PRIMARY';
const DEFAULT_REVIEWER_SECONDARY = process.env.ASSURANCE_DEFAULT_REVIEWER_SECONDARY || 'UNASSIGNED_SECONDARY';

const DEFINITION_FILES = [
  'src/orchestrator/post_closure_assurance.ts',
  'src/orchestrator/final_acceptance_run.ts',
  'src/orchestrator/main.ts',
  'src/orchestrator/check_2023_integrity.ts',
  'src/db/googleSheetsService.ts',
  'package.json'
];

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}`);
  }
  return value;
}

function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

function toIsoWeek(isoTs: string): string {
  const date = new Date(isoTs);
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const d = new Date(utc);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function hoursBetween(olderIso: string, newerIso: string): number {
  const older = Date.parse(olderIso);
  const newer = Date.parse(newerIso);
  if (!Number.isFinite(older) || !Number.isFinite(newer) || newer < older) return 0;
  return (newer - older) / (60 * 60 * 1000);
}

function runCommand(command: string, args: string[], extraEnv: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(' ')} code=${code ?? 'null'} signal=${signal ?? 'null'}`));
    });
  });
}

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function ensureDirStructure(): void {
  for (const dir of [ASSURANCE_DIR, DAILY_DIR, WEEKLY_DIR, SAMPLE_DIR, INCIDENT_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeKpis(raw: Partial<FinalAcceptanceKpis> | undefined): FinalAcceptanceKpis {
  return {
    totalDriveOnly: Number(raw?.totalDriveOnly || 0),
    totalSheetOnly: Number(raw?.totalSheetOnly || 0),
    totalDuplicateIds: Number(raw?.totalDuplicateIds || 0),
    forbiddenMarkerHits: Number(raw?.forbiddenMarkerHits || 0),
    qaSampleSize: Number(raw?.qaSampleSize || 0),
    qaSampleCriticalPassed: Number(raw?.qaSampleCriticalPassed || 0),
    qaAccuracy: Number(raw?.qaAccuracy || 0),
    criticalQaIssues: Number(raw?.criticalQaIssues || 0),
    idempotencyPass: Boolean(raw?.idempotencyPass),
    dashboardFormulaDriftCount: Number(raw?.dashboardFormulaDriftCount || 0),
    dashboardValueDriftCount: Number(raw?.dashboardValueDriftCount || 0),
    bidirectionalDriftIncidents: Number(raw?.bidirectionalDriftIncidents || 0)
  };
}

function parseHistory(): AssuranceHistoryEntry[] {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  const rows = fs
    .readFileSync(HISTORY_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: AssuranceHistoryEntry[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row) as Partial<AssuranceHistoryEntry>;
      if (!parsed.runId || !parsed.timestamp || typeof parsed.done !== 'boolean') continue;
      entries.push({
        timestamp: parsed.timestamp,
        reportTimestamp: parsed.reportTimestamp || parsed.timestamp,
        runId: parsed.runId,
        done: parsed.done,
        kpis: normalizeKpis(parsed.kpis),
        categories: parsed.categories || {},
        yearCounters: parsed.yearCounters || {},
        hardFailReasons: parsed.hardFailReasons || [],
        scopeYears: parsed.scopeYears || [],
        alertKinds: parsed.alertKinds || [],
        incidentPath: parsed.incidentPath || null
      });
    } catch {
      // Ignore malformed history lines.
    }
  }

  return entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function appendHistory(entry: AssuranceHistoryEntry): void {
  fs.appendFileSync(HISTORY_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

function sortYears(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function classifyAlerts(report: FinalAcceptanceReport): AssuranceAlertKind[] {
  if (report.done) return [];

  const kinds = new Set<AssuranceAlertKind>();
  const stageErrors = report.stages
    .filter((stage) => !stage.ok && stage.error)
    .map((stage) => String(stage.error || '').toLowerCase());

  if (stageErrors.some((error) => error.includes('quota') || error.includes('rate limit') || error.includes('429'))) {
    kinds.add('quota');
  }

  const hasSchemaIssue = report.governanceFindings.some(
    (finding) => finding.code.includes('HEADER') || finding.code.includes('MISSING_REQUIRED_TAB')
  ) || report.hardFailReasons.some((reason) => reason.includes('GOVERNANCE'));
  if (hasSchemaIssue) {
    kinds.add('schema');
  }

  if (
    report.kpis.totalDriveOnly > 0 ||
    report.kpis.totalSheetOnly > 0 ||
    report.kpis.totalDuplicateIds > 0 ||
    report.kpis.bidirectionalDriftIncidents > 0
  ) {
    kinds.add('drive_drift');
  }

  if (
    report.kpis.qaAccuracy < 0.99 ||
    report.kpis.criticalQaIssues > 0 ||
    report.kpis.forbiddenMarkerHits > 0 ||
    report.kpis.dashboardFormulaDriftCount > 0 ||
    report.kpis.dashboardValueDriftCount > 0
  ) {
    kinds.add('parser_drift');
  }

  if (kinds.size === 0) {
    kinds.add('unknown');
  }

  return Array.from(kinds.values());
}

function summarizeYearCounters(rows: YearlyGateStatus[]): Record<string, YearGateCounter> {
  const out: Record<string, YearGateCounter> = {};
  for (cons
```
