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
        kpis: parsed.kpis as FinalAcceptanceKpis,
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
    report.kpis.totalDuplicateIds > 0
  ) {
    kinds.add('drive_drift');
  }

  if (
    report.kpis.qaAccuracy < 0.99 ||
    report.kpis.criticalQaIssues > 0 ||
    report.kpis.forbiddenMarkerHits > 0
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
  for (const row of rows) {
    out[row.year] = {
      driveOnly: row.driveOnly,
      sheetOnly: row.sheetOnly,
      duplicateIds: row.duplicateDriveIds
    };
  }
  return out;
}

function pickTopUnresolvedIds(report: FinalAcceptanceReport, limit: number): string[] {
  const ids = new Set<string>();

  const unresolvedPath = report.unresolvedIdsPath || '';
  if (unresolvedPath && fs.existsSync(unresolvedPath)) {
    const unresolved = readJsonIfExists<{ unresolved?: Record<string, string[]> }>(unresolvedPath);
    for (const rows of Object.values(unresolved?.unresolved || {})) {
      for (const id of rows) {
        if (id) ids.add(String(id));
        if (ids.size >= limit) return Array.from(ids.values());
      }
    }
  }

  const fullMismatch = report.integrity?.fullMismatchFiles || {};
  for (const ref of Object.values(fullMismatch)) {
    const driveOnly = ref.driveOnlyFullPath ? readJsonIfExists<any>(ref.driveOnlyFullPath) : null;
    for (const row of [...(driveOnly?.income || []), ...(driveOnly?.expense || [])]) {
      if (row?.id) ids.add(String(row.id));
      if (ids.size >= limit) return Array.from(ids.values());
    }

    const sheetOnly = ref.sheetOnlyFullPath ? readJsonIfExists<any>(ref.sheetOnlyFullPath) : null;
    for (const row of [...(sheetOnly?.income || []), ...(sheetOnly?.expense || [])]) {
      if (row?.driveFileId) ids.add(String(row.driveFileId));
      if (ids.size >= limit) return Array.from(ids.values());
    }

    const duplicates = ref.duplicateFullPath ? readJsonIfExists<any>(ref.duplicateFullPath) : null;
    for (const row of [...(duplicates?.income || []), ...(duplicates?.expense || [])]) {
      if (row?.driveFileId) ids.add(String(row.driveFileId));
      if (ids.size >= limit) return Array.from(ids.values());
    }
  }

  return Array.from(ids.values());
}

function ensureIncidentBranch(branchName: string): string {
  const shouldCreate = process.env.ASSURANCE_CREATE_INCIDENT_BRANCH !== '0';
  if (!shouldCreate) return 'skipped';

  const exists = spawnSync('git', ['rev-parse', '--verify', branchName], {
    cwd: process.cwd(),
    stdio: 'ignore'
  });
  if (exists.status === 0) {
    return 'exists';
  }

  const create = spawnSync('git', ['branch', branchName], {
    cwd: process.cwd(),
    stdio: 'pipe'
  });
  if (create.status === 0) {
    return 'created';
  }

  const stderr = String(create.stderr || '').trim();
  return stderr ? `failed:${stderr}` : 'failed';
}

function computeDefinitionFingerprint(): { fingerprint: string; files: string[] } {
  const hash = createHash('sha256');
  const files = DEFINITION_FILES.map((file) => path.join(process.cwd(), file));

  for (const filePath of files) {
    const relative = path.relative(process.cwd(), filePath);
    const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    hash.update(relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  return {
    fingerprint: hash.digest('hex'),
    files: files.map((file) => path.relative(process.cwd(), file))
  };
}

function entryFailed(entry: AssuranceHistoryEntry): boolean {
  return !entry.done;
}

function entryOperationalRed(entry: AssuranceHistoryEntry): boolean {
  if (!entry.done) return true;
  const kinds = new Set(entry.alertKinds || []);
  return kinds.has('schema') || kinds.has('drive_drift');
}

function extractYear(record: Partial<BelegRecord>): string {
  const source = `${record.original_name || ''} ${record.analyzed_at || ''}`;
  const match = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(source);
  if (!match) return 'unknown';
  return match[1];
}

function selectStratifiedSample(rows: Partial<BelegRecord>[], size: number): SampleRow[] {
  const grouped = new Map<string, Partial<BelegRecord>[]>();
  for (const row of rows) {
    const year = extractYear(row);
    const category = String(row.category || 'Unkategorisiert');
    const key = `${year}::${category}`;
    const bucket = grouped.get(key) || [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const orderedKeys = Array.from(grouped.keys()).sort();
  for (const key of orderedKeys) {
    const sorted = (grouped.get(key) || []).sort((a, b) => String(a.drive_file_id || '').localeCompare(String(b.drive_file_id || '')));
    grouped.set(key, sorted);
  }

  const picks: Partial<BelegRecord>[] = [];
  const cursor = new Map<string, number>();

  for (const key of orderedKeys) {
    const bucket = grouped.get(key) || [];
    if (bucket.length > 0) {
      picks.push(bucket[0]);
      cursor.set(key, 1);
    } else {
      cursor.set(key, 0);
    }
    if (picks.length >= size) break;
  }

  while (picks.length < size) {
    let added = false;
    for (const key of orderedKeys) {
      const bucket = grouped.get(key) || [];
      const idx = cursor.get(key) || 0;
      if (idx < bucket.length) {
        picks.push(bucket[idx]);
        cursor.set(key, idx + 1);
        added = true;
        if (picks.length >= size) break;
      }
    }
    if (!added) break;
  }

  return picks.slice(0, size).map((row) => ({
    drive_file_id: String(row.drive_file_id || ''),
    original_name: String(row.original_name || ''),
    year: extractYear(row),
    category: String(row.category || ''),
    file_url: String(row.file_url || ''),
    target_folder_id: String(row.target_folder_id || ''),
    review_checklist: [
      'Datum gegen Dokument verifizieren',
      'Betrag gegen Dokument verifizieren',
      'Kategorie gegen Ordner/Beleginhalt verifizieren',
      'Gegenpartei korrekt erfasst?'
    ]
  }));
}

function writeDailyKpi(report: FinalAcceptanceReport): string {
  const day = isoDate(report.timestamp);
  const payload = {
    date: day,
    runId: report.runId,
    done: report.done,
    scopeYears: report.scopeYears,
    records: report.after.records,
    categories: report.after.categories,
    kpis: report.kpis,
    hardFailReasons: report.hardFailReasons
  };

  const jsonPath = path.join(DAILY_DIR, `DAILY_KPI_${day}.json`);
  const mdPath = path.join(DAILY_DIR, `DAILY_KPI_${day}.md`);
  writeJson(jsonPath, payload);

  const lines: string[] = [];
  lines.push(`# Daily KPI ${day}`);
  lines.push('');
  lines.push(`- runId: ${report.runId}`);
  lines.push(`- done: ${report.done}`);
  lines.push(`- records: ${report.after.records}`);
  lines.push(`- driveOnly: ${report.kpis.totalDriveOnly}`);
  lines.push(`- sheetOnly: ${report.kpis.totalSheetOnly}`);
  lines.push(`- duplicateIds: ${report.kpis.totalDuplicateIds}`);
  lines.push(`- forbiddenMarkerHits: ${report.kpis.forbiddenMarkerHits}`);
  lines.push(`- qaAccuracy: ${(report.kpis.qaAccuracy * 100).toFixed(2)}%`);
  lines.push(`- criticalQaIssues: ${report.kpis.criticalQaIssues}`);
  lines.push(`- idempotencyPass: ${report.kpis.idempotencyPass}`);
  lines.push('');
  lines.push('## Categories');
  lines.push('');
  for (const [category, count] of Object.entries(report.after.categories).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${category}: ${count}`);
  }
  if (report.hardFailReasons.length > 0) {
    lines.push('');
    lines.push('## Hard Fail Reasons');
    lines.push('');
    for (const reason of report.hardFailReasons) {
      lines.push(`- ${reason}`);
    }
  }

  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');
  return jsonPath;
}

function buildWeeklyTrend(history: AssuranceHistoryEntry[], nowIso: string): { jsonPath: string; mdPath: string } {
  const week = toIsoWeek(nowIso);
  const cutoff = Date.parse(nowIso) - (7 * 24 * 60 * 60 * 1000);
  const windowRows = history.filter((entry) => Date.parse(entry.timestamp) >= cutoff);
  const sorted = [...windowRows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const categoryDelta: Record<string, number> = {};
  if (first && last) {
    const keys = new Set([...Object.keys(first.categories || {}), ...Object.keys(last.categories || {})]);
    for (const key of keys) {
      categoryDelta[key] = (last.categories[key] || 0) - (first.categories[key] || 0);
    }
  }

  const yearDelta: Record<string, YearGateCounter> = {};
  if (first && last) {
    const keys = new Set([...Object.keys(first.yearCounters || {}), ...Object.keys(last.yearCounters || {})]);
    for (const key of keys) {
      const before = first.yearCounters[key] || { driveOnly: 0, sheetOnly: 0, duplicateIds: 0 };
      const after = last.yearCounters[key] || { driveOnly: 0, sheetOnly: 0, duplicateIds: 0 };
      yearDelta[key] = {
        driveOnly: after.driveOnly - before.driveOnly,
        sheetOnly: after.sheetOnly - before.sheetOnly,
        duplicateIds: after.duplicateIds - before.duplicateIds
      };
    }
  }

  const failRuns = sorted.filter((entry) => entryFailed(entry)).length;
  const payload = {
    week,
    generatedAt: nowIso,
    runsInWindow: sorted.length,
    failRuns,
    passRate: sorted.length === 0 ? 0 : (sorted.length - failRuns) / sorted.length,
    fromRunId: first?.runId || null,
    toRunId: last?.runId || null,
    fromReportTimestamp: first?.reportTimestamp || null,
    toReportTimestamp: last?.reportTimestamp || null,
    kpiDelta: first && last ? {
      driveOnly: last.kpis.totalDriveOnly - first.kpis.totalDriveOnly,
      sheetOnly: last.kpis.totalSheetOnly - first.kpis.totalSheetOnly,
      duplicateIds: last.kpis.totalDuplicateIds - first.kpis.totalDuplicateIds,
      forbiddenMarkerHits: last.kpis.forbiddenMarkerHits - first.kpis.forbiddenMarkerHits,
      qaAccuracy: Number((last.kpis.qaAccuracy - first.kpis.qaAccuracy).toFixed(4))
    } : null,
    categoryDelta,
    yearDelta
  };

  const jsonPath = path.join(WEEKLY_DIR, `WEEKLY_TREND_${week}.json`);
  const mdPath = path.join(WEEKLY_DIR, `WEEKLY_TREND_${week}.md`);
  writeJson(jsonPath, payload);

  const lines: string[] = [];
  lines.push(`# Weekly Trend ${week}`);
  lines.push('');
  lines.push(`- generatedAt: ${nowIso}`);
  lines.push(`- runsInWindow: ${payload.runsInWindow}`);
  lines.push(`- failRuns: ${payload.failRuns}`);
  lines.push(`- passRate: ${(payload.passRate * 100).toFixed(2)}%`);
  lines.push(`- fromRunId: ${payload.fromRunId || 'n/a'}`);
  lines.push(`- toRunId: ${payload.toRunId || 'n/a'}`);
  lines.push('');
  if (payload.kpiDelta) {
    lines.push('## KPI Delta');
    lines.push('');
    lines.push(`- driveOnly: ${payload.kpiDelta.driveOnly}`);
    lines.push(`- sheetOnly: ${payload.kpiDelta.sheetOnly}`);
    lines.push(`- duplicateIds: ${payload.kpiDelta.duplicateIds}`);
    lines.push(`- forbiddenMarkerHits: ${payload.kpiDelta.forbiddenMarkerHits}`);
    lines.push(`- qaAccuracy: ${payload.kpiDelta.qaAccuracy}`);
    lines.push('');
  }
  lines.push('## Category Delta');
  lines.push('');
  for (const [category, delta] of Object.entries(categoryDelta).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${category}: ${delta}`);
  }
  lines.push('');
  lines.push('## Year Delta');
  lines.push('');
  for (const [year, delta] of Object.entries(yearDelta).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${year}: driveOnly=${delta.driveOnly}, sheetOnly=${delta.sheetOnly}, duplicateIds=${delta.duplicateIds}`);
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  return { jsonPath, mdPath };
}

function writeIncidentArtifacts(report: FinalAcceptanceReport, alertKinds: AssuranceAlertKind[]): { jsonPath: string; mdPath: string; incidentBranch: string } {
  const tag = `${isoDate(report.timestamp)}_${report.runId}`;
  const incidentBranch = `incident/${tag}`;
  const incidentBranchStatus = ensureIncidentBranch(incidentBranch);
  const unresolvedTop = pickTopUnresolvedIds(report, 100);
  const stageFailures = report.stages.filter((stage) => !stage.ok).map((stage) => ({
    stage: stage.stage,
    error: stage.error || ''
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    runId: report.runId,
    incidentBranch,
    incidentBranchStatus,
    alertKinds,
    hardFailReasons: report.hardFailReasons,
    stageFailures,
    unresolvedTop,
    actionPlan: [
      'Ursache klassifizieren (quota/schema/drive drift/parser drift)',
      'Reconcile erneut laufen lassen',
      'Wenn nach 2 Läufen nicht grün: blocker dokumentieren und Top-IDs priorisieren'
    ]
  };

  const jsonPath = path.join(INCIDENT_DIR, `INCIDENT_${tag}.json`);
  const mdPath = path.join(INCIDENT_DIR, `INCIDENT_${tag}.md`);
  writeJson(jsonPath, payload);

  const lines: string[] = [];
  lines.push(`# Incident ${tag}`);
  lines.push('');
  lines.push(`- runId: ${report.runId}`);
  lines.push(`- incidentBranch: ${incidentBranch}`);
  lines.push(`- incidentBranchStatus: ${incidentBranchStatus}`);
  lines.push(`- alertKinds: ${alertKinds.join(', ')}`);
  lines.push('');
  lines.push('## Hard Fail Reasons');
  lines.push('');
  for (const reason of report.hardFailReasons) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Stage Failures');
  lines.push('');
  for (const stage of stageFailures) {
    lines.push(`- ${stage.stage}: ${stage.error}`);
  }
  lines.push('');
  lines.push('## Top Unresolved IDs');
  lines.push('');
  for (const id of unresolvedTop) {
    lines.push(`- ${id}`);
  }
  lines.push('');
  lines.push('## Action Plan');
  lines.push('');
  for (const item of payload.actionPlan) {
    lines.push(`- ${item}`);
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  return { jsonPath, mdPath, incidentBranch };
}

function writeBlockerArtifacts(report: FinalAcceptanceReport, consecutiveRedRuns: number, incidentBranch: string): { jsonPath: string; mdPath: string } {
  const tag = `${isoDate(report.timestamp)}_${report.runId}`;
  const unresolvedTop = pickTopUnresolvedIds(report, 100);

  const payload = {
    generatedAt: new Date().toISOString(),
    runId: report.runId,
    incidentBranch,
    consecutiveRedRuns,
    blockerReasons: report.hardFailReasons,
    unresolvedTop
  };

  const jsonPath = path.join(INCIDENT_DIR, `BLOCKER_${tag}.json`);
  const mdPath = path.join(INCIDENT_DIR, `BLOCKER_${tag}.md`);
  writeJson(jsonPath, payload);

  const lines: string[] = [];
  lines.push(`# Blocker ${tag}`);
  lines.push('');
  lines.push(`- runId: ${report.runId}`);
  lines.push(`- incidentBranch: ${incidentBranch}`);
  lines.push(`- consecutiveRedRuns: ${consecutiveRedRuns}`);
  lines.push('');
  lines.push('## Blocker Reasons');
  lines.push('');
  for (const reason of report.hardFailReasons) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Top Unresolved IDs');
  lines.push('');
  for (const id of unresolvedTop) {
    lines.push(`- ${id}`);
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  return { jsonPath, mdPath };
}

function buildReviewRows(sampleRows: SampleRow[]): ReviewRow[] {
  return sampleRows.map((row) => ({
    drive_file_id: row.drive_file_id,
    original_name: row.original_name,
    datum_ok: null,
    betrag_ok: null,
    category_ok: null,
    gegenpartei_ok: null,
    notes: ''
  }));
}

function ensureDailyReviewTemplate(date: string, samplePath: string, nowIso: string): string {
  const reviewPath = path.join(DAILY_DIR, `DAILY_REVIEW_${date}.json`);
  if (fs.existsSync(reviewPath)) {
    const existing = readJsonIfExists<Partial<DailyReview>>(reviewPath) || {};
    const nextReviewer = String(existing.reviewer_primary || '').trim() || DEFAULT_REVIEWER_PRIMARY;
    if (nextReviewer !== String(existing.reviewer_primary || '')) {
      writeJson(reviewPath, {
        ...existing,
        reviewer_primary: nextReviewer,
        updated_at: nowIso
      });
    }
    return reviewPath;
  }

  const sample = readJsonIfExists<SampleFile>(samplePath);
  const rows = sample?.rows || [];
  const payload: DailyReview = {
    date,
    sample_file: samplePath,
    expected_sample_size: rows.length,
    reviewed_count: 0,
    reviewer_primary: DEFAULT_REVIEWER_PRIMARY,
    critical_mismatches: 0,
    decision: 'pending',
    created_at: nowIso,
    updated_at: nowIso,
    rows: buildReviewRows(rows)
  };
  writeJson(reviewPath, payload);
  return reviewPath;
}

function ensureWeeklyReviewTemplate(week: string, samplePath: string, nowIso: string): string {
  const reviewPath = path.join(WEEKLY_DIR, `WEEKLY_REVIEW_${week}.json`);
  if (fs.existsSync(reviewPath)) {
    const existing = readJsonIfExists<Partial<WeeklyReview>>(reviewPath) || {};
    const nextPrimary = String(existing.reviewer_primary || '').trim() || DEFAULT_REVIEWER_PRIMARY;
    const nextSecondary = String(existing.reviewer_secondary || '').trim() || DEFAULT_REVIEWER_SECONDARY;
    if (
      nextPrimary !== String(existing.reviewer_primary || '') ||
      nextSecondary !== String(existing.reviewer_secondary || '')
    ) {
      writeJson(reviewPath, {
        ...existing,
        reviewer_primary: nextPrimary,
        reviewer_secondary: nextSecondary,
        updated_at: nowIso
      });
    }
    return reviewPath;
  }

  const sample = readJsonIfExists<SampleFile>(samplePath);
  const rows = sample?.rows || [];
  const payload: WeeklyReview = {
    iso_week: week,
    sample_file: samplePath,
    expected_sample_size: rows.length,
    reviewed_count: 0,
    reviewer_primary: DEFAULT_REVIEWER_PRIMARY,
    reviewer_secondary: DEFAULT_REVIEWER_SECONDARY,
    critical_mismatches: 0,
    decision: 'pending',
    created_at: nowIso,
    updated_at: nowIso,
    rows: buildReviewRows(rows)
  };
  writeJson(reviewPath, payload);
  return reviewPath;
}

function listDatesInclusive(startIso: string, endIso: string): string[] {
  const start = new Date(Date.parse(isoDate(startIso) + 'T00:00:00.000Z'));
  const end = new Date(Date.parse(isoDate(endIso) + 'T00:00:00.000Z'));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end.getTime() < start.getTime()) {
    return [];
  }

  const out: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    out.push(isoDate(cursor.toISOString()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function listIsoWeeksInclusive(startIso: string, endIso: string): string[] {
  const days = listDatesInclusive(startIso, endIso);
  const weeks = new Set<string>();
  for (const day of days) {
    weeks.add(toIsoWeek(`${day}T00:00:00.000Z`));
  }
  return Array.from(weeks).sort((a, b) => a.localeCompare(b));
}

function isReviewCompleted(
  reviewedCount: number,
  expectedCount: number,
  decision: string,
  criticalMismatches: number
): boolean {
  if (expectedCount <= 0) return false;
  if (reviewedCount < expectedCount) return false;
  if (criticalMismatches > 0) return false;
  const normalized = (decision || '').toLowerCase();
  return normalized === 'approved' || normalized === 'passed' || normalized === 'ok';
}

function summarizeReviews(periodStart: string, nowIso: string): ReviewSummary {
  const expectedDates = listDatesInclusive(periodStart, nowIso);
  const expectedWeeks = listIsoWeeksInclusive(periodStart, nowIso);

  let dailyFilesPresent = 0;
  let dailyCompleted = 0;
  let dailySamplesReviewed = 0;
  let weeklyFilesPresent = 0;
  let weeklyCompleted = 0;
  let weeklySamplesReviewed = 0;
  let criticalMismatches = 0;

  const missingDates: string[] = [];
  const missingWeeks: string[] = [];

  for (const date of expectedDates) {
    const filePath = path.join(DAILY_DIR, `DAILY_REVIEW_${date}.json`);
    if (!fs.existsSync(filePath)) {
      missingDates.push(date);
      continue;
    }

    dailyFilesPresent++;
    const review = readJsonIfExists<Partial<DailyReview>>(filePath) || {};
    const reviewedCount = Number(review.reviewed_count || 0);
    const expectedCount = Number(review.expected_sample_size || 0);
    const decision = String(review.decision || 'pending');
    const reviewCriticalMismatches = Number(review.critical_mismatches || 0);

    dailySamplesReviewed += reviewedCount;
    criticalMismatches += reviewCriticalMismatches;
    if (isReviewCompleted(reviewedCount, expectedCount, decision, reviewCriticalMismatches)) {
      dailyCompleted++;
    }
  }

  for (const week of expectedWeeks) {
    const filePath = path.join(WEEKLY_DIR, `WEEKLY_REVIEW_${week}.json`);
    if (!fs.existsSync(filePath)) {
      missingWeeks.push(week);
      continue;
    }

    weeklyFilesPresent++;
    const review = readJsonIfExists<Partial<WeeklyReview>>(filePath) || {};
    const reviewedCount = Number(review.reviewed_count || 0);
    const expectedCount = Number(review.expected_sample_size || 0);
    const decision = String(review.decision || 'pending');
    const reviewCriticalMismatches = Number(review.critical_mismatches || 0);

    weeklySamplesReviewed += reviewedCount;
    criticalMismatches += reviewCriticalMismatches;
    if (isReviewCompleted(reviewedCount, expectedCount, decision, reviewCriticalMismatches)) {
      weeklyCompleted++;
    }
  }

  return {
    daily: {
      expected: expectedDates.length,
      filesPresent: dailyFilesPresent,
      completed: dailyCompleted,
      samplesReviewed: dailySamplesReviewed,
      missingDates
    },
    weekly: {
      expected: expectedWeeks.length,
      filesPresent: weeklyFilesPresent,
      completed: weeklyCompleted,
      samplesReviewed: weeklySamplesReviewed,
      missingWeeks
    },
    criticalMismatches
  };
}

async function writeSamplingArtifacts(nowIso: string): Promise<{ dailySamplePath: string; weeklySamplePath: string; dailySampleSize: number; weeklySampleSize: number }> {
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');
  const dailySize = Math.max(1, Number.parseInt(process.env.ASSURANCE_DAILY_SAMPLE_SIZE || '25', 10));
  const weeklySize = Math.max(1, Number.parseInt(process.env.ASSURANCE_WEEKLY_SAMPLE_SIZE || '100', 10));

  const service = new GoogleSheetsService(credentialsPath, spreadsheetId);
  await service.init();
  const belege = await service.getAllBelege();

  const dailySample = selectStratifiedSample(belege, dailySize);
  const weeklySample = selectStratifiedSample(belege, weeklySize);
  const day = isoDate(nowIso);
  const week = toIsoWeek(nowIso);

  const dailySamplePath = path.join(SAMPLE_DIR, `DAILY_SAMPLE_${day}.json`);
  const weeklySamplePath = path.join(SAMPLE_DIR, `WEEKLY_SAMPLE_${week}.json`);

  writeJson(dailySamplePath, {
    generatedAt: nowIso,
    sampleType: 'daily',
    sampleSize: dailySample.length,
    sourceRows: belege.length,
    rows: dailySample
  });

  writeJson(weeklySamplePath, {
    generatedAt: nowIso,
    sampleType: 'weekly',
    sampleSize: weeklySample.length,
    sourceRows: belege.length,
    rows: weeklySample
  });

  return {
    dailySamplePath,
    weeklySamplePath,
    dailySampleSize: dailySample.length,
    weeklySampleSize: weeklySample.length
  };
}

function loadOrCreateWindowState(
  history: AssuranceHistoryEntry[],
  report: FinalAcceptanceReport,
  nowIso: string,
  daysTarget: number,
  definitionFingerprint: { fingerprint: string; files: string[] }
): AssuranceWindowState {
  const resetWindow = process.env.ASSURANCE_RESET_WINDOW === '1';
  const existing = !resetWindow ? readJsonIfExists<AssuranceWindowState>(WINDOW_STATE_PATH) : null;

  if (existing) {
    const scopeChanged =
      JSON.stringify(sortYears(existing.scopeYears || [])) !==
      JSON.stringify(sortYears(report.scopeYears || []));

    const definitionChanged = existing.definitionFingerprint !== definitionFingerprint.fingerprint;
    const failRunIds = Array.from(new Set(existing.failRunIds || []));
    if (!report.done && !failRunIds.includes(report.runId)) {
      failRunIds.push(report.runId);
    }

    const status: WindowStatus = (definitionChanged || scopeChanged || failRunIds.length > 0)
      ? 'broken'
      : existing.status;

    return {
      ...existing,
      daysTarget: existing.daysTarget,
      scopeYears: existing.scopeYears,
      definitionFiles: existing.definitionFiles || definitionFingerprint.files,
      definitionChanged,
      scopeChanged,
      failRunIds,
      status,
      updatedAt: nowIso
    };
  }

  const greenCandidates = history
    .filter((entry) => entry.done)
    .map((entry) => ({ runId: entry.runId, ts: entry.reportTimestamp || entry.timestamp }));

  if (report.done) {
    greenCandidates.push({ runId: report.runId, ts: report.timestamp });
  }

  const latestGreen = greenCandidates.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
  if (!latestGreen) {
    throw new Error('Cannot initialize 7-day window: no green run available');
  }

  const failRunIds: string[] = [];
  if (!report.done) failRunIds.push(report.runId);

  const state: AssuranceWindowState = {
    version: 1,
    daysTarget,
    periodStart: latestGreen.ts,
    periodStartRunId: latestGreen.runId,
    scopeYears: sortYears(report.scopeYears),
    definitionFingerprint: definitionFingerprint.fingerprint,
    definitionFiles: definitionFingerprint.files,
    definitionChanged: false,
    scopeChanged: false,
    status: report.done ? 'active' : 'broken',
    failRunIds,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  return state;
}

function computeWindowMetrics(state: AssuranceWindowState, historyWithCurrent: AssuranceHistoryEntry[], nowIso: string): WindowMetrics {
  const rows = historyWithCurrent
    .filter((entry) => Date.parse(entry.timestamp) >= Date.parse(state.periodStart))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const failedRuns = rows.filter((entry) => entryFailed(entry)).length;

  let consecutiveFailedRuns = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].done) break;
    consecutiveFailedRuns++;
  }

  let consecutiveRedRuns = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!entryOperationalRed(rows[i])) break;
    consecutiveRedRuns++;
  }

  const coverageHours = hoursBetween(state.periodStart, nowIso);
  const fullWindowCovered = coverageHours >= (state.daysTarget * 24);

  const passTechnicalWindow =
    failedRuns === 0 &&
    fullWindowCovered &&
    !state.definitionChanged &&
    !state.scopeChanged;

  return {
    daysTarget: state.daysTarget,
    runs: rows.length,
    failedRuns,
    consecutiveFailedRuns,
    consecutiveRedRuns,
    coverageHours,
    fullWindowCovered,
    passTechnicalWindow
  };
}

function writeExecSignoff(params: {
  state: AssuranceWindowState;
  nowIso: string;
  report: FinalAcceptanceReport;
  metrics: WindowMetrics;
  reviewSummary: ReviewSummary;
  blockerActive: boolean;
}): ExecSignoff {
  const existing = readJsonIfExists<Partial<ExecSignoff>>(EXEC_SIGNOFF_PATH);

  const reasons: string[] = [];
  if (!params.report.done) reasons.push('latest_run_not_green');
  if (params.metrics.failedRuns > 0) reasons.push('failed_runs_within_window');
  if (!params.metrics.fullWindowCovered) reasons.push('window_not_fully_covered');
  if (params.state.definitionChanged) reasons.push('definition_changed_during_window');
  if (params.state.scopeChanged) reasons.push('scope_years_changed_during_window');
  if (params.reviewSummary.daily.completed < params.reviewSummary.daily.expected) reasons.push('daily_review_incomplete');
  if (params.reviewSummary.weekly.completed < params.reviewSummary.weekly.expected) reasons.push('weekly_review_incomplete');
  if (params.reviewSummary.criticalMismatches > 0) reasons.push('critical_manual_mismatches_present');
  if (params.blockerActive) reasons.push('blocked_after_two_consecutive_failed_runs');

  const decision: 'approved' | 'blocked' = reasons.length === 0 ? 'approved' : 'blocked';

  const payload: ExecSignoff = {
    period_start: params.state.periodStart,
    period_end: params.nowIso,
    reviewer_primary: String(existing?.reviewer_primary || '').trim() || DEFAULT_REVIEWER_PRIMARY,
    reviewer_secondary: String(existing?.reviewer_secondary || '').trim() || DEFAULT_REVIEWER_SECONDARY,
    daily_samples_reviewed: params.reviewSummary.daily.samplesReviewed,
    weekly_samples_reviewed: params.reviewSummary.weekly.samplesReviewed,
    critical_mismatches: params.reviewSummary.criticalMismatches,
    decision,
    decision_reasons: reasons,
    generated_at: params.nowIso
  };

  writeJson(EXEC_SIGNOFF_PATH, payload);
  return payload;
}

function writeFinalCertification(params: {
  nowIso: string;
  state: AssuranceWindowState;
  report: FinalAcceptanceReport;
  metrics: WindowMetrics;
  reviewSummary: ReviewSummary;
  execSignoff: ExecSignoff;
  alertKinds: AssuranceAlertKind[];
}): { mdPath: string; jsonPath: string } {
  const periodStartDay = isoDate(params.state.periodStart);
  const periodEndDay = isoDate(params.nowIso);
  const baseName = `FINAL_7D_CERTIFICATION_${periodStartDay}_to_${periodEndDay}`;

  const payload = {
    generatedAt: params.nowIso,
    period_start: params.state.periodStart,
    period_end: params.nowIso,
    windowStatus: params.state.status,
    daysTarget: params.state.daysTarget,
    coverageHours: Number(params.metrics.coverageHours.toFixed(2)),
    fullWindowCovered: params.metrics.fullWindowCovered,
    technicalGreenLatestRun: params.report.done,
    latestRunId: params.report.runId,
    latestKpis: params.report.kpis,
    alertKinds: params.alertKinds,
    reviewSummary: params.reviewSummary,
    execSignoff: params.execSignoff,
    operationalClosureApproved: params.execSignoff.decision === 'approved'
  };

  const jsonPath = path.join(ASSURANCE_DIR, `${baseName}.json`);
  const mdPath = path.join(ASSURANCE_DIR, `${baseName}.md`);
  writeJson(jsonPath, payload);
  writeJson(path.join(ASSURANCE_DIR, 'FINAL_7D_CERTIFICATION_LATEST.json'), payload);

  const lines: string[] = [];
  lines.push(`# Final 7-Day Certification (${periodStartDay} -> ${periodEndDay})`);
  lines.push('');
  lines.push(`- generatedAt: ${params.nowIso}`);
  lines.push(`- latestRunId: ${params.report.runId}`);
  lines.push(`- technicalGreenLatestRun: ${params.report.done}`);
  lines.push(`- windowStatus: ${params.state.status}`);
  lines.push(`- daysTarget: ${params.state.daysTarget}`);
  lines.push(`- coverageHours: ${params.metrics.coverageHours.toFixed(2)}`);
  lines.push(`- fullWindowCovered: ${params.metrics.fullWindowCovered}`);
  lines.push(`- execDecision: ${params.execSignoff.decision}`);
  lines.push('');
  lines.push('## KPI');
  lines.push('');
  lines.push(`- driveOnly: ${params.report.kpis.totalDriveOnly}`);
  lines.push(`- sheetOnly: ${params.report.kpis.totalSheetOnly}`);
  lines.push(`- duplicateIds: ${params.report.kpis.totalDuplicateIds}`);
  lines.push(`- forbiddenMarkerHits: ${params.report.kpis.forbiddenMarkerHits}`);
  lines.push(`- qaAccuracy: ${(params.report.kpis.qaAccuracy * 100).toFixed(2)}%`);
  lines.push(`- criticalQaIssues: ${params.report.kpis.criticalQaIssues}`);
  lines.push(`- idempotencyPass: ${params.report.kpis.idempotencyPass}`);
  lines.push('');
  lines.push('## Manual QA Coverage');
  lines.push('');
  lines.push(`- daily_expected: ${params.reviewSummary.daily.expected}`);
  lines.push(`- daily_completed: ${params.reviewSummary.daily.completed}`);
  lines.push(`- weekly_expected: ${params.reviewSummary.weekly.expected}`);
  lines.push(`- weekly_completed: ${params.reviewSummary.weekly.completed}`);
  lines.push(`- critical_mismatches: ${params.reviewSummary.criticalMismatches}`);
  lines.push('');
  lines.push('## Exec Decision Reasons');
  lines.push('');
  for (const reason of params.execSignoff.decision_reasons) {
    lines.push(`- ${reason}`);
  }
  if (params.execSignoff.decision_reasons.length === 0) {
    lines.push('- none');
  }

  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(ASSURANCE_DIR, 'FINAL_7D_CERTIFICATION_LATEST.md'), `${lines.join('\n')}\n`, 'utf8');

  return { mdPath, jsonPath };
}

function saveWindowState(state: AssuranceWindowState): void {
  writeJson(WINDOW_STATE_PATH, state);
}

function hasBlockerSince(periodStartIso: string): boolean {
  if (!fs.existsSync(INCIDENT_DIR)) return false;
  const periodStartMs = Date.parse(periodStartIso);
  const files = fs
    .readdirSync(INCIDENT_DIR)
    .filter((name) => name.startsWith('BLOCKER_') && name.endsWith('.json'));

  for (const name of files) {
    const fullPath = path.join(INCIDENT_DIR, name);
    const payload = readJsonIfExists<{ generatedAt?: string }>(fullPath);
    const generatedAtMs = Date.parse(String(payload?.generatedAt || ''));
    if (Number.isFinite(periodStartMs) && Number.isFinite(generatedAtMs) && generatedAtMs >= periodStartMs) {
      return true;
    }
  }

  return false;
}

async function main(): Promise<void> {
  ensureDirStructure();

  const nowIso = new Date().toISOString();
  const runAcceptance = process.env.ASSURANCE_SKIP_ACCEPTANCE !== '1';
  if (runAcceptance) {
    await runCommand('npm', ['run', 'final-acceptance'], {
      PIPELINE_LOCK_BYPASS: '1',
      ACCEPTANCE_MAX_LOOPS: process.env.ACCEPTANCE_MAX_LOOPS || '3'
    });
  }

  const report = readJsonIfExists<FinalAcceptanceReport>(FINAL_REPORT_PATH);
  if (!report) {
    throw new Error(`Missing final acceptance report: ${FINAL_REPORT_PATH}`);
  }

  const contractKeys = [
    'done',
    'kpis',
    'scopeYears',
    'yearlyGateStatus',
    'criticalQaIssues',
    'governanceFindings',
    'hardFailReasons',
    'idempotency'
  ];
  const rawReport = JSON.parse(fs.readFileSync(FINAL_REPORT_PATH, 'utf8')) as Record<string, unknown>;
  const missingContractKeys = contractKeys.filter((key) => !(key in rawReport));
  if (missingContractKeys.length > 0) {
    throw new Error(`Final report contract violation: missing keys ${missingContractKeys.join(', ')}`);
  }

  const history = parseHistory();
  const definitionFingerprint = computeDefinitionFingerprint();
  const daysTarget = Math.max(1, Number.parseInt(process.env.ASSURANCE_STABILITY_WINDOW_DAYS || '7', 10));

  const windowState = loadOrCreateWindowState(history, report, nowIso, daysTarget, definitionFingerprint);

  const dailyKpiPath = writeDailyKpi(report);
  const samples = await writeSamplingArtifacts(nowIso);
  const day = isoDate(nowIso);
  const week = toIsoWeek(nowIso);
  const dailyReviewPath = ensureDailyReviewTemplate(day, samples.dailySamplePath, nowIso);
  const weeklyReviewPath = ensureWeeklyReviewTemplate(week, samples.weeklySamplePath, nowIso);

  let alertKinds = classifyAlerts(report);
  if (windowState.definitionChanged && !alertKinds.includes('schema')) {
    alertKinds = [...alertKinds, 'schema'];
  }
  if (windowState.scopeChanged && !alertKinds.includes('drive_drift')) {
    alertKinds = [...alertKinds, 'drive_drift'];
  }

  let incidentPath: string | null = null;
  let blockerPath: string | null = null;
  let incidentBranch: string | null = null;

  const currentEntry: AssuranceHistoryEntry = {
    timestamp: nowIso,
    reportTimestamp: report.timestamp,
    runId: report.runId,
    done: report.done,
    kpis: report.kpis,
    categories: report.after.categories,
    yearCounters: summarizeYearCounters(report.yearlyGateStatus),
    hardFailReasons: report.hardFailReasons,
    scopeYears: report.scopeYears,
    alertKinds,
    incidentPath
  };

  const historyWithCurrent = [...history, currentEntry].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const metrics = computeWindowMetrics(windowState, historyWithCurrent, nowIso);

  const isOperationalRed =
    !report.done ||
    metrics.failedRuns > 0 ||
    windowState.definitionChanged ||
    windowState.scopeChanged;

  if (metrics.failedRuns > 0 || windowState.definitionChanged || windowState.scopeChanged) {
    windowState.status = 'broken';
  }

  if (metrics.passTechnicalWindow && windowState.status === 'active') {
    windowState.status = 'completed';
    windowState.completedAt = nowIso;
  }
  windowState.updatedAt = nowIso;
  saveWindowState(windowState);

  if (isOperationalRed) {
    const incident = writeIncidentArtifacts(report, alertKinds);
    incidentPath = incident.jsonPath;
    incidentBranch = incident.incidentBranch;
  }

  if (isOperationalRed && metrics.consecutiveRedRuns >= 2 && incidentBranch) {
    const blocker = writeBlockerArtifacts(report, metrics.consecutiveRedRuns, incidentBranch);
    blockerPath = blocker.jsonPath;
  }

  const reviewSummary = summarizeReviews(windowState.periodStart, nowIso);

  const blockerActiveInWindow = blockerPath !== null || hasBlockerSince(windowState.periodStart);

  const execSignoff = writeExecSignoff({
    state: windowState,
    nowIso,
    report,
    metrics,
    reviewSummary,
    blockerActive: blockerActiveInWindow
  });

  const weeklyTrend = buildWeeklyTrend(historyWithCurrent, nowIso);
  const certification = writeFinalCertification({
    nowIso,
    state: windowState,
    report,
    metrics,
    reviewSummary,
    execSignoff,
    alertKinds
  });

  const alertPayload = {
    timestamp: nowIso,
    runId: report.runId,
    status: isOperationalRed ? 'ALERT' : 'OK',
    alertKinds,
    hardFailReasons: report.hardFailReasons,
    kpis: report.kpis,
    stabilityWindow: {
      daysTarget: metrics.daysTarget,
      periodStart: windowState.periodStart,
      periodStartRunId: windowState.periodStartRunId,
      runs: metrics.runs,
      failedRuns: metrics.failedRuns,
      consecutiveFailedRuns: metrics.consecutiveFailedRuns,
      consecutiveRedRuns: metrics.consecutiveRedRuns,
      coverageHours: Number(metrics.coverageHours.toFixed(2)),
      fullWindowCovered: metrics.fullWindowCovered,
      definitionChanged: windowState.definitionChanged,
      scopeChanged: windowState.scopeChanged,
      status: windowState.status,
      pass: windowState.status === 'completed',
      passWithoutCoverage: metrics.failedRuns === 0 && !windowState.definitionChanged && !windowState.scopeChanged
    },
    operationalClosure: {
      decision: execSignoff.decision,
      decisionReasons: execSignoff.decision_reasons,
      approved: execSignoff.decision === 'approved'
    },
    outputs: {
      finalReport: FINAL_REPORT_PATH,
      dailyKpi: dailyKpiPath,
      weeklyTrend: weeklyTrend.jsonPath,
      dailySample: samples.dailySamplePath,
      weeklySample: samples.weeklySamplePath,
      dailyReview: dailyReviewPath,
      weeklyReview: weeklyReviewPath,
      windowState: WINDOW_STATE_PATH,
      execSignoff: EXEC_SIGNOFF_PATH,
      certification: certification.mdPath,
      certificationJson: certification.jsonPath,
      incident: incidentPath,
      blocker: blockerPath
    }
  };

  writeJson(ALERT_PATH, alertPayload);
  appendHistory(currentEntry);

  console.log(JSON.stringify(alertPayload, null, 2));

  const exitOnAlert = process.env.ASSURANCE_EXIT_ON_ALERT !== '0';
  if (isOperationalRed && exitOnAlert) {
    process.exitCode = 2;
  }
}

withPipelineLock('post_closure_assurance', main).catch((error) => {
  console.error('post_closure_assurance failed:', error);
  process.exit(1);
});
