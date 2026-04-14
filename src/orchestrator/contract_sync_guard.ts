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
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ]
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

type FormulaSpec = { tab: string; cell: string; formula: string };
const YEAR_EXPR = 'IFERROR(YEAR(DATEVALUE(Buchhaltung_DB!J2:J));IFERROR(YEAR(Buchhaltung_DB!J2:J);IFERROR(VALUE(REGEXEXTRACT(Buchhaltung_DB!D2:D;"(20\\\\d{2})"));IFERROR(VALUE(REGEXEXTRACT(Buchhaltung_DB!C2:C;"(20\\\\d{2})"));0))))';
const FLOW_UNCLEAR_EXPR = 'N(Buchhaltung_DB!E2:E<>"Einnahme")*N(Buchhaltung_DB!E2:E<>"Ausgabe")';
const FLOW_NON_TRANSACTION_EXPR = 'N(REGEXMATCH(LOWER(Buchhaltung_DB!D2:D&" "&Buchhaltung_DB!C2:C&" "&Buchhaltung_DB!L2:L);"einnahmen.{0,12}berschussrechnung|umsatzsteuer.{0,18}voranmeldung|steuerbescheid|jahresabschluss|gewinn.{0,8}verlust|kontenblatt|\\\\bbwa\\\\b|\\\\belster\\\\b"))';
const FLOW_INCOME_HINT_EXPR = 'N(REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"einnahmen|photovoltaik|\\\\bpv\\\\b"))+N(REGEXMATCH(LOWER(Buchhaltung_DB!D2:D&" "&Buchhaltung_DB!C2:C);"\\\\beinnahme\\\\b|\\\\bgutschrift\\\\b|\\\\bumsatz\\\\b"))';
const FLOW_EXPENSE_HINT_EXPR = 'N(REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"ausgaben|material|waren|kraftstoff|benzin|bewirt|telekommunikation|it|hosting|strom|energie|miete|versicherung|sonstige"))+N(REGEXMATCH(LOWER(Buchhaltung_DB!D2:D&" "&Buchhaltung_DB!C2:C);"\\\\bausgabe\\\\b|\\\\brechnung\\\\b|\\\\binvoice\\\\b|\\\\bquittung\\\\b|\\\\bbestellung\\\\b"))';
const FLOW_INCOME_EXPR = '(N(Buchhaltung_DB!E2:E="Einnahme")+N(' + FLOW_UNCLEAR_EXPR + '>0)*N(' + FLOW_NON_TRANSACTION_EXPR + '=0)*N(' + FLOW_INCOME_HINT_EXPR + '>0)*N(' + FLOW_EXPENSE_HINT_EXPR + '=0))>0';
const FLOW_EXPENSE_EXPR = '(N(Buchhaltung_DB!E2:E="Ausgabe")+N(' + FLOW_UNCLEAR_EXPR + '>0)*N(' + FLOW_NON_TRANSACTION_EXPR + '=0)*N(' + FLOW_EXPENSE_HINT_EXPR + '>0)*N(' + FLOW_INCOME_HINT_EXPR + '=0))>0';
const YEAR_MATCH_EXPR = '((N($B$2)=0)+N(' + YEAR_EXPR + '=$B$2))>0';

const EUR_FORMULAS: FormulaSpec[] = [
  { tab: 'EÜR', cell: 'B2', formula: `=IFERROR('Finanz-Cockpit'!B2;YEAR(TODAY()))` },
  { tab: 'EÜR', cell: 'B5', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_INCOME_EXPR}; ${YEAR_MATCH_EXPR}; Buchhaltung_DB!M2:M>0));0)` },
  { tab: 'EÜR', cell: 'B6', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_INCOME_EXPR}; ${YEAR_MATCH_EXPR}; Buchhaltung_DB!N2:N>0));0)` },
  { tab: 'EÜR', cell: 'B7', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_INCOME_EXPR}; ${YEAR_MATCH_EXPR}; Buchhaltung_DB!O2:O>0));0)` },
  { tab: 'EÜR', cell: 'B8', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_INCOME_EXPR}; ${YEAR_MATCH_EXPR}))-SUM(B5:B7);0)` },
  { tab: 'EÜR', cell: 'B9', formula: `=SUM(B5:B8)` },
  { tab: 'EÜR', cell: 'B12', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_EXPENSE_EXPR}; ${YEAR_MATCH_EXPR}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"material|waren|pv|photovoltaik")));0)` },
  { tab: 'EÜR', cell: 'B13', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_EXPENSE_EXPR}; ${YEAR_MATCH_EXPR}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"kraftstoff|benzin|diesel|tank")));0)` },
  { tab: 'EÜR', cell: 'B14', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_EXPENSE_EXPR}; ${YEAR_MATCH_EXPR}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"bewirt|restaurant|cafe|imbiss|wolt|lieferando")));0)` },
  { tab: 'EÜR', cell: 'B15', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_EXPENSE_EXPR}; ${YEAR_MATCH_EXPR}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"telekommunikation|it|hosting|domain|software|cloud")));0)` },
  { tab: 'EÜR', cell: 'B16', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_EXPENSE_EXPR}; ${YEAR_MATCH_EXPR}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"strom|energie")));0)` },
  { tab: 'EÜR', cell: 'B17', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_EXPENSE_EXPR}; ${YEAR_MATCH_EXPR}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"miete|pacht")));0)` },
  { tab: 'EÜR', cell: 'B18', formula: `=IFERROR(SUM(FILTER(Buchhaltung_DB!Q2:Q; ${FLOW_EXPENSE_EXPR}; ${YEAR_MATCH_EXPR}; REGEXMATCH(LOWER(Buchhaltung_DB!L2:L);"versicherung")));0)` },
  { tab: 'EÜR', cell: 'B19', formula: `=MAX(0;B20-SUM(B12:B18))` },
  { tab: 'EÜR', cell: 'B20', formula: `=SUMPRODUCT(N(${FLOW_EXPENSE_EXPR})*N(${YEAR_MATCH_EXPR})*N(Buchhaltung_DB!Q2:Q))` },
  { tab: 'EÜR', cell: 'B22', formula: `=B9-B20` },
  { tab: 'EÜR', cell: 'B23', formula: `=SUMPRODUCT(N(${FLOW_EXPENSE_EXPR})*N(${YEAR_MATCH_EXPR})*N(Buchhaltung_DB!U2:U))` },
  { tab: 'EÜR', cell: 'B24', formula: `=B22+B23` }
];

const COCKPIT_FORMULAS: FormulaSpec[] = [
  { tab: 'Finanz-Cockpit', cell: 'B5', formula: `=IFERROR(EÜR!B9;0)` },
  { tab: 'Finanz-Cockpit', cell: 'D5', formula: `=IFERROR(EÜR!B20;0)` },
  { tab: 'Finanz-Cockpit', cell: 'F5', formula: `=B5-D5` },
  { tab: 'Finanz-Cockpit', cell: 'H5', formula: `=IFERROR(Steuerreport!B10;0)` },
  { tab: 'Finanz-Cockpit', cell: 'J5', formula: `=IFERROR(Steuerreport!B11;0)` },
  { tab: 'Finanz-Cockpit', cell: 'L5', formula: `=H5-J5` }
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
  let pageToken: string | undefined;
  do {
    const response = await withRetry(
      `drive.files.list.${folderId}`,
      () => drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }, {
        timeout: REQUEST_TIMEOUT_MS
      })
    );
    out.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken || undefined;
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
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function isYearFolderName(name: string): boolean {
  return /^20\d{2}$/.test(String(name || '').trim());
}

async function buildGateARootFolders(): Promise<string[]> {
  const roots = new Set<string>([SOURCE_DRIVE_FOLDER_ID, TARGET_DRIVE_FOLDER_ID]);
  const topLevel = await listChildren(ACCOUNTING_ROOT_FOLDER_ID);
  for (const folder of topLevel) {
    const id = String(folder.id || '').trim();
    if (!id) continue;
    if (folder.mimeType !== 'application/vnd.google-apps.folder') continue;
    const name = String(folder.name || '').trim();
    if (isYearFolderName(name) || ADDITIONAL_CONTRACT_ROOT_FOLDERS.has(name)) {
      roots.add(id);
    }
  }
  return Array.from(roots);
}

async function listDriveIdsFromRoots(rootFolderIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  const queue = [...rootFolderIds];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const folderId = queue.shift();
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);
    const children = await listChildren(folderId);
    for (const child of children) {
      const id = String(child.id || '').trim();
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

async function readBelegeDriveIds(): Promise<{ ids: Set<string>; duplicateDriveIds: number }> {
  const response = await withRetry(
    'sheets.values.get.belege',
    () => sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'belege!A1:AZ'
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  const values = response.data.values || [];
  if (values.length <= 1) {
    return { ids: new Set<string>(), duplicateDriveIds: 0 };
  }
  const header = values[0];
  const idx = header.indexOf('drive_file_id');
  if (idx < 0) {
    throw new Error('belege header missing drive_file_id');
  }
  const ids = new Set<string>();
  const counter = new Map<string, number>();
  for (const row of values.slice(1)) {
    const id = String(row[idx] || '').trim();
    if (!id) continue;
    ids.add(id);
    counter.set(id, (counter.get(id) || 0) + 1);
  }
  const duplicateDriveIds = Array.from(counter.values()).filter((count) => count > 1).length;
  return { ids, duplicateDriveIds };
}

async function runIntegrityCheck(scopeYears: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('node', ['--import', 'tsx', 'src/orchestrator/check_2023_integrity.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CHECK_YEARS: scopeYears.join(',')
      },
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`check_2023_integrity failed: code=${code ?? 'null'} signal=${signal ?? 'null'}`));
    });
  });
}

function readIntegritySummary(): CheckIntegrityJson {
  if (!fs.existsSync(INTEGRITY_JSON_PATH)) {
    throw new Error(`Missing integrity summary: ${INTEGRITY_JSON_PATH}`);
  }
  return JSON.parse(fs.readFileSync(INTEGRITY_JSON_PATH, 'utf8')) as CheckIntegrityJson;
}

async function readRangeMap(ranges: string[], valueRenderOption: sheets_v4.Params$Resource$Spreadsheets$Values$Batchget['valueRenderOption']): Promise<Map<string, unknown>> {
  const response = await withRetry(
    `sheets.values.batchGet.${valueRenderOption || 'DEFAULT'}`,
    () => sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
      valueRenderOption
    }, {
      timeout: REQUEST_TIMEOUT_MS
    })
  );
  const map = new Map<string, unknown>();
  for (const entry of response.data.valueRanges || []) {
    const rangeA1 = String(entry.range || '');
    const splitAt = rangeA1.indexOf('!');
    if (splitAt < 0) continue;
    const tab = normalizeSheetName(rangeA1.slice(0, splitAt));
    const range = rangeA1.slice(splitAt + 1).split(':')[0].replace(/\$/g, '').trim();
    const key = `${tab}!${range}`;
    map.set(key, entry.values?.[0]?.[0] ?? '');
  }
  return map;
}

function toNum(value: unknown): number {
  if (typeof value === 'number') return value;
  const normalized = normalizeComparableValue(value);
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function evaluateDashboardGate(): Promise<DashboardGateResult> {
  const specs = [...EUR_FORMULAS, ...COCKPIT_FORMULAS];
  const ranges = [
    ...specs.map((spec) => `${spec.tab}!${spec.cell}`),
    'Finanz-Cockpit!B2',
    'Steuerreport!B10',
    'Steuerreport!B11',
    'Steuerreport!B12'
  ];
  const formulaMap = await readRangeMap(ranges, 'FORMULA');
  const valueMap = await readRangeMap(ranges, 'UNFORMATTED_VALUE');

  const formulaChecks: FormulaDrift[] = specs.map((spec) => {
    const key = `${spec.tab}!${spec.cell}`;
    const actualFormula = String(formulaMap.get(key) || '');
    const pass = normalizeFormula(actualFormula) === normalizeFormula(spec.formula);
    return {
      tab: spec.tab,
      cell: spec.cell,
      expectedFormula: spec.formula,
      actualFormula,
      pass
    };
  });

  const valueChecks: ValueDrift[] = [];
  const addPairCheck = (label: string, leftRef: string, rightRef: string): void => {
    const left = normalizeComparableValue(valueMap.get(leftRef));
    const right = normalizeComparableValue(valueMap.get(rightRef));
    valueChecks.push({
      label,
      leftRef,
      rightRef,
      expected: right,
      actual: left,
      pass: left === right
    });
  };

  addPairCheck('YearLink', 'Finanz-Cockpit!B2', 'EÜR!B2');
  addPairCheck('IncomeKPI', 'Finanz-Cockpit!B5', 'EÜR!B9');
  addPairCheck('ExpenseKPI', 'Finanz-Cockpit!D5', 'EÜR!B20');
  addPairCheck('ResultKPI', 'Finanz-Cockpit!F5', 'EÜR!B22');
  addPairCheck('OutputTaxKPI', 'Finanz-Cockpit!H5', 'Steuerreport!B10');
  addPairCheck('InputTaxKPI', 'Finanz-Cockpit!J5', 'Steuerreport!B11');
  addPairCheck('TaxSaldoKPI', 'Finanz-Cockpit!L5', 'Steuerreport!B12');

  const l5 = toNum(valueMap.get('Finanz-Cockpit!L5'));
  const h5 = toNum(valueMap.get('Finanz-Cockpit!H5'));
  const j5 = toNum(valueMap.get('Finanz-Cockpit!J5'));
  valueChecks.push({
    label: 'CockpitTaxSaldoArithmetic',
    leftRef: 'Finanz-Cockpit!L5',
    rightRef: 'Finanz-Cockpit!H5-J5',
    expected: (h5 - j5).toFixed(2),
    actual: l5.toFixed(2),
    pass: l5.toFixed(2) === (h5 - j5).toFixed(2)
  });

  const formulaDriftCount = formulaChecks.filter((check) => !check.pass).length;
  const valueDriftCount = valueChecks.filter((check) => !check.pass).length;
  return {
    pass: formulaDriftCount === 0 && valueDriftCount === 0,
    formulaDriftCount,
    valueDriftCount,
    formulaChecks,
    valueChecks
  };
}

function writeReports(report: SyncContractResult): void {
  fs.mkdirSync(path.dirname(REPORT_JSON_PATH), { recursive: true });
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2), 'utf8');

  const lines: string[] = [];
  lines.push('# Contract Sync Guard');
  lines.push('');
  lines.push(`- Timestamp: ${report.timestamp}`);
  lines.push(`- Scope years: ${report.scopeYears.join(', ')}`);
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Gate A pass: ${report.gates.gateA.pass}`);
  lines.push(`- Gate B pass: ${report.gates.gateB.pass}`);
  lines.push(`- Gate C pass: ${report.gates.gateC.pass}`);
  lines.push('');
  lines.push('## Gate A');
  lines.push('');
  lines.push(`- driveCount: ${report.gates.gateA.driveCount}`);
  lines.push(`- sheetCount: ${report.gates.gateA.sheetCount}`);
  lines.push(`- driveOnly: ${report.gates.gateA.driveOnly}`);
  lines.push(`- sheetOnly: ${report.gates.gateA.sheetOnly}`);
  lines.push(`- duplicateDriveIds: ${report.gates.gateA.duplicateDriveIds}`);
  lines.push('');
  lines.push('## Gate B');
  lines.push('');
  lines.push(`- totalDriveOnly: ${report.gates.gateB.totalDriveOnly}`);
  lines.push(`- totalSheetOnly: ${report.gates.gateB.totalSheetOnly}`);
  lines.push(`- totalDuplicateDriveIds: ${report.gates.gateB.totalDuplicateDriveIds}`);
  lines.push(`- missingYears: ${report.gates.gateB.missingYears.join(', ') || '-'}`);
  lines.push('');
  lines.push('| year | pass | driveOnly | sheetOnly | duplicateDriveIds |');
  lines.push('|---|---|---:|---:|---:|');
  for (const row of report.gates.gateB.perYear) {
    lines.push(`| ${row.year} | ${row.pass} | ${row.driveOnly} | ${row.sheetOnly} | ${row.duplicateDriveIds} |`);
  }
  lines.push('');
  lines.push('## Gate C');
  lines.push('');
  lines.push(`- formulaDriftCount: ${report.gates.gateC.formulaDriftCount}`);
  lines.push(`- valueDriftCount: ${report.gates.gateC.valueDriftCount}`);
  lines.push('');
  lines.push('| kind | label | pass | expected | actual |');
  lines.push('|---|---|---|---|---|');
  for (const formula of report.gates.gateC.formulaChecks.filter((row) => !row.pass)) {
    lines.push(`| formula | ${formula.tab}!${formula.cell} | ${formula.pass} | ${formula.expectedFormula.replace(/\|/g, '/')} | ${formula.actualFormula.replace(/\|/g, '/')} |`);
  }
  for (const value of report.gates.gateC.valueChecks.filter((row) => !row.pass)) {
    lines.push(`| value | ${value.label} | ${value.pass} | ${value.expected} | ${value.actual} |`);
  }
  if (report.violations.length > 0) {
    lines.push('');
    lines.push('## Violations');
    lines.push('');
    for (const violation of report.violations) {
      lines.push(`- [${violation.gate}] ${violation.code}: ${violation.message}`);
      if (violation.detail) {
        lines.push(`  detail: ${violation.detail}`);
      }
    }
  }

  fs.writeFileSync(REPORT_MD_PATH, `${lines.join('\n')}\n`, 'utf8');
}

async function main(): Promise<void> {
  if (!SPREADSHEET_ID) {
    throw new Error('Missing GOOGLE_SHEET_ID');
  }
  const scopeYears = parseScopeYears();
  if (scopeYears.length === 0) {
    throw new Error('No valid scope years for contract_sync_guard');
  }

  if (RUN_INTEGRITY_CHECK) {
    await runIntegrityCheck(scopeYears);
  }

  const integrity = readIntegritySummary();
  const yearlyMap = new Map((integrity.summaries || []).map((row) => [row.year, row]));

  const driveIds = GATE_A_FULL_ROOT
    ? await listDriveIdsRecursive(ACCOUNTING_ROOT_FOLDER_ID)
    : await listDriveIdsFromRoots(await buildGateARootFolders());
  const belege = await readBelegeDriveIds();

  const gateADriveOnly = Array.from(driveIds).filter((id) => !belege.ids.has(id)).length;
  const gateASheetOnly = Array.from(belege.ids).filter((id) => !driveIds.has(id)).length;
  const gateA = {
    pass: gateADriveOnly === 0 && gateASheetOnly === 0 && belege.duplicateDriveIds === 0,
    driveCount: driveIds.size,
    sheetCount: belege.ids.size,
    driveOnly: gateADriveOnly,
    sheetOnly: gateASheetOnly,
    duplicateDriveIds: belege.duplicateDriveIds
  };

  const missingYears: string[] = [];
  const gateBPerYear: Array<{ year: string; driveOnly: number; sheetOnly: number; duplicateDriveIds: number; pass: boolean }> = [];
  let gateBDriveOnly = 0;
  let gateBSheetOnly = 0;
  let gateBDuplicate = 0;
  for (const year of scopeYears) {
    const summary = yearlyMap.get(year);
    if (!summary) {
      missingYears.push(year);
      gateBPerYear.push({ year, driveOnly: 0, sheetOnly: 0, duplicateDriveIds: 0, pass: false });
      continue;
    }
    const driveOnly = Number(summary.income?.driveOnly || 0) + Number(summary.expense?.driveOnly || 0);
    const sheetOnly = Number(summary.income?.sheetOnly || 0) + Number(summary.expense?.sheetOnly || 0);
    const duplicateDriveIds =
      Number(summary.income?.duplicateDriveIdsInSheet || 0) +
      Number(summary.expense?.duplicateDriveIdsInSheet || 0);
    gateBDriveOnly += driveOnly;
    gateBSheetOnly += sheetOnly;
    gateBDuplicate += duplicateDriveIds;
    gateBPerYear.push({
      year,
      driveOnly,
      sheetOnly,
      duplicateDriveIds,
      pass: driveOnly === 0 && sheetOnly === 0 && duplicateDriveIds === 0
    });
  }
  const gateB = {
    pass: missingYears.length === 0 && gateBDriveOnly === 0 && gateBSheetOnly === 0 && gateBDuplicate === 0,
    missingYears,
    perYear: gateBPerYear,
    totalDriveOnly: gateBDriveOnly,
    totalSheetOnly: gateBSheetOnly,
    totalDuplicateDriveIds: gateBDuplicate
  };

  const gateC = await evaluateDashboardGate();

  const violations: ContractMismatch[] = [];
  if (!gateA.pass) {
    violations.push({
      gate: 'A',
      code: 'BELEGE_DRIVE_DRIFT',
      severity: 'CRITICAL',
      message: 'belege tab is not in strict sync with Drive IDs',
      detail: `driveOnly=${gateA.driveOnly}, sheetOnly=${gateA.sheetOnly}, duplicateDriveIds=${gateA.duplicateDriveIds}`
    });
  }
  if (!gateB.pass) {
    violations.push({
      gate: 'B',
      code: 'YEARLY_TAB_DRIFT',
      severity: 'CRITICAL',
      message: 'Yearly tabs are not in strict sync with Drive',
      detail: `driveOnly=${gateB.totalDriveOnly}, sheetOnly=${gateB.totalSheetOnly}, duplicateDriveIds=${gateB.totalDuplicateDriveIds}, missingYears=${gateB.missingYears.join(',') || '-'}`
    });
  }
  if (!gateC.pass) {
    violations.push({
      gate: 'C',
      code: 'DASHBOARD_DRIFT',
      severity: 'CRITICAL',
      message: 'Dashboard formula or KPI value drift detected',
      detail: `formulaDriftCount=${gateC.formulaDriftCount}, valueDriftCount=${gateC.valueDriftCount}`
    });
  }

  const report: SyncContractResult = {
    version: '2026.1',
    timestamp: new Date().toISOString(),
    scopeYears,
    gates: {
      gateA,
      gateB,
      gateC
    },
    violations,
    autofixActions: [],
    status: violations.length === 0 ? 'green' : 'red'
  };

  writeReports(report);

  console.log(JSON.stringify({
    status: report.status,
    reportJsonPath: REPORT_JSON_PATH,
    reportMdPath: REPORT_MD_PATH,
    gateA: report.gates.gateA,
    gateB: {
      pass: report.gates.gateB.pass,
      totalDriveOnly: report.gates.gateB.totalDriveOnly,
      totalSheetOnly: report.gates.gateB.totalSheetOnly,
      totalDuplicateDriveIds: report.gates.gateB.totalDuplicateDriveIds
    },
    gateC: {
      pass: report.gates.gateC.pass,
      formulaDriftCount: report.gates.gateC.formulaDriftCount,
      valueDriftCount: report.gates.gateC.valueDriftCount
    }
  }, null, 2));

  if (report.status !== 'green') {
    process.exitCode = 2;
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;

if (isMain) {
  main().catch((error) => {
    console.error('contract_sync_guard failed:', error);
    process.exit(1);
  });
}
