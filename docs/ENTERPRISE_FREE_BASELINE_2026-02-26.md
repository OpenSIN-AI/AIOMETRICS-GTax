# ENTERPRISE FREE BASELINE

Date: 2026-02-26  
Scope: `AIOMETRICS-GTax` (Node/TypeScript + OCR/AI + Google integrations)  
Goal: enterprise-grade quality and security with only free tooling.

## 0) Verified references (as of 2026-02-26)

- NIST CSF 2.0: https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20
- NIST SSDF 1.1: https://csrc.nist.gov/publications/detail/sp/800-218/final
- OWASP Top 10:2025: https://owasp.org/Top10/2025/
- OWASP ASVS (v5 project page): https://owasp.org/www-project-application-security-verification-standard/
- SLSA spec (v1.2): https://slsa.dev/spec/v1.2/whats-new
- GitHub artifact attestations: https://docs.github.com/actions/concepts/security/artifact-attestations
- GitHub Actions usage and billing: https://docs.github.com/en/actions/concepts/overview/usage-limits-billing-and-administration

## 1) Control System (What "enterprise" means here)

This repository is now aligned to these public baselines:

- NIST CSF 2.0 (govern, identify, protect, detect, respond, recover)
- NIST SSDF 1.1 (secure software development framework)
- OWASP ASVS / OWASP Top 10 control mindset
- Supply-chain integrity via SBOM + build provenance

## 2) Implemented in Repository

### CI Quality + Security Gates

File: `.github/workflows/enterprise-ci.yml`

- Build gate: `npm run -s build`
- Test gate: `npm run -s test`
- Lint gate: `npm run -s lint`
- Dependency risk gate: `npm audit --audit-level=high`
- Secret leak gate: `gitleaks`
- Vulnerability gate: `trivy` filesystem scan (HIGH/CRITICAL)
- Supply-chain artifact: SPDX SBOM via `npm sbom`

### Nightly Security Baseline

File: `.github/workflows/nightly-security.yml`

- Scheduled daily security baseline scan
- Re-runs all core quality and security controls
- Publishes nightly artifacts (SBOM)

### Provenance Attestation

File: `.github/workflows/provenance-attestation.yml`

- Builds release bundle on main/master push
- Uploads signed provenance attestation for traceability

### Governance Controls

- Security disclosure process: `SECURITY.md`
- Ownership enforcement: `.github/CODEOWNERS`
- Dependency update automation: `.github/dependabot.yml`
- PR security checklist: `.github/pull_request_template.md`
- Local parity command: `npm run enterprise-guard`
- Workflow integrity check: `.github/workflows/workflow-integrity.yml`

## 3) Required Repo Settings (Manual, one-time)

Enable these in GitHub settings to get full enterprise effect:

1. Branch protection/ruleset for `main`:
   - Require pull request before merge
   - Require at least 1 approval
   - Require code owner reviews
   - Require status checks:
     - `Quality Gate`
     - `Dependency Audit`
     - `Secret Scan`
     - `FS Vulnerability Scan`
     - `SBOM (SPDX)`
     - `Workflow Lint` (for workflow changes)
   - Block force pushes and branch deletion
2. Enable Dependabot security updates.
3. Enable artifact attestations visibility (if not already default).

Cost note (2026-02-26): Public repositories remain free on standard hosted runners.
Private repository usage depends on plan quotas and current GitHub billing policy.

## 4) Data Protection Rules (Tax/Receipt context)

- Never log full OCR text containing personal data by default.
- Keep retention windows short for transient OCR output.
- Use least-privilege service accounts for Google APIs.
- Rotate API keys and revoke unused credentials.
- Store all secrets only in environment or secret manager.

## 5) Operational Cadence

- Per PR: CI quality and security gates must pass.
- Daily: nightly security scan.
- Weekly: dependency update review (Dependabot PRs).
- Monthly: control review against incidents and false positives.

## 6) Immediate Next Hardening (still free)

1. Add OpenTelemetry spans/metrics in orchestrators.
2. Add signed release/tag policy.
3. Add policy-as-code checks for workflow integrity.
4. Split production credentials by lane (read-only vs write workers).

## 7) Quickstart

Run the same gate locally before opening PR:

```bash
npm run enterprise-guard
```
