# Context Fulltext

- source_path: src/orchestrator/contract_sync_guard.ts
- source_sha256: a97ab7615825395a7d4eaad5c2d0bcc98b3863f49949d1585a9322c52a79f6f2
- chunk: 2/3

```text
ace(/''/g, "'");
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
  const ranges = specs.map((spec) => `${spec.tab}!${spec.cell}`);
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
  addPairCheck('ExpenseKPI', 'Finanz-Cockpit!E5', 'EÜR!B17');
  addPairCheck('ResultKPI', 'Finanz-Cockpit!H5', 'EÜR!B18');

  const q5 = toNum(valueMap.get('Finanz-Cockpit!Q5'));
  const k5 = toNum(valueMap.get('Finanz-Cockpit!K5'));
  const n5 = toNum(valueMap.get('Finanz-Cockpit!N5'));
  valueChecks.push({
    label: 'CockpitSaldoArithmetic',
    leftRef: 'Finanz-Cockpit!Q5',
    rightRef: 'Finanz-Cockpit!K5-N5',
    expected: (k5 - n5).toFixed(2),
    actual: q5.toFixed(2),
    pass: q5.toFixed(2) === (k5 - n5).toFixed(2)
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
    totalSheetOnly:
```
