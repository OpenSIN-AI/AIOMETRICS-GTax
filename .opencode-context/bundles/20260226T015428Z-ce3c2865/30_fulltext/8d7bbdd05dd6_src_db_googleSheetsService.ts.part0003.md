# Context Fulltext

- source_path: src/db/googleSheetsService.ts
- source_sha256: f0dfc991aec284a86c0f43b83444bd33e3e58c3a987b0c97f35020c3071aa3fc
- chunk: 3/5

```text
RunId(): Promise<string | null> {
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
    for (const sheet of spreadsheet.d
```
