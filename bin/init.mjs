#!/usr/bin/env node
// ponytail: single-file, zero-dependency CLI. Node stdlib only (fs, path, readline).
// Detects stack automatically; asks only what can't be detected; writes AGENTS.md
// plus thin pointer files so Claude/Gemini/Cursor/Codex all read the same source of truth.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';

const cwd = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const reviewMode = args.includes('--review');

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function detectStack() {
  const pkg = readJson(join(cwd, 'package.json'));
  const detected = {
    name: pkg?.name ?? null,
    packageManager: existsSync(join(cwd, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(join(cwd, 'yarn.lock')) ? 'yarn'
      : existsSync(join(cwd, 'bun.lockb')) ? 'bun'
      : pkg ? 'npm' : null,
    scripts: pkg?.scripts ?? {},
    languages: [],
    monorepo: existsSync(join(cwd, 'pnpm-workspace.yaml')) || Boolean(pkg?.workspaces),
    ci: existsSync(join(cwd, '.github', 'workflows')) &&
      readdirSync(join(cwd, '.github', 'workflows')).length > 0,
    git: existsSync(join(cwd, '.git')),
  };
  if (pkg) detected.languages.push('javascript/typescript');
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'requirements.txt'))) detected.languages.push('python');
  if (existsSync(join(cwd, 'go.mod'))) detected.languages.push('go');
  if (existsSync(join(cwd, 'Cargo.toml'))) detected.languages.push('rust');
  if (existsSync(join(cwd, 'pom.xml')) || existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts'))) detected.languages.push('java/kotlin');

  const allDeps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  detected.dependencyScanning = existsSync(join(cwd, '.github', 'dependabot.yml')) || existsSync(join(cwd, 'renovate.json')) || existsSync(join(cwd, '.renovaterc'));
  detected.secretScanning = existsSync(join(cwd, '.pre-commit-config.yaml')) || existsSync(join(cwd, '.gitleaks.toml')) || existsSync(join(cwd, '.husky'));
  detected.errorMonitoring = Boolean(allDeps['@sentry/node'] || allDeps['@sentry/nextjs'] || allDeps['@sentry/react']);
  detected.multiTenantSignal = existsSync(join(cwd, 'supabase')) || Boolean(allDeps['@supabase/supabase-js']);
  detected.hasAgentsMd = existsSync(join(cwd, 'AGENTS.md'));

  const pick = (...names) => names.find((n) => detected.scripts[n]);
  detected.commands = {
    dev: pick('dev', 'start'),
    build: pick('build'),
    lint: pick('lint'),
    typecheck: pick('typecheck', 'type-check'),
    test: pick('test'),
    testCov: pick('test:cov', 'coverage'),
    e2e: pick('test:e2e', 'e2e'),
    checkAll: pick('check:all', 'ci'),
  };
  return detected;
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

async function gatherAnswers(detected) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const description = await ask(rl, 'One-line description of what this project does: ');
  const sensitiveRaw = await ask(rl, 'Does this project handle sensitive data (PII, payments, health, credentials)? [y/N]: ');
  const multiTenantRaw = await ask(rl, 'Is this multi-tenant (per-tenant data isolation matters)? [y/N]: ');
  rl.close();
  return {
    description: description || '(describe the project here)',
    sensitive: /^y/i.test(sensitiveRaw),
    multiTenant: /^y/i.test(multiTenantRaw),
  };
}

function cmd(pm, script) {
  if (!script) return null;
  if (pm === 'pnpm') return `pnpm ${script}`;
  if (pm === 'yarn') return `yarn ${script}`;
  return `npm run ${script}`;
}

function buildAgentsMd(detected, answers) {
  const pm = detected.packageManager ?? 'npm';
  const c = detected.commands;
  const lines = [];

  lines.push('# AGENTS.md', '', 'Guidance for AI coding agents working in this repository.', '');
  lines.push('## Project Overview', '', answers.description, '');
  if (answers.sensitive) {
    lines.push('This project handles sensitive data. Treat every change touching auth, input handling, storage, or third-party integrations as security-relevant (see OWASP checklist below) and never let secrets, keys, or credentials be hardcoded or logged.', '');
  }

  lines.push('## Tech Stack', '');
  lines.push(`- Languages: ${detected.languages.length ? detected.languages.join(', ') : '(none auto-detected — fill in manually)'}`);
  lines.push(`- Package manager: ${detected.packageManager ?? '(none detected)'}`);
  lines.push(`- Monorepo: ${detected.monorepo ? 'yes' : 'no'}`);
  lines.push('');

  lines.push('## Build, Run, Test', '');
  const commandLines = [
    ['Dev', c.dev], ['Build', c.build], ['Lint', c.lint], ['Typecheck', c.typecheck],
    ['Test', c.test], ['Coverage', c.testCov], ['E2E', c.e2e], ['Full CI gate', c.checkAll],
  ].filter(([, script]) => script);
  if (commandLines.length === 0) {
    lines.push('(no scripts auto-detected in package.json — add build/lint/typecheck/test commands here manually)');
  } else {
    for (const [label, script] of commandLines) lines.push(`- ${label}: ${cmd(pm, script)}`);
  }
  lines.push('');

  lines.push('## Subagent Workflow (Delegation, Review, Verification)', '');
  lines.push('Move non-trivial changes through these stages. Use whatever specialized review agents/skills are installed for the current tool rather than skipping steps; do not build new ones for coverage that already exists.', '');
  lines.push('1. **Plan** — restate the change and, for anything crossing a trust boundary (client vs. server, tenant vs. tenant), state which side owns the authoritative check.');
  lines.push('2. **Delegate implementation** — break independent sub-tasks out rather than doing everything inline in one long pass.');
  lines.push('3. **Review — correctness & quality** — run the relevant language/framework reviewer for the touched surface; check error handling isn\'t silently swallowing failures.');
  lines.push('4. **Review — UX/UI & accessibility** — for any change to rendered UI: check keyboard navigation, focus management, contrast, and responsive behavior; verify interactively rather than trusting the diff.');
  const owasp = [
    'A01 broken access control (never trust client-supplied IDs/roles; verify server-side)',
    'A02 cryptographic failures (secrets never in code or logs; verified token signing)',
    'A03 injection (parameterized queries, input validation/whitelisting)',
    'A04 insecure design (server-authoritative business rules, not client-enforced)',
    'A05 security misconfiguration (env separation, no debug/secrets leaking to client)',
    'A08 data integrity (immutable records where correctness depends on it)',
    'A09 logging/monitoring gaps (security-relevant events are actually logged)',
  ];
  lines.push(`5. **Review — security (OWASP)** — check for: ${owasp.join('; ')}. Scan every staged diff for hardcoded secrets before committing — treat this as manual and non-optional unless a pre-commit secret scanner is actually installed.`);
  if (answers.multiTenant) {
    lines.push('   - This project is multi-tenant: any change to authorization, database row-level security policies, or tenant-scoped queries needs explicit cross-tenant-access testing, not just a normal code review.');
  }
  lines.push('6. **Static checks & test verification** — run lint/typecheck first (cheap, catches most mistakes early), then confirm tests cover real behavior, not just the happy path. Check coverage reports for security/money/scoring-critical logic specifically — passing tests is not the same as adequate coverage.');
  lines.push('7. **Completion & sign-off** — confirm the change actually works as intended (not just "tests pass"), and update any living task-tracking docs this project keeps.');
  lines.push('');
  lines.push('### Known gaps to flag rather than assume are covered');
  lines.push('');
  if (!detected.ci) {
    lines.push('- **No CI detected** (`.github/workflows` is empty or absent) — nothing enforces these gates automatically. Recommend adding CI before relying on this workflow as a hard gate.');
  } else {
    lines.push('- CI workflows detected under `.github/workflows` — confirm they actually run lint/typecheck/test/e2e before treating CI as a backstop.');
  }
  lines.push('- No dependency vulnerability scanning detected by this tool — check for Dependabot/Renovate config, or run the package manager\'s audit command periodically.');
  lines.push('- No automated secret scanning detected — treat secret-scanning in stage 5 as manual until a pre-commit hook or CI step exists.');
  lines.push('');

  lines.push('## Coding Conventions', '');
  lines.push('(Fill in: language style rules, where shared types/DTOs live, test file naming convention, any "never do X" domain rules.)', '');

  lines.push('## Gotchas and In-Progress Work', '');
  lines.push('(Fill in from any living project docs, e.g. CURRENT_TASK.md/NEXT_STEPS.md if this project keeps them — what\'s mid-flight, what\'s deliberately deferred.)', '');

  return lines.join('\n') + '\n';
}

const POINTER = (target) => `# ${target}\n\nThis project's AI agent instructions live in [AGENTS.md](./AGENTS.md) — read that file first. This file exists only so ${target === 'CLAUDE.md' ? 'Claude Code' : 'Gemini'} picks up the same instructions without duplicating them.\n`;

function reviewExisting(detected) {
  const agentsPath = join(cwd, 'AGENTS.md');
  const suggestions = [];

  if (!detected.hasAgentsMd) {
    console.log('No AGENTS.md found. Run without --review to generate one.');
    return;
  }

  const content = readFileSync(agentsPath, 'utf8');
  const has = (needle) => content.toLowerCase().includes(needle.toLowerCase());

  if (!has('subagent workflow') && !has('review workflow')) {
    suggestions.push('No delegation/review workflow section found — add plan → delegate → review → security → verification stages.');
  }
  if (!has('owasp')) {
    suggestions.push('No OWASP checklist referenced — add one if this project has auth, user input, or payment flows.');
  }
  if (!has('coverage') && (detected.commands.testCov || detected.commands.test)) {
    suggestions.push('Coverage command exists in package.json but AGENTS.md doesn\'t mention checking coverage reports — add it.');
  }
  if (!has('secret')) {
    suggestions.push('No mention of secret scanning — add a manual-check requirement, or wire up a real pre-commit scanner (none detected on disk).');
  }
  if (!has('accessib') && !has('a11y') && !has('ux')) {
    suggestions.push('No UX/UI or accessibility review step found — add one if this project has a frontend.');
  }
  if (detected.multiTenantSignal && !has('tenant') && !has('row-level security') && !has('rls')) {
    suggestions.push('Supabase detected but AGENTS.md doesn\'t mention tenant isolation / RLS — confirm whether this project is multi-tenant and document the review requirement if so.');
  }
  if (!detected.ci && !has('no ci')) {
    suggestions.push('No CI detected and AGENTS.md doesn\'t flag it as a known gap — add a note so agents don\'t assume gates are enforced automatically.');
  }
  if (!detected.dependencyScanning && !has('dependency') ) {
    suggestions.push('No Dependabot/Renovate config detected and AGENTS.md doesn\'t mention dependency scanning — add a note or wire one up.');
  }
  if (!detected.errorMonitoring && !has('sentry') && !has('error monitoring')) {
    suggestions.push('No error-monitoring SDK (e.g. Sentry) detected — consider adding one, or note the gap.');
  }

  console.log(`Reviewed ${agentsPath}\n`);
  if (suggestions.length === 0) {
    console.log('No gaps found against the standard checklist. Looks solid.');
    return;
  }
  console.log(`${suggestions.length} suggestion(s):\n`);
  for (const s of suggestions) console.log(`- ${s}`);
}

async function main() {
  const detected = detectStack();
  console.log('Detected:', JSON.stringify(detected, null, 2));

  if (reviewMode) {
    reviewExisting(detected);
    return;
  }

  const agentsPath = join(cwd, 'AGENTS.md');
  if (existsSync(agentsPath) && !force) {
    console.log('\nAGENTS.md already exists. Re-run with --force to overwrite, or merge manually.');
    process.exit(1);
  }

  const answers = await gatherAnswers(detected);
  const agentsMd = buildAgentsMd(detected, answers);

  const files = {
    'AGENTS.md': agentsMd,
    'CLAUDE.md': POINTER('CLAUDE.md'),
    'GEMINI.md': POINTER('GEMINI.md'),
  };

  console.log('\n--- Files to write ---');
  for (const name of Object.keys(files)) console.log(`- ${join(cwd, name)}`);

  if (dryRun) {
    console.log('\n(dry run — nothing written; re-run without --dry-run to apply)');
    return;
  }

  for (const [name, content] of Object.entries(files)) {
    if (name !== 'AGENTS.md' && existsSync(join(cwd, name)) && !force) {
      console.log(`Skipping ${name} (already exists; use --force to overwrite)`);
      continue;
    }
    writeFileSync(join(cwd, name), content, 'utf8');
  }
  console.log('\nDone. Codex and other AGENTS.md-aware tools read AGENTS.md directly; Cursor users can add a .cursorrules pointer the same way.');
}

main();
