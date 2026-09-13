---
name: secure-server
description: "Audit a Linux server's infrastructure for security issues, categorize findings by severity (P0-P3), and fix them one at a time via dependency-ordered subagents with verification and confirmation gates."
---

# secure-server

A repeatable workflow for auditing and hardening a real, possibly-already-in-production Linux server, run by the orchestrating (main) agent — not delegated wholesale to a single subagent, because it needs to ask the user questions and make sequencing judgment calls between fixes.

This is a multi-phase workflow: **Audit → Categorize → Confirm → Fix (dependency-ordered) → Verify → Report**. Do not skip phases or collapse them — the categorize/confirm step exists specifically so the user sees the full picture before anything changes.

## Hard rules (apply throughout, learned the hard way)

- **This server may already run other production services you don't know about.** Before touching any shared resource (ports 80/443, a docker network, a systemd service, ufw rules), inventory what's already there: `docker ps -a`, `docker network ls`, `ss -ltnp`, existing compose files under `/opt` or similar. Never assume greenfield. If you find an existing reverse proxy, database, or app already serving traffic, work *with* it (add a server block, join its network) rather than replacing it.
- **Never take down or degrade a working, unrelated production service to fix something else.** After every change that touches shared config (nginx, docker daemon, firewall), immediately verify the pre-existing services still respond correctly (curl a health endpoint, check container status) before moving on. If a fix would require real downtime, ask the user first — don't assume a maintenance window.
- **Docker single-file bind mounts go stale on edit.** If a config file is mounted into a container with `./file:/path/file:ro` (a single-file mount, not a directory mount), editing that file on the host via a tool that replaces-and-renames (most file-editing tools do) changes its inode, and the container keeps serving the *old* inode's content — `nginx -t` / `-s reload` will silently test/reload stale content. After editing any such mounted file: compare `stat -c '%i'` on host vs. `docker exec <container> stat -c '%i'` on the same path; if they differ, you must `docker restart <container>` (not just reload) to pick up the real content, then re-validate.
- **No passwordless sudo should be assumed.** Try one non-mutating sudo command (e.g. `sudo -n true`) to check. If it fails, do not repeatedly prompt for sudo — print the exact command(s) for the user to run themselves, explain what they do and why, and wait for confirmation before treating that step as done. Don't fabricate or assume the outcome.
- **Never print actual secret values** (passwords, API keys, private key material, tokens) in any report or message, even partially. Describe presence/absence/strength qualitatively only ("looks sufficiently random", "reused across services", "empty").
- **Respect the user's stated scope.** If they say "don't break X" or "only touch Y", that constraint applies to every subagent you spawn for the rest of the workflow, not just the next action — restate it explicitly in every fixer subagent's prompt.
- **Destructive or hard-to-reverse actions always get a confirmation gate** before executing, regardless of severity category: firewall changes, service restarts on shared infra, key/secret rotation, deleting anything, force-pushes, DB schema changes. Routine, easily-reversible, single-service changes (adding a log rotation option to one container, writing a new isolated config file) can proceed without a question if the user has already approved the category (see Phase 3).

## Phase 1 — Discovery & Audit (read-only)

Spawn one or more **read-only** audit subagents (general-purpose type) to cover the surface areas relevant to this server. Split by domain so they can run in parallel and stay within context budgets; a single host with one compose stack can usually be one agent, a host with multiple stacks/apps should get one agent per stack plus one for host-level concerns (firewall, SSH, orphan processes, Docker daemon config).

Each audit agent's prompt must explicitly state:
- **Read-only**: no edits, no writes, no mutating `docker`/`systemctl`/`ufw`/`fail2ban-client` commands — inspection only (`docker inspect`, `docker ps`, `cat`, `ls`, `stat`, `grep`, `curl -I`, `docker exec ... cat`).
- The specific things to check (tailor per context, but the checklist below is a strong default):
  1. Network exposure: `docker ps` port mappings across the *whole host* (not just the target stack), `ss -ltnp`, ufw/iptables status, what's bound to `0.0.0.0` vs `127.0.0.1`.
  2. Reverse proxy / TLS config: security headers present or missing, rate limiting present or missing, cert validity and renewal setup, any server blocks with no auth in front of sensitive paths.
  3. Secrets handling: env files and credential files — permissions (world-readable is bad), whether they're baked into images/compose vs. externalized, whether default/weak values are in use (qualitative only).
  4. Datastores (DB, cache, queue): auth enabled or not, bind address, whether the app uses a scoped low-privilege credential vs. root/admin.
  5. Container hardening: `cap_drop`, `no-new-privileges`, read-only rootfs, resource limits — present or absent per service.
  6. Logging: Docker log driver options (`max-size`/`max-file`) — unbounded growth risk.
  7. Orphan/undocumented containers: anything running that isn't in the known compose file(s) — flag as a finding even if it looks intentional, since it's invisible to normal deploy/update flow.
  8. Host-level: SSH config (password auth allowed?, root login?), unattended-upgrades, fail2ban/ufw presence.
- Report format: a flat list of findings, each with a one-line risk description and a one-line suggested fix — no fixing, no fluff, under ~500 words per agent.

Wait for all audit agents to complete before moving to Phase 2. Do not start fixing anything during this phase, even if an agent flags something you already know how to fix.

## Phase 2 — Categorize

Consolidate all findings into a single prioritized list using these bands (a P0 in a toy/dev-only server may only be P1 — use judgment about actual blast radius, not just the abstract pattern):

- **P0 — Critical**: exploitable right now, remotely, without extra preconditions — open datastore with no auth reachable from the app network or worse, secrets readable by any local user, an authentication bypass, a publicly exposed admin/debug endpoint.
- **P1 — High**: a real weakness that needs some precondition to bite (missing security headers, no rate limiting on auth endpoints, an unmanaged/orphan container with network access, legacy/weak crypto config, stale unpinned images on anything internet-facing).
- **P2 — Medium**: defense-in-depth gaps, not directly exploitable alone (missing container capability dropping, no log rotation, no resource limits, missing 2FA).
- **P3 — Low**: hygiene / best-practice, no meaningful risk on its own (deprecated config syntax warnings, minor version-notification/telemetry settings).

Present this categorized list to the user as the response to their audit request (this is itself useful output even if they don't want fixes applied yet). Do not proceed to fixing without the user seeing this list first.

## Phase 3 — Confirm scope

Ask the user (AskUserQuestion is appropriate here) which categories/items to act on now. Reasonable default options: "Fix P0 only", "Fix P0 + P1", "Fix everything", "Let me pick specific items". If they picked specific items in their original request (e.g. "fix the two critical ones"), you can skip re-asking and proceed straight to Phase 4 for those items — but still surface the full categorized list first so they know what's being deferred.

## Phase 4 — Build the dependency graph, then fix one item at a time

Before dispatching any fixer, sketch the dependency relationships among the approved fixes:

- **Same shared file/resource → sequential.** Two fixes that both edit the same nginx config, the same compose file, or both need a `docker restart` of the same container must not run concurrently — one subagent's edit can clobber or race the other's, and simultaneous restarts of a shared proxy compound risk. Serialize these explicitly.
- **Independent services/files → safe to parallelize**, but still verify after each completes rather than batching all verification at the end, so a failure is caught close to its cause.
- **Ordering matters when one fix's precondition is another's output** — e.g., "add rate limiting to nginx" and "add security headers to nginx" both touch the same file/server block, so do them as one combined edit or strictly in sequence, not as two racing subagents. "Set Redis auth" must land before "update app's Redis connection string to include the password" (or be done as a single fix if they're tightly coupled — don't artificially split a single logical change across two subagents just to parallelize).

For each fix, in dependency order:

1. State briefly what you're about to do and its blast radius (which service(s) it touches, whether it's reversible, whether it risks the shared production services).
2. If it's destructive/hard-to-reverse/production-impacting per the Hard Rules above, confirm with the user first — even if they approved the category in Phase 3, a specific irreversible action (e.g. rotating a credential, restarting the shared proxy) still deserves a heads-up given the "cost of pausing is low, cost of surprise is high" principle.
3. Spawn a dedicated subagent scoped to exactly that one fix. Its prompt must include:
   - The exact finding being addressed and why it matters (don't make it re-derive the audit).
   - The specific files/services in scope, and explicitly what's **out of scope** ("do not touch nginx server blocks for other domains", "do not restart eom_mysql", etc. — restate the user's original constraints here).
   - The verification step it must perform after the change (e.g. `curl` a health endpoint, `docker compose ps`, `nginx -t` with the inode-staleness check above) and report pass/fail.
   - That it should stop and report back rather than improvising if it hits something unexpected (an existing config it didn't know about, a permissions wall, a service it can't safely restart).
4. Wait for that subagent to finish. Independently re-verify anything that touches shared/production-adjacent resources yourself (don't just trust the subagent's self-report for high-blast-radius changes) before starting the next dependent fix.
5. If a fix or its verification fails, stop the chain for anything depending on it, report the failure clearly, and ask the user how to proceed rather than guessing or rolling back unilaterally.

## Phase 5 — Report

Summarize: what was fixed (and verified), what was explicitly deferred and why, what still needs the user to run manually (anything requiring sudo you don't have, anything requiring a decision only they can make), and any new reusable artifacts created (config files, jail definitions, cron jobs) with their locations. Keep it scannable — a short table or bulleted list per category, not prose.