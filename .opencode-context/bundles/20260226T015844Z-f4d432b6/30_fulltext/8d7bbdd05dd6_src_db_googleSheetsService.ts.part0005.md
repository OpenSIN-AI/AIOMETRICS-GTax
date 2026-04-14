# Context Fulltext

- source_path: src/db/googleSheetsService.ts
- source_sha256: f0dfc991aec284a86c0f43b83444bd33e3e58c3a987b0c97f35020c3071aa3fc
- chunk: 5/5

```text
_brutto || '',
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

```
