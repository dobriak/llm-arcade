#!/usr/bin/env node
// Computes the scripted part of the PRD §11 score from evaluate.sh checks + the Playwright JSON report.
// Usage: node score.mjs <out-dir>     (expects <out-dir>/checks.json and optionally <out-dir>/playwright.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2];
if (!outDir) { console.error('usage: node score.mjs <out-dir>'); process.exit(2); }

const checks = JSON.parse(readFileSync(join(outDir, 'checks.json'), 'utf8'));
const reportPath = join(outDir, 'playwright.json');

const AREAS = { '@api': { weight: 25, label: 'API contract (§6)' }, '@moves': { weight: 15, label: 'Moves / positions / WIP' }, '@ui': { weight: 20, label: 'UI flows (Playwright)' } };
const tally = Object.fromEntries(Object.keys(AREAS).map((t) => [t, { passed: 0, total: 0, failed: [] }]));
const xssFailures = [];

function walk(suite, titlePath = []) {
  const path = suite.title ? [...titlePath, suite.title] : titlePath;
  for (const spec of suite.specs ?? []) {
    const tags = spec.tags ?? [];
    for (const t of spec.tests ?? []) {
      const ok = t.status === 'expected' || t.status === 'flaky';
      if (t.status === 'skipped') continue;
      const name = [...path.slice(1), spec.title].join(' › ');
      const area = Object.keys(AREAS).find((a) => tags.includes(a) || tags.includes(a.slice(1)));
      if (area) {
        tally[area].total += 1;
        if (ok) tally[area].passed += 1; else tally[area].failed.push(name);
      }
      if ((tags.includes('@xss') || tags.includes('xss')) && !ok) xssFailures.push(name);
    }
  }
  for (const child of suite.suites ?? []) walk(child, path);
}

let reportMissing = false;
if (checks.healthy && existsSync(reportPath)) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  for (const s of report.suites ?? []) walk(s);
} else {
  reportMissing = checks.healthy;
}

const round1 = (x) => Math.round(x * 10) / 10;
const rows = [];
rows.push({ area: 'Startup: build + healthy ≤120s', max: 10, points: checks.healthy ? 10 : 0 });
rows.push({ area: 'Startup: data survives down/up', max: 5, points: checks.persisted ? 5 : 0 });
for (const [tag, { weight, label }] of Object.entries(AREAS)) {
  const t = tally[tag];
  const points = t.total ? (weight * t.passed) / t.total : 0;
  rows.push({ area: `${label} — ${t.passed}/${t.total} tests`, max: weight, points: round1(points) });
}
rows.push({ area: 'Backend tests (docker --target test)', max: 10, points: checks.backend_tests === 'pass' ? 10 : 0 });

let scripted = round1(rows.reduce((s, r) => s + r.points, 0));
const penalties = [];
let cap = 100;
if (!checks.healthy) { cap = Math.min(cap, 10); penalties.push('App did not start → capped at 10'); }
if (xssFailures.length) { cap = Math.min(cap, 40); penalties.push(`XSS test failed → capped at 40 (${xssFailures.join('; ')})`); }
if (checks.healthy && !checks.persisted) { cap = Math.min(cap, 50); penalties.push('Data lost across restart → capped at 50'); }
if (checks.healthy && checks.migrations_table === '') { scripted = Math.max(0, scripted - 10); penalties.push('No migration bookkeeping table found in the DB → −10'); }
if (reportMissing) penalties.push('Playwright report missing — suite did not run');

const result = {
  stack: checks.stack,
  llm: checks.llm,
  evaluated_at: new Date().toISOString(),
  checks,
  areas: rows,
  failed_tests: Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, v.failed])),
  penalties,
  scripted_score: round1(Math.min(scripted, cap)),
  scripted_max: 85,
  review_max: 15,
  note: 'Review points (TECH.md adherence 10, code clarity/docs 5) are awarded manually. Lint is checked during review.',
};
writeFileSync(join(outDir, 'score.json'), JSON.stringify(result, null, 2) + '\n');

const md = [
  `# Score — ${checks.llm} / ${checks.stack}`,
  '',
  `Evaluated ${result.evaluated_at}`,
  '',
  '| Area | Points | Max |',
  '|---|---:|---:|',
  ...rows.map((r) => `| ${r.area} | ${r.points} | ${r.max} |`),
  `| **Scripted total** | **${result.scripted_score}** | **85** |`,
  '| Review (manual: TECH adherence 10, clarity/docs 5) | _tbd_ | 15 |',
  '',
  penalties.length ? `**Penalties / caps:**\n${penalties.map((p) => `- ${p}`).join('\n')}\n` : '',
  `Migration table: \`${checks.migrations_table || 'none found'}\` · Build: ${checks.build} · Backend tests: ${checks.backend_tests}`,
  '',
  ...Object.entries(tally).flatMap(([k, v]) => (v.failed.length ? [`## Failed ${k} tests`, '', ...v.failed.map((f) => `- ${f}`), ''] : [])),
].join('\n');
writeFileSync(join(outDir, 'score.md'), md + '\n');
console.log(md);
