import * as fs from 'fs';
import * as path from 'path';

type Severity = 'error' | 'warn';

interface Finding {
  severity: Severity;
  code: string;
  message: string;
  file?: string;
}

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs', 'ARCH_GUARD_REPORT.md');
const ORCH_DIR = path.join(ROOT, 'src', 'orchestrator');
const ACTIVE_MAX_LINES = Number.parseInt(process.env.ARCH_GUARD_MAX_ACTIVE_LINES || '600', 10);
const ACTIVE_ALLOWLIST = new Set([
  'repair_2023.ts',
  'setup_eigenbeleg_workflow.ts',
  'run_eigenbeleg_pipeline.ts'
]);

const BANNED_ACTIVE_PATTERNS = [
  /^gemini_/,
  /^delete_/,
  /^scan_/,
  /^main\.ts$/,
  /^pipeline_sync\.ts$/,
  /^soft_audit\.ts$/,
  /^yearly_reorganize\.ts$/,
  /^accounting_enrichment\.ts$/
];

const BANNED_NON_LEGACY_SCRIPT_REFS = [
  'dist/orchestrator/main.js',
  'dist/orchestrator/pipeline_sync.js',
  'dist/orchestrator/soft_audit.js',
  'dist/orchestrator/yearly_reorganize.js',
  'dist/orchestrator/accounting_enrichment.js',
  'src/orchestrator/main.ts'
];

function countLines(abs: string): number {
  const txt = fs.readFileSync(abs, 'utf8');
  return txt.split('\n').length;
}

function pushFinding(out: Finding[], finding: Finding): void {
  out.push(finding);
}

function checkOrchestratorFiles(findings: Finding[]): void {
  const entries = fs.readdirSync(ORCH_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    for (const re of BANNED_ACTIVE_PATTERNS) {
      if (re.test(e.name)) {
        pushFinding(findings, {
          severity: 'error',
          code: 'ACTIVE_FILE_BANNED',
          message: `Banned file pattern in active orchestrator: ${e.name}`,
          file: `src/orchestrator/${e.name}`
        });
      }
    }

    const abs = path.join(ORCH_DIR, e.name);
    const lines = countLines(abs);
    if (lines > ACTIVE_MAX_LINES && !ACTIVE_ALLOWLIST.has(e.name)) {
      pushFinding(findings, {
        severity: 'warn',
        code: 'ACTIVE_FILE_TOO_LONG',
        message: `Active file exceeds ${ACTIVE_MAX_LINES} lines (${lines})`,
        file: `src/orchestrator/${e.name}`
      });
    }
  }
}

function checkScripts(findings: Finding[]): void {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  for (const [name, cmd] of Object.entries<string>(scripts)) {
    const isLegacyNamed = name.startsWith('legacy-');
    if (isLegacyNamed) continue;
    for (const bad of BANNED_NON_LEGACY_SCRIPT_REFS) {
      if (cmd.includes(bad)) {
        pushFinding(findings, {
          severity: 'error',
          code: 'SCRIPT_POINTS_TO_BANNED_PATH',
          message: `Non-legacy script references banned path: ${bad}`,
          file: `package.json:scripts.${name}`
        });
      }
    }
  }
}

function writeReport(findings: Finding[]): void {
  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');
  const lines: string[] = [];
  lines.push('# Architecture Guard Report');
  lines.push('');
  lines.push(`- Timestamp: ${new Date().toISOString()}`);
  lines.push(`- Active line threshold: ${ACTIVE_MAX_LINES}`);
  lines.push(`- Errors: ${errors.length}`);
  lines.push(`- Warnings: ${warns.length}`);
  lines.push('');
  lines.push('| severity | code | message | file |');
  lines.push('|---|---|---|---|');
  for (const f of findings) {
    lines.push(`| ${f.severity} | ${f.code} | ${f.message.replace(/\|/g, '/')} | ${(f.file || '').replace(/\|/g, '/')} |`);
  }
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
}

async function main(): Promise<void> {
  const findings: Finding[] = [];
  checkOrchestratorFiles(findings);
  checkScripts(findings);
  writeReport(findings);

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');

  console.log(JSON.stringify({
    status: errors.length === 0 ? 'ok' : 'fail',
    errors: errors.length,
    warnings: warnings.length,
    reportPath: OUT
  }, null, 2));

  if (errors.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

