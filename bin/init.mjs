#!/usr/bin/env node
// ponytail: single-file, zero-dependency CLI. Node stdlib only (fs, path, readline).
// Detects stack automatically; asks only what can't be detected; writes AGENTS.md
// plus thin pointer files so Claude/Gemini/Cursor/Codex all read the same source of truth.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import readline from 'node:readline';

const cwd = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const reviewMode = args.includes('--review');
const suggestToolsMode = args.includes('--suggest-tools');
const START_MARKER = '<!-- project-governance-init:start -->';
const END_MARKER = '<!-- project-governance-init:end -->';

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function discoverGuidanceFiles() {
  const files = [];
  const roots = ['.aiassistant', 'docs', 'skills'];
  const walk = (dir, depth) => {
    if (depth > 2 || files.length >= 40) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (/\.md$/i.test(entry.name)) files.push(relative(cwd, path));
    }
  };
  for (const root of roots) if (existsSync(join(cwd, root))) walk(join(cwd, root), 0);
  for (const file of ['CONTRIBUTING.md', 'SECURITY.md', 'PRODUCT_CONSTITUTION.md', 'PRODUCT_STRATEGY.md', 'CONSTITUTION_V1.md']) {
    if (existsSync(join(cwd, file))) files.push(file);
  }
  for (const dir of ['.agents', '.claude', '.codex', '.superpowers']) if (existsSync(join(cwd, dir))) files.push(`${dir}/`);
  return [...new Set(files)].sort();
}

function detectStack() {
  const pkg = readJson(join(cwd, 'package.json'));
  const hasRootSource = readdirSync(cwd).some((name) => /\.(c|cc|cpp|cs|go|java|js|jsx|kt|php|py|rb|rs|swift|ts|tsx)$/.test(name));
  const readmeDescription = (() => {
    try {
      return readFileSync(join(cwd, 'README.md'), 'utf8').split(/\r?\n/)
        .map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? null;
    } catch { return null; }
  })();
  const detected = {
    name: pkg?.name ?? null,
    description: pkg?.description ?? readmeDescription,
    guidanceFiles: discoverGuidanceFiles(),
    packageManager: existsSync(join(cwd, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(join(cwd, 'yarn.lock')) ? 'yarn'
      : existsSync(join(cwd, 'bun.lockb')) ? 'bun'
      : pkg ? 'npm'
      : existsSync(join(cwd, 'uv.lock')) ? 'uv'
      : existsSync(join(cwd, 'poetry.lock')) ? 'poetry'
      : existsSync(join(cwd, 'go.mod')) ? 'go'
      : existsSync(join(cwd, 'Cargo.toml')) ? 'cargo'
      : existsSync(join(cwd, 'pom.xml')) ? 'maven'
      : existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts')) ? 'gradle'
      : existsSync(join(cwd, 'Package.swift')) ? 'swift'
      : null,
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
  detected.isProject = Boolean(pkg || detected.languages.length || detected.description || hasRootSource || existsSync(join(cwd, 'Dockerfile')) || existsSync(join(cwd, 'terraform')) || ['src', 'app', 'lib'].some((dir) => existsSync(join(cwd, dir))));

  const allDeps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const pythonApi = detected.languages.includes('python') && (() => {
    const text = ['pyproject.toml', 'requirements.txt'].map((file) => { try { return readFileSync(join(cwd, file), 'utf8'); } catch { return ''; } }).join('\n');
    return /fastapi|flask|django|starlette/i.test(text);
  })();
  const nativeMobile = existsSync(join(cwd, 'Package.swift')) || existsSync(join(cwd, 'Podfile')) || existsSync(join(cwd, 'AndroidManifest.xml')) || existsSync(join(cwd, 'app', 'build.gradle')) || existsSync(join(cwd, 'app', 'build.gradle.kts'));
  detected.projectType = nativeMobile || allDeps['react-native'] || allDeps.expo ? 'mobile'
    : allDeps.react || allDeps.next || allDeps.vue || existsSync(join(cwd, 'index.html')) ? 'web'
    : allDeps.express || allDeps.fastify || allDeps['@nestjs/core'] ? 'api'
    : pythonApi ? 'api'
    : pkg?.bin ? 'cli'
    : pkg?.exports || pkg?.main ? 'library' : 'general';
  const dependencyNames = Object.keys(allDeps).map((name) => name.toLowerCase());
  const hasDependency = (patterns) => dependencyNames.some((name) => patterns.some((pattern) => name.includes(pattern)));
  detected.signals = [
    hasDependency(['prisma', 'sequelize', 'mongoose', 'typeorm', 'pg', 'mysql', 'supabase']) && 'database',
    hasDependency(['stripe', 'paypal', 'braintree']) && 'payments',
    hasDependency(['passport', 'jsonwebtoken', 'auth0', 'firebase-admin', 'clerk']) && 'authentication',
    hasDependency(['react', 'vue', 'svelte', 'angular']) && 'ui',
  ].filter(Boolean);
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

function knownAnswersFromAgents(content) {
  const fields = { users: 'Primary user', success: 'Success outcome', deployment: 'Deployment and release owner', criticalFlows: 'Critical flow', integrations: 'External dependencies', constraints: 'Non-negotiables', risks: 'Known risk or unfinished area', visualDirection: 'Visual direction', contentVoice: 'Content voice', seoTargets: 'SEO audience or targets' };
  return Object.fromEntries(Object.entries(fields).flatMap(([key, label]) => {
    const match = content.match(new RegExp(`^- ${label}:\\s*(.+)$`, 'mi'));
    return match && match[1] && !match[1].startsWith('(') ? [[key, match[1].trim()]] : [];
  }));
}

async function gatherAnswers(detected, known = {}, existingRl = null) {
  const ownsRl = !existingRl;
  const rl = existingRl ?? readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (key, question) => known[key] || ask(rl, question);
  const description = detected.description || known.description || await ask(rl, 'One-line description of what this project does: ');
  const users = await answer('users', 'Who is the primary user or customer: ');
  const success = await answer('success', 'What outcome proves this project is successful: ');
  const sensitiveRaw = await ask(rl, 'Does this project handle sensitive data (PII, payments, health, credentials)? [y/N]: ');
  const multiTenantRaw = await ask(rl, 'Is this multi-tenant (per-tenant data isolation matters)? [y/N]: ');
  const deployment = await answer('deployment', 'Where is it deployed, and who owns releases: ');
  const criticalFlows = await answer('criticalFlows', 'What user flow must never break: ');
  const integrations = await answer('integrations', 'Which external systems are trusted dependencies (or none): ');
  const constraints = await answer('constraints', 'What is non-negotiable (deadline, budget, privacy, compatibility, performance): ');
  const risks = await answer('risks', 'What is the biggest known risk or unfinished area: ');
  const visualDirection = ['web', 'mobile'].includes(detected.projectType) ? await answer('visualDirection', 'What visual direction should guide UI choices (for example: glass, flat, editorial, dense, minimal): ') : '';
  const contentVoice = ['web', 'mobile'].includes(detected.projectType) ? await answer('contentVoice', 'What should user-facing copy sound like (for example: direct, warm, technical, restrained): ') : '';
  const seoTargets = detected.projectType === 'web' ? await answer('seoTargets', 'Who should find the public-facing site, and what topics or search intent matter: ') : '';
  if (ownsRl) rl.close();
  return {
    description: description || '(describe the project here)',
    users: users || '(identify the primary user)',
    success: success || '(define a measurable outcome)',
    sensitive: /^y/i.test(sensitiveRaw),
    multiTenant: /^y/i.test(multiTenantRaw),
    deployment: deployment || '(document deployment and release ownership)',
    criticalFlows: criticalFlows || '(identify the critical user flow)',
    integrations: integrations || 'none declared',
    constraints: constraints || 'none declared',
    risks: risks || 'none declared',
    visualDirection: visualDirection || '(choose visual direction before UI work)',
    contentVoice: contentVoice || '(choose a direct, audience-appropriate voice)',
    seoTargets: seoTargets || '(define public audience and search intent, if applicable)',
  };
}

const CAPABILITY_DEFINITIONS = {
  'correctness-review': {
    when: 'Every non-trivial change.',
    use: 'the installed reviewer, agent, or plugin that checks correctness and error handling.',
    fallback: 'Review the changed flow, failure paths, and observable behavior manually.',
  },
  'security-review': {
    when: 'Authentication, databases, payments, sensitive data, or tenant isolation are involved.',
    use: 'the installed security reviewer, agent, or plugin for trust-boundary and OWASP analysis.',
    fallback: 'Apply the OWASP checklist in this file and verify every authorization check server-side.',
  },
  'privacy-review': {
    when: 'Personal, health, payment, credential, or otherwise sensitive data is handled.',
    use: 'the installed privacy or data-governance reviewer.',
    fallback: 'Minimize collection, prevent secrets/PII in logs, document retention, and verify deletion/export behavior.',
  },
  'ui-accessibility-review': {
    when: 'Rendered UI or interaction changes are involved.',
    use: 'the installed UI and accessibility reviewer.',
    fallback: 'Verify keyboard access, focus, contrast, responsive behavior, and real browser/device behavior.',
  },
  'design-preferences': {
    when: 'A web or mobile interface is being created or changed.',
    use: 'the installed design or frontend skill that asks for visual direction, density, surfaces, motion, typography, and accessibility preferences before implementation.',
    fallback: 'Read ./skills/design-preferences/SKILL.md, then ask the user to choose a visual direction (such as glass, flat, editorial, dense, or minimal) and record the decision before coding.',
  },
  'authentic-writing': {
    when: 'User-facing product, marketing, help, or error copy is created or edited.',
    use: 'the installed writing skill that removes vague, inflated, and formulaic AI prose while preserving the project voice.',
    fallback: 'Read ./skills/authentic-writing/SKILL.md, then write specific, direct copy; name the user, action, and outcome; remove puffery and generic claims.',
  },
  'seo-review': {
    when: 'A public-facing web page or site needs discoverability review.',
    use: 'the installed SEO audit skill or equivalent, with live evidence where available.',
    fallback: 'Read ./skills/seo-review/SKILL.md, then check titles, descriptions, headings, canonical/robots/sitemap behavior, structured data, accessibility, and page performance; do not claim findings without evidence.',
  },
  'mobile-device-validation': {
    when: 'A mobile application or device lifecycle is involved.',
    use: 'the installed mobile testing or device-validation reviewer.',
    fallback: 'Test on a real device where possible, including offline behavior, permissions, lifecycle, and release builds.',
  },
  'test-verification': {
    when: 'A test command exists or a critical user flow is changing.',
    use: 'the installed test-design or verification reviewer.',
    fallback: 'Run the smallest relevant test first, then the full available suite; cover unhappy paths.',
  },
  'release-verification': {
    when: 'Deployment or CI configuration is involved.',
    use: 'the installed release or delivery reviewer.',
    fallback: 'Verify build artifacts, environment separation, rollback steps, and the production smoke path.',
  },
};

function recommendedCapabilities(detected, answers = {}) {
  const signals = detected.signals ?? [];
  const ids = ['correctness-review'];
  if (answers.sensitive || answers.multiTenant || signals.some((signal) => ['authentication', 'database', 'payments'].includes(signal))) ids.push('security-review');
  if (answers.sensitive) ids.push('privacy-review');
  if (signals.includes('ui') || ['web', 'mobile'].includes(detected.projectType)) ids.push('ui-accessibility-review');
  if (['web', 'mobile'].includes(detected.projectType) || signals.includes('ui')) ids.push('design-preferences');
  if (['web', 'mobile'].includes(detected.projectType) || signals.includes('ui')) ids.push('authentic-writing');
  if (detected.projectType === 'web') ids.push('seo-review');
  if (detected.projectType === 'mobile') ids.push('mobile-device-validation');
  if (detected.commands?.test || answers.criticalFlows) ids.push('test-verification');
  if (detected.ci || answers.deployment) ids.push('release-verification');
  return ids.map((id) => ({ id, ...CAPABILITY_DEFINITIONS[id] }));
}

const TOOLING_SUGGESTIONS = [
  { category: 'MCP', name: 'github', when: (d) => d.git, reason: 'repo is under git — an MCP server for issues/PRs saves manual gh-cli round-trips' },
  { category: 'MCP', name: 'postgres / database connector', when: (d) => d.signals?.includes('database'), reason: 'database dependency detected — query/schema access without leaving the agent' },
  { category: 'MCP', name: 'sentry', when: (d) => !d.errorMonitoring && ['web', 'api', 'mobile'].includes(d.projectType), reason: 'no error monitoring detected — useful once one is added' },
  { category: 'Skill', name: 'security-review', when: (d) => d.signals?.some((s) => ['authentication', 'database', 'payments'].includes(s)), reason: 'auth/database/payments touch trust boundaries' },
  { category: 'Skill', name: 'frontend-design / accessibility review', when: (d) => d.signals?.includes('ui') || ['web', 'mobile'].includes(d.projectType), reason: 'UI dependency or web/mobile project type detected' },
  { category: 'Skill', name: 'test-coverage / tdd', when: (d) => Boolean(d.commands?.test), reason: 'a test command exists — worth enforcing coverage on changes' },
  { category: 'Agent', name: 'react-reviewer / vue-reviewer (framework-specific)', when: (d) => d.signals?.includes('ui'), reason: 'a frontend framework dependency was detected' },
  { category: 'Agent', name: 'python-reviewer', when: (d) => d.languages?.includes('python'), reason: 'Python source detected' },
  { category: 'Agent', name: 'go-reviewer', when: (d) => d.languages?.includes('go'), reason: 'Go source detected' },
  { category: 'Agent', name: 'rust-reviewer', when: (d) => d.languages?.includes('rust'), reason: 'Rust source detected' },
  { category: 'Agent', name: 'typescript-reviewer', when: (d) => d.languages?.includes('javascript/typescript'), reason: 'JS/TS source detected' },
  { category: 'Plugin', name: 'dependabot / renovate', when: (d) => !d.dependencyScanning, reason: 'no dependency-vulnerability scanning config found' },
  { category: 'Plugin', name: 'husky + gitleaks (or equivalent pre-commit secret scanner)', when: (d) => !d.secretScanning, reason: 'no secret-scanning config found — catches leaked keys before they\'re committed' },
  { category: 'Plugin', name: 'GitHub Actions CI workflow', when: (d) => d.git && !d.ci, reason: 'repo is under git but no CI workflow detected' },
];

function suggestTooling(detected) {
  return TOOLING_SUGGESTIONS.filter((s) => s.when(detected));
}

function printToolingSuggestions(detected) {
  const suggestions = suggestTooling(detected);
  console.log('Suggested tooling (illustrative names — availability depends on your AI tool; not written to AGENTS.md)\n');
  if (suggestions.length === 0) {
    console.log('Nothing to suggest beyond what the standard capability checklist already covers.');
    return;
  }
  for (const category of ['MCP', 'Skill', 'Agent', 'Plugin']) {
    const inCategory = suggestions.filter((s) => s.category === category);
    if (inCategory.length === 0) continue;
    console.log(`${category}:`);
    for (const s of inCategory) console.log(`- ${s.name} — ${s.reason}`);
  }
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
  lines.push('## Success Context', '');
  lines.push(`- Primary user: ${answers.users}`);
  lines.push(`- Success outcome: ${answers.success}`);
  lines.push(`- Critical flow: ${answers.criticalFlows}`);
  lines.push(`- Deployment and release owner: ${answers.deployment}`);
  lines.push(`- External dependencies: ${answers.integrations}`);
  lines.push(`- Non-negotiables: ${answers.constraints}`);
  lines.push(`- Known risk or unfinished area: ${answers.risks}`, '');
  if (['web', 'mobile'].includes(detected.projectType)) {
    lines.push('## Front-facing preferences', '', `- Visual direction: ${answers.visualDirection ?? '(choose before UI work)'}`, `- Content voice: ${answers.contentVoice ?? '(choose before writing user-facing copy)'}`, `- SEO audience or targets: ${answers.seoTargets ?? '(define for public web work, otherwise mark not applicable)'}`, '');
  }
  lines.push('## Definition of ready', '', '- User or business outcome is stated.', '- Affected surfaces and ownership are identified.', '- Acceptance criteria, failure cases, security impact, and out-of-scope work are clear.', '');
  lines.push('## Definition of done', '', '- Implementation matches the agreed outcome and preserves existing contracts.', '- Validation, error handling, security, accessibility, and relevant tests are covered.', '- Documentation, configuration, migrations, and release impact are updated.', '- The change was verified with the available checks, not only reviewed by diff.', '');
  if (detected.guidanceFiles?.length) {
    lines.push('## Existing project guidance', '', 'Read these repository-owned guides before changing the areas they govern. Keep their detailed rules in place instead of duplicating them here.');
    for (const file of detected.guidanceFiles) lines.push(`- [${file}](./${file.replaceAll('\\', '/')})`);
    lines.push('');
  }
  lines.push('## Recommended Capabilities', '', 'Use the local skill, agent, or plugin that matches each capability when one is available. These names are portable labels, not vendor requirements.', '');
  for (const capability of recommendedCapabilities(detected, answers)) {
    lines.push(`### ${capability.id}`, `When: ${capability.when}`, `Use: ${capability.use}`, `Fallback: ${capability.fallback}`, '');
  }
  if (answers.sensitive) {
    lines.push('This project handles sensitive data. Treat every change touching auth, input handling, storage, or third-party integrations as security-relevant (see OWASP checklist below) and never let secrets, keys, or credentials be hardcoded or logged.', '');
  }

  lines.push('## Tech Stack', '');
  lines.push(`- Languages: ${detected.languages.length ? detected.languages.join(', ') : '(none auto-detected — fill in manually)'}`);
  lines.push(`- Project type: ${detected.projectType}`);
  lines.push(`- Integration signals: ${detected.signals?.length ? detected.signals.join(', ') : 'none detected'}`);
  lines.push(`- Package manager: ${detected.packageManager ?? '(none detected)'}`);
  lines.push(`- Monorepo: ${detected.monorepo ? 'yes' : 'no'}`);
  lines.push('');

  const typeGuidance = {
    web: 'Web changes: verify keyboard access, focus, contrast, responsive layouts, and real-browser behavior.',
    api: 'API changes: verify authentication and authorization server-side, input validation, rate limits, and migration safety.',
    mobile: 'Mobile changes: verify on a real device where possible, including offline behavior, permissions, lifecycle, and release builds.',
    cli: 'CLI changes: preserve useful exit codes, readable errors, non-interactive usage, and backwards-compatible flags.',
    library: 'Library changes: treat exported APIs as contracts; check compatibility, documentation, and package artifacts.',
    general: 'Document runtime assumptions, user-visible behavior, and the smallest reliable verification command for each change.',
  };
  lines.push('## Project-Type Guardrails', '', typeGuidance[detected.projectType], '');

  lines.push('## Build, Run, Test', '');
  const commandLines = [
    ['Dev', c.dev], ['Build', c.build], ['Lint', c.lint], ['Typecheck', c.typecheck],
    ['Test', c.test], ['Coverage', c.testCov], ['E2E', c.e2e], ['Full CI gate', c.checkAll],
  ].filter(([, script]) => script);
  if (commandLines.length === 0) {
    const nativeTest = { uv: 'uv run pytest', poetry: 'poetry run pytest', go: 'go test ./...', cargo: 'cargo test', maven: 'mvn test', gradle: 'gradle test' }[pm];
    lines.push(nativeTest ? `- Test: ${nativeTest}` : '(no scripts auto-detected in package.json — add build/lint/typecheck/test commands here manually)');
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
  lines.push(detected.dependencyScanning
    ? '- Dependency scanning configuration detected — confirm it runs on every dependency change.'
    : '- No dependency vulnerability scanning detected by this tool — check for Dependabot/Renovate config, or run the package manager\'s audit command periodically.');
  lines.push(detected.secretScanning
    ? '- Secret-scanning configuration detected — confirm it runs locally and in CI.'
    : '- No automated secret scanning detected — treat secret-scanning in stage 5 as manual until a pre-commit hook or CI step exists.');
  lines.push('');

  if (detected.git) {
    lines.push('## Git Workflow', '');
    lines.push('- Commit in small, reviewable units with messages that explain why, not just what changed.');
    lines.push('- Never commit secrets, keys, or credentials; check `git status`/`git diff` before staging.');
    lines.push('- Name branches by type: `feat/`, `fix/`, `hotfix/`, `chore/`, `docs/` followed by a short slug (e.g. `feat/user-auth`).');
    lines.push('- Do not force-push, rebase, or rewrite history on shared/main branches.');
    lines.push('- Open a PR for review instead of pushing directly to the default branch, where the workflow supports it.');
    lines.push('');
  } else {
    lines.push('## Git Workflow', '', 'No `.git` directory detected — this project is not under version control. Run `git init` before making changes so work is tracked and reversible.', '');
  }

  lines.push('## Coding Conventions', '');
  lines.push('(Fill in: language style rules, where shared types/DTOs live, test file naming convention, any "never do X" domain rules.)', '');

  lines.push('## Gotchas and In-Progress Work', '');
  lines.push('(Fill in from any living project docs, e.g. CURRENT_TASK.md/NEXT_STEPS.md if this project keeps them — what\'s mid-flight, what\'s deliberately deferred.)', '');

  return `${START_MARKER}\n${lines.join('\n')}\n${END_MARKER}\n`;
}

function updateAgentsMd(existing, generated, mode) {
  if (mode === 'replace') return generated;
  const block = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`);
  if (block.test(existing)) return existing.replace(block, () => generated.trimEnd());
  return `${existing.trimEnd()}\n\n${generated}`;
}

const POINTER = (target) => `# ${target}\n\nThis project's AI agent instructions live in [AGENTS.md](./AGENTS.md) — read that file first. This file exists only so ${target === 'CLAUDE.md' ? 'Claude Code' : 'Gemini'} picks up the same instructions without duplicating them.\n`;

function reviewExisting(detected) {
  const agentsPath = join(cwd, 'AGENTS.md');
  const suggestions = [];

  if (!detected.isProject) {
    console.log('No project signals found. Start with the full setup interview.');
    return;
  }

  console.log('Project analysis\n');
  if (!detected.hasAgentsMd) {
    console.log('No AGENTS.md found. Recommendations below are read-only.\n');
  }

  const content = detected.hasAgentsMd ? readFileSync(agentsPath, 'utf8') : '';
  const has = (needle) => content.toLowerCase().includes(needle.toLowerCase());
  if (content.length > 12000) {
    suggestions.push('Root AGENTS.md is large — keep the shared contract here and move detailed domain, product, or platform rules into linked guides.');
  }

  const signalAdvice = {
    database: 'Database integration detected — document migration/rollback ownership and verify tenant or authorization filters at the data boundary.',
    payments: 'Payment integration detected — verify webhook authenticity, idempotency, secret handling, and failure/reconciliation paths.',
    authentication: 'Authentication integration detected — verify token/session validation, authorization ownership, and account recovery paths server-side.',
    ui: 'UI integration detected — verify keyboard access, focus behavior, contrast, responsive layouts, and real-browser behavior.',
  };
  for (const signal of detected.signals ?? []) {
    if (!has(signalAdvice[signal])) suggestions.push(signalAdvice[signal]);
  }

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
  if (!has('git workflow')) {
    suggestions.push(detected.git
      ? 'No Git Workflow section found — add commit, branching, and secret-handling guidance.'
      : 'No `.git` directory detected and AGENTS.md doesn\'t flag it — recommend `git init` before relying on version control.');
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

  console.log(`${detected.hasAgentsMd ? `Reviewed ${agentsPath}` : 'Analysis complete'}\n`);
  console.log('Recommended capabilities\n');
  for (const capability of recommendedCapabilities(detected, { sensitive: detected.signals?.some((signal) => ['authentication', 'database', 'payments'].includes(signal)) })) {
    console.log(`- ${capability.id}: ${capability.when}`);
  }
  console.log('');
  if (detected.guidanceFiles?.length) {
    console.log('Existing project guidance\n');
    for (const file of detected.guidanceFiles) console.log(`- ${file}`);
    console.log('');
  }
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

  if (suggestToolsMode) {
    printToolingSuggestions(detected);
    return;
  }

  const agentsPath = join(cwd, 'AGENTS.md');
  let approvedExistingProjectWrite = false;
  let updateMode = null;
  let interactionRl = null;
  if (detected.isProject) {
    reviewExisting(detected);
    interactionRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!existsSync(agentsPath)) {
      const apply = await ask(interactionRl, '\nApply a generated AGENTS.md from these recommendations? [y/N]: ');
      updateMode = /^y/i.test(apply) ? 'replace' : null;
    } else if (readFileSync(agentsPath, 'utf8').includes(START_MARKER)) {
      const apply = await ask(interactionRl, '\nUpdate the managed governance section? [y/N]: ');
      updateMode = /^y/i.test(apply) ? 'markers' : null;
    } else {
      const choice = await ask(interactionRl, '\nAGENTS.md is unmarked. Choose [a]ppend, [r]eplace, or [c]ancel [c]: ');
      updateMode = /^a/i.test(choice) ? 'append' : /^r/i.test(choice) ? 'replace' : null;
    }
    approvedExistingProjectWrite = true;
    if (!updateMode) {
      interactionRl.close();
      console.log('No files changed. Re-run when you are ready to apply the recommendations.');
      return;
    }
  }

  if (existsSync(agentsPath) && !force && !approvedExistingProjectWrite) {
    console.log('\nAGENTS.md already exists. Re-run with --force to overwrite, or merge manually.');
    process.exit(1);
  }

  const known = existsSync(agentsPath) ? knownAnswersFromAgents(readFileSync(agentsPath, 'utf8')) : {};
  const answers = await gatherAnswers(detected, known, interactionRl);
  if (interactionRl) interactionRl.close();
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
    if (name === 'AGENTS.md' && updateMode && existsSync(agentsPath)) {
      writeFileSync(agentsPath, updateAgentsMd(readFileSync(agentsPath, 'utf8'), content, updateMode), 'utf8');
      continue;
    }
    if (name !== 'AGENTS.md' && existsSync(join(cwd, name)) && !force) {
      console.log(`Skipping ${name} (already exists; use --force to overwrite)`);
      continue;
    }
    writeFileSync(join(cwd, name), content, 'utf8');
  }
  console.log('\nDone. Codex and other AGENTS.md-aware tools read AGENTS.md directly; Cursor users can add a .cursorrules pointer the same way.');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) main();

export { buildAgentsMd, knownAnswersFromAgents, recommendedCapabilities, suggestTooling, updateAgentsMd };
