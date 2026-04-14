# Context Fulltext

- source_path: src/db/googleSheetsService.ts
- source_sha256: f0dfc991aec284a86c0f43b83444bd33e3e58c3a987b0c97f35020c3071aa3fc
- chunk: 2/5

```text
preadsheets.values.update({
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

  async getLatestReconcile
```
