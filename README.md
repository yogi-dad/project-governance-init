# project-governance-init

Run once in any repo to stop re-inventing the same project setup every time. Detects your stack automatically, asks 3 questions it can't figure out on its own, then writes a single `AGENTS.md` (plus thin `CLAUDE.md`/`GEMINI.md` pointers) with a repeatable review workflow baked in: plan → delegate → correctness review → UX/a11y review → OWASP security review → lint/typecheck/coverage → completion sign-off.

Works with any AI coding tool: Codex and other AGENTS.md-aware tools read `AGENTS.md` directly; Claude Code and Gemini get a one-line pointer file so nothing is duplicated.

## Usage

```bash
node bin/init.mjs            # detect, ask 3 questions, write files
node bin/init.mjs --dry-run  # show what would be written, write nothing
node bin/init.mjs --force    # overwrite existing AGENTS.md/CLAUDE.md/GEMINI.md
node bin/init.mjs --review   # audit an existing AGENTS.md against the checklist, suggest gaps, write nothing
```

Run `--review` in a repo that already has an `AGENTS.md` (yours or hand-written) to get the same gap analysis without regenerating anything — checks for a delegation/review workflow section, an OWASP mention, coverage/secret-scanning/CI/dependency-scanning/error-monitoring notes, a UX/a11y step, and (when Supabase is detected) a tenant-isolation mention.

Or via npx once published:

```bash
npx project-governance-init
```

## What it does

1. Detects package manager, languages, monorepo layout, existing CI, and `build`/`lint`/`typecheck`/`test`/`test:cov`/`test:e2e` scripts from `package.json` — no question asked for anything it can read off disk.
2. Asks three questions:
   - One-line description of the project.
   - Does it handle sensitive data (PII/payments/health/credentials)?
   - Is it multi-tenant?
3. Generates `AGENTS.md` with sections tailored to those answers — e.g. multi-tenant projects get an explicit tenant-isolation review requirement; sensitive-data projects get the OWASP checklist flagged as mandatory, not optional.
4. Flags gaps it can detect rather than assuming coverage: no CI, no dependency scanning, no secret scanning.
5. Never overwrites an existing `AGENTS.md` without `--force`.

## Why not just re-ask Claude/Codex/Gemini every time?

Because the questions and the resulting checklist are the same across projects, and doing it from memory means gaps get missed (that's literally why this exists). This tool encodes the checklist once; each project only supplies the 3 answers that are actually project-specific.

## Extending

The whole generator is one file: `bin/init.mjs`. Edit `buildAgentsMd()` to change what gets written — there's no template engine or config format to learn.
