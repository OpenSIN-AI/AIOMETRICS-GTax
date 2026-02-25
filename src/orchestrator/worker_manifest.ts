export type WorkerRole = 'write' | 'read' | 'ocr' | 'qa';
export type WorkerStatus = 'ACTIVE' | 'LEGACY';
export type MicioProfile = 'core' | 'ocr' | 'qa';

export type WorkerId =
  | 'micro_sync_drive_changes'
  | 'micro_sheet_delete_archive_sync'
  | 'micro_enrich_buchhaltung_db'
  | 'micro_tax_category_assign'
  | 'micro_konto_assign'
  | 'micro_plausibility_duplicate'
  | 'micro_sheet_formula_guard'
  | 'micro_ocr_audit_1nm'
  | 'micro_clean_private_1nm'
  | 'micro_local_118_tesseract_filter'
  | 'micio_scheduler'
  | 'zio_guard_worker'
  | 'aiometrics_worker'
  | 'check_all_years_integrity'
  | 'check_2023_integrity'
  | 'audit_2023_strict'
  | 'repair_2023'
  | 'main_legacy'
  | 'pipeline_sync_legacy'
  | 'soft_audit_legacy'
  | 'yearly_reorganize_legacy'
  | 'accounting_enrichment_legacy'
  | 'micro_reclassify_private_business_legacy'
  | 'micro_reclassify_einnahmen_2023_legacy'
  | 'micro_move_zoe_invoices_legacy';

export interface WorkerDefinition {
  id: WorkerId;
  status: WorkerStatus;
  role: WorkerRole;
  sourcePath: string;
  distEntry?: string;
  requiredEnv: string[];
  defaultTimeoutMs: number;
  defaultBatch?: number;
  micioProfiles?: MicioProfile[];
  riskGated?: boolean;
}

export const WORKER_MANIFEST: WorkerDefinition[] = [
  {
    id: 'micro_sync_drive_changes',
    status: 'ACTIVE',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_sync_drive_changes.ts',
    distEntry: 'dist-micro/orchestrator/micro_sync_drive_changes.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 50000,
    defaultBatch: 40,
    micioProfiles: ['core']
  },
  {
    id: 'micro_sheet_delete_archive_sync',
    status: 'ACTIVE',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_sheet_delete_archive_sync.ts',
    distEntry: 'dist-micro/orchestrator/micro_sheet_delete_archive_sync.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 45000,
    defaultBatch: 30
  },
  {
    id: 'micro_enrich_buchhaltung_db',
    status: 'ACTIVE',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_enrich_buchhaltung_db.ts',
    distEntry: 'dist-micro/orchestrator/micro_enrich_buchhaltung_db.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 90000,
    defaultBatch: 20,
    micioProfiles: ['core']
  },
  {
    id: 'micro_tax_category_assign',
    status: 'ACTIVE',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_tax_category_assign.ts',
    distEntry: 'dist-micro/orchestrator/micro_tax_category_assign.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 60000,
    defaultBatch: 40,
    micioProfiles: ['core']
  },
  {
    id: 'micro_konto_assign',
    status: 'ACTIVE',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_konto_assign.ts',
    distEntry: 'dist-micro/orchestrator/micro_konto_assign.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 60000,
    defaultBatch: 50,
    micioProfiles: ['core']
  },
  {
    id: 'micro_plausibility_duplicate',
    status: 'ACTIVE',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_plausibility_duplicate.ts',
    distEntry: 'dist-micro/orchestrator/micro_plausibility_duplicate.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 60000
  },
  {
    id: 'micro_sheet_formula_guard',
    status: 'ACTIVE',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_sheet_formula_guard.ts',
    distEntry: 'dist-micro/orchestrator/micro_sheet_formula_guard.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 40000,
    micioProfiles: ['core']
  },
  {
    id: 'micro_ocr_audit_1nm',
    status: 'ACTIVE',
    role: 'ocr',
    sourcePath: 'src/orchestrator/micro_ocr_audit_1nm.ts',
    distEntry: 'dist-micro/orchestrator/micro_ocr_audit_1nm.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 100000,
    defaultBatch: 2,
    micioProfiles: ['ocr']
  },
  {
    id: 'micro_clean_private_1nm',
    status: 'ACTIVE',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_clean_private_1nm.ts',
    distEntry: 'dist-micro/orchestrator/micro_clean_private_1nm.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 60000,
    defaultBatch: 2
  },
  {
    id: 'micro_local_118_tesseract_filter',
    status: 'ACTIVE',
    role: 'ocr',
    sourcePath: 'src/orchestrator/micro_local_118_tesseract_filter.ts',
    distEntry: 'dist-micro/orchestrator/micro_local_118_tesseract_filter.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 100000,
    defaultBatch: 5,
    micioProfiles: ['ocr']
  },
  {
    id: 'micio_scheduler',
    status: 'ACTIVE',
    role: 'qa',
    sourcePath: 'src/orchestrator/micio_scheduler.ts',
    distEntry: 'dist-micro/orchestrator/micio_scheduler.js',
    requiredEnv: [],
    defaultTimeoutMs: 170000
  },
  {
    id: 'zio_guard_worker',
    status: 'ACTIVE',
    role: 'qa',
    sourcePath: 'src/orchestrator/zio_guard_worker.ts',
    distEntry: 'dist-micro/orchestrator/zio_guard_worker.js',
    requiredEnv: [],
    defaultTimeoutMs: 30000
  },
  {
    id: 'aiometrics_worker',
    status: 'ACTIVE',
    role: 'qa',
    sourcePath: 'src/orchestrator/aiometrics_worker.ts',
    distEntry: 'dist-micro/orchestrator/aiometrics_worker.js',
    requiredEnv: [],
    defaultTimeoutMs: 30000
  },
  {
    id: 'check_all_years_integrity',
    status: 'ACTIVE',
    role: 'read',
    sourcePath: 'src/orchestrator/check_all_years_integrity.ts',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 120000
  },
  {
    id: 'check_2023_integrity',
    status: 'ACTIVE',
    role: 'read',
    sourcePath: 'src/orchestrator/check_2023_integrity.ts',
    distEntry: 'dist-micro/orchestrator/check_2023_integrity.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 120000,
    micioProfiles: ['qa']
  },
  {
    id: 'audit_2023_strict',
    status: 'ACTIVE',
    role: 'qa',
    sourcePath: 'src/orchestrator/audit_2023_strict.ts',
    distEntry: 'dist-micro/orchestrator/audit_2023_strict.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 60000,
    micioProfiles: ['qa']
  },
  {
    id: 'repair_2023',
    status: 'ACTIVE',
    role: 'write',
    sourcePath: 'src/orchestrator/repair_2023.ts',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 120000,
    defaultBatch: 20,
    riskGated: true
  },
  {
    id: 'main_legacy',
    status: 'LEGACY',
    role: 'write',
    sourcePath: 'src/orchestrator/main.ts',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 300000
  },
  {
    id: 'pipeline_sync_legacy',
    status: 'LEGACY',
    role: 'write',
    sourcePath: 'src/orchestrator/pipeline_sync.ts',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 300000
  },
  {
    id: 'soft_audit_legacy',
    status: 'LEGACY',
    role: 'qa',
    sourcePath: 'src/orchestrator/soft_audit.ts',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 180000
  },
  {
    id: 'yearly_reorganize_legacy',
    status: 'LEGACY',
    role: 'write',
    sourcePath: 'src/orchestrator/yearly_reorganize.ts',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 300000
  },
  {
    id: 'accounting_enrichment_legacy',
    status: 'LEGACY',
    role: 'write',
    sourcePath: 'src/orchestrator/accounting_enrichment.ts',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 300000
  },
  {
    id: 'micro_reclassify_private_business_legacy',
    status: 'LEGACY',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_reclassify_private_business.ts',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 120000
  },
  {
    id: 'micro_reclassify_einnahmen_2023_legacy',
    status: 'LEGACY',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_reclassify_einnahmen_2023.ts',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 120000
  },
  {
    id: 'micro_move_zoe_invoices_legacy',
    status: 'LEGACY',
    role: 'write',
    sourcePath: 'src/orchestrator/micro_move_zoe_invoices.ts',
    distEntry: 'dist-micro/orchestrator/micro_move_zoe_invoices.js',
    requiredEnv: ['GOOGLE_CREDENTIALS_PATH', 'GOOGLE_SHEET_ID'],
    defaultTimeoutMs: 120000
  }
];

export const ACTIVE_WORKERS = WORKER_MANIFEST.filter((w) => w.status === 'ACTIVE');
export const LEGACY_WORKERS = WORKER_MANIFEST.filter((w) => w.status === 'LEGACY');

export const MICIO_PROFILE_WORKERS: Record<MicioProfile, WorkerId[]> = {
  core: [
    'micro_sync_drive_changes',
    'micro_enrich_buchhaltung_db',
    'micro_tax_category_assign',
    'micro_konto_assign',
    'micro_sheet_formula_guard'
  ],
  ocr: [
    'micro_ocr_audit_1nm',
    'micro_local_118_tesseract_filter'
  ],
  qa: [
    'check_2023_integrity',
    'audit_2023_strict'
  ]
};

export function getWorkerDefinition(id: WorkerId): WorkerDefinition {
  const worker = WORKER_MANIFEST.find((entry) => entry.id === id);
  if (!worker) {
    throw new Error(`Unknown worker id: ${id}`);
  }
  return worker;
}

export function getMicioProfileWorkers(profile: MicioProfile): WorkerDefinition[] {
  return MICIO_PROFILE_WORKERS[profile].map((id) => getWorkerDefinition(id));
}
