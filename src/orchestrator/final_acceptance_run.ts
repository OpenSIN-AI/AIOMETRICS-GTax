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

async function runNodeScript(scriptPath: string, extraEnv: Record<string, string> = {}): Promise<void> {
  await runCommand(process.execPath, [scriptPath], {
    ...extraEnv,
    PIPELINE_LOCK_BYPASS: '1'
  });
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
  let pageToken: string | undefined = undefined;
  do {
    const response = await runWithRateLimitRetry(
      () => driveApi.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      }),
      `listChildren.${folderId}`
    );
    out.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken || undefined;
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
    for (const range of valuesRes.data.valueRanges || []) {
      for (const row of range.values || []) {
        for (const cell of row) {
          if (String(cell).includes('Fehler bei der PDF-Analyse')) forbiddenMarkerHits++;
        }
      }
    }
  }

  return {
    records: data.length,
    categories,
    tabs,
    forbiddenMarkerHits
  };
}

function selectStratifiedSample(rows: any[], sampleSize: number): any[] {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const year = extractYear(String(row.original_name || '')) || extractYear(String(row.analyzed_at || '')) || 'unknown';
    const category = String(row.category || '(leer)');
    const key = `${year}::${category}`;
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const keys = Array.from(groups.keys()).sort();
  const sampled: any[] = [];
  const idx = new Map<string, number>();
  for (const key of keys) {
    const bucket = groups.get(key) || [];
    if (bucket.length > 0) {
      sampled.push(bucket[0]);
      idx.set(key, 1);
    } else {
      idx.set(key, 0);
    }
  }

  while (sampled.length < sampleSize) {
    let added = false;
    for (const key of keys) {
      const bucket = groups.get(key) || [];
      const current = idx.get(key) || 0;
      if (current < bucket.length) {
        sampled.push(bucket[current]);
        idx.set(key, current + 1);
        added = true;
        if (sampled.length >= sampleSize) break;
      }
    }
    if (!added) break;
  }

  return sampled.slice(0, sampleSize);
}

function assessQaIssue(row: any): QaIssue | null {
  const failures: string[] = [];
  const criticalFailures: string[] = [];

  const driveFileId = String(row.drive_file_id || '');
  const originalName = String(row.original_name || '');
  const category = String(row.category || '');
  const targetFolderId = String(row.target_folder_id || '');
  const fileUrl = String(row.file_url || '');

  if (!driveFileId) criticalFailures.push('missing_drive_file_id');
  if (!originalName) criticalFailures.push('missing_original_name');
  if (!category) criticalFailures.push('missing_category');
  if (!targetFolderId) criticalFailures.push('missing_target_folder_id');
  if (!fileUrl) criticalFailures.push('missing_file_url');

  const derivedYear = extractYear(originalName) || extractYear(String(row.analyzed_at || ''));
  if (!derivedYear) criticalFailures.push('invalid_year');

  const textBlob = `${row.extracted_text || ''} ${row.ocr_text || ''}`.trim();
  const metadata = String(row.metadata || '');
  const amountCandidates = textBlob.match(/\d+[\.,]\d{2}/g) || [];

  if (textBlob.length < 20) failures.push('weak_text_extraction');
  if (!metadata || metadata === '{}') failures.push('missing_metadata');
  if (amountCandidates.length === 0) {
    failures.push('missing_amount_pattern');
  } else {
    const maxAmount = Math.max(...amountCandidates.map(parseAmount));
    if (maxAmount <= 0) failures.push('invalid_amount_pattern');
  }

  const allFailures = [...criticalFailures, ...failures];
  if (allFailures.length === 0) return null;

  let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' = 'MEDIUM';
  if (criticalFailures.length > 0) severity = 'CRITICAL';
  else if (failures.includes('missing_metadata') && amountCandidates.length > 0) severity = 'HIGH';

  return {
    drive_file_id: driveFileId,
    original_name: originalName,
    year: derivedYear || 'unknown',
    category,
    severity,
    failures: allFailures
  };
}

function runQualityCheck(belegeRows: any[], sampleSize: number): QaResult {
  const sampled = selectStratifiedSample(belegeRows, sampleSize);
  const issues: QaIssue[] = [];
  let criticalPassed = 0;
  for (const row of sampled) {
    const issue = assessQaIssue(row);
    if (!issue) {
      criticalPassed++;
      continue;
    }
    if (issue.severity !== 'CRITICAL') {
      criticalPassed++;
    }
    issues.push(issue);
  }

  const total = sampled.length;
  const accuracy = total === 0 ? 0 : criticalPassed / total;
  const criticalQaIssues = issues.filter((issue) => issue.severity === 'CRITICAL').length;
  return {
    total,
    criticalPassed,
    accuracy,
    criticalQaIssues,
    issues
  };
}

async function writeQaCriticalOpen(sheetsApi: any, spreadsheetId: string, issues: QaIssue[]): Promise<void> {
  const sheetMap = await getSheetMap(sheetsApi, spreadsheetId);
  await ensureSheetExists(sheetsApi, spreadsheetId, 'QA_CRITICAL_OPEN', sheetMap);

  const rows = [
    ['drive_file_id', 'original_name', 'year', 'category', 'severity', 'failures_json'],
    ...issues
      .filter((issue) => issue.severity === 'CRITICAL')
      .map((issue) => [
        issue.drive_file_id,
        issue.original_name,
        issue.year,
        issue.category,
        issue.severity,
        JSON.stringify(issue.failures)
      ])
  ];

  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.clear({
      spreadsheetId,
      range: 'QA_CRITICAL_OPEN!A:Z'
    }),
    'writeQaCriticalOpen.clear'
  );
  await runWithRateLimitRetry(
    () => sheetsApi.spreadsheets.values.update({
      spreadsheetId,
      range: 'QA_CRITICAL_OPEN!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows }
    }),
    'writeQaCriticalOpen.update'
  );
}

function computeYearlyGateStatus(integritySummary: any): YearlyGateStatus[] {
  const rows = integritySummary?.summaries || [];
  return rows.map((yearly: any) => {
    const driveOnly = (yearly.income?.driveOnly || 0) + (yearly.expense?.driveOnly || 0);
    const sheetOnly = (yearly.income?.sheetOnly || 0) + (yearly.expense?.sheetOnly || 0);
    const duplicateDriveIds = (yearly.income?.duplicateDriveIdsInSheet || 0) + (yearly.expense?.duplicateDriveIdsInSheet || 0);
    return {
      year: String(yearly.year || ''),
      driveOnly,
      sheetOnly,
      duplicateDriveIds,
      pass: driveOnly === 0 && sheetOnly === 0 && duplicateDriveIds === 0
    };
  });
}

function buildSortKey(year: string, category: string, originalName: string, driveFileId: string): string {
  return `${year}|${category}|${originalName}|${driveFileId}`;
}

function mapRecordFromCanonical(
  canonical: CanonicalDriveFile,
  existing: BelegRecord | undefined,
  sourceFolderId: string,
  nowIso: string
): Partial<BelegRecord> {
  return {
    id: existing?.id || randomUUID(),
    drive_file_id: canonical.drive_file_id,
    original_name: canonical.original_name,
    mime_type: canonical.mime_type,
    file_size: canonical.file_size,
    category: canonical.category,
    extracted_text: existing?.extracted_text || '',
    ocr_text: existing?.ocr_text || '',
    image_description: existing?.image_description || '',
    tags: existing?.tags || '[]',
    metadata: existing?.metadata || '{}',
    confidence: Number(existing?.confidence || 0),
    source_folder_id: sourceFolderId,
    source_folder_url: `https://drive.google.com/drive/folders/${sourceFolderId}`,
    target_folder_id: canonical.target_folder_id,
    target_folder_url: canonical.target_folder_id ? `https://drive.google.com/drive/folders/${canonical.target_folder_id}` : '',
    analyzed_at: existing?.analyzed_at || nowIso,
    moved_at: existing?.moved_at || nowIso,
    file_url: canonical.file_url
  };
}

function buildYearlyRow(header: string[], entry: CanonicalDriveFile): string[] {
  const row = new Array(header.length).fill('');
  const set = (name: string, value: string) => {
    const idx = header.indexOf(name);
    if (idx >= 0) row[idx] = value;
  };
  set('Datum', `${entry.year}-01-01`);
  set('Typ', entry.cashflow === 'Einnahmen' ? 'Einnahme' : 'Ausgabe');
  set('Kategorie', entry.category);
  set('Status', 'SYNCED');
  set('Bemerkung', 'AUTO_PROJECTION');
  set('Dateiname', entry.original_name);
  set('reason', 'AUTO_PROJECTION');
  set('drive_file_id', entry.drive_file_id);
  set('file_url', entry.file_url);
  return row;
}

function chooseCanonicalExisting(rows: BelegRecord[]): BelegRecord {
  return [...rows].sort((a, b) => {
    const aTs = Date.parse(a.analyzed_at || '');
    const bTs = Date.parse(b.analyzed_at || '');
    const aVal = Number.isFinite(aTs) ? aTs : Number.MAX_SAFE_INTEGER;
    const bVal = Number.isFinite(bTs) ? bTs : Number.MAX_SAFE_INTEGER;
    if (aVal !== bVal) return aVal - bVal;
    return (a.id || '').localeCompare(b.id || '');
  })[0];
}

async function buildCanonicalDriveIndex(
  driveApi: drive_v3.Drive,
  config: { sourceFolderId: string; targetFolderId: string; accountingRootFolderId: string }
): Promise<{ files: CanonicalDriveFile[]; physicalYears: string[] }> {
  const topLevelFolders = (await listChildren(driveApi, config.accountingRootFolderId)).filter(
    (item) => item.mimeType === 'application/vnd.google-apps.folder'
  );

  const physicalYears = Array.from(
    new Set(
      topLevelFolders
        .map((folder) => folder.name || '')
        .filter((name) => /^20\d{2}$/.test(name) && isValidYear(name))
    )
  ).sort();

  const roots = new Map<string, string>();
  roots.set(config.sourceFolderId, 'source');
  roots.set(config.targetFolderId, 'target');
  for (const folder of topLevelFolders) {
    const name = folder.name || '';
    const id = folder.id || '';
    if (!id) continue;
    const isYearFolder = /^20\d{2}$/.test(name) && isValidYear(name);
    const isAdditional = ['Sonstige_Belege', 'Neue Belege', 'Neue Belege '].includes(name);
    if (isYearFolder || isAdditional) {
      roots.set(id, name || id);
    }
  }

  const files: CanonicalDriveFile[] = [];
  const visited = new Set<string>();
  for (const [rootId, rootName] of roots.entries()) {
    const queue: Array<{ id: string; path: string }> = [{ id: rootId, path: rootName }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const visitKey = `${rootId}:${current.id}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      if (current.id === DUPLICATE_FOLDER_ID || current.id === MISSING_FOLDER_ID) {
        continue;
      }

      const children = await listChildren(driveApi, current.id);
      for (const child of children) {
        const childId = child.id || '';
        const childName = child.name || childId;
        if (!childId) continue;
        if (child.mimeType === 'application/vnd.google-apps.folder') {
          queue.push({ id: childId, path: `${current.path}/${childName}` });
          continue;
        }

        const pathYear = current.path
          .split('/')
          .map((segment) => segment.trim())
          .find((segment) => /^20\d{2}$/.test(segment) && isValidYear(segment));
        const nameYear = extractYear(childName);
        const resolvedYear = pathYear || nameYear || String(new Date().getFullYear());

        files.push({
          drive_file_id: childId,
          original_name: childName,
          mime_type: child.mimeType || '',
          file_size: Number.parseInt(child.size || '0', 10),
          file_url: child.webViewLink || `https://drive.google.com/file/d/${childId}/view`,
          folder_path: current.path,
          target_folder_id: current.id,
          year: resolvedYear,
          cashflow: inferCashflow(current.path, childName),
          category: inferCategory(current.path, childName)
        });
      }
    }
  }

  files.sort((a, b) =>
    buildSortKey(a.year, a.category, a.original_name, a.drive_file_id).localeCompare(
      buildSortKey(b.year, b.category, b.original_name, b.drive_file_id)
    )
  );

  return { files, physicalYears };
}

function canonicalEntriesForTab(files: CanonicalDriveFile[], year: string, flow: 'Einnahmen' | 'Ausgaben'): CanonicalDriveFile[] {
  const needle = `${year}/${flow}_${year}`.toLowerCase();
  const strict = files.filter((entry) => entry.folder_path.toLowerCase().includes(needle));
  if (strict.length > 0) {
    return strict.sort((a, b) => buildSortKey(a.year, a.category, a.original_name, a.drive_file_id).localeCompare(buildSortKey(b.year, b.category, b.original_name, b.drive_file_id)));
  }
  return files
    .filter((entry) => entry.year === year && entry.cashflow === flow)
    .sort((a, b) => buildSortKey(a.year, a.category, a.original_name, a.drive_file_id).localeCompare(buildSortKey(b.year, b.category, b.original_name, b.drive_file_id)));
}

async function resolveMismatches(params: {
  runId: string;
  nowIso: string;
  sheetsApi: any;
  spreadsheetId: string;
  sheetsService: GoogleSheetsService;
  canonicalFiles: CanonicalDriveFile[];
  scopeYears: string[];
  sourceFolderId: string;
}): Promise<MismatchResolutionStats> {
  const actionPriority: Record<MismatchActionType, number> = {
    DELETE_DUPLICATE: 1,
    DELETE_ORPHAN: 2,
    DELETE_YEARLY_ORPHAN: 3,
    INSERT_MISSING: 4,
    INSERT_YEARLY_MISSING: 5,
    UPDATE_YEAR: 6,
    UPDATE_CATEGORY: 7
  };

  const existingRecords = await params.sheetsService.getAllBelege();
  const existingById = new Map<string, BelegRecord[]>();
  for (const record of existingRecords) {
    const bucket = existingById.get(record.drive_file_id) || [];
    bucket.push(record);
    existingById.set(record.drive_file_id, bucket);
  }

  const canonicalById = new Map<string, CanonicalDriveFile>();
  for (const file of params.canonicalFiles) {
    canonicalById.set(file.drive_file_id, file);
  }

  const actions: MismatchAction[] = [];
  const finalBelege: Partial<BelegRecord>[] = [];

  for (const file of params.canonicalFiles) {
    const rows = existingById.get(file.drive_file_id) || [];
    const canonicalExisting = rows.length > 0 ? chooseCanonicalExisting(rows) : undefined;
    const nextRecord = mapRecordFromCanonical(file, canonicalExisting, params.sourceFolderId, params.nowIso);
    finalBelege.push(nextRecord);

    if (!canonicalExisting) {
      actions.push({
        type: 'INSERT_MISSING',
        reason: 'MISSING_IN_SHEET',
        target: 'belege',
        driveFileId: file.drive_file_id,
        scopeYear: file.year,
        sortKey: buildSortKey(file.year, file.category, file.original_name, file.drive_file_id),
        before: {},
        after: nextRecord as Record<string, unknown>
      });
    } else {
      const oldYear = extractYear(canonicalExisting.original_name || '') || extractYear(canonicalExisting.analyzed_at || '') || '0000';
      if (oldYear !== file.year) {
        actions.push({
          type: 'UPDATE_YEAR',
          reason: 'YEAR_MISMATCH',
          target: 'belege',
          driveFileId: file.drive_file_id,
          scopeYear: file.year,
          sortKey: buildSortKey(file.year, file.category, file.original_name, file.drive_file_id),
          before: { year: oldYear, original_name: canonicalExisting.original_name },
          after: { year: file.year, original_name: file.original_name }
        });
      }
      if ((canonicalExisting.category || '') !== file.category) {
        actions.push({
          type: 'UPDATE_CATEGORY',
          reason: 'CATEGORY_MISMATCH',
          target: 'belege',
          driveFileId: file.drive_file_id,
          scopeYear: file.year,
          sortKey: buildSortKey(file.year, file.category, file.original_name, file.drive_file_id),
          before: { category: canonicalExisting.category || '' },
          after: { category: file.category }
        });
      }
      if (rows.length > 1) {
        for (const duplicate of rows.filter((r) => r.id !== canonicalExisting.id)) {
          actions.push({
            type: 'DELETE_DUPLICATE',
            reason: 'DUPLICATE_DRIVE_ID',
            target: 'belege',
            driveFileId: file.drive_file_id,
            scopeYear: file.year,
            sortKey: buildSortKey(file.year, file.category, file.original_name, file.drive_file_id),
            before: duplicate as unknown as Record<string, unknown>,
            after: canonicalExisting as unknown as Record<string, unknown>
          });
        }
      }
    }
  }

  for (const record of existingRecords) {
    if (!record.drive_file_id || canonicalById.has(record.drive_file_id)) continue;
    const orphanYear = extractYear(record.original_name || '') || extractYear(record.analyzed_at || '') || '0000';
    actions.push({
      type: 'DELETE_ORPHAN',
      reason: 'ORPHAN_IN_SHEET',
      target: 'belege',
      driveFileId: record.drive_file_id,
      scopeYear: orphanYear,
      sortKey: buildSortKey(orphanYear, record.category || 'Sonstiges', record.original_name || '', record.drive_file_id),
      before: record as unknown as Record<string, unknown>,
      after: {}
    });
  }

  await params.sheetsService.replaceAllBelege(finalBelege);

  const expectedTabs = params.scopeYears.flatMap((year) => [`Einnahmen_${year}`, `Ausgaben_${year}`]).sort();
  const existingYearlyTabs = await params.sheetsService.listYearlyTabs();
  const staleGeneratedTabs = existingYearlyTabs.filter(
    (tab) => !expectedTabs.includes(tab) && !/_Legacy_/i.test(tab)
  );

  const sheetMap = await getSheetMap(params.sheetsApi, params.spreadsheetId);
  if (staleGeneratedTabs.length > 0) {
    const deleteRequests = staleGeneratedTabs
      .map((title) => sheetMap.get(title))
      .filter((id): id is number => typeof id === 'number')
      .map((sheetId) => ({ deleteSheet: { sheetId } }));
    if (deleteRequests.length > 0) {
      await runWithRateLimitRetry(
        () => params.sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId: params.spreadsheetId,
          requestBody: { requests: deleteRequests }
        }),
        'resolveMismatches.deleteStaleYearTabs'
      );
      for (const tab of staleGeneratedTabs) sheetMap.delete(tab);
    }
  }

  let yearlyTabsTouched = 0;
  for (const tab of expectedTabs) {
    const flow = tab.startsWith('Einnahmen_') ? 'Einnahmen' : 'Ausgaben';
    const year = tab.slice(-4);
    const desired = canonicalEntriesForTab(params.canonicalFiles, year, flow);
    const currentRows: YearlyTabRow[] = existingYearlyTabs.includes(tab)
      ? await params.sheetsService.readYearlyRows(tab)
      : [];

    const currentIds = new Set(currentRows.map((row) => row.drive_file_id));
    const desiredIds = new Set(desired.map((row) => row.drive_file_id));

    for (const row of currentRows) {
      if (!desiredIds.has(row.drive_file_id)) {
        actions.push({
          type: 'DELETE_YEARLY_ORPHAN',
          reason: 'ORPHAN_IN_SHEET',
          target: 'yearly_tabs',
          driveFileId: row.drive_file_id,
          scopeYear: year,
          sortKey: buildSortKey(year, 'yearly', tab, row.drive_file_id),
          before: { tab, rowNumber: row.rowNumber, row: row.raw },
          after: {}
        });
      }
    }

    for (const file of desired) {
      if (!currentIds.has(file.drive_file_id)) {
        actions.push({
          type: 'INSERT_YEARLY_MISSING',
          reason: 'MISSING_IN_SHEET',
          target: 'yearly_tabs',
          driveFileId: file.drive_file_id,
          scopeYear: year,
          sortKey: buildSortKey(year, file.category, file.original_name, file.drive_file_id),
          before: {},
          after: { tab, drive_file_id: file.drive_file_id }
        });
      }
    }

    await ensureSheetExists(params.sheetsApi, params.spreadsheetId, tab, sheetMap);
    const headerRead: any = await runWithRateLimitRetry(
      () => params.sheetsApi.spreadsheets.values.get({
        spreadsheetId: params.spreadsheetId,
        range: `${tab}!1:1`
      }),
      `resolveMismatches.readHeader.${tab}`
    );
    let header = (headerRead.data.values?.[0] || []).map((x: string) => String(x || '').trim());
    if (header.length === 0 || !header.includes('drive_file_id')) {
      header = [...DEFAULT_YEARLY_HEADERS];
    }

    const rows = [
      header,
      ...desired.map((entry) => buildYearlyRow(header, entry))
    ];

    await runWithRateLimitRetry(
      () => params.sheetsApi.spreadsheets.values.clear({
        spreadsheetId: params.spreadsheetId,
        range: `${tab}!A:ZZ`
      }),
      `resolveMismatches.clear.${tab}`
    );
    await runWithRateLimitRetry(
      () => params.sheetsApi.spreadsheets.values.update({
        spreadsheetId: params.spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      }),
      `resolveMismatches.update.${tab}`
    );
    yearlyTabsTouched++;
  }

  actions.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey.localeCompare(b.sortKey);
    const pa = actionPriority[a.type];
    const pb = actionPriority[b.type];
    if (pa !== pb) return pa - pb;
    return a.driveFileId.localeCompare(b.driveFileId);
  });

  const auditRows: AuditMutationRecord[] = actions.map((action) => ({
    run_id: params.runId,
    timestamp: params.nowIso,
    action: action.type,
    target: action.target,
    drive_file_id: action.driveFileId,
    before_json: JSON.stringify({ scopeYear: action.scopeYear, payload: action.before }),
    after_json: JSON.stringify({ scopeYear: action.scopeYear, payload: action.after }),
    reason: action.reason
  }));

  const chunkSize = 300;
  for (let i = 0; i < auditRows.length; i += chunkSize) {
    await params.sheetsService.appendAuditMutations(auditRows.slice(i, i + chunkSize));
  }

  const actionsByType: Record<string, number> = {};
  const actionsByYear: Record<string, number> = {};
  for (const action of actions) {
    actionsByType[action.type] = (actionsByType[action.type] || 0) + 1;
    actionsByYear[action.scopeYear] = (actionsByYear[action.scopeYear] || 0) + 1;
  }

  await params.sheetsService.logProcessing(
    '',
    'mismatch_resolve',
    'success',
    `run=${params.runId}, actions=${actions.length}, belegeBefore=${existingRecords.length}, belegeAfter=${finalBelege.length}, staleTabsDeleted=${staleGeneratedTabs.length}`
  );

  return {
    belegeBefore: existingRecords.length,
    belegeAfter: finalBelege.length,
    yearlyTabsTouched,
    staleYearTabsDeleted: staleGeneratedTabs,
    actionsTotal: actions.length,
    actionsByType,
    actionsByYear
  };
}

async function runStage(stageResults: StageResult[], stageName: string, fn: () => Promise<void>, canRun: boolean): Promise<boolean> {
  if (!canRun) {
    stageResults.push({
      stage: stageName,
      ok: false,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      error: 'SKIPPED_DUE_TO_PREVIOUS_FAILURE'
    });
    return false;
  }

  const startedAt = new Date().toISOString();
  const startedTs = Date.now();
  try {
    await fn();
    stageResults.push({
      stage: stageName,
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedTs
    });
    return true;
  } catch (error: any) {
    stageResults.push({
      stage: stageName,
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedTs,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

async function main() {
  const spreadsheetId = mustEnv('GOOGLE_SHEET_ID');
  const credentialsPath = mustEnv('GOOGLE_CREDENTIALS_PATH');
  const sourceFolderId = process.env.SOURCE_DRIVE_FOLDER_ID || DEFAULT_SOURCE_FOLDER;
  const targetFolderId = process.env.TARGET_DRIVE_FOLDER_ID || DEFAULT_TARGET_FOLDER;
  const accountingRootFolderId = process.env.ACCOUNTING_ROOT_FOLDER_ID || DEFAULT_ACCOUNTING_ROOT;
  const sampleSize = Number.parseInt(process.env.QA_SAMPLE_SIZE || '80', 10);
  const maxLoops = Math.max(1, Number.parseInt(process.env.ACCEPTANCE_MAX_LOOPS || '1', 10));

  const runId = randomUUID();
  const reportMdPath = path.join(process.cwd(), 'docs', 'FINAL_ACCEPTANCE_REPORT.md');
  const reportJsonPath = path.join(process.cwd(), 'docs', 'FINAL_ACCEPTANCE_REPORT.json');
  const baselinePath = path.join(process.cwd(), 'docs', 'FINAL_ACCEPTANCE_BASELINE.json');
  const unresolvedPath = path.join(process.cwd(), 'docs', `UNRESOLVED_IDS_${runId}.json`);

  const auth = new JWT({
    keyFile: credentialsPath,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const driveApi = google.drive({ version: 'v3', auth });

  const sheetsService = new GoogleSheetsService(credentialsPath, spreadsheetId);
  await sheetsService.init();
  const auditSchemaMigration = await sheetsService.ensureCanonicalAuditTable();
  await sheetsService.enforceBestPracticeTabs();

  const initialYearlyTabs = await sheetsService.listYearlyTabs();
  const envYears = parseEnvYears(process.env.CHECK_YEARS);

  const initialDriveIndex = await buildCanonicalDriveIndex(driveApi, {
    sourceFolderId,
    targetFolderId,
    accountingRootFolderId
  });
  const canonicalDriveIndexPath = path.join(process.cwd(), 'docs', `CANONICAL_DRIVE_INDEX_${runId}.json`);
  fs.mkdirSync(path.dirname(canonicalDriveIndexPath), { recursive: true });
  fs.writeFileSync(canonicalDriveIndexPath, JSON.stringify(initialDriveIndex.files, null, 2), 'utf8');

  const scopeYears = resolveScopeYears({
    envYears,
    physicalYears: initialDriveIndex.physicalYears,
    yearlyTabYears: parseYearsFromYearlyTabs(initialYearlyTabs),
    canonicalDriveYears: Array.from(new Set(initialDriveIndex.files.map((f) => f.year).filter((y) => isValidYear(y)))).sort()
  });
  if (scopeYears.length === 0) {
    throw new Error('Scope year resolution failed: no years discovered');
  }

  const baseline = await collectSnapshot(sheetsApi, spreadsheetId);
  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        runId,
        scopeYears,
        baseline
      },
      null,
      2
    ),
    'utf8'
  );

  await sheetsService.appendAuditMutations([
    {
      run_id: runId,
      timestamp: new Date().toISOString(),
      action: 'BASELINE',
      target: 'final_acceptance',
      drive_file_id: '',
      before_json: '{}',
      after_json: JSON.stringify({ baseline, scopeYears, canonicalDriveIndexPath }),
      reason: 'BASELINE'
    }
  ]);

  const distRoot = path.join(process.cwd(), 'dist', 'orchestrator');
  const stageResults: StageResult[] = [];
  const loopHistory: LoopStatus[] = [];

  let qa: QaResult = { total: 0, criticalPassed: 0, accuracy: 0, criticalQaIssues: 0, issues: [] };
  let governance: SheetGovernanceResult = { ok: false, expectedYears: scopeYears, requiredTabs: [], presentTabs: [], findings: [] };
  let mismatchResolutionStats: MismatchResolutionStats = {
    belegeBefore: baseline.records,
    belegeAfter: baseline.records,
    yearlyTabsTouched: 0,
    staleYearTabsDeleted: [],
    actionsTotal: 0,
    actionsByType: {},
    actionsByYear: {}
  };
  let afterSnapshot: Snapshot = baseline;
  let yearlyGateStatus: YearlyGateStatus[] = [];
  let integritySummary: any = {};
  let idempotency = {
    firstRunId: null as string | null,
    secondRunId: null as string | null,
    secondRunMutations: 0,
    pass: false
  };

  let nonImprovingRuns = 0;
  let previousMismatchTotal = Number.MAX_SAFE_INTEGER;
  let canRun = true;

  canRun = await runStage(stageResults, 'build', async () => {
    await runCommand('npm', ['run', 'build']);
  }, canRun);

  for (let loop = 1; loop <= maxLoops; loop++) {
    canRun = await runStage(stageResults, `start_sync#${loop}`, async () => {
      await runNodeScript(path.join(distRoot, 'main.js'));
    }, canRun);

    canRun = await runStage(stageResults, `soft_audit#${loop}`, async () => {
      await runNodeScript(path.join(distRoot, 'soft_audit.js'), { AUDIT_LEVEL: 'soft' });
    }, canRun);

    canRun = await runStage(stageResults, `integrity_check#${loop}`, async () => {
      await runNodeScript(path.join(distRoot, 'check_2023_integrity.js'), { CHECK_YEARS: scopeYears.join(',') });
      integritySummary = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'CHECK_DRIVE_SHEETS_SYNC.json'), 'utf8'));
      yearlyGateStatus = computeYearlyGateStatus(integritySummary);
    }, canRun);

    canRun = await runStage(stageResults, `mismatch_resolve#${loop}`, async () => {
      const canonicalNow = await buildCanonicalDriveIndex(driveApi, {
        sourceFolderId,
        targetFolderId,
        accountingRootFolderId
      });
      fs.writeFileSync(canonicalDriveIndexPath, JSON.stringify(canonicalNow.files, null, 2), 'utf8');
      mismatchResolutionStats = await resolveMismatches({
        runId,
        nowIso: new Date().toISOString(),
        sheetsApi,
        spreadsheetId,
        sheetsService,
        canonicalFiles: canonicalNow.files,
        scopeYears,
        sourceFolderId
      });
    }, canRun);

    canRun = await runStage(stageResults, `quality_check#${loop}`, async () => {
      await runNodeScript(path.join(distRoot, 'check_2023_integrity.js'), { CHECK_YEARS: scopeYears.join(',') });
      integritySummary = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'CHECK_DRIVE_SHEETS_SYNC.json'), 'utf8'));
      yearlyGateStatus = computeYearlyGateStatus(integritySummary);

      const belege = await sheetsService.getAllBelege();
      qa = runQualityCheck(belege as any[], sampleSize);
      await writeQaCriticalOpen(sheetsApi, spreadsheetId, qa.issues);
      afterSnapshot = await collectSnapshot(sheetsApi, spreadsheetId);
    }, canRun);

    canRun = await runStage(stageResults, `governance_check#${loop}`, async () => {
      governance = await sheetsService.checkSheetGovernance(scopeYears);
    }, canRun);

    canRun = await runStage(stageResults, `idempotency_check#${loop}`, async () => {
      idempotency.firstRunId = await sheetsService.getLatestReconcileRunId();
      const auditBefore = await sheetsService.getAuditMutationCount();
      await runNodeScript(path.join(distRoot, 'main.js'), { SYNC_ONLY: '1' });
      idempotency.secondRunId = await sheetsService.getLatestReconcileRunId();
      const auditAfter = await sheetsService.getAuditMutationCount();
      idempotency.secondRunMutations = Math.max(0, auditAfter - auditBefore);
      if (idempotency.secondRunId && idempotency.firstRunId && idempotency.secondRunId !== idempotency.firstRunId) {
        const byRun = await sheetsService.getAuditMutationsByRunId(idempotency.secondRunId);
        if (byRun.length > 0) idempotency.secondRunMutations = byRun.length;
      }
      idempotency.pass = idempotency.secondRunMutations === 0;
    }, canRun);

    const mismatchTotal = yearlyGateStatus.reduce((sum, item) => sum + item.driveOnly + item.sheetOnly + item.duplicateDriveIds, 0);
    const doneCandidate =
      mismatchTotal === 0 &&
      afterSnapshot.forbiddenMarkerHits === 0 &&
      qa.accuracy >= 0.99 &&
      qa.criticalQaIssues === 0 &&
      governance.ok &&
      governance.findings.filter((f) => f.severity === 'CRITICAL').length === 0 &&
      idempotency.pass;
    loopHistory.push({ iteration: loop, mismatchTotal, doneCandidate });

    if (doneCandidate || !canRun) {
      break;
    }

    if (mismatchTotal < previousMismatchTotal) {
      nonImprovingRuns = 0;
    } else {
      nonImprovingRuns += 1;
    }
    previousMismatchTotal = mismatchTotal;

    if (nonImprovingRuns >= 2) {
      const fullMismatchFiles = integritySummary?.fullMismatchFiles || {};
      const unresolved: Record<string, string[]> = {};
      for (const [year, refs] of Object.entries<any>(fullMismatchFiles)) {
        const driveOnlyPath = refs?.driveOnlyFullPath;
        if (!driveOnlyPath || !fs.existsSync(driveOnlyPath)) continue;
        const payload = JSON.parse(fs.readFileSync(driveOnlyPath, 'utf8'));
        const ids: string[] = [];
        for (const row of [...(payload.income || []), ...(payload.expense || [])]) {
          if (row?.id) ids.push(String(row.id));
        }
        unresolved[year] = ids.slice(0, 200);
      }
      fs.writeFileSync(unresolvedPath, JSON.stringify({ runId, unresolved }, null, 2), 'utf8');
      break;
    }
  }

  await runStage(stageResults, 'final_report', async () => {
    const totalDriveOnly = yearlyGateStatus.reduce((sum, item) => sum + item.driveOnly, 0);
    const totalSheetOnly = yearlyGateStatus.reduce((sum, item) => sum + item.sheetOnly, 0);
    const totalDuplicateIds = yearlyGateStatus.reduce((sum, item) => sum + item.duplicateDriveIds, 0);

    const hardFailReasons: string[] = [];
    for (const stage of stageResults) {
      if (!stage.ok && stage.error !== 'SKIPPED_DUE_TO_PREVIOUS_FAILURE') {
        hardFailReasons.push(`STAGE_FAILED:${stage.stage}`);
      }
    }
    if (totalDriveOnly !== 0) hardFailReasons.push('DRIVE_ONLY_NOT_ZERO');
    if (totalSheetOnly !== 0) hardFailReasons.push('SHEET_ONLY_NOT_ZERO');
    if (totalDuplicateIds !== 0) hardFailReasons.push('DUPLICATE_IDS_NOT_ZERO');
    if (afterSnapshot.forbiddenMarkerHits !== 0) hardFailReasons.push('FORBIDDEN_MARKER_PRESENT');
    if (qa.accuracy < 0.99) hardFailReasons.push('QA_BELOW_THRESHOLD');
    if (qa.criticalQaIssues > 0) hardFailReasons.push('CRITICAL_QA_ISSUES_PRESENT');
    const criticalGovernance = governance.findings.filter((f) => f.severity === 'CRITICAL');
    if (criticalGovernance.length > 0) hardFailReasons.push('GOVERNANCE_CRITICAL_FINDINGS');
    if (!idempotency.pass) hardFailReasons.push('IDEMPOTENCY_FAILED');
    if (nonImprovingRuns >= 2 && fs.existsSync(unresolvedPath)) hardFailReasons.push('NO_IMPROVEMENT_ESCALATION');

    const done = hardFailReasons.length === 0;
    const report = {
      timestamp: new Date().toISOString(),
      runId,
      scopeYears,
      years: scopeYears,
      stages: stageResults,
      baseline,
      after: afterSnapshot,
      kpis: {
        totalDriveOnly,
        totalSheetOnly,
        totalDuplicateIds,
        forbiddenMarkerHits: afterSnapshot.forbiddenMarkerHits,
        qaSampleSize: qa.total,
        qaSampleCriticalPassed: qa.criticalPassed,
        qaAccuracy: qa.accuracy,
        criticalQaIssues: qa.criticalQaIssues,
        idempotencyPass: idempotency.pass
      },
      yearlyGateStatus,
      governanceFindings: governance.findings,
      criticalQaIssues: qa.criticalQaIssues,
      qaIssues: qa.issues,
      auditSchemaMigration,
      mismatchResolutionStats,
      hardFailReasons,
      integrity: integritySummary,
      idempotency,
      canonicalDriveIndexPath,
      loopHistory,
      unresolvedIdsPath: fs.existsSync(unresolvedPath) ? unresolvedPath : null,
      done
    };

    fs.mkdirSync(path.dirname(reportMdPath), { recursive: true });
    fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf8');

    const md: string[] = [];
    md.push('# Final Acceptance Report');
    md.push('');
    md.push(`- Timestamp: ${report.timestamp}`);
    md.push(`- Run ID: ${runId}`);
    md.push(`- Scope years: ${scopeYears.join(', ')}`);
    md.push(`- Done (all gates green): ${done ? 'YES' : 'NO'}`);
    md.push('');
    md.push('## KPI Summary');
    md.push('');
    md.push(`- records_before: ${baseline.records}`);
    md.push(`- records_after: ${afterSnapshot.records}`);
    md.push(`- driveOnly_total: ${totalDriveOnly}`);
    md.push(`- sheetOnly_total: ${totalSheetOnly}`);
    md.push(`- duplicate_drive_file_id_total: ${totalDuplicateIds}`);
    md.push(`- forbidden_marker_hits: ${afterSnapshot.forbiddenMarkerHits}`);
    md.push(`- qa_accuracy_critical: ${(qa.accuracy * 100).toFixed(2)}% (${qa.criticalPassed}/${qa.total})`);
    md.push(`- critical_qa_issues: ${qa.criticalQaIssues}`);
    md.push(`- idempotency_pass: ${idempotency.pass}`);
    md.push('');
    md.push('## Hard Fail Reasons');
    md.push('');
    for (const reason of hardFailReasons) {
      md.push(`- ${reason}`);
    }
    md.push('');
    md.push('## Yearly Gate Status');
    md.push('');
    for (const yearly of yearlyGateStatus) {
      md.push(`- ${yearly.year}: pass=${yearly.pass} driveOnly=${yearly.driveOnly} sheetOnly=${yearly.sheetOnly} duplicateDriveIds=${yearly.duplicateDriveIds}`);
    }
    md.push('');
    md.push('## Governance Findings (Top 50)');
    md.push('');
    for (const finding of governance.findings.slice(0, 50)) {
      md.push(`- ${finding.severity} | ${finding.tab} | ${finding.code} | ${finding.message}`);
    }
    md.push('');
    md.push('## Stage Results');
    md.push('');
    for (const stage of stageResults) {
      md.push(`- ${stage.stage}: ${stage.ok ? 'OK' : 'FAIL'} (${stage.durationMs}ms)`);
    }
    md.push('');
    md.push('## QA Issues (Top 50)');
    md.push('');
    for (const issue of qa.issues.slice(0, 50)) {
      md.push(`- ${issue.severity} | ${issue.drive_file_id} | ${issue.year} | ${issue.category} | ${issue.failures.join(', ')}`);
    }
    md.push('');
    md.push('## JSON Appendix');
    md.push('');
    md.push('```json');
    md.push(JSON.stringify(report, null, 2));
    md.push('```');

    fs.writeFileSync(reportMdPath, md.join('\n'), 'utf8');
  }, true);

  const finalReport = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
  console.log(JSON.stringify({
    done: finalReport.done,
    runId,
    scopeYears,
    reportMdPath,
    reportJsonPath,
    kpis: finalReport.kpis,
    hardFailReasons: finalReport.hardFailReasons
  }, null, 2));
}

withPipelineLock('final_acceptance', main).catch((error) => {
  console.error('final_acceptance_run failed:', error);
  process.exit(1);
});
