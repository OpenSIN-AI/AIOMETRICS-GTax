# Security Policy

## Supported Versions

This project follows a rolling support model.

- `main`: fully supported
- release branches/tags: security fixes only
- everything else: unsupported

## Reporting a Vulnerability

Do not open public issues for security vulnerabilities.

1. Send a private report to the repository owner (`@Delqhi`) with:
   - clear impact statement
   - reproduction steps
   - affected files/paths
   - suggested fix if available
2. Expect acknowledgment within 72 hours.
3. A mitigation/fix plan is provided after triage.
4. Public disclosure happens only after fix deployment.

## Security Requirements For Contributions

- No secrets in code, logs, fixtures, or docs.
- New dependencies must be justified and actively maintained.
- New external integrations must use least-privilege credentials.
- Sensitive document content must be redacted in logs and reports.
- All PRs touching runtime or workflows must pass CI security gates.

## Hardening Baseline

The repository enforces enterprise controls using free tooling:

- quality gate (`build`, `test`, `lint`)
- dependency gate (`npm audit`)
- secret scanning (`gitleaks`)
- filesystem vulnerability scanning (`trivy`)
- SBOM generation (`npm sbom`, SPDX)
- build provenance attestation
