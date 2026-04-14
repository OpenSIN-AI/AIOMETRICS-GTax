# Context Fulltext

- source_path: src/db/googleSheetsService.ts
- source_sha256: f0dfc991aec284a86c0f43b83444bd33e3e58c3a987b0c97f35020c3071aa3fc
- chunk: 4/5

```text
ata.sheets || []) {
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
      row.geschaeftlicher_anteil
```
