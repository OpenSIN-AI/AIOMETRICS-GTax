# Context Fulltext

- source_path: src/orchestrator/contract_sync_guard.ts
- source_sha256: a97ab7615825395a7d4eaad5c2d0bcc98b3863f49949d1585a9322c52a79f6f2
- chunk: 1/3

```text
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { google, drive_v3, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { fileURLToPath } from 'url';

export type GateId = 'A' | 'B' | 'C';

export interface ContractMismatch {
  gate: GateId;
  code: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  message: string;
  detail?: string;
}

export interface FormulaDrift {
  tab: string;
  cell: string;
  expectedFormula: string;
  actualFormula: string;
  pass: boolean;
}

export interface ValueDrift {
  label: string;
  leftRef: string;
  rightRef: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface DashboardGateResult {
  pass: boolean;
  formulaDriftCount: number;
  valueDriftCount: number;
  formulaChecks: FormulaDrift[];
  valueChecks: ValueDrift[];
}

export interface SyncContractResult {
  version: string;
  timestamp: string;
  scopeYears: string[];
  gates: {
    gateA: {
      pass: boolean;
      driveCount: number;
      sheetCount: number;
      driveOnly: number;
      sheetOnly: number;
      duplicateDriveIds: number;
    };
    gateB: {
      pass: boolean;
      missingYears: string[];
      perYear: Array<{ year: string; driveOnly: number; sheetOnly: number; duplicateDriveIds: number; pass: boolean }>;
      totalDriveOnly: number;
      totalSheetOnly: number;
      totalDuplicateDriveIds: number;
    };
    gateC: DashboardGateResult;
  };
  violations: ContractMismatch[];
  autofixActions: Array<{ action: string; status: 'planned' | 'executed' | 'skipped'; reason: string }>;
  status: 'green' | 'red';
}

interface CheckIntegrityJson {
  summaries?: Array<{
    year: string;
    income?: {
      driveOnly?: number;
      sheetOnly?: number;
      duplicateDriveIdsInSheet?: number;
    };
    expense?: {
      driveOnly?: number;
      sheetOnly?: number;
      duplicateDriveIdsInSheet?: number;
    };
  }>;
}

interface ApiErrorLike {
  code?: string | number;
  message?: string;
  response?: {
    status?: number;
    data?: {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string }>;
      };
    };
  };
  errors?: Array<{ reason?: string }>;
}

const ACCOUNTING_ROOT_FOLDER_ID = process.env.ACCOUNTING_ROOT_FOLDER_ID || '1azt2ULJv8_iJGWdNbQfWv0Jd1AY7XR1p';
const SOURCE_DRIVE_FOLDER_ID = process.env.SOURCE_DRIVE_FOLDER_ID || '1rY8Zs1-eoCCtzruQDvicMihjH0AMR-gH';
const TARGET_DRIVE_FOLDER_ID = process.env.TARGET_DRIVE_FOLDER_ID || '11OoJH5PObXP-ANnlEqsPmGBfiC7zPz7m';
const GATE_A_FULL_ROOT = ['1', 'true', 'yes', 'on'].includes(String(process.env.CONTRACT_GATE_A_FULL_ROOT || '0').toLowerCase());
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID as string;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.CONTRACT_GUARD_REQUEST_TIMEOUT_MS || '30000', 10);
const MAX_RETRIES = Number.parseInt(process.env.CONTRACT_GUARD_MAX_RETRIES || '5', 10);
const RETRY_BASE_MS = Number.parseInt(process.env.CONTRACT_GUARD_RETRY_BASE_MS || '2000', 10);
const REPORT_JSON_PATH = path.join(process.cwd(), 'docs', 'CONTRACT_SYNC_GUARD.json');
const REPORT_MD_PATH = path.join(process.cwd(), 'docs', 'CONTRACT_SYNC_GUARD.md');
const INTEGRITY_JSON_PATH = path.join(process.cwd(), 'docs', 'CHECK_DRIVE_SHEETS_SYNC.json');
const RUN_INTEGRITY_CHECK = !['0', 'false', 'no', 'off'].includes(String(process.env.CONTRACT_SKIP_INTEGRITY_CHECK || '0').toLowerCase());
const ADDITIONAL_CONTRACT_ROOT_FOLDERS = new Set(['Sonstige_Belege', 'Neue Belege', 'Neue Belege ']);

const auth = new JWT({
  keyFile: [REDACTED]
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

type FormulaSpec = { tab: string; cell: string; formula: string };

const EUR_FORMULAS: FormulaSpec[] = [
  { tab: 'EÜR', cell: 'B2', formula: `=IFERROR('Finanz-Cockpit'!B2;YEAR(TODAY()))` },
  { tab: 'EÜR', cell: 'B5', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!M2:M>0));0)` },
  { tab: 'EÜR', cell: 'B6', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!N2:N>0));0)` },
  { tab: 'EÜR', cell: 'B7', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; Buchhaltung_DB!O2:O>0));0)` },
  { tab: 'EÜR', cell: 'B8', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(B5:B7);0)` },
  { tab: 'EÜR', cell: 'B9', formula: `=SUM(B5:B8)` },
  { tab: 'EÜR', cell: 'B12', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;"(?i)material|pv")));0)` },
  { tab: 'EÜR', cell: 'B13', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;"(?i)kraftstoff|benzin|diesel")));0)` },
  { tab: 'EÜR', cell: 'B14', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;"(?i)telekommunikation|it|hosting|domain")));0)` },
  { tab: 'EÜR', cell: 'B15', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2; REGEXMATCH(Buchhaltung_DB!L2:L;"(?i)versicherung")));0)` },
  { tab: 'EÜR', cell: 'B16', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(B12:B15);0)` },
  { tab: 'EÜR', cell: 'B17', formula: `=SUM(B12:B16)` },
  { tab: 'EÜR', cell: 'B18', formula: `=B9-B17` },
  { tab: 'EÜR', cell: 'B19', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))+SUM(FILTER(Buchhaltung_DB!N2:N; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2))-SUM(FILTER(Buchhaltung_DB!N2:N; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=$B$2));0)` }
];

const COCKPIT_FORMULAS: FormulaSpec[] = [
  { tab: 'Finanz-Cockpit', cell: 'B2', formula: `=YEAR(TODAY())` },
  { tab: 'Finanz-Cockpit', cell: 'B5', formula: `=IFERROR(EÜR!B9;0)` },
  { tab: 'Finanz-Cockpit', cell: 'E5', formula: `=IFERROR(EÜR!B17;0)` },
  { tab: 'Finanz-Cockpit', cell: 'H5', formula: `=IFERROR(EÜR!B18;0)` },
  { tab: 'Finanz-Cockpit', cell: 'K5', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E="Einnahme"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=B2));0)` },
  { tab: 'Finanz-Cockpit', cell: 'N5', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!M2:M; Buchhaltung_DB!E2:E="Ausgabe"; IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));0)=B2));0)` },
  { tab: 'Finanz-Cockpit', cell: 'Q5', formula: `=K5-N5` }
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseScopeYears(): string[] {
  const raw = (process.env.CONTRACT_SCOPE_YEARS || process.env.CHECK_YEARS || '2022,2023,2024,2025,2026')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^20\d{2}$/.test(part));
  return Array.from(new Set(raw)).sort();
}

function normalizeFormula(formula: string): string {
  return String(formula || '')
    .replace(/\s+/g, '')
    .replace(/'([^']+)'!/g, '$1!')
    .trim();
}

export function normalizeComparableValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return value.toFixed(2);
  }
  const raw = String(value).trim();
  if (!raw) return '';
  const sanitized = raw.replace(/[^\d,.-]/g, '');
  if (sanitized) {
    const normalized = sanitized.includes(',') && sanitized.includes('.')
      ? sanitized.replace(/\./g, '').replace(',', '.')
      : sanitized.replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) {
      return parsed.toFixed(2);
    }
  }
  return raw;
}

function extractError(error: unknown): { status: number; code: string; reason: string; message: string } {
  const err = (error || {}) as ApiErrorLike;
  const status = Number(err.response?.status || err.code || 0);
  const code = String(err.code || '');
  const reason =
    String(err.errors?.[0]?.reason || '') ||
    String(err.response?.data?.error?.errors?.[0]?.reason || '');
  const message = String(err.response?.data?.error?.message || err.message || '');
  return { status, code, reason, message };
}

function isRetryable(error: unknown): boolean {
  const { status, code, reason, message } = extractError(error);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE'].includes(code)) return true;
  if (['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError', 'internalError'].includes(reason)) return true;
  const msg = message.toLowerCase();
  return msg.includes('timeout') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('backend error');
}

async function withRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const maxAttempts = Math.max(1, MAX_RETRIES);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = isRetryable(error);
      const isLast = attempt >= maxAttempts;
      if (!retryable || isLast) throw error;
      const jitter = Math.floor(Math.random() * 300);
      const waitMs = Math.min(20000, RETRY_BASE_MS * attempt + jitter);
      const meta = extractError(error);
      console.warn(`[contract_sync_guard] ${operation} retry ${attempt}/${maxAttempts} in ${waitMs}ms: ${meta.message || meta.reason || meta.code || meta.status}`);
      await sleep(waitMs);
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}

async function listChildren(folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: [REDACTED] | undefined;
  do {
    const response = await withRetry(
      `drive.files.list.${folderId}`,
      () => drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: [REDACTED]
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
    out.push(...(response.data.files || []));
    pageToken = [REDACTED] || undefined;
  } while (pageToken);
  return out;
}

async function listDriveIdsRecursive(rootFolderId: string): Promise<Set<string>> {
  const queue = [rootFolderId];
  const visited = new Set<string>();
  const ids = new Set<string>();
  while (queue.length > 0) {
    const folderId = queue.shift();
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);
    const children = await listChildren(folderId);
    for (const child of children) {
      const id = child.id || '';
      if (!id) continue;
      if (child.mimeType === 'application/vnd.google-apps.folder') {
        queue.push(id);
      } else {
        ids.add(id);
      }
    }
  }
  return ids;
}

function normalizeSheetName(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).repl
```
