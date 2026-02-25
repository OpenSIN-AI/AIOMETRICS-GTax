import * as fs from 'fs';
import * as path from 'path';

interface FileEntry {
  path: string;
  size: number;
}

interface TsLineEntry {
  path: string;
  lines: number;
}

const ROOT = process.cwd();
const OUT_MD = path.join(ROOT, 'docs', 'REPO_INVENTORY.md');
const OUT_JSON = path.join(ROOT, 'docs', 'REPO_INVENTORY.json');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'venv_composio',
  'dist',
  'dist-micro'
]);

function walkFiles(dir: string, out: FileEntry[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(full, out);
      continue;
    }
    try {
      const st = fs.statSync(full);
      out.push({ path: rel, size: st.size });
    } catch {
      // ignore transient files
    }
  }
}

function countLines(filePath: string): number {
  const txt = fs.readFileSync(filePath, 'utf8');
  return txt.split('\n').length;
}

function toRow(cols: string[]): string {
  return `| ${cols.map((c) => c.replace(/\|/g, '/')).join(' | ')} |`;
}

function isLegacyScriptValue(v: string): boolean {
  const t = v.toLowerCase();
  return t.includes('src/legacy/') || t.includes('dist/legacy/') || t.includes('legacy-');
}

async function main(): Promise<void> {
  const files: FileEntry[] = [];
  walkFiles(ROOT, files);

  const srcFiles = files.filter((f) => f.path.startsWith('src/'));
  const orchestratorFiles = files.filter((f) => f.path.startsWith('src/orchestrator/'));
  const legacyFiles = files.filter((f) => f.path.startsWith('src/legacy/'));
  const docsFiles = files.filter((f) => f.path.startsWith('docs/'));
  const rootTsFiles = files.filter((f) => !f.path.includes('/') && f.path.endsWith('.ts'));

  const tsFiles = files.filter((f) => f.path.startsWith('src/') && f.path.endsWith('.ts'));
  const tsLines: TsLineEntry[] = tsFiles.map((f) => ({
    path: f.path,
    lines: countLines(path.join(ROOT, f.path))
  }));
  tsLines.sort((a, b) => b.lines - a.lines);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts: Array<{ name: string; cmd: string; legacy: boolean }> =
    Object.entries<string>(pkg.scripts || {}).map(([name, cmd]) => ({
      name,
      cmd,
      legacy: name.startsWith('legacy-') || isLegacyScriptValue(cmd)
    }));

  const topFiles = [...files].sort((a, b) => b.size - a.size).slice(0, 30);
  const topTs = tsLines.slice(0, 30);
  const activeScripts = scripts.filter((s) => !s.legacy);
  const legacyScripts = scripts.filter((s) => s.legacy);

  const jsonOut = {
    timestamp: new Date().toISOString(),
    counts: {
      repoFiles: files.length,
      srcFiles: srcFiles.length,
      orchestratorFiles: orchestratorFiles.length,
      legacyFiles: legacyFiles.length,
      docsFiles: docsFiles.length,
      rootTsFiles: rootTsFiles.length
    },
    scripts: {
      total: scripts.length,
      active: activeScripts.length,
      legacy: legacyScripts.length
    },
    topFiles,
    topTsByLines: topTs
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), 'utf8');

  const lines: string[] = [];
  lines.push('# Repo Inventory');
  lines.push('');
  lines.push(`- Timestamp: ${jsonOut.timestamp}`);
  lines.push(`- Root: \`${ROOT}\``);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push(`- Repo files: ${jsonOut.counts.repoFiles}`);
  lines.push(`- Src files: ${jsonOut.counts.srcFiles}`);
  lines.push(`- Orchestrator files: ${jsonOut.counts.orchestratorFiles}`);
  lines.push(`- Legacy files: ${jsonOut.counts.legacyFiles}`);
  lines.push(`- Docs files: ${jsonOut.counts.docsFiles}`);
  lines.push(`- Root TS files: ${jsonOut.counts.rootTsFiles}`);
  lines.push('');
  lines.push('## Scripts');
  lines.push('');
  lines.push(`- Total: ${jsonOut.scripts.total}`);
  lines.push(`- Active: ${jsonOut.scripts.active}`);
  lines.push(`- Legacy: ${jsonOut.scripts.legacy}`);
  lines.push('');
  lines.push('## Top Files By Size');
  lines.push('');
  lines.push(toRow(['bytes', 'file']));
  lines.push(toRow(['---:', '---']));
  for (const f of topFiles) lines.push(toRow([String(f.size), f.path]));
  lines.push('');
  lines.push('## Top TS Files By Lines');
  lines.push('');
  lines.push(toRow(['lines', 'file']));
  lines.push(toRow(['---:', '---']));
  for (const t of topTs) lines.push(toRow([String(t.lines), t.path]));
  lines.push('');
  lines.push('## Active Script List');
  lines.push('');
  lines.push(toRow(['name', 'command']));
  lines.push(toRow(['---', '---']));
  for (const s of activeScripts) lines.push(toRow([s.name, s.cmd]));
  lines.push('');
  lines.push('## Legacy Script List');
  lines.push('');
  lines.push(toRow(['name', 'command']));
  lines.push(toRow(['---', '---']));
  for (const s of legacyScripts) lines.push(toRow([s.name, s.cmd]));

  fs.writeFileSync(OUT_MD, lines.join('\n') + '\n', 'utf8');

  console.log(JSON.stringify({
    status: 'ok',
    reportMd: OUT_MD,
    reportJson: OUT_JSON,
    counts: jsonOut.counts,
    scripts: jsonOut.scripts
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

