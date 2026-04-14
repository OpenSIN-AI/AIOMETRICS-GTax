# Context Fulltext

- source_path: tsconfig.micro.json
- source_sha256: 27910fac472ca70f765436d2fb74e1e77b4e27de4e6e861958803e729f8d732a
- chunk: 1/1

```text
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist-micro"
  },
  "include": [
    "src/orchestrator/micro_*.ts",
    "src/orchestrator/zio_guard_worker.ts",
    "src/orchestrator/micio_scheduler.ts",
    "src/orchestrator/aiometrics_worker.ts",
    "src/orchestrator/audit_2023_strict.ts",
    "src/orchestrator/check_2023_integrity.ts"
  ],
  "exclude": [
    "node_modules",
    "dist",
    "dist-micro",
    "tests"
  ]
}

```
