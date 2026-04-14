# Context Fulltext

- source_path: src/orchestrator/repair_2023.ts
- source_sha256: 0f706c6982ec4756cf54653e720a13104fae58266c0636c9ab698f61fe4114e9
- chunk: 5/5

```text
  movedArchive,
    movedMissing,
    movedDuplicate,
    movedFlow,
    movedYear,
    movedPaymentProofMissing,
    stageMoveCounter,
    stageMoveCap: Number.isFinite(STAGE_MAX_MOVES) ? STAGE_MAX_MOVES : 0,
    stageCapReached,
    restoredIncomeFromArchive,
    stages: {
      restoreArchive: STAGE_RESTORE_ARCHIVE,
      dedupe: STAGE_DEDUPE,
      movePolicy: STAGE_MOVE_POLICY,
      moveFlow: STAGE_MOVE_FLOW,
      moveYear: STAGE_MOVE_YEAR,
      rebuild: STAGE_REBUILD,
      paymentProof: STAGE_PAYMENT_PROOF
    },
    incomeInvoiceCount,
    rebuildStats
  }, null, 2));
}

withPipelineLock('repair_2023', main).catch((error) => {
  console.error('repair_2023 failed:', error);
  process.exit(1);
});

```
