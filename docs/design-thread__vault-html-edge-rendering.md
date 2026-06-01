---
title: "Design Thread — HTML Pages from Vault via Edge Rendering"
author: "@Dev (dev.sgraph, Claude Sonnet 4.6)"
date: 2026-05-31
status: DESIGN — not yet started
audience: @Dev, @Content, architects
related:
  - docs/architecture__edge-render-resolution.md (how .md resolution works today)
  - docs/guide__llm-api-access.md (usage guide for current renderers)
  - infra/lambda-edge/sg-edge-render/ (Lambda bootstrap)
---

# Design Thread — Vault-Driven HTML Pages at the Edge

## The Problem with the Current Setup

HTML pages (`/en-gb/`, `/en-gb/product/`, etc.) currently live in the GitHub
repo as static `index.html` files. This creates several pain points:

- **Deployment coupling**: every content edit requires the full CI pipeline
  (commit → PR → merge → CI → deploy) across all four environments
- **Agent friction**: AI agents cannot edit HTML files easily — the format is
  not natural for agents and the deploy loop is too slow for iteration
- **No multi-lingual / multi-theme support**: adding a language variant means
  duplicating entire files with no shared structure
- **Wrong ownership**: page content should be owned by a content agent, not
  live in the @Dev-owned infrastructure repo
- **Static by nature**: `index.html` files don't change often, but when they
  do, the full CI cycle is disproportionate overhead

## The Proposed Model

Replace static S3 HTML with **vault-driven edge rendering** — the same
three-layer pattern already proven for `/llms.txt` and `*.md`:

```
Current:
  browser → CloudFront → S3 (static index.html from git repo)

Proposed:
  browser → CloudFront → Lambda@Edge → vault → assembled HTML
                                        ↑
                              (same Lambda already there)
```

The browser sees identical HTML. The source of truth moves from the git repo
to an encrypted vault controlled by a content agent.

---

## What Changes vs What Stays the Same

```
UNCHANGED                          CHANGES
─────────                          ───────
Lambda bootstrap (index.mjs)  →    INTERCEPT adds HTML paths
Vault crypto chain             →    new vault (pages vault)
Orchestrator structure         →    new renderHtml() renderer
Three-layer model              →    new manifests per page/section
CF Function (url-rewrite)      →    stop rewriting to index.html
                                    for vault-rendered paths
```

The Lambda bootstrap (Layer 1) needs one small addition to INTERCEPT:
paths like `/en-gb/` and `/en-gb/product/` that don't have a file extension.
Everything else flows through the existing pattern.

---

## Caching Strategy

This is the key architectural decision that differentiates the environments:

```
Environment    Cache policy         Publish trigger       Vault
───────────    ────────────         ───────────────       ─────
dev            CachingDisabled      vault push → live     dev vault
qa             CachingDisabled      vault push → live     dev vault
main           TTL (e.g. 1hr)       CI pipeline           prod vault
prod           TTL (e.g. 24hr)      CI pipeline           prod vault
```

**dev/qa behaviour** (same as current .md / .llms.txt):
- Every request is a cache miss → hits Lambda → hits vault
- Content is live within seconds of `sgit push`
- No CI, no redeploy, no @Dev involvement for content updates

**main/prod behaviour** (new):
- CloudFront caches the rendered HTML at the edge for the TTL period
- On CI pipeline merge to main/prod: `aws cloudfront create-invalidation`
- Vault push alone does NOT update live prod — must go through CI
- This gives prod stability: no accidental live updates from a dev vault push

The CI invalidation step:
```sh
aws cloudfront create-invalidation \
  --distribution-id ${CF_DISTRIBUTION_ID} \
  --paths "/en-gb/*"
```

---

## Two-Vault Model

```
dev vault                           prod vault
─────────                           ──────────
Owned by: @Pages (dev agent)        Owned by: @Pages (prod agent)
Used by:  dev + qa distributions    Used by:  main + prod distributions
Purpose:  experimentation, drafts   Purpose:  stable, published content
Promoted: explicit vault-to-vault   Backup:   zip on each CI deploy
          content promotion
```

**Promotion flow** (dev → prod):
```
@Pages agent:
  sgit clone <dev-vault-key>
  # review content
  sgit clone <prod-vault-key>
  # copy approved files, commit, push
```

Or via a CI step that cherry-picks specific paths from dev → prod vault on
merge to main.

**Vault backup on main/prod deploy**:
```sh
# In CI pipeline, after merge to main:
sgit pull  # get latest prod vault
zip -r vault-backup-$(date +%Y%m%d-%H%M%S).zip .sg_vault/
aws s3 cp vault-backup-*.zip s3://sgraph-ai-backups/prod/
```

This gives a point-in-time snapshot of every prod vault state, correlated
with the git commit that triggered the deploy.

---

## Vault Structure for HTML Pages

Mirror the URL structure directly:

```
pages vault (prod)
├── en-gb/
│   ├── index.html          ← /en-gb/ landing page
│   ├── product/
│   │   └── index.html      ← /en-gb/product/
│   └── about/
│       └── index.html
├── _manifest.json          ← site-level metadata
└── _nav.json               ← site navigation
```

The Lambda resolves the URI path directly via tree walk:
```
/en-gb/product/  →  strip trailing slash  →  path: "en-gb/product/index.html"
                 →  resolvePath(vault, key, "en-gb/product/index.html")
                 →  decrypt blob
                 →  return text/html
```

This is simpler than the library pattern — no nav lookup needed, just a
direct path resolution. The tree walk is 3-4 round-trips (ref → commit →
tree walk → blob).

---

## The renderHtml() Renderer

Minimal first pass — return the vault blob verbatim:

```javascript
async function renderHtml(manifest, _nav, ctx) {
  const { slug, commit } = ctx
  const key = b64url(manifest.vault.read_key)

  // Direct path resolution: no nav lookup needed
  const { blob } = await resolvePath(manifest.vault.id, key, slug)
  if (!blob) throw new Error(`page not found: ${slug}`)

  const buf = await readObject(manifest.vault.id, blob, key)
  return { body: buf.toString('utf8'), meta: { slug } }
}
```

For this renderer, the "nav" step can be skipped — the path IS the address.
This means the HTML renderer doesn't need `nav_path` in its manifest, just
`vault.id` and `vault.read_key`.

---

## CloudFront Function Change

Currently `url-rewrite-for__sgraph-ai` rewrites SPA paths:
```
/en-gb/library/slug/  →  /en-gb/library/index.html
```

For vault-rendered pages, these rewrites become unnecessary — the Lambda
handles the path directly. The CF Function needs to:
1. **Not rewrite** paths that will be handled by the Lambda
2. **Still rewrite** paths that remain as SPA (the library, if it stays SPA)

The cleanest approach: add an explicit allow-list of vault-rendered paths to
the CF Function. Anything on the list passes through unchanged; everything
else gets the existing SPA rewrite logic.

```javascript
// Paths handled by Lambda@Edge (vault-rendered) — skip SPA rewrite
var VAULT_RENDERED = ['/en-gb/', '/en-gb/product/', '/en-gb/about/']
if (VAULT_RENDERED.some(function(p) { return uri === p || uri.startsWith(p) })) {
  return request  // Lambda will handle it
}
// ... existing SPA rewrite logic below
```

---

## INTERCEPT Update (Lambda bootstrap)

```javascript
// current
const INTERCEPT = uri =>
  typeof uri === 'string' && (
    uri === '/llms.txt' ||
    uri.endsWith('.md') ||
    uri.endsWith('.llm.json')
  )

// proposed — add HTML page paths
const VAULT_HTML_PATHS = ['/en-gb/']  // expand as pages are migrated

const INTERCEPT = uri =>
  typeof uri === 'string' && (
    uri === '/llms.txt'         ||
    uri.endsWith('.md')         ||
    uri.endsWith('.llm.json')   ||
    VAULT_HTML_PATHS.some(p => uri === p || uri.startsWith(p))
  )
```

Or — cleaner for the long term — add a `VAULT_HTML_PREFIX` to the manifest
and make INTERCEPT data-driven. But for the first pass, an explicit list is
fine.

---

## Building Blocks (Future v2 Idea — Not for First Pass)

The user's insight: if the HTML page itself comes from the vault, you can go
further and store it as **components** that are assembled at the edge:

```
vault
├── components/
│   ├── header.html
│   ├── footer.html
│   └── nav.html
├── templates/
│   └── page.html        ← {{ header }} {{ content }} {{ footer }}
├── pages/
│   └── en-gb/
│       └── product/
│           └── content.html   ← just the content block
└── themes/
    ├── default.css
    └── dark.css
```

The renderer assembles: `header + content + footer → complete HTML`.
Multi-lingual: `pages/en-gb/` vs `pages/fr-fr/` with shared components.
Multi-theme: swap the CSS blob based on a query param or cookie.

This is a full edge-side JS/CSS/HTML bundler. Keep for v2 — prove the basic
vault→HTML path first.

---

## Migration Path (Recommended Sequence)

```
Phase 1 — Prove the pattern (one page)
  • Create dev vault, push /en-gb/index.html into it
  • Add renderHtml() renderer to orchestrator
  • Add INTERCEPT rule for /en-gb/
  • CF Function: pass /en-gb/ through to Lambda
  • Test on qa: live HTML from vault, identical to current

Phase 2 — Migrate remaining pages
  • Push all /en-gb/** pages to vault
  • Wire Lambda INTERCEPT for all paths
  • Verify on qa, then promote to main

Phase 3 — Production caching
  • Enable TTL cache policy on main/prod distributions
  • Add CF invalidation to CI pipeline
  • Set up two-vault model (dev + prod)
  • Add vault backup step to CI

Phase 4 — Components (v2, future)
  • Decompose HTML into components + templates
  • Build renderHtmlComposed() renderer
  • Multi-lingual variants
  • Theme switching
```

---

## Open Questions

1. **Which pages first?** All `/en-gb/` at once, or start with one (e.g. home)?
2. **Who owns the pages vault?** New @Pages agent or @Content extended?
3. **Do current `index.html` files need transformation** before going into vault, or verbatim?
4. **CF Function**: extend existing `url-rewrite-for__sgraph-ai` or a new function?
5. **Read key visibility**: pages vault read key — public (like library) or private?
   (If the HTML is public anyway, public read key is fine and follows the same pattern)
6. **SPA vs edge-rendered**: does the library stay SPA (client-side decrypt) or
   also migrate to edge rendering? (Probably stay SPA for now — different use case.)
