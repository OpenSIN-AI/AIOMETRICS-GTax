# Context Fulltext

- source_path: docs/assurance/incidents/INCIDENT_2026-02-26_e9ca1ecb-585c-4015-9c5b-d6e3d87b2082.json
- source_sha256: 48e731d2d29c3ea948ef54f123a00d339bf0be01533b884f118881f05c24ee45
- chunk: 1/1

```text
{
  "generatedAt": "2026-02-26T00:59:48.066Z",
  "runId": "e9ca1ecb-585c-4015-9c5b-d6e3d87b2082",
  "incidentBranch": "incident/2026-02-26_e9ca1ecb-585c-4015-9c5b-d6e3d87b2082",
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
      "error": "getAuditMutationsByRunId.read: timeout after 30000ms"
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
