import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';

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

export class GoogleSheetsService {
  private sheets: sheets_v4.Sheets;
  private spreadsheetId: string;
  private processingLogHeadersEnsured = false;
  private categoryFolderHeadersEnsured = false;
  private auditHeadersEnsured = false;
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
  
  constructor(private credentialsPath: string, spreadsheetId: string) {
    const auth = new JWT({
      keyFile: credentialsPath,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ]
    });
    
    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = spreadsheetId;
  }

  private async runWithRateLimitRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
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
        if (!rateLimited || attempt === maxAttempts) {
          throw error;
        }
        const delayMs = attempt * 5000;
        console.warn(`${operation}: rate limited, retry ${attempt}/${maxAttempts} in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
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
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'sync_state!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['drive_file_id']] }
      });
    }

    const categoryFoldersResult = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'category_folders!1:1'
    });
    if (!categoryFoldersResult.data.values || categoryFoldersResult.data.values.length === 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'category_folders!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['category', 'folder_id', 'folder_name']] }
      });
    }

    const processingLogResult = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'processing_log!1:1'
    });
    if (!processingLogResult.data.values || processingLogResult.data.values.length === 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'processing_log!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['drive_file_id', 'action', 'status', 'message', 'created_at']] }
      });
    }

    const auditResult = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Audit_Tabellen!1:1'
    });

    if (!auditResult.data.values || auditResult.data.values.length === 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Audit_Tabellen!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [this.auditHeaders] }
      });
    }
  }

  async ensureCanonicalAuditTable(): Promise<AuditSchemaMigrationResult> {
    await this.ensureRequiredSheets();

    const metadata = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'sheets.properties.sheetId,sheets.properties.title'
      }),
      'ensureCanonicalAuditTable.meta'
    );
    const sheetsMeta = metadata.data.sheets || [];
    const canonicalSheet = sheetsMeta.find((s) => s.properties?.title === 'Audit_Tabellen');

    const canonicalHeader = [...this.auditHeaders];
    if (!canonicalSheet?.properties?.sheetId) {
      await this.runWithRateLimitRetry(
        () => this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: 'Audit_Tabellen' } } }]
          }
        }),
        'ensureCanonicalAuditTable.create'
      );
      await this.runWithRateLimitRetry(
        () => this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: 'Audit_Tabellen!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [canonicalHeader] }
        }),
        'ensureCanonicalAuditTable.header.create'
      );
      return {
        migrated: true,
        canonicalSheetTitle: 'Audit_Tabellen',
        previousHeader: [],
        canonicalHeader
      };
    }

    const headerRead = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Audit_Tabellen!1:1'
      }),
      'ensureCanonicalAuditTable.header.read'
    );
    const previousHeader = (headerRead.data.values?.[0] || []).map((h) => String(h || '').trim());
    const isCanonical =
      previousHeader.length >= canonicalHeader.length &&
      canonicalHeader.every((h, i) => previousHeader[i] === h);
    if (isCanonical) {
      return {
        migrated: false,
        canonicalSheetTitle: 'Audit_Tabellen',
        previousHeader,
        canonicalHeader
      };
    }

    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const legacySheetTitle = `Audit_Tabellen_Legacy_${timestamp}`.slice(0, 95);
    const oldSheetId = canonicalSheet.properties.sheetId;
    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: oldSheetId,
                  title: legacySheetTitle
                },
                fields: 'title'
              }
            },
            {
              addSheet: {
                properties: { title: 'Audit_Tabellen' }
              }
            }
          ]
        }
      }),
      'ensureCanonicalAuditTable.migrate.renameCreate'
    );

    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'Audit_Tabellen!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [canonicalHeader] }
      }),
      'ensureCanonicalAuditTable.migrate.header'
    );

    await this.appendAuditMutations([
      {
        run_id: 'schema-migration',
        timestamp: new Date().toISOString(),
        action: 'AUDIT_SCHEMA_MIGRATION',
        target: 'Audit_Tabellen',
        drive_file_id: '',
        before_json: JSON.stringify({ previousHeader }),
        after_json: JSON.stringify({ canonicalHeader, legacySheetTitle }),
        reason: 'AUDIT_SCHEMA_MIGRATION'
      }
    ]);

    return {
      migrated: true,
      canonicalSheetTitle: 'Audit_Tabellen',
      legacySheetTitle,
      previousHeader,
      canonicalHeader
    };
  }
  
  async saveBeleg(record: Partial<BelegRecord>): Promise<void> {
    const row = this.recordToRow(record);
    
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'belege',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
  }
  
  async getAllBelege(): Promise<BelegRecord[]> {
    const result = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'belege'
      }),
      'getAllBelege.read'
    );
    
    const rows = result.data.values || [];
    if (rows.length <= 1) return [];
    
    const headers = rows[0];
    return rows.slice(1).map(row => {
      const obj: any = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj as BelegRecord;
    });
  }
  
  async getBelegByDriveId(driveFileId: string): Promise<BelegRecord | null> {
    const all = await this.getAllBelege();
    return all.find(b => b.drive_file_id === driveFileId) || null;
  }
  
  async getBelegeByCategory(category: string): Promise<BelegRecord[]> {
    const all = await this.getAllBelege();
    return all.filter(b => b.category === category);
  }
  
  async markAsMoved(driveFileId: string, targetFolderId: string): Promise<void> {
    const all = await this.getAllBelege();
    const index = all.findIndex(b => b.drive_file_id === driveFileId);
    
    if (index >= 0) {
      const row = index + 2;

      const targetFolderUrl = `https://drive.google.com/drive/folders/${targetFolderId}`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `belege!O${row}:R${row}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            targetFolderId,
            targetFolderUrl,
            new Date().toISOString(),
            (all[index] as any).file_url || ''
          ]]
        }
      });
    }
  }
  
  async logProcessing(driveFileId: string, action: string, status: string, message?: string): Promise<void> {
    if (!this.processingLogHeadersEnsured) {
      const result = await this.runWithRateLimitRetry(
        () => this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: 'processing_log!1:1'
        }),
        'logProcessing.header.read'
      );
      
      if (!result.data.values || result.data.values.length === 0) {
        await this.runWithRateLimitRetry(
          () => this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: 'processing_log!A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [['drive_file_id', 'action', 'status', 'message', 'created_at']] }
          }),
          'logProcessing.header.update'
        );
      }
      
      this.processingLogHeadersEnsured = true;
    }
    
    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'processing_log',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[driveFileId, action, status, message || '', new Date().toISOString()]] }
      }),
      'logProcessing.append'
    );
  }

  async appendAuditMutations(records: AuditMutationRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.ensureAuditHeader();
    const rows = records.map((r) => [
      r.run_id,
      r.timestamp,
      r.action,
      r.target,
      r.drive_file_id,
      r.before_json,
      r.after_json,
      r.reason
    ]);
    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Audit_Tabellen',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      }),
      'appendAuditMutations.append'
    );
    await this.applyStandardSheetFormatting('Audit_Tabellen', this.auditHeaders.length, rows.length + 1, 5);
  }

  private async ensureAuditHeader(): Promise<void> {
    if (this.auditHeadersEnsured) {
      return;
    }
    const auditResult = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Audit_Tabellen!1:1'
      }),
      'ensureAuditHeader.read'
    );
    const existing = (auditResult.data.values?.[0] || []).map((h) => String(h || '').trim());
    const expected = this.auditHeaders.map((h) => String(h || '').trim());
    const ok = existing.length >= expected.length && expected.every((h, i) => existing[i] === h);
    if (!ok) {
      await this.runWithRateLimitRetry(
        () => this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: 'Audit_Tabellen!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [this.auditHeaders] }
        }),
        'ensureAuditHeader.write'
      );
    }
    this.auditHeadersEnsured = true;
  }

  async getAuditMutationsByRunId(runId: string): Promise<AuditMutationRecord[]> {
    const result = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Audit_Tabellen'
      }),
      'getAuditMutationsByRunId.read'
    );
    const rows = result.data.values || [];
    if (rows.length <= 1) return [];

    const headers = rows[0];
    const iRun = headers.indexOf('run_id');
    const iTs = headers.indexOf('timestamp');
    const iAction = headers.indexOf('action');
    const iTarget = headers.indexOf('target');
    const iDrive = headers.indexOf('drive_file_id');
    const iBefore = headers.indexOf('before_json');
    const iAfter = headers.indexOf('after_json');
    const iReason = headers.indexOf('reason');

    return rows
      .slice(1)
      .filter((row) => (row[iRun] || '') === runId)
      .map((row) => ({
        run_id: row[iRun] || '',
        timestamp: row[iTs] || '',
        action: row[iAction] || '',
        target: row[iTarget] || '',
        drive_file_id: row[iDrive] || '',
        before_json: row[iBefore] || '',
        after_json: row[iAfter] || '',
        reason: row[iReason] || ''
      }));
  }

  async getLatestReconcileRunId(): Promise<string | null> {
    const result = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'processing_log'
      }),
      'getLatestReconcileRunId.read'
    );
    const rows = result.data.values || [];
    if (rows.length <= 1) return null;

    const headers = rows[0];
    const iAction = headers.indexOf('action');
    const iMessage = headers.indexOf('message');
    for (let i = rows.length - 1; i >= 1; i--) {
      const row = rows[i];
      if ((row[iAction] || '') !== 'reconcile_audit') continue;
      const message = String(row[iMessage] || '');
      const match = /run=([0-9a-f-]{36})/i.exec(message);
      if (match) return match[1];
    }
    return null;
  }

  async getAuditMutationCount(): Promise<number> {
    const result = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Audit_Tabellen!A2:A'
      }),
      'getAuditMutationCount.read'
    );
    return (result.data.values || []).length;
  }

  async listYearlyTabs(): Promise<string[]> {
    const metadata = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'sheets.properties.title'
      }),
      'listYearlyTabs.meta'
    );
    return (metadata.data.sheets || [])
      .map((sheet) => sheet.properties?.title || '')
      .filter((title) => /^(Einnahmen|Ausgaben)_\d{4}$/.test(title))
      .sort();
  }

  async readYearlyRows(tabTitle: string): Promise<YearlyTabRow[]> {
    const result = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: tabTitle
      }),
      `readYearlyRows.${tabTitle}`
    );
    const values = result.data.values || [];
    if (values.length <= 1) return [];
    const headers = values[0];
    const driveIdx = headers.indexOf('drive_file_id');
    if (driveIdx < 0) return [];
    return values
      .slice(1)
      .map((row, i) => ({
        rowNumber: i + 2,
        drive_file_id: row[driveIdx] || '',
        raw: row
      }))
      .filter((row) => Boolean(row.drive_file_id));
  }

  async checkSheetGovernance(expectedYears: string[] = []): Promise<SheetGovernanceResult> {
    await this.ensureRequiredSheets();
    await this.ensureHeaders();

    const metadata = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'sheets.properties.title,sheets.properties.gridProperties.frozenRowCount'
      }),
      'checkSheetGovernance.meta'
    );

    const tabProps = (metadata.data.sheets || [])
      .map((sheet) => ({
        title: sheet.properties?.title || '',
        frozenRowCount: sheet.properties?.gridProperties?.frozenRowCount || 0
      }))
      .filter((entry) => Boolean(entry.title));
    const presentTabs = tabProps.map((entry) => entry.title).sort();
    const findings: SheetGovernanceFinding[] = [];

    const requiredTabs = ['belege', 'processing_log', 'Audit_Tabellen', 'category_folders'];
    for (const year of expectedYears) {
      requiredTabs.push(`Einnahmen_${year}`);
      requiredTabs.push(`Ausgaben_${year}`);
    }

    for (const tab of requiredTabs) {
      if (!presentTabs.includes(tab)) {
        findings.push({
          severity: 'CRITICAL',
          code: 'MISSING_REQUIRED_TAB',
          tab,
          message: `Required tab missing: ${tab}`
        });
      }
    }

    const frozenCheckTabs = ['belege', 'processing_log', 'Audit_Tabellen', 'category_folders'];
    for (const tabName of frozenCheckTabs) {
      const props = tabProps.find((entry) => entry.title === tabName);
      if (props && props.frozenRowCount < 1) {
        findings.push({
          severity: 'HIGH',
          code: 'HEADER_NOT_FROZEN',
          tab: tabName,
          message: 'Header row is not frozen'
        });
      }
    }

    const headerChecks: Array<{ tab: string; expected: string[] }> = [
      { tab: 'belege', expected: this.belegeHeaders },
      { tab: 'processing_log', expected: ['drive_file_id', 'action', 'status', 'message', 'created_at'] },
      { tab: 'Audit_Tabellen', expected: this.auditHeaders },
      { tab: 'category_folders', expected: ['category', 'folder_id', 'folder_name'] }
    ];
    for (const check of headerChecks) {
      if (!presentTabs.includes(check.tab)) continue;
      const headerRes = await this.runWithRateLimitRetry(
        () => this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: `${check.tab}!1:1`
        }),
        `checkSheetGovernance.header.${check.tab}`
      );
      const actual = (headerRes.data.values?.[0] || []).map((h) => String(h || '').trim());
      const expected = check.expected.map((h) => String(h || '').trim());
      if (actual.length < expected.length || expected.some((value, idx) => (actual[idx] || '') !== value)) {
        const isCriticalAuditHeader = check.tab === 'Audit_Tabellen';
        findings.push({
          severity: isCriticalAuditHeader ? 'CRITICAL' : 'HIGH',
          code: isCriticalAuditHeader ? 'AUDIT_HEADER_MISMATCH' : 'HEADER_MISMATCH',
          tab: check.tab,
          message: 'Header sequence does not match expected contract',
          detail: `expected=${expected.join('|')}, actual=${actual.join('|')}`
        });
      }
    }

    if (expectedYears.length > 0) {
      const expectedYearTabs = new Set<string>();
      for (const year of expectedYears) {
        expectedYearTabs.add(`Einnahmen_${year}`);
        expectedYearTabs.add(`Ausgaben_${year}`);
      }
      const unknownGenerated = presentTabs.filter(
        (tab) => /^(Einnahmen|Ausgaben)_\d{4}$/.test(tab) && !expectedYearTabs.has(tab)
      );
      for (const tab of unknownGenerated) {
        findings.push({
          severity: 'CRITICAL',
          code: 'UNEXPECTED_GENERATED_YEAR_TAB',
          tab,
          message: 'Generated year tab is outside expected year scope'
        });
      }
    }

    const obsoleteLegacyGenerated = presentTabs.filter((tab) => /^(Belege|Rechnungen)_\d{4}$/.test(tab));
    for (const tab of obsoleteLegacyGenerated) {
      findings.push({
        severity: 'MEDIUM',
        code: 'LEGACY_GENERATED_TAB',
        tab,
        message: 'Legacy generated tab naming still present'
      });
    }

    const hasCritical = findings.some((finding) => finding.severity === 'CRITICAL');
    return {
      ok: !hasCritical,
      expectedYears,
      requiredTabs,
      presentTabs,
      findings
    };
  }
  
  async saveCategoryFolder(category: string, folderId: string, folderName: string): Promise<void> {
    if (!this.categoryFolderHeadersEnsured) {
      const result = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'category_folders!1:1'
      });
      
      if (!result.data.values || result.data.values.length === 0) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: 'category_folders!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['category', 'folder_id', 'folder_name']] }
        });
      }
      
      this.categoryFolderHeadersEnsured = true;
    }
    
    const all = await this.getAllCategoryFolders();
    const existing = all.find(c => c.category === category);
    
    if (existing) {
      const index = all.indexOf(existing) + 2;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `category_folders!A${index}:C${index}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[category, folderId, folderName]] }
      });
    } else {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'category_folders',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[category, folderId, folderName]] }
      });
    }
  }
  
  async getCategoryFolder(category: string): Promise<CategoryFolder | null> {
    const all = await this.getAllCategoryFolders();
    return all.find(c => c.category === category) || null;
  }
  
  async getAllCategoryFolders(): Promise<CategoryFolder[]> {
    const result = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'category_folders'
      }),
      'getAllCategoryFolders.read'
    );
    
    const rows = result.data.values || [];
    if (rows.length <= 1) return [];
    
    const headers = rows[0];
    return rows.slice(1).map(row => {
      const obj: any = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj as CategoryFolder;
    });
  }
  
  getSpreadsheetUrl(): string {
    return `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}`;
  }

  async enforceBestPracticeTabs(): Promise<void> {
    await this.ensureRequiredSheets();
    await this.ensureHeaders();

    await this.applyStandardSheetFormatting('belege', this.belegeHeaders.length, Math.max(2, (await this.getAllBelege()).length + 1), 2);
    await this.applyStandardSheetFormatting('Audit_Tabellen', this.auditHeaders.length, 2, 5);
    await this.applyStandardSheetFormatting('category_folders', 3, Math.max(2, (await this.getAllCategoryFolders()).length + 1), 1);
    await this.applyStandardSheetFormatting('processing_log', 5, 2, 3);
  }

  async replaceAllBelege(records: Partial<BelegRecord>[]): Promise<void> {
    await this.ensureHeaders();

    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: 'belege!A2:Z'
      }),
      'replaceAllBelege.clear'
    );

    if (records.length === 0) {
      await this.applyStandardSheetFormatting('belege', this.belegeHeaders.length, 1, 2);
      return;
    }

    const rows = records.map((record) => this.recordToRow(record));

    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'belege!A2',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      }),
      'replaceAllBelege.update'
    );

    await this.applyStandardSheetFormatting('belege', this.belegeHeaders.length, Math.max(1, rows.length + 1), 2);
  }

  async syncYearlySheets(records: Partial<BelegRecord>[]): Promise<void> {
    const buchhaltungRows = await this.getBuchhaltungDbRows();
    if (buchhaltungRows.length === 0) {
      await this.syncYearlySheetsLegacy(records);
      return;
    }

    const belegeByDriveId = new Map<string, Partial<BelegRecord>>();
    for (const record of records) {
      const driveId = record.drive_file_id || '';
      if (driveId) {
        belegeByDriveId.set(driveId, record);
      }
    }

    const grouped = new Map<string, string[][]>();
    const yearSet = new Set<string>();

    for (const row of buchhaltungRows) {
      const driveId = row.drive_file_id || '';
      const fallback = driveId ? belegeByDriveId.get(driveId) : undefined;
      const year = this.extractYearFromAccountingRow(row, fallback);
      const cashflow = this.detectCashflowTypeFromAccountingRow(row, fallback);
      const key = `${cashflow}_${year}`;
      yearSet.add(year);
      const existing = grouped.get(key) || [];
      existing.push(this.accountingRowToYearlyRow(row, fallback));
      grouped.set(key, existing);
    }

    const years = Array.from(yearSet).sort();

    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    });

    const sheetsByTitle = new Map<string, number>();
    for (const sheet of spreadsheet.data.sheets || []) {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      if (title && typeof sheetId === 'number') {
        sheetsByTitle.set(title, sheetId);
      }
    }

    const expectedTitles = new Set<string>();
    for (const year of years) {
      expectedTitles.add(`Einnahmen_${year}`);
      expectedTitles.add(`Ausgaben_${year}`);
    }

    const staleGeneratedSheets = Array.from(sheetsByTitle.entries())
      .filter(([title]) => /^(Belege|Rechnungen|Einnahmen|Ausgaben)_\d{4}$/.test(title) && !expectedTitles.has(title));

    if (staleGeneratedSheets.length > 0) {
      await this.runWithRateLimitRetry(
        () => this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: staleGeneratedSheets.map(([, sheetId]) => ({
              deleteSheet: { sheetId }
            }))
          }
        }),
        'syncYearlySheets.deleteStale'
      );
    }

    for (const year of years) {
      await this.upsertYearSheetRows(
        sheetsByTitle,
        `Einnahmen_${year}`,
        this.yearlyAccountingHeaders,
        grouped.get(`Einnahmen_${year}`) || [],
        11
      );

      await this.upsertYearSheetRows(
        sheetsByTitle,
        `Ausgaben_${year}`,
        this.yearlyAccountingHeaders,
        grouped.get(`Ausgaben_${year}`) || [],
        11
      );
    }
  }

  private async syncYearlySheetsLegacy(records: Partial<BelegRecord>[]): Promise<void> {
    const years = Array.from(new Set(records.map((record) => this.extractYear(record))))
      .filter((year) => Boolean(year))
      .sort();

    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    });

    const sheetsByTitle = new Map<string, number>();
    for (const sheet of spreadsheet.data.sheets || []) {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      if (title && typeof sheetId === 'number') {
        sheetsByTitle.set(title, sheetId);
      }
    }

    const expectedTitles = new Set<string>();
    for (const year of years) {
      expectedTitles.add(`Einnahmen_${year}`);
      expectedTitles.add(`Ausgaben_${year}`);
    }

    const staleGeneratedSheets = Array.from(sheetsByTitle.entries())
      .filter(([title]) => /^(Belege|Rechnungen|Einnahmen|Ausgaben)_\d{4}$/.test(title) && !expectedTitles.has(title));

    if (staleGeneratedSheets.length > 0) {
      await this.runWithRateLimitRetry(
        () => this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: staleGeneratedSheets.map(([, sheetId]) => ({
              deleteSheet: { sheetId }
            }))
          }
        }),
        'syncYearlySheetsLegacy.deleteStale'
      );
    }

    for (const year of years) {
      await this.upsertYearSheetRows(
        sheetsByTitle,
        `Einnahmen_${year}`,
        this.belegeHeaders,
        records
          .filter((record) => this.extractYear(record) === year && this.detectCashflowType(record) === 'Einnahmen')
          .map((record) => this.recordToRow(record)),
        2
      );

      await this.upsertYearSheetRows(
        sheetsByTitle,
        `Ausgaben_${year}`,
        this.belegeHeaders,
        records
          .filter((record) => this.extractYear(record) === year && this.detectCashflowType(record) === 'Ausgaben')
          .map((record) => this.recordToRow(record)),
        2
      );
    }
  }

  private async upsertYearSheetRows(
    sheetsByTitle: Map<string, number>,
    title: string,
    headers: string[],
    bodyRows: string[][],
    wideColumnIndex: number
  ): Promise<void> {
    let sheetId = sheetsByTitle.get(title);
    const wasExisting = sheetsByTitle.has(title);
    if (!wasExisting) {
      const createResponse = await this.runWithRateLimitRetry(
        () => this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              { addSheet: { properties: { title } } }
            ]
          }
        }),
        `upsertYearSheet.create.${title}`
      );

      const createdSheetId = createResponse.data.replies?.[0]?.addSheet?.properties?.sheetId;
      if (typeof createdSheetId === 'number') {
        sheetsByTitle.set(title, createdSheetId);
        sheetId = createdSheetId;
      }
    }

    if (typeof sheetId !== 'number') {
      throw new Error(`Could not determine sheetId for ${title}`);
    }

    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: `${title}!A:ZZ`
      }),
        `upsertYearSheet.clear.${title}`
      );

    const rows = [headers, ...bodyRows];

    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${title}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      }),
      `upsertYearSheet.update.${title}`
    );

    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId,
                  gridProperties: { frozenRowCount: 1 }
                },
                fields: 'gridProperties.frozenRowCount'
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: headers.length
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true }
                  }
                },
                fields: 'userEnteredFormat.textFormat.bold'
              }
            },
            {
              setBasicFilter: {
                filter: {
                  range: {
                    sheetId,
                    startRowIndex: 0,
                    endRowIndex: Math.max(1, rows.length),
                    startColumnIndex: 0,
                    endColumnIndex: headers.length
                  }
                }
              }
            },
            {
              updateDimensionProperties: {
                range: {
                  sheetId,
                  dimension: 'COLUMNS',
                  startIndex: wideColumnIndex,
                  endIndex: wideColumnIndex + 1
                },
                properties: { pixelSize: 300 },
                fields: 'pixelSize'
              }
            }
          ]
        }
      }),
      `upsertYearSheet.format.${title}`
    );
  }

  private async getBuchhaltungDbRows(): Promise<Record<string, string>[]> {
    const result = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Buchhaltung_DB'
      }),
      'getBuchhaltungDbRows.read'
    );
    const rows = result.data.values || [];
    if (rows.length <= 1) return [];
    const headers = rows[0].map((h) => String(h || '').trim());
    const out: Record<string, string>[] = [];
    for (const row of rows.slice(1)) {
      const obj: Record<string, string> = {};
      let hasAny = false;
      headers.forEach((header, i) => {
        const value = String(row[i] || '');
        obj[header] = value;
        if (value) hasAny = true;
      });
      if (hasAny) out.push(obj);
    }
    return out;
  }

  private parseAmount(value: string): number {
    const raw = String(value || '').trim();
    const sanitized = raw.replace(/[^\d,.-]/g, '');
    let normalized = sanitized;
    const hasComma = sanitized.includes(',');
    const hasDot = sanitized.includes('.');
    if (hasComma && hasDot) {
      normalized = sanitized.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
      normalized = sanitized.replace(',', '.');
    }
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private formatAmount(value: number): string {
    if (!Number.isFinite(value)) return '';
    return value.toFixed(2);
  }

  private detectMwstSatz(row: Record<string, string>): string {
    const vat19 = this.parseAmount(row.mwst_19_betrag || '');
    const vat7 = this.parseAmount(row.mwst_7_betrag || '');
    const vat0 = this.parseAmount(row.mwst_0_betrag || '');
    if (vat19 > 0 && vat7 > 0) return '19+7';
    if (vat19 > 0) return '19';
    if (vat7 > 0) return '7';
    if (vat0 > 0) return '0';
    return '';
  }

  private extractYearFromAccountingRow(
    row: Record<string, string>,
    fallback?: Partial<BelegRecord>
  ): string {
    const currentYear = new Date().getFullYear();
    const minYear = 2000;
    const maxYear = currentYear + 1;
    const candidates = [
      row.belegdatum || '',
      row.leistungsdatum || '',
      row.analyzed_at || '',
      row.dateiname_original || '',
      row.dateiname_standardisiert || '',
      fallback?.analyzed_at || '',
      fallback?.original_name || ''
    ];

    for (const value of candidates) {
      const iso = /^(\d{4})/.exec(value);
      if (iso) {
        const year = Number.parseInt(iso[1], 10);
        if (year >= minYear && year <= maxYear) return String(year);
      }
      const generic = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(value);
      if (generic) {
        const year = Number.parseInt(generic[1], 10);
        if (year >= minYear && year <= maxYear) return String(year);
      }
    }
    return String(currentYear);
  }

  private detectCashflowTypeFromAccountingRow(
    row: Record<string, string>,
    fallback?: Partial<BelegRecord>
  ): 'Einnahmen' | 'Ausgaben' {
    const belegart = String(row.belegart || '').toLowerCase();
    if (belegart.includes('einnahme')) return 'Einnahmen';
    if (belegart.includes('ausgabe')) return 'Ausgaben';
    if (fallback) return this.detectCashflowType(fallback);
    return 'Ausgaben';
  }

  private extractionNoteFromMetadata(metadata: string): string {
    if (!metadata) return '';
    try {
      const parsed = JSON.parse(metadata);
      return String(parsed.extraction_note || parsed.reason || '');
    } catch {
      return '';
    }
  }

  private accountingRowToYearlyRow(
    row: Record<string, string>,
    fallback?: Partial<BelegRecord>
  ): string[] {
    const vatBusiness = this.parseAmount(row.geschaeftliche_mwst || '');
    const vatFromRates = this.parseAmount(row.mwst_19_betrag || '') + this.parseAmount(row.mwst_7_betrag || '');
    const mwstBetrag = vatBusiness > 0 ? vatBusiness : vatFromRates;
    const reason = row.duplikat_gruppe || this.extractionNoteFromMetadata(fallback?.metadata || '');
    const bemerkung = row.hinweis || '';
    const status = row.status || '';
    const dateiname = row.dateiname_standardisiert || row.dateiname_original || fallback?.original_name || '';

    return [
      row.belegdatum || '',
      row.lieferant || '',
      row.belegnr || '',
      row.belegart || '',
      row.netto_gesamt || '',
      this.detectMwstSatz(row),
      this.formatAmount(mwstBetrag),
      row.brutto_gesamt || '',
      row.steuerkategorie || fallback?.category || '',
      status,
      bemerkung,
      dateiname,
      reason,
      row.drive_file_id || fallback?.drive_file_id || '',
      row.file_url || fallback?.file_url || '',
      row.beleg_id || '',
      row.kunde || '',
      row.leistungsdatum || '',
      row.mwst_19_betrag || '',
      row.mwst_7_betrag || '',
      row.mwst_0_betrag || '',
      row.geschaeftliche_mwst || '',
      row.private_mwst || '',
      row.geschaeftlicher_anteil_brutto || '',
      row.privater_anteil_brutto || '',
      row.sollkonto || '',
      row.habenkonto || '',
      row.iban || '',
      row.bic || '',
      row.bankleitzahl || '',
      row.line_items_json || '',
      row.source_folder_id || fallback?.source_folder_id || '',
      row.target_folder_id || fallback?.target_folder_id || '',
      row.analyzed_at || fallback?.analyzed_at || '',
      row.dateiname_original || fallback?.original_name || '',
      row.dateiname_standardisiert || '',
      fallback?.extracted_text || '',
      fallback?.ocr_text || '',
      fallback?.metadata || ''
    ];
  }

  private extractYear(record: Partial<BelegRecord>): string {
    const currentYear = new Date().getFullYear();
    const minYear = 2000;
    const maxYear = currentYear + 1;

    const validYear = (value: string): string | null => {
      const year = Number(value);
      if (year >= minYear && year <= maxYear) {
        return value;
      }
      return null;
    };

    const candidates = [
      record.original_name || '',
      record.analyzed_at || '',
      record.moved_at || ''
    ];

    for (const value of candidates) {
      const isoYear = /^(\d{4})/.exec(value);
      if (isoYear) {
        const valid = validYear(isoYear[1]);
        if (valid) {
          return valid;
        }
      }

      const genericYear = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(value);
      if (genericYear) {
        const valid = validYear(genericYear[1]);
        if (valid) {
          return valid;
        }
      }
    }

    return currentYear.toString();
  }

  private recordToRow(record: Partial<BelegRecord>): string[] {
    return [
      record.id || '',
      record.drive_file_id || '',
      record.original_name || '',
      record.mime_type || '',
      record.file_size?.toString() || '',
      record.category || '',
      record.extracted_text || '',
      record.ocr_text || '',
      record.image_description || '',
      record.tags || '',
      record.metadata || '',
      record.confidence?.toString() || '',
      record.source_folder_id || '',
      record.source_folder_url || '',
      record.target_folder_id || '',
      record.target_folder_url || '',
      record.analyzed_at || '',
      record.moved_at || '',
      record.file_url || ''
    ];
  }

  async getArchivDriveIds(): Promise<Set<string>> {
    const result = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Archiv!A2:A'
    });
    const ids = (result.data.values || [])
      .map((row) => row[0] || '')
      .filter((id) => Boolean(id));
    return new Set(ids);
  }

  async appendArchivRecords(records: ArchivRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const existingIds = await this.getArchivDriveIds();
    const rows = records
      .filter((record) => !existingIds.has(record.drive_file_id))
      .map((record) => [
        record.drive_file_id,
        record.original_name,
        record.file_url,
        record.archived_reason,
        record.archived_at
      ]);
    if (rows.length === 0) {
      return;
    }
    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Archiv',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      }),
      'appendArchivRecords.append'
    );
  }

  async getSyncStateIds(): Promise<Set<string>> {
    const result = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'sync_state!A2:A'
    });
    const ids = (result.data.values || [])
      .map((row) => row[0] || '')
      .filter((id) => Boolean(id));
    return new Set(ids);
  }

  async setSyncStateIds(ids: string[]): Promise<void> {
    const values = [['drive_file_id'], ...ids.sort().map((id) => [id])];
    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: 'sync_state!A:Z'
      }),
      'setSyncStateIds.clear'
    );
    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: 'sync_state!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
      }),
      'setSyncStateIds.update'
    );
  }

  private detectCashflowType(record: Partial<BelegRecord>): 'Einnahmen' | 'Ausgaben' {
    const content = [
      record.original_name || '',
      record.category || '',
      record.extracted_text || '',
      record.ocr_text || '',
      record.image_description || ''
    ].join(' ').toLowerCase();

    const incomeKeywords = [
      'einnahme', 'gutschrift', 'umsatz', 'erloes', 'erlös',
      'rueckerstattung', 'rückerstattung', 'mieteinnahme', 'income'
    ];
    const expenseKeywords = [
      'ausgabe', 'rechnung', 'quittung', 'kauf', 'bestellung',
      'lieferung', 'zahlung', 'abschlagsrechnung', 'schlussrechnung',
      'invoice', 'receipt', 'expense'
    ];

    const incomeHits = incomeKeywords.filter((k) => content.includes(k)).length;
    const expenseHits = expenseKeywords.filter((k) => content.includes(k)).length;

    if (incomeHits > expenseHits) return 'Einnahmen';
    return 'Ausgaben';
  }

  private async getSheetIdByTitle(title: string): Promise<number> {
    const response = await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: 'sheets.properties.sheetId,sheets.properties.title'
      }),
      `getSheetIdByTitle.${title}`
    );

    for (const sheet of response.data.sheets || []) {
      const sheetTitle = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      if (sheetTitle === title && typeof sheetId === 'number') {
        return sheetId;
      }
    }

    throw new Error(`Sheet not found: ${title}`);
  }

  private async applyStandardSheetFormatting(
    title: string,
    columnCount: number,
    rowCount: number,
    wideColumnIndex: number
  ): Promise<void> {
    const sheetId = await this.getSheetIdByTitle(title);
    const requests: any[] = [
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: 1 }
          },
          fields: 'gridProperties.frozenRowCount'
        }
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: columnCount
          },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 }
            }
          },
          fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor'
        }
      },
      {
        setBasicFilter: {
          filter: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: Math.max(1, rowCount),
              startColumnIndex: 0,
              endColumnIndex: columnCount
            }
          }
        }
      }
    ];

    if (wideColumnIndex >= 0 && wideColumnIndex < columnCount) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: wideColumnIndex,
            endIndex: wideColumnIndex + 1
          },
          properties: { pixelSize: 320 },
          fields: 'pixelSize'
        }
      });
    }

    await this.runWithRateLimitRetry(
      () => this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: { requests }
      }),
      `applyStandardSheetFormatting.${title}`
    );
  }
}
