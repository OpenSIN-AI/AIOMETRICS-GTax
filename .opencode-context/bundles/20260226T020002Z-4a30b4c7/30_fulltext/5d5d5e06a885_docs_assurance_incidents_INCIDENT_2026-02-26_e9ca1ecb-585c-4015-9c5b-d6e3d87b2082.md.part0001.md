# Context Fulltext

- source_path: docs/assurance/incidents/INCIDENT_2026-02-26_e9ca1ecb-585c-4015-9c5b-d6e3d87b2082.md
- source_sha256: 098513a3ccd3f75843985afa331354f9855de21d47be70b3bf446e10af2d2389
- chunk: 1/1

```text
# Incident 2026-02-26_e9ca1ecb-585c-4015-9c5b-d6e3d87b2082

- runId: e9ca1ecb-585c-4015-9c5b-d6e3d87b2082
- incidentBranch: incident/2026-02-26_e9ca1ecb-585c-4015-9c5b-d6e3d87b2082
- incidentBranchStatus: created
- alertKinds: unknown, schema

## Hard Fail Reasons

- STAGE_FAILED:idempotency_check#1
- IDEMPOTENCY_FAILED

## Stage Failures

- idempotency_check#1: getAuditMutationsByRunId.read: timeout after 30000ms

## Top Unresolved IDs


## Action Plan

- Ursache klassifizieren (quota/schema/drive drift/parser drift)
- Reconcile erneut laufen lassen
- Wenn nach 2 Läufen nicht grün: blocker dokumentieren und Top-IDs priorisieren

```
