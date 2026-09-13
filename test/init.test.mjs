import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAgentsMd, knownAnswersFromAgents, recommendedCapabilities, updateAgentsMd } from '../bin/init.mjs';

const cli = join(process.cwd(), 'bin', 'init.mjs');

function review(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'project-governance-init-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(dir, name);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
    }
    return execFileSync(process.execPath, [cli, '--review'], { cwd: dir, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('review starts the full interview for an empty folder', () => {
  assert.match(review(), /No project signals found\. Start with the full setup interview\./);
});

test('review analyzes an actual project without writing governance files', () => {
  const output = review({ 'package.json': '{"name":"demo","description":"Demo app","scripts":{"test":"node --test"}}' });
  assert.match(output, /Project analysis/);
  assert.match(output, /No AGENTS\.md found/);
  assert.match(output, /"description": "Demo app"/);
  assert.doesNotMatch(output, /Reviewed .*AGENTS\.md/);
});

test('review recognizes source files as an existing project', () => {
  const output = review({ 'src/main.js': 'export default null;\n' });
  assert.match(output, /Project analysis/);
});

test('review recognizes a root-level source file as an existing project', () => {
  const output = review({ 'main.py': 'print("hello")\n' });
  assert.match(output, /Project analysis/);
});

test('review reuses the first README paragraph as project context', () => {
  const output = review({ 'README.md': '# Demo\n\nA small tool for reviewing projects.\n' });
  assert.match(output, /"description": "A small tool for reviewing projects\."/);
});

test('review discovers repository-owned guidance files', () => {
  const output = review({ 'package.json': '{"name":"demo"}', 'docs/definition-of-ready.md': '# Ready\n', '.aiassistant/00-project/security-baseline.md': '# Security\n', 'skills/custom/SKILL.md': '---\nname: custom\n---\n' });
  assert.match(output, /"guidanceFiles": \[/);
  assert.match(output, /docs[\\\\/]definition-of-ready\.md/);
  assert.match(output, /\.aiassistant[\\\\/]00-project[\\\\/]security-baseline\.md/);
  assert.match(output, /skills[\\\\/]custom[\\\\/]SKILL\.md/);
});

test('review flags an oversized root AGENTS file', () => {
  const output = review({ 'package.json': '{"name":"demo"}', 'AGENTS.md': `# Instructions\n${'detail\n'.repeat(4000)}` });
  assert.match(output, /Root AGENTS\.md is large/);
});

test('review classifies a React project as web', () => {
  const output = review({ 'package.json': '{"name":"demo","dependencies":{"react":"latest"}}' });
  assert.match(output, /"projectType": "web"/);
});

test('review detects sensitive integration areas from dependencies', () => {
  const output = review({ 'package.json': '{"name":"demo","dependencies":{"prisma":"latest","stripe":"latest"}}' });
  assert.match(output, /"signals": \[\s*"database",\s*"payments"\s*\]/);
  assert.match(output, /Database integration detected/);
  assert.match(output, /Payment integration detected/);
  assert.match(output, /Recommended capabilities/);
  assert.match(output, /security-review/);
});

test('review detects a Python project manager', () => {
  const output = review({ 'pyproject.toml': '[tool.poetry]\nname = "demo"\n', 'poetry.lock': '' });
  assert.match(output, /"packageManager": "poetry"/);
});

test('review classifies common Python API frameworks as API', () => {
  const output = review({ 'pyproject.toml': '[project]\ndependencies = ["fastapi"]\n', 'uv.lock': '' });
  assert.match(output, /"projectType": "api"/);
});

test('review classifies native iOS markers as mobile', () => {
  const output = review({ 'Package.swift': '// swift-tools-version:5.9\n' });
  assert.match(output, /"projectType": "mobile"/);
});

test('generated governance provides a native test command for Rust', () => {
  const output = buildAgentsMd({ projectType: 'general', languages: ['rust'], packageManager: 'cargo', monorepo: false, commands: {}, ci: false, dependencyScanning: false, secretScanning: false }, {
    description: 'Demo', users: 'users', success: 'outcome', criticalFlows: 'flow', deployment: 'ops', integrations: 'none', constraints: 'none', risks: 'none', sensitive: false, multiTenant: false,
  });
  assert.match(output, /Test: cargo test/);
});

test('generated governance includes project-type guardrails', () => {
  const output = buildAgentsMd({ projectType: 'api', languages: [], packageManager: null, monorepo: false, commands: {}, ci: false, dependencyScanning: false }, {
    description: 'API', users: 'users', success: 'uptime', criticalFlows: 'login', deployment: 'ops', integrations: 'db', constraints: 'privacy', risks: 'none', sensitive: true, multiTenant: false,
  });
  assert.match(output, /Project type: api/);
  assert.match(output, /authentication and authorization server-side/);
  assert.match(output, /Definition of ready/);
  assert.match(output, /Definition of done/);
});

test('capability recommendations stay vendor-neutral', () => {
  const capabilities = recommendedCapabilities({ projectType: 'api', signals: ['database', 'payments'], commands: { test: 'test' } }, { sensitive: true, multiTenant: true });
  assert.deepEqual(capabilities.map(({ id }) => id), ['correctness-review', 'security-review', 'privacy-review', 'test-verification']);
  assert.match(capabilities[1].fallback, /OWASP/);
  assert.doesNotMatch(JSON.stringify(capabilities), /Claude|Gemini|Codex/);
});

test('front-facing projects get design, writing, and SEO capabilities', () => {
  const capabilities = recommendedCapabilities({ projectType: 'web', signals: ['ui'], commands: {} });
  assert.deepEqual(capabilities.map(({ id }) => id), ['correctness-review', 'ui-accessibility-review', 'design-preferences', 'authentic-writing', 'seo-review']);
  assert.match(capabilities.find(({ id }) => id === 'design-preferences').fallback, /glass/);
  assert.doesNotMatch(JSON.stringify(capabilities), /Claude|Gemini|Codex/);
});

test('existing generated context is reusable for the next interview', () => {
  const answers = knownAnswersFromAgents('- Primary user: clinicians\n- Success outcome: safe triage\n- Deployment and release owner: platform team\n');
  assert.deepEqual(answers, { users: 'clinicians', success: 'safe triage', deployment: 'platform team' });
});

test('generated gaps reflect detected CI and scanners', () => {
  const output = buildAgentsMd({ projectType: 'general', languages: [], packageManager: null, monorepo: false, commands: {}, ci: true, dependencyScanning: true, secretScanning: true }, {
    description: 'Demo', users: 'users', success: 'outcome', criticalFlows: 'flow', deployment: 'ops', integrations: 'none', constraints: 'none', risks: 'none', sensitive: false, multiTenant: false,
  });
  assert.match(output, /CI workflows detected/);
  assert.doesNotMatch(output, /No dependency vulnerability scanning detected/);
  assert.doesNotMatch(output, /No automated secret scanning detected/);
});

test('approved update replaces only the generated marker block', () => {
  const existing = 'Manual instructions\n\n<!-- project-governance-init:start -->\nold generated\n<!-- project-governance-init:end -->\n\nKeep this too.\n';
  const updated = updateAgentsMd(existing, '<!-- project-governance-init:start -->\nnew generated\n<!-- project-governance-init:end -->\n', 'markers');
  assert.match(updated, /^Manual instructions/);
  assert.match(updated, /Keep this too/);
  assert.doesNotMatch(updated, /old generated/);
  assert.match(updated, /new generated/);
});
