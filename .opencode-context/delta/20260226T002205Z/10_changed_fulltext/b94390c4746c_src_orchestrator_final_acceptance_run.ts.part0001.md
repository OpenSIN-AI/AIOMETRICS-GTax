# Delta Fulltext

- source_path: src/orchestrator/final_acceptance_run.ts
- source_sha256: f0cfb52f2d0978f314e10b545c4c2f23fd4cc15c1768b9df8b29a7dfdb6ca58f
- chunk: 1/5

```text
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import {
  AuditMutationRecord,
  AuditSchemaMigrationResult,
  BelegRecord,
  GoogleSheetsService,
  SheetGovernanceResult,
  YearlyTabRow
} from '../db/googleSheetsService.js';
import { withPipelineLock } from './pipeline_lock.js';

dotenv.config();

type Snapshot = {
  records: number;
  categories: Record<string, number>;
  tabs: string[];
  forbiddenMarkerHits: number;
};

type StageResult = {
  stage: string;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: string;
};

type QaIssue = {
  drive_file_id: string;
  original_name: string;
  year: string;
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  failures: string[];
};

type QaResult = {
  total: number;
  criticalPassed: number;
  accuracy: number;
  criticalQaIssues: number;
  issues: QaIssue[];
};

type YearlyGateStatus = {
  year: string;
  driveOnly: number;
  sheetOnly: number;
  duplicateDriveIds: number;
  pass: boolean;
};

type CanonicalDriveFile = {
  drive_file_id: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  file_url: string;
  folder_path: string;
  target_folder_id: string;
  year: string;
  cashflow: 'Einnahmen' | 'Ausgaben';
  category: string;
};

type MismatchResolutionStats = {
  belegeBefore: number;
  belegeAfter: number;
  yearlyTabsTouched: number;
  staleYearTabsDeleted: string[];
  actionsTotal: number;
  actionsByType: Record<string, number>;
  actionsByYear: Record<string, number>;
};

type MismatchActionType =
  | 'DELETE_DUPLICATE'
  | 'DELETE_ORPHAN'
  | 'DELETE_YEARLY_ORPHAN'
  | 'INSERT_MISSING'
  | 'INSERT_YEARLY_MISSING'
  | 'UPDATE_YEAR'
  | 'UPDATE_CATEGORY';

type MismatchAction = {
  type: MismatchActionType;
  reason: 'MISSING_IN_SHEET' | 'ORPHAN_IN_SHEET' | 'DUPLICATE_DRIVE_ID' | 'YEAR_MISMATCH' | 'CATEGORY_MISMATCH';
  target: 'belege' | 'yearly_tabs';
  driveFileId: string;
  scopeYear: string;
  sortKey: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

type LoopStatus = {
  iteration: number;
  mismatchTotal: number;
  doneCandidate: boolean;
};

type ContractSyncReport = {
  gates: {
    gateA: { pass: boolean };
    gateB: { pass: boolean };
    gateC: { pass: boolean; formulaDriftCount: number; valueDriftCount: number };
  };
  status: 'green' | 'red';
};

const DUPLICATE_FOLDER_ID = '1n750UVJdcNSV-1Uo0vjKv2gAtS8jegfz';
const MISSING_FOLDER_ID = '1mvZzo7eCeyThITWSuZf0UHsB4KYt7MNy';
const DEFAULT_ACCOUNTING_ROOT = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const DEFAULT_SOURCE_FOLDER = process.env.SOURCE_DRIVE_FOLDER_ID || '1rY8Zs1-eoCCtzruQDvicMihjH0AMR-gH';
const DEFAULT_TARGET_FOLDER = process.env.TARGET_DRIVE_FOLDER_ID || '11OoJH5PObXP-ANnlEqsPmGBfiC7zPz7m';
const DEFAULT_YEARLY_HEADERS = [
  'Datum',
  'Lieferant',
  'Rechnungsnr',
  'Typ',
  'Betrag_Netto',
  'MwSt_Satz',
  'MwSt_Betrag',
  'Betrag_Brutto',
  'Kategorie',
  'Status',
  'Bemerkung',
  'Dateiname',
  'reason',
  'drive_file_id',
  'file_url'
];

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

async function runWithRateLimitRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.response?.status || error?.code;
      const reason =
        error?.errors?.[0]?.reason ||
        error?.response?.data?.error?.errors?.[0]?.reason ||
        '';
      const message = String(
        error?.response?.data?.error?.message ||
        error?.message ||
        ''
      );
      const rateLimited =
        status === 429 ||
        reason === 'rateLimitExceeded' ||
        reason === 'userRateLimitExceeded' ||
        reason === 'quotaExceeded' ||
        message.includes('Quota exceeded');
      if (!rateLimited || attempt === maxAttempts) throw error;
      const waitMs = attempt * 5000;
      console.warn(`${operation}: rate limited, retry ${attempt}/${maxAttempts} in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}

async function runCommand(command: string, args: string[], extraEnv: Record<string, string> = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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

function resolveOrchestratorScriptPath(scriptName: string): string[] {
  const distMicroPath = path.join(process.cwd(), 'dist-micro', 'orchestrator', `${scriptName}.js`);
  if (fs.existsSync(distMicroPath)) {
    return [distMicroPath];
  }
  return ['--import', 'tsx', `src/orchestrator/${scriptName}.ts`];
}

async function runOrchestratorScript(scriptName: string, extraEnv: Record<string, string> = {}): Promise<void> {
  await runCommand(process.execPath, resolveOrchestratorScriptPath(scriptName), {
    ...extraEnv,
    PIPELINE_LOCK_BYPASS: '1'
  });
}

function readContractSyncReport(): ContractSyncReport | null {
  const reportPath = path.join(process.cwd(), 'docs', 'CONTRACT_SYNC_GUARD.json');
  if (!fs.existsSync(reportPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ContractSyncReport;
  } catch {
    return null;
  }
}

function isValidYear(year: string): boolean {
  if (!/^\d{4}$/.test(year)) return false;
  const numeric = Number.parseInt(year, 10);
  const minYear = 2000;
  const maxYear = new Date().getFullYear() + 1;
  return numeric >= minYear && numeric <= maxYear;
}

function extractYear(value: string): string {
  const iso = /^(20\d{2})/.exec(value);
  if (iso && isValidYear(iso[1])) return iso[1];
  const generic = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(value);
  if (generic && isValidYear(generic[1])) return generic[1];
  return '';
}

function parseAmount(value: string): number {
  const cleaned = String(value || '').replace(/[^\d,.-]/g, '');
  const normalized = cleaned.includes(',') && cleaned.includes('.')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferCashflow(folderPath: string, fileName: string): 'Einnahmen' | 'Ausgaben' {
  const probe = `${folderPath} ${fileName}`.toLowerCase();
  if (probe.includes('einnahmen') || probe.includes('einnahme') || probe.includes('gutschrift') || probe.includes('income')) {
    return 'Einnahmen';
  }
  return 'Ausgaben';
}

function inferCategory(folderPath: string, fileName: string): string {
  const probe = `${folderPath} ${fileName}`.toLowerCase();
  if (probe.includes('vertrag') || probe.includes('contract')) return 'Vertraege';
  if (probe.includes('rechnung') || probe.includes('invoice')) return 'Rechnungen';
  return 'Sonstiges';
}

async function listChildren(driveApi: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: [REDACTED] | undefined = undefined;
  do {
    const response = await runWithRateLimitRetry(
      () => driveApi.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: [REDACTED]
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }),
      `listChildren.${folderId}`
    );
    out.push(...(response.data.files || []));
    pageToken = [REDACTED] || undefined;
  } while (pageToken);
  return out;
}

async function getSheetMap(sheetsApi: any, spreadsheetId: string): Promise<Map<string, number>> {
  const metadata: any = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    }),
    'getSheetMap.meta'
  );
  const map = new Map<string, number>();
  for (const sheet of metadata.data.sheets || []) {
    const title = sheet.properties?.title;
    const id = sheet.properties?.sheetId;
    if (title && typeof id === 'number') map.set(title, id);
  }
  return map;
}

async function ensureSheetExists(sheetsApi: any, spreadsheetId: string, title: string, sheetMap: Map<string, number>): Promise<number> {
  const existing = sheetMap.get(title);
  if (typeof existing === 'number') return existing;
  const created: any = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }]
      }
    }),
    `ensureSheetExists.create.${title}`
  );
  const createdId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof createdId !== 'number') throw new Error(`Failed to create sheet: ${title}`);
  sheetMap.set(title, createdId);
  return createdId;
}

function parseEnvYears(raw: string | undefined): string[] {
  const parsed = (raw || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => isValidYear(x));
  return Array.from(new Set(parsed)).sort();
}

function parseYearsFromYearlyTabs(tabs: string[]): string[] {
  const years = tabs
    .map((tab) => {
      const m = /^(Einnahmen|Ausgaben)_(\d{4})$/.exec(tab);
      return m ? m[2] : '';
    })
    .filter((year) => isValidYear(year));
  return Array.from(new Set(years)).sort();
}

function resolveScopeYears(input: {
  envYears: string[];
  physicalYears: string[];
  yearlyTabYears: string[];
  canonicalDriveYears: string[];
}): string[] {
  const set = new Set<string>();
  for (const value of [...input.envYears, ...input.physicalYears, ...input.yearlyTabYears, ...input.canonicalDriveYears]) {
    if (isValidYear(value)) set.add(value);
  }
  return Array.from(set).sort();
}

async function collectSnapshot(sheetsApi: any, spreadsheetId: string): Promise<Snapshot> {
  const belege: any = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: 'belege'
    }),
    'collectSnapshot.belege'
  );
  const rows = belege.data.values || [];
  const header = rows[0] || [];
  const data = rows.slice(1);
  const categoryIdx = header.findIndex((h: string) => String(h).toLowerCase() === 'category');
  const categories: Record<string, number> = {};
  for (const row of data) {
    const key = (row[categoryIdx] && String(row[categoryIdx]).trim()) || '(leer)';
    categories[key] = (categories[key] || 0) + 1;
  }

  const meta: any = await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title'
    }),
    'collectSnapshot.meta'
  );
  const tabs = (meta.data.sheets || [])
    .map((s: any) => s.properties?.title)
    .filter((t: string | undefined): t is string => Boolean(t))
    .sort();

  let forbiddenMarkerHits = 0;
  const ranges = tabs.map((title: string) => `'${title.replace(/'/g, "''")}'`);
  const chunkSize = 20;
  for (let i = 0; i < ranges.length; i += chunkSize) {
    const chunk = ranges.slice(i, i + chunkSize);
    const valuesRes: any = await runWithRateLimitRetry(
      () => sheetsApi.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: chunk
      }),
      `collectSnapshot.batchGet.${i}`
    );
    for (const range of valuesRes.data.valueRanges ||
```
