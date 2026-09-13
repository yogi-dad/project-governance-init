# project-governance-init

`project-governance-init` is a small, zero-dependency CLI for starting work in an unfamiliar codebase with clear project context and repeatable review habits.

It is for people who use AI coding tools to build apps, APIs, mobile products, libraries, scripts, and prototypes. It is especially useful when the person describing the product, the person writing code, and the person reviewing the result are different people—or when one person is doing all three with an AI assistant.

## Why this repository exists

AI coding tools are good at producing code quickly. They cannot know a project's real purpose, users, release constraints, data obligations, or definition of “done” unless someone records those things. Starting with a blank folder also makes it easy to skip tests, security review, accessibility checks, or a release plan.

Teams often solve this by repeating the same setup conversation in every repository. The questions vary in wording and the resulting instructions live in different places. Important details get lost when the project changes tools or when a new contributor joins.

This CLI turns that setup into a repeatable repository artifact: an `AGENTS.md` containing project context, commands, guardrails, review stages, known gaps, and portable capability recommendations. The file is plain Markdown, so it remains useful when the team changes AI providers or works without an AI tool.

## Who should use it

Use it when:

- You are starting an application in an empty directory and want to establish scope before writing features.
- You are joining an existing repository and need a quick picture of its stack, commands, risks, and missing safeguards.
- You use more than one AI coding tool and want one source of project instructions instead of separate vendor-specific copies.
- You are building a sensitive product involving personal data, payments, health information, credentials, authentication, or tenant isolation.
- You want an AI-assisted project to have a written definition of success and a review path that survives the original author.

It is not a project-management system, an automatic security certification, or a replacement for a human who understands the product. It creates a useful starting point and makes gaps visible.

## How the workflow works

Run the CLI from the folder you want to initialize:

```bash
npx project-governance-init
```

The CLI first looks for signs of a real project. It checks package and build manifests, source files, common source directories, Docker and Terraform files, README content, CI workflows, dependency files, and package scripts. A Git directory or IDE settings alone do not count as a project.

### Empty folder

An empty folder starts an interview. The questions cover the information tools cannot safely infer:

- What the project does and who uses it.
- What outcome proves that it is working.
- Whether it handles sensitive data or needs tenant isolation.
- Where it runs and who owns releases.
- Which user flow must not break.
- Which external systems it trusts.
- What cannot be compromised, such as privacy, compatibility, a deadline, or performance.
- The largest known risk or unfinished area.

Answers are written into the generated project context. Blank answers become visible placeholders rather than invented facts.

### Existing project

An existing project is reviewed before anything is written. The report includes detected languages, package manager, project type, scripts, CI and scanning configuration, dependency signals, and checklist gaps. It also recommends portable capabilities that match the evidence.

The first run is read-only until the user confirms. If `AGENTS.md` already exists, the CLI asks how to handle it:

- Cancel and keep the file unchanged.
- Append a marked generated section below the existing content.
- Replace the entire file.

Generated files contain `project-governance-init` start and end markers. Future updates replace only the marked section, so manually maintained instructions outside that section remain intact.

Use `--review` when you want the analysis and recommendations without any confirmation prompt or file changes.

## What gets generated

The normal run can create:

- `AGENTS.md`, the single source of project instructions.
- `CLAUDE.md`, a thin pointer to `AGENTS.md`.
- `GEMINI.md`, a thin pointer to `AGENTS.md`.

The generated `AGENTS.md` contains:

- Project overview and success context.
- Definitions of ready and done for each change.
- Detected technology and native build/test commands.
- Project-type guardrails for web, API, mobile, CLI, library, or general projects.
- Integration signals for UI, authentication, databases, and payments.
- A staged workflow: plan, delegate, correctness review, UI/accessibility review, security review, verification, and sign-off.
- Known gaps such as missing CI, dependency scanning, or secret scanning.
- Portable capability recommendations with manual fallbacks.
- Sections for coding conventions and unfinished work that the team can complete later.

## Portable skills, agents, and plugins

The generated recommendations never require a named AI provider. They use capability labels such as:

```md
### security-review
When: Authentication, databases, payments, sensitive data, or tenant isolation are involved.
Use: the installed security reviewer, agent, or plugin for trust-boundary and OWASP analysis.
Fallback: Apply the OWASP checklist in this file and verify every authorization check server-side.
```

For web and mobile work, the interview also records visual direction (for example glass, flat, editorial, dense, or minimal) and content voice. It recommends `design-preferences` for the UI intake, `authentic-writing` for direct user-facing copy, and `seo-review` for public web discoverability. Each label can map to a local Claude, Codex, Gemini, or other tool skill; the generated fallback remains usable without one.

An AI tool can map `security-review` to its own installed skill, agent, or plugin. A tool that has no matching extension can follow the fallback instructions. This repository also ships fallback skills in [`skills/`](skills/): `design-preferences`, `authentic-writing`, `seo-review`, `secure-server`, and `aeo-geo-seo-website-optimizer`. They are plain Markdown and can be read by any coding tool.

## Commands

```bash
node bin/init.mjs            # analyze, then interview or ask for update approval
node bin/init.mjs --review   # analyze and recommend; never write files
node bin/init.mjs --dry-run  # show planned output; never write files
node bin/init.mjs --force    # allow pointer files and full replacement when selected
npm test                     # run the native Node test suite
```

The CLI has no runtime dependencies. It uses Node's standard library for file inspection, prompts, and writing.

## Detection coverage

The detector recognizes JavaScript and TypeScript package managers (`npm`, `pnpm`, `yarn`, and `bun`), Python (`uv` and Poetry), Go, Rust, Maven, Gradle, and Swift Package Manager. It recognizes Python API frameworks (FastAPI, Flask, Django), native iOS markers, Android markers, and common project types from dependencies and metadata.

When a project has no package scripts, generated instructions use native test commands where there is a safe convention, such as `go test ./...`, `cargo test`, `uv run pytest`, `mvn test`, or `gradle test`. Unknown commands are left for the project owner to fill in.

Detection is intentionally conservative. A dependency name or folder is a signal for a recommendation, not proof that a feature is configured correctly. Review the report and correct any false positives before accepting generated instructions.

## Safety and privacy boundaries

The CLI reads local filenames and selected text files to build recommendations. It does not send repository contents to a service and it has no network dependency at runtime. It does not infer or store secrets. The generated file can contain whatever answers the user provides, so do not enter credentials, private keys, or raw personal records into the interview.

The tool reports security and privacy work that still needs to happen. Passing its tests or generating an `AGENTS.md` does not prove that an application is secure, compliant, accessible, or ready to ship.

## Development

Clone the repository, then run:

```bash
npm test
node --check bin/init.mjs
```

The implementation is intentionally kept in one CLI file. Tests in `test/` use Node's built-in test runner and temporary directories; no test framework or dependency installation is required.

Before publishing, inspect the package contents:

```bash
npm pack --dry-run
```

The package allowlist publishes only the CLI, README, and package metadata. GitHub Actions runs the test suite on pushes and pull requests.

## Extending the project

Small changes usually belong in `bin/init.mjs`:

- Add a detector when a new manifest or lockfile gives reliable evidence.
- Add a capability when a recurring review responsibility has a clear trigger and manual fallback.
- Add a project-type guardrail when a platform has rules that differ from the general workflow.
- Add a fixture test before changing detection or generated output.

Keep recommendations evidence-based. If the tool cannot determine something from the repository, ask the user or mark it as unknown instead of guessing.
