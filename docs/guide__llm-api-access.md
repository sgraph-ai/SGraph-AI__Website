---
title: "Agent & API Access to sgraph.ai Content — /llms.txt, *.md, *.llm.json"
author: "@Dev (dev.sgraph, Claude Sonnet 4.6)"
date: 2026-05-31
status: LIVE — all four environments (qa / dev / main / sgraph.ai)
audience: AI agents, developers, @QA — anyone reading or verifying site content programmatically
---

# Machine-Readable Content at sgraph.ai

The sgraph.ai site is a client-side SPA that decrypts content in the browser.
To a non-JS agent it looks like an empty shell. These endpoints solve that:
every page in the library is available at a stable URL as plain text, Markdown,
or structured JSON — rendered live from the encrypted vault, no build step,
no redeploy.

---

## The Three URLs

### `/llms.txt` — site index

```
https://sgraph.ai/llms.txt
```

A structured index of the entire library following the
[llms.txt standard](https://llmstxt.org) (Jeremy Howard / Mintlify / Anthropic).
Format: plain text, Markdown conventions.

```
# sgraph.ai Library

> A public knowledge base on how sgraph.ai delivers content from encrypted
> vaults — cryptography, components, and trust boundaries.

Content is served live from an encrypted, content-addressed vault (id: pmcv9tfe).
Each page links to its Markdown source.

## Get Started
Practical walkthroughs for your first vault operations.

- [Walkthroughs Overview](https://sgraph.ai/en-gb/library/get-started.md)
- [How to Set Up Claude with sgit](https://sgraph.ai/en-gb/library/get-started/claude-setup.md)

## Use Cases
...
```

**Use it to:** discover all pages, get section structure, find the `.md` URL
for any article.

---

### `<page-path>.md` — article Markdown

```
https://sgraph.ai/en-gb/library/get-started/claude-setup.md
```

The raw Markdown source of a specific article, decrypted from the vault on
demand. The URL is the SPA page URL with `.md` appended.

```markdown
# How to Set Up Claude to Work with sgit

This walkthrough takes you from a default Claude session to one that can
create vaults, commit files, push to SG/Send, and collaborate with other
agents — all from a Claude chat window.

## What you need before you start

- A Claude account (claude.ai — Pro or Team for full computer use)
...
```

**Content-Type:** `text/markdown; charset=utf-8`

**Use it to:** read a page, summarise it, cite it, pass it to an LLM as
context. This is the canonical source — the SPA renders from this same vault
content, so there is no fidelity loss vs what a browser would show.

---

### `<page-path>.llm.json` — structured page object

```
https://sgraph.ai/en-gb/library/get-started/claude-setup.llm.json
```

A JSON object with the full article content plus metadata and cryptographic
provenance. Designed for @QA assertions and agent workflows that need typed
access to the content.

```json
{
  "schema": "sg-render/v1",
  "slug": "get-started/claude-setup",
  "title": "How to Set Up Claude with sgit",
  "description": "Configure Claude with network access and the sgit skill...",
  "content_markdown": "# How to Set Up Claude to Work with sgit\n\n...",
  "links": {
    "self":     "https://sgraph.ai/en-gb/library/get-started/claude-setup",
    "markdown": "https://sgraph.ai/en-gb/library/get-started/claude-setup.md",
    "json":     "https://sgraph.ai/en-gb/library/get-started/claude-setup.llm.json"
  },
  "source": {
    "vault_id":  "pmcv9tfe",
    "object_id": "obj-cas-imm-f826911d9c9f",
    "commit_id": "obj-cas-imm-0c7206cad899"
  },
  "resolved_at": "2026-05-31T21:35:57.448Z"
}
```

**Content-Type:** `application/json; charset=utf-8`

**Use it to:** assert page content in @QA, verify `commit_id == HEAD`,
check that no `[decrypt failed]` appears in `content_markdown`, confirm
links resolve.

---

## URL Convention

```
SPA page:   /en-gb/library/<slug>
Markdown:   /en-gb/library/<slug>.md
JSON:       /en-gb/library/<slug>.llm.json
```

Every library page has all three. The slug is the same in all cases.

**Examples:**

| SPA page | .md | .llm.json |
|---|---|---|
| `/en-gb/library/get-started` | `/en-gb/library/get-started.md` | `/en-gb/library/get-started.llm.json` |
| `/en-gb/library/get-started/claude-setup` | `/en-gb/library/get-started/claude-setup.md` | `/en-gb/library/get-started/claude-setup.llm.json` |
| `/en-gb/library/use-cases/agentic-js-api` | `/en-gb/library/use-cases/agentic-js-api.md` | `/en-gb/library/use-cases/agentic-js-api.llm.json` |

All slugs are listed in `/llms.txt`.

### Other content areas

The same `.md` / `.llm.json` convention works for the **Invest** sub-site
(vault `ub9jj0gq`), which is not linked from the main nav:

```
Markdown:   /en-gb/invest/<slug>.md
JSON:       /en-gb/invest/<slug>.llm.json
```

Example: `/en-gb/invest/the-ask.md`. New areas are added by dropping a manifest
into `core/edge-render/v1/manifests/` and registering the base path in the
orchestrator's `AREAS` table — no Lambda change.

---

## How the Content Stays Live

Content is stored encrypted in a vault (`pmcv9tfe`). When @Content publishes
(`sgit push`), the vault's HEAD ref updates. The next request to any of these
URLs re-reads the HEAD ref, walks the tree, and decrypts the latest content.
No redeploy. No cache invalidation. The change is live within seconds.

The `commit_id` in every response is the vault commit that was resolved —
cryptographic proof of which version of the content was returned.

---

## Response Headers

Every response carries tracing headers:

```
X-Sg-Commit:     obj-cas-imm-0c7206cad899   vault commit (content provenance)
X-Sg-Version:    v0.1.6                      Lambda@Edge bootstrap version
X-Sg-Cf-Version: v0.1.0                      CloudFront Function version
X-Sg-Site-Host:  sgraph.ai                   resolved environment hostname
Cache-Control:   no-store, no-cache, ...     always fresh (caching disabled)
```

If `X-Sg-Site-Host` shows an S3 bucket URL instead of `sgraph.ai`, the
CloudFront Function hasn't propagated yet. If the response is a 502, the
body contains the error message.

---

## Environments

All four environments serve these endpoints from their own branch's content:

| Environment | Base URL |
|---|---|
| Production | `https://sgraph.ai` |
| Main | `https://main.sgraph.ai` |
| QA | `https://qa.sgraph.ai` |
| Dev | `https://dev.sgraph.ai` |

The same Lambda function serves all four. Each environment loads its own
vault content and orchestrator via the `Host` header — so dev branch content
is always at `dev.sgraph.ai`, qa branch at `qa.sgraph.ai`, and so on.

---

## For AI Agents — Recommended Workflow

To read a specific page:

```
1. Fetch https://sgraph.ai/llms.txt  →  find the slug for the page you want
2. Fetch https://sgraph.ai/en-gb/library/<slug>.md  →  read the content
```

To read all pages in a section:

```
1. Fetch /llms.txt  →  find all slugs under the section heading
2. Fetch each <slug>.md in parallel
```

To verify content for @QA:

```
1. Fetch <slug>.llm.json
2. Assert: no "[decrypt failed]" in content_markdown
3. Assert: source.commit_id matches the expected vault HEAD
4. Assert: links.self, .markdown, .json all resolve with 200
```
