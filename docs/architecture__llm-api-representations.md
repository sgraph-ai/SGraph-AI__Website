---
title: "Architecture Brief — LLM/API Representations of Pages (llms.txt, *.md, *.llm.json)"
author: "@Dev (dev.sgraph, Claude Opus 4.8)"
date: 2026-05-31
status: MVP SHIPPING — /llms.txt orchestrator + manifest + Lambda bootstrap built and proven against the live vault. CloudFront wiring pending (AWS account).
audience: a fresh Claude session extending the renderer set (*.md, *.llm.json) and @QA's assertion flow.
related:
  - docs/architecture__content-publishing-independence.md (the resolution chain reused here)
  - infra/lambda-edge/sg-edge-render/ (the bootstrap + deploy notes)
  - sgraph_ai_website/.../core/edge-render/v1/ (orchestrator + manifests)
---

# LLM/API Representations

## TL;DR

The human site is a client-side SPA that decrypts vault content in the browser —
so to a non-JS agent it is an empty shell. We expose **machine-readable
representations** of every page at stable URLs:

    /llms.txt                       site index (the standard, Jeremy Howard / Mintlify+Anthropic)
    /en-gb/library/<slug>.md        the page's Markdown source (Mintlify/Anthropic convention)
    /en-gb/library/<slug>.llm.json  structured page object (for @QA / agents)

These are produced **live from the encrypted vault** by a Lambda@Edge function —
so they inherit content-publishing independence: @Content publishes, the
representations update on the next request, no redeploy.

## Use cases

1. **Agents reading content** — RAG, "explain this page", citation. Markdown is
   the canonical vault source (no HTML-scrape fidelity loss).
2. **@QA verification** — fetch `*.llm.json` and assert on a typed object
   (links resolve, nav context correct, no `[decrypt failed]`, `commit_id ==
   HEAD`) instead of scraping the DOM. Comes with cryptographic provenance.

## Why not the obvious alternatives

- **Build-time static `.md`/`.json` (CI generates files):** re-introduces the
  redeploy coupling we just removed — content would be stale until deploy. Rejected.
- **`Accept: text/markdown` content negotiation:** wrecks CDN caching (`Vary`),
  hard to share/debug. We use explicit URL suffixes instead — what tools auto-try.
- **Prerender / headless scrape:** unnecessary — we own the Markdown *source* in
  the vault; no need to reverse-engineer it from rendered HTML.

## Design — three layers

The pivotal principle: **keep the edge function tiny and static; push all logic
to JS we control on the site, and all content/structure to the vault + manifests.**

### Layer 1 — Lambda@Edge bootstrap (`infra/lambda-edge/sg-edge-render/index.mjs`)

~50 lines incl. comments. Knows only (a) which URIs to intercept, (b) to load the
orchestrator from the **same host** and call it. One Lambda version attached to
all four distributions; the `Host` header selects the environment, so every site
runs its own branch's orchestrator. Almost never changes.

### Layer 2 — Orchestrator (`core/edge-render/v1/sg-edge-render.mjs`)

@Dev-controlled, shipped on the site via normal CI. Self-contained (no importmap
dependency, runs in Node). Maps URI → manifest, resolves the vault (ref → commit
→ tree-walk, identical chain to `sg-side-nav`), runs the named renderer, returns
text. New file types = new renderer here; the Lambda is untouched.

### Layer 3 — Manifests + Content Vault

`manifests/*.json` (we own the schema). A manifest names the vault + nav path,
the renderer `type`, and include/exclude/size knobs. **Editing the manifest
changes the output with no code change** (proven: capping `max_pages` shrank
`/llms.txt` from 6.5 KB to 1.5 KB with zero code edits). Manifests start in the
repo (shipped, @Dev) and can later move into the vault (@Content, no redeploy) —
same JSON either way.

### Manifest schema (`sg-render/v1`)

    {
      "schema": "sg-render/v1",
      "type": "llms.txt",                       // selects the renderer
      "content_type": "text/plain; charset=utf-8",
      "vault": { "id", "read_key", "nav_path" }, // read_key is public-by-design
      "site":  { "title", "summary", "base_path", "page_suffix" },
      "include": { "exclude_sections", "exclude_slugs", "max_pages" }
    }

`base_path` (not a full URL) keeps the manifest environment-agnostic — the
orchestrator builds the absolute `base_url` from the request Host, so one manifest
serves qa / dev / main / prod correctly.

## Host-derived load (four sites, one Lambda)

Sites: `qa.sgraph.ai`, `dev.sgraph.ai`, `main.sgraph.ai`, `sgraph.ai`, each a
CloudFront distribution aligned to a branch via CI. The bootstrap derives
`https://<Host>/core/edge-render/v1/sg-edge-render.mjs` from the request, so:

- one Lambda version, zero per-site config;
- each environment runs its own branch's code + manifests;
- changes flow dev → qa → main → prod through normal CI; the Lambda is never touched.

Same-origin load replaces third-party hash-pinning — the orchestrator is fetched
from the very origin CloudFront already serves.

## Status & next steps

- [x] Orchestrator + `llms.txt` renderer + manifest — built, proven on live vault.
- [x] Lambda bootstrap (host-derived, TTL module cache) + deploy README.
- [x] Local harness (`tests/edge-render/run-local.mjs`) — doubles as smoke check.
- [ ] CloudFront wiring: publish Lambda version (us-east-1), attach origin-request
      trigger to the four distributions for `/llms.txt` (+ `*.md`, `*.llm.json`).
- [ ] `markdown` renderer — per-page `*.md` (resolve slug in nav → article object).
- [ ] `json` renderer — `*.llm.json` for @QA (content + links[] + provenance).
- [ ] Optional v2: move manifests into the vault (@Content-controlled output shape).

## Limits

Lambda@Edge generated responses cap at 1 MB — ample for `/llms.txt` and per-page
`.md`. A future `llms-full.txt` near the cap should split per-section.
