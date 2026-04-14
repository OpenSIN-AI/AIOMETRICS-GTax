# Context Fulltext

- source_path: docs/assurance/incidents/INCIDENT_2026-02-25_d4390fb1-ec42-4a89-9123-3705c07c80ba.json
- source_sha256: bfa109fe90fb154a05f090d469ccf063488b2a93ac3debefbb3cdfb57089faae
- chunk: 1/1

```text
{
  "generatedAt": "2026-02-25T05:54:37.771Z",
  "runId": "d4390fb1-ec42-4a89-9123-3705c07c80ba",
  "incidentBranch": "incident/2026-02-25_d4390fb1-ec42-4a89-9123-3705c07c80ba",
  "incidentBranchStatus": "created",
  "alertKinds": [
    "unknown",
    "schema"
  ],
  "hardFailReasons": [
    "STAGE_FAILED:idempotency_check#1",
    "IDEMPOTENCY_FAILED"
  ],
  "stageFailures": [
    {
      "stage": "idempotency_check#1",
      "error": "Command failed: /Users/jeremy/.nvm/versions/node/v22.15.0/bin/node /Users/jeremy/dev/AIOMETRICS-GTax/dist/orchestrator/main.js code=1 signal=null"
    }
  ],
  "unresolvedTop": [],
  "actionPlan": [
    "Ursache klassifizieren (quota/schema/drive drift/parser drift)",
    "Reconcile erneut laufen lassen",
    "Wenn nach 2 Läufen nicht grün: blocker dokumentieren und Top-IDs priorisieren"
  ]
}
```
