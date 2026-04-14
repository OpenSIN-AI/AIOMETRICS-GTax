# Context Fulltext

- source_path: src/db/googleSheetsService.ts
- source_sha256: f0dfc991aec284a86c0f43b83444bd33e3e58c3a987b0c97f35020c3071aa3fc
- chunk: 1/5

```text
import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BelegRecord {
  id: string;
  drive_file_id: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  category: string;
  extracted_text?: string;
  ocr_text?: string;
  image_description?: string;
  tags: string;
  metadata: string;
  confidence: number;
  source_folder_id: string;
  source_folder_url?: string;
  target_folder_id: string;
  target_folder_url?: string;
  analyzed_at: string;
  moved_at?: string;
  file_url: string;
}

export interface CategoryFolder {
  category: string;
  folder_id: string;
  folder_name: string;
}

export interface ArchivRecord {
  drive_file_id: string;
  original_name: string;
  file_url: string;
  archived_reason: string;
  archived_at: string;
}

export interface AuditMutationRecord {
  run_id: string;
  timestamp: string;
  action: string;
  target: string;
  drive_file_id: string;
  before_json: string;
  after_json: string;
  reason: string;
}

export interface SheetGovernanceFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  code: string;
  tab: string;
  message: string;
  detail?: string;
}

export interface SheetGovernanceResult {
  ok: boolean;
  expectedYears: string[];
  requiredTabs: string[];
  presentTabs: string[];
  findings: SheetGovernanceFinding[];
  dashboardGate?: {
    ok: boolean;
    formulaDriftCount: number;
    valueDriftCount: number;
  };
}

export interface AuditSchemaMigrationResult {
  migrated: boolean;
  canonicalSheetTitle: string;
  legacySheetTitle?: string;
  previousHeader: string[];
  canonicalHeader: string[];
}

export interface YearlyTabRow {
  rowNumber: number;
  drive_file_id: string;
  raw: string[];
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

export class GoogleSheetsService {
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;
  private processingLogHeadersEnsured = false;
  private categoryFolderHeadersEnsured = false;
  private auditHeadersEnsured = false;
  private readonly sheetsRequestTimeoutMs = parsePositiveInt(process.env.GSHEETS_REQUEST_TIMEOUT_MS, 30000);
  private readonly sheetsMaxRetries = parsePositiveInt(process.env.GSHEETS_MAX_RETRIES, 6);
  private readonly sheetsRetryBaseMs = parsePositiveInt(process.env.GSHEETS_RETRY_BASE_MS, 2000);
  private readonly sheetsEventsPath = process.env.GSHEETS_EVENTS_PATH || path.join(process.cwd(), 'logs', 'google_sheets_events.jsonl');
  private readonly belegeHeaders = [
    'id', 'drive_file_id', 'original_name', 'mime_type', 'file_size',
    'category', 'extracted_text', 'ocr_text', 'image_description',
    'tags', 'metadata', 'confidence', 'source_folder_id', 'source_folder_url',
    'target_folder_id', 'target_folder_url', 'analyzed_at', 'moved_at', 'file_url'
  ];
  private readonly archivHeaders = [
    'drive_file_id', 'original_name', 'file_url', 'archived_reason', 'archived_at'
  ];
  private readonly auditHeaders = [
    'run_id',
    'timestamp',
    'action',
    'target',
    'drive_file_id',
    'before_json',
    'after_json',
    'reason'
  ];
  private readonly yearlyAccountingHeaders = [
    // CSV-compatible core columns
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
    // Extended accounting/search columns
    'drive_file_id',
    'file_url',
    'beleg_id',
    'kunde',
    'leistungsdatum',
    'mwst_19_betrag',
    'mwst_7_betrag',
    'mwst_0_betrag',
    'geschaeftliche_mwst',
    'private_mwst',
    'geschaeftlicher_anteil_brutto',
    'privater_anteil_brutto',
    'sollkonto',
    'habenkonto',
    'iban',
    'bic',
    'bankleitzahl',
    'line_items_json',
    'source_folder_id',
    'target_folder_id',
    'analyzed_at',
    'dateiname_original',
    'dateiname_standardisiert',
    'extracted_text',
    'ocr_text',
    'metadata'
  ];
  
  constructor(private credentialsPath: [REDACTED]
    const auth = new JWT({
      keyFile: [REDACTED]
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ]
    });
    
    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = spreadsheetId;
  }

  private logApiEvent(event: string, payload: Record<string, unknown> = {}): void {
    try {
      fs.mkdirSync(path.dirname(this.sheetsEventsPath), { recursive: true });
      fs.appendFileSync(
        this.sheetsEventsPath,
        JSON.stringify({
          ts: new Date().toISOString(),
          event,
          spreadsheetId: this.spreadsheetId,
          ...payload
        }) + '\n',
        'utf8'
      );
    } catch {
      // Telemetry must never break production flows.
    }
  }

  private extractApiError(error: unknown): { status: number; code: string; reason: string; message: string } {
    const err = (error || {}) as ApiErrorLike;
    const status = Number(err.response?.status || err.code || 0);
    const code = String(err.code || '');
    const reason =
      String(err.errors?.[0]?.reason || '') ||
      String(err.response?.data?.error?.errors?.[0]?.reason || '');
    const message = String(
      err.response?.data?.error?.message ||
      err.message ||
      ''
    );
    return { status, code, reason, message };
  }

  private isRetryableSheetsError(error: unknown): boolean {
    const { status, code, reason, message } = this.extractApiError(error);
    if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) {
      return true;
    }
    if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE'].includes(code)) {
      return true;
    }
    if (['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError', 'internalError'].includes(reason)) {
      return true;
    }
    const msg = message.toLowerCase();
    return msg.includes('timeout') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('backend error');
  }

  private withTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
    if (this.sheetsRequestTimeoutMs <= 0) {
      return promise;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${operation}: timeout after ${this.sheetsRequestTimeoutMs}ms`));
      }, this.sheetsRequestTimeoutMs);
      timer.unref();
      promise.then((value) => {
        clearTimeout(timer);
        resolve(value);
      }).catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private async runWithRateLimitRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
    const maxAttempts = Math.max(1, this.sheetsMaxRetries);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      try {
        const result = await this.withTimeout(fn(), operation);
        this.logApiEvent('api_ok', {
          operation,
          attempt,
          durationMs: Date.now() - started
        });
        return result;
      } catch (error: unknown) {
        const meta = this.extractApiError(error);
        const retryable = this.isRetryableSheetsError(error);
        const lastAttempt = attempt >= maxAttempts;
        this.logApiEvent('api_error', {
          operation,
          attempt,
          durationMs: Date.now() - started,
          retryable,
          status: meta.status,
          code: meta.code,
          reason: meta.reason,
          message: meta.message
        });
        if (!retryable || lastAttempt) {
          throw error;
        }
        const jitterMs = Math.floor(Math.random() * 300);
        const delayMs = Math.min(20000, this.sheetsRetryBaseMs * attempt + jitterMs);
        console.warn(`${operation}: retry ${attempt}/${maxAttempts} in ${delayMs}ms (${meta.message || meta.reason || meta.code || meta.status})`);
        await sleep(delayMs);
      }
    }
    throw new Error(`${operation}: exhausted retries`);
  }
  
  async init(): Promise<void> {
    try {
      await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
      console.log('Spreadsheet found');
    } catch (error: any) {
      const status = error?.response?.status || error?.code;

      if (status === 404) {
        console.log('Creating new spreadsheet...');
        const spreadsheet = await this.sheets.spreadsheets.create({
          requestBody: {
            properties: { title: 'Jerry Belege - AI Analyse' },
            sheets: [
              { properties: { title: 'belege' } },
              { properties: { title: 'category_folders' } },
              { properties: { title: 'processing_log' } }
            ]
          }
        });
        this.spreadsheetId = spreadsheet.data.spreadsheetId || '';
        console.log(`Created spreadsheet: ${this.spreadsheetId}`);
      } else {
        const reason = error?.response?.data?.error?.message || error?.message || 'Unknown error';
        throw new Error(`Cannot access spreadsheet ${this.spreadsheetId}: ${reason}`);
      }
    }
    
    await this.ensureRequiredSheets();
    await this.ensureHeaders();
  }

  private async ensureRequiredSheets(): Promise<void> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties.title'
    });

    const existingTitles = new Set(
      (response.data.sheets || [])
        .map((sheet) => sheet.properties?.title)
        .filter((title): title is string => Boolean(title))
    );

    const requiredTitles = ['belege', 'category_folders', 'processing_log', 'Archiv', 'sync_state', 'Audit_Tabellen'];
    const missingTitles = requiredTitles.filter((title) => !existingTitles.has(title));

    if (missingTitles.length === 0) {
      return;
    }

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: missingTitles.map((title) => ({
          addSheet: {
            properties: { title }
          }
        }))
      }
    });
  }
  
  private async ensureHeaders(): Promise<void> {
    const belegeResult = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'belege!1:1'
    });
    
    if (!belegeResult.data.values || belegeResult.data.values.length === 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'belege!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [this.belegeHeaders] }
      });
    }

    const archivResult = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Archiv!1:1'
    });

    if (!archivResult.data.values || archivResult.data.values.length === 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Archiv!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [this.archivHeaders] }
      });
    }

    const stateResult = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'sync_state!1:1'
    });

    if (!stateResult.data.values || stateResult.data.values.length === 0) {
      await this.sheets.s
```
