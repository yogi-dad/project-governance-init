---
name: seo-review
description: Audit public-facing web pages for discoverability and search quality using evidence from the repository or live site. Use when reviewing SEO, metadata, indexing, structured data, content intent, or page performance.
---

# SEO review

Review only the scope the user names. Start by reading any product or marketing context in the repository. Ask for the audience, business goal, target topics, affected URLs, and known changes when they are not documented.

## Checks

- Crawlability: robots.txt, sitemap.xml, canonical URLs, redirects, status codes, and accidental noindex rules.
- Page basics: unique title, useful description, one clear main heading, descriptive links, image text alternatives, and stable URL intent.
- Structured data: valid JSON-LD that matches visible content; check rendered output for client-generated sites.
- Content: answer the target user's intent, use specific language, avoid keyword stuffing, and link related pages where useful.
- Performance and access: responsive rendering, keyboard access, readable contrast, and measured performance. Use PageSpeed or equivalent for field metrics.
- Indexation and ranking: use Search Console or a live search tool when access is provided; do not infer ranking from HTML alone.

## Evidence contract

Every finding must include the URL or file, the check performed, the observed output or excerpt, impact, fix, and priority. If a check cannot be measured, put it in an out-of-scope section with the tool needed. Never claim that schema, indexing, or rankings are absent without running the relevant check.
