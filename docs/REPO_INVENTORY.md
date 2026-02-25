# Repo Inventory

- Timestamp: 2026-02-25T00:53:53.008Z
- Root: `/Users/jeremy/dev/AIOMETRICS-GTax`

## Counts

- Repo files: 224
- Src files: 100
- Orchestrator files: 37
- Legacy files: 59
- Docs files: 40
- Root TS files: 23

## Scripts

- Total: 57
- Active: 48
- Legacy: 9

## Top Files By Size

| bytes | file |
| ---: | --- |
| 5199098 | eng.traineddata |
| 2070514 | deu.traineddata |
| 215345 | package-lock.json |
| 127492 | logs/pipeline_events.jsonl |
| 48935 | src/orchestrator/repair_2023.ts |
| 41380 | src/legacy/monolith/accounting_enrichment.ts |
| 34691 | src/db/googleSheetsService.ts |
| 33514 | src/legacy/monolith/setup_finance_dashboard.ts |
| 23858 | src/orchestrator/audit_2023_strict.ts |
| 23316 | src/legacy/monolith/soft_audit.ts |
| 22712 | src/legacy/monolith/yearly_reorganize.ts |
| 21621 | docs/MICRO_PRIVATE_RECLASSIFY_REPORT.md |
| 19749 | LASTPLAN.md |
| 17886 | src/legacy/gemini/gemini_ocr_worker.ts |
| 17690 | docs/MICRO_ZOE_MOVE_REPORT.md |
| 17451 | docs/MICRO_CLEAN_PRIVATE_1NM.md |
| 16832 | src/legacy/monolith/main.ts |
| 16384 | .LASTPLAN.md.swp |
| 15961 | logs/micio_core_node.log |
| 14767 | src/orchestrator/check_2023_integrity.ts |
| 14225 | docs/ZOE_SOLAR_RECHNUNGSPLAN_2023.md |
| 13915 | src/orchestrator/micro_local_118_tesseract_filter.ts |
| 13897 | src/orchestrator/check_all_years_integrity.ts |
| 13884 | src/orchestrator/micro_enrich_buchhaltung_db.ts |
| 13525 | src/orchestrator/micro_ocr_audit_1nm.ts |
| 12511 | docs/TANKSTELLEN_SPLIT_2023.md |
| 11954 | src/ai/nvidiaAIClient.ts |
| 10584 | src/orchestrator/micro_sync_drive_changes.ts |
| 10254 | process_belege_gemini.py |
| 10018 | src/orchestrator/run_eigenbeleg_pipeline.ts |

## Top TS Files By Lines

| lines | file |
| ---: | --- |
| 1465 | src/orchestrator/repair_2023.ts |
| 1181 | src/legacy/monolith/accounting_enrichment.ts |
| 1114 | src/db/googleSheetsService.ts |
| 929 | src/legacy/monolith/setup_finance_dashboard.ts |
| 748 | src/legacy/monolith/soft_audit.ts |
| 734 | src/legacy/monolith/yearly_reorganize.ts |
| 705 | src/orchestrator/audit_2023_strict.ts |
| 500 | src/legacy/gemini/gemini_ocr_worker.ts |
| 494 | src/legacy/monolith/main.ts |
| 453 | src/ai/nvidiaAIClient.ts |
| 437 | src/orchestrator/check_2023_integrity.ts |
| 409 | src/orchestrator/check_all_years_integrity.ts |
| 380 | src/orchestrator/micro_ocr_audit_1nm.ts |
| 370 | src/orchestrator/micro_local_118_tesseract_filter.ts |
| 318 | src/orchestrator/micro_enrich_buchhaltung_db.ts |
| 309 | src/orchestrator/micro_sync_drive_changes.ts |
| 293 | src/orchestrator/run_eigenbeleg_pipeline.ts |
| 291 | src/legacy/gemini/gemini_qa_global.ts |
| 282 | src/drive/googleDriveService.ts |
| 281 | src/orchestrator/report_zoe_invoice_gaps_2023.ts |
| 278 | src/orchestrator/pipeline_lock.ts |
| 269 | src/orchestrator/check_2023_policy.ts |
| 268 | src/orchestrator/micro_move_zoe_invoices.ts |
| 246 | src/orchestrator/micro_reclassify_private_business.ts |
| 245 | src/orchestrator/fix_invalid_future_dates.ts |
| 209 | src/orchestrator/micro_swarm_tick.ts |
| 202 | src/orchestrator/setup_eigenbeleg_workflow.ts |
| 201 | src/orchestrator/micro_reclassify_einnahmen_2023.ts |
| 192 | src/routing/fileRouter.ts |
| 191 | src/orchestrator/micro_konto_assign.ts |

## Active Script List

| name | command |
| --- | --- |
| build | tsc -p tsconfig.micro.json |
| build-all | tsc |
| start | npm run -s micio-scheduler |
| accounting-enrichment | npm run -s micro-enrich-buchhaltung-db |
| sync-chain | npm run -s micro-swarm-tick |
| setup-finance-dashboard | npm run -s micro-sheet-formula-guard |
| repair-2023 | node dist/orchestrator/repair_2023.js |
| repair-all-years | bash ./repair_all_years.sh |
| check-2023 | tsx src/orchestrator/check_2023_integrity.ts |
| check-2023-policy | tsx src/orchestrator/check_2023_policy.ts |
| audit-year-strict | tsx src/orchestrator/audit_2023_strict.ts |
| audit-2023-strict | tsx src/orchestrator/audit_2023_strict.ts |
| fix-2023-step1-dedupe | REPAIR_YEAR=2023 REPAIR_STAGE_MAX_MOVES=20 REPAIR_STAGE_RESTORE_ARCHIVE=false REPAIR_STAGE_DEDUPE=true REPAIR_STAGE_MOVE_POLICY=false REPAIR_STAGE_MOVE_FLOW=false REPAIR_STAGE_MOVE_YEAR=false REPAIR_STAGE_REBUILD=false REPAIR_STAGE_PAYMENT_PROOF=false tsx src/orchestrator/repair_2023.ts |
| fix-2023-step2-policy | REPAIR_YEAR=2023 REPAIR_STAGE_MAX_MOVES=20 REPAIR_STAGE_RESTORE_ARCHIVE=false REPAIR_STAGE_DEDUPE=false REPAIR_STAGE_MOVE_POLICY=true REPAIR_STAGE_MOVE_FLOW=false REPAIR_STAGE_MOVE_YEAR=false REPAIR_STAGE_REBUILD=false REPAIR_STAGE_PAYMENT_PROOF=false tsx src/orchestrator/repair_2023.ts |
| fix-2023-step3-flow | REPAIR_YEAR=2023 REPAIR_STAGE_MAX_MOVES=20 REPAIR_STAGE_RESTORE_ARCHIVE=true REPAIR_STAGE_DEDUPE=false REPAIR_STAGE_MOVE_POLICY=false REPAIR_STAGE_MOVE_FLOW=true REPAIR_STAGE_MOVE_YEAR=true REPAIR_STAGE_REBUILD=false REPAIR_STAGE_PAYMENT_PROOF=false tsx src/orchestrator/repair_2023.ts |
| fix-2023-step4-rebuild | REPAIR_YEAR=2023 REPAIR_STAGE_MAX_MOVES=20 REPAIR_STAGE_RESTORE_ARCHIVE=false REPAIR_STAGE_DEDUPE=false REPAIR_STAGE_MOVE_POLICY=false REPAIR_STAGE_MOVE_FLOW=false REPAIR_STAGE_MOVE_YEAR=false REPAIR_STAGE_REBUILD=true REPAIR_STAGE_PAYMENT_PROOF=false tsx src/orchestrator/repair_2023.ts |
| fix-2023-step5-payment-proof | REPAIR_YEAR=2023 REPAIR_STAGE_MAX_MOVES=20 REPAIR_STAGE_RESTORE_ARCHIVE=false REPAIR_STAGE_DEDUPE=false REPAIR_STAGE_MOVE_POLICY=false REPAIR_STAGE_MOVE_FLOW=false REPAIR_STAGE_MOVE_YEAR=false REPAIR_STAGE_REBUILD=false REPAIR_STAGE_PAYMENT_PROOF=true tsx src/orchestrator/repair_2023.ts |
| fix-invalid-future-dates | tsx src/orchestrator/fix_invalid_future_dates.ts |
| fix-2023-modular | npm run fix-2023-step1-dedupe && npm run fix-2023-step2-policy && npm run fix-2023-step3-flow && npm run fix-2023-step4-rebuild && npm run check-2023 && npm run audit-2023-strict |
| report-zoe-2023 | node dist/orchestrator/report_zoe_invoice_gaps_2023.js |
| check-all-years | tsx src/orchestrator/check_all_years_integrity.ts |
| dev | tsx watch src/orchestrator/micio_scheduler.ts |
| test | vitest run --passWithNoTests |
| verify-local | tsx src/orchestrator/verify_local_files.ts |
| cleanup-local | tsx src/orchestrator/cleanup_local_files.ts |
| setup-eigenbeleg-workflow | tsx src/orchestrator/setup_eigenbeleg_workflow.ts |
| run-eigenbeleg-pipeline | tsx src/orchestrator/run_eigenbeleg_pipeline.ts |
| micro-move-zoe-invoices | tsx src/orchestrator/micro_move_zoe_invoices.ts |
| micro-reclassify-private-business | tsx src/orchestrator/micro_reclassify_private_business.ts |
| micro-reclassify-einnahmen-2023 | tsx src/orchestrator/micro_reclassify_einnahmen_2023.ts |
| micro-clean-private-1nm | tsx src/orchestrator/micro_clean_private_1nm.ts |
| micro-ocr-audit-1nm | tsx src/orchestrator/micro_ocr_audit_1nm.ts |
| micro-local-118-filter | tsx src/orchestrator/micro_local_118_tesseract_filter.ts |
| micro-sync-drive-changes | tsx src/orchestrator/micro_sync_drive_changes.ts |
| micro-enrich-buchhaltung-db | tsx src/orchestrator/micro_enrich_buchhaltung_db.ts |
| micro-tax-category-assign | tsx src/orchestrator/micro_tax_category_assign.ts |
| micro-konto-assign | tsx src/orchestrator/micro_konto_assign.ts |
| micro-plausibility-duplicate | tsx src/orchestrator/micro_plausibility_duplicate.ts |
| micro-sheet-formula-guard | tsx src/orchestrator/micro_sheet_formula_guard.ts |
| micro-sheet-delete-archive-sync | tsx src/orchestrator/micro_sheet_delete_archive_sync.ts |
| micro-swarm-tick | tsx src/orchestrator/micro_swarm_tick.ts |
| zio-guard | tsx src/orchestrator/zio_guard_worker.ts |
| micio-scheduler | tsx src/orchestrator/micio_scheduler.ts |
| aiometrics | tsx src/orchestrator/aiometrics_worker.ts |
| micro-lane-swarm | bash ./start_micro_lane_swarm.sh |
| inventory-report | tsx src/orchestrator/repo_inventory_report.ts |
| arch-guard | tsx src/orchestrator/architecture_guard.ts |
| lint | eslint src --ext .ts |

## Legacy Script List

| name | command |
| --- | --- |
| legacy-start | node dist/legacy/monolith/main.js |
| legacy-accounting-enrichment | node dist/legacy/monolith/accounting_enrichment.js |
| legacy-sync-chain | node dist/legacy/monolith/pipeline_sync.js |
| legacy-setup-finance-dashboard | node dist/legacy/monolith/setup_finance_dashboard.js |
| yearly-reorganize | node dist/legacy/monolith/yearly_reorganize.js |
| soft-audit | node dist/legacy/monolith/soft_audit.js |
| hard-audit | AUDIT_LEVEL=hard node dist/legacy/monolith/soft_audit.js |
| delete-zoe-19pct | node --max-old-space-size=8192 --import tsx src/legacy/manual/delete_zoe_19pct_invoices.ts |
| delete-specific-files | tsx src/legacy/manual/delete_specific_files.ts |
