---
title: "Architecture Deep-Dive — /llms.txt via Lambda@Edge + Encrypted Vault"
author: "@Dev (dev.sgraph, Claude Sonnet 4.6)"
date: 2026-05-31
status: LIVE on qa.sgraph.ai/llms.txt
audience: engineers extending the renderer set; agents onboarding to the stack
---

# How `/llms.txt` Works — End to End

A visitor (or AI agent) hits `https://qa.sgraph.ai/llms.txt` and receives
a live, machine-readable index of the entire library — rendered from an
**encrypted vault** by a **90-line edge function**, with no server, no build
step, and no redeploy when content changes.

This document traces every layer: CloudFront → Lambda@Edge → orchestrator →
vault → rendered text. It also explains who controls what, and how to extend
the system to new file types.

---

## 1. The Full Request Flow

```
Browser / AI agent / curl
        │
        │  GET https://qa.sgraph.ai/llms.txt
        ▼
┌─────────────────────────────────────────────────────────────┐
│  CloudFront  (distribution E3J38IKLQX1LG — QA)             │
│                                                             │
│  ① Viewer-request  ──►  url-rewrite-for__sgraph-ai          │
│     CloudFront Function (v0.1.0)                           │
│     • Stamps X-Sg-Site-Host: qa.sgraph.ai                   │
│     • Stamps X-Sg-Cf-Version: v0.1.0                       │
│     • URI has a dot → no rewrite, passes through           │
│                                                             │
│  ② Cache check  ──►  MISS  (CachingDisabled policy)        │
│                                                             │
│  ③ Origin-request  ──►  sg-website-edge-render (v0.1.6)     │
│     Lambda@Edge (us-east-1)                                 │
│     • Reads X-Sg-Site-Host → "qa.sgraph.ai"                │
│     • Intercepts /llms.txt  ✓                               │
│     • Fetches + runs orchestrator from qa.sgraph.ai         │
│     • Returns 200 text/plain with rendered body             │
│                                                             │
│  ④ Response returned directly (generated response,          │
│     never touches S3)                                       │
└─────────────────────────────────────────────────────────────┘
        │
        │  HTTP/2 200
        │  Content-Type: text/plain; charset=utf-8
        │  X-Sg-Version:    v0.1.6
        │  X-Sg-Cf-Version: v0.1.0
        │  X-Sg-Site-Host:  qa.sgraph.ai
        │  X-Sg-Commit:     obj-cas-imm-0c7206cad899
        │  Cache-Control:   no-store, no-cache, must-revalidate
        ▼
  # sgraph.ai Library
  > A public knowledge base ...
  ## Get Started
  - [How to Set Up Claude with sgit](https://qa.sgraph.ai/...)
  ...
```

**Why two functions?** CloudFront Functions (viewer-request) are
sub-millisecond JavaScript — ideal for header stamping and URI rewrites.
Lambda@Edge (origin-request) is full Node.js with network access — required
for the vault fetch + crypto. Each does only what it can do.

---

## 2. Three-Layer Architecture

The pivotal design principle: **keep the edge function tiny; push all logic
and all content outward**.

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1 — Lambda@Edge Bootstrap                                 │
│  infra/lambda-edge/sg-edge-render/index.mjs  (~90 lines)        │
│                                                                  │
│  Knows only:                                                     │
│    • which URIs to intercept (/llms.txt, *.md, *.llm.json)      │
│    • how to load the orchestrator from the request host          │
│    • how to read X-Sg-Site-Host to recover the real hostname     │
│                                                                  │
│  Changes: almost never. One version attached to all 4 distros.  │
├──────────────────────────────────────────────────────────────────┤
│  Layer 2 — Orchestrator                                          │
│  /core/edge-render/v1/sg-edge-render.mjs  (~163 lines)          │
│  Shipped on the site like any JS asset. Fetched at runtime.      │
│                                                                  │
│  Knows:                                                          │
│    • vault resolution chain (ref → commit → tree → blob)        │
│    • renderer registry  { 'llms.txt': fn, 'markdown': fn, … }   │
│    • manifest → renderer routing                                 │
│                                                                  │
│  Changes: @Dev, via normal CI. New file type = new renderer.     │
│           Lambda is never touched.                               │
├──────────────────────────────────────────────────────────────────┤
│  Layer 3 — Manifests + Content Vault                             │
│  /core/edge-render/v1/manifests/llms.txt.json                   │
│  Content vault  pmcv9tfe  (encrypted, send.sgraph.ai)            │
│                                                                  │
│  Controls:                                                       │
│    • which vault, which nav file                                 │
│    • which sections/pages to include or exclude                  │
│    • output shape (title, summary, base_path, page_suffix)       │
│                                                                  │
│  Changes: @Dev (manifest JSON), @Content (vault content).        │
│           Zero code changes needed for content updates.          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Layer 1 — The Bootstrap in Full

```javascript
// infra/lambda-edge/sg-edge-render/index.mjs  (v0.1.6)

const VERSION = 'v0.1.6'
const RENDER_PATH = '/core/edge-render/v1/sg-edge-render.mjs'

// Intercept only these URIs; everything else passes through to S3/SPA untouched
const INTERCEPT = uri =>
  typeof uri === 'string' && (
    uri === '/llms.txt' ||
    uri.endsWith('.md') ||
    uri.endsWith('.llm.json')
  )

async function loadModule(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`load orchestrator ${url}: ${res.status}`)
  const code = await res.text()
  // Node can't import() HTTPS URLs — write to /tmp, then import
  const file = `/tmp/sg-orch-${hash(url + code)}.mjs`
  writeFileSync(file, code)
  return import(file)
}

export const handler = async (event) => {
  const req = event?.Records?.[0]?.cf?.request
  if (!req || !INTERCEPT(req.uri)) return req ?? event  // pass through

  // CloudFront rewrites Host → S3 bucket URL at origin-request.
  // The viewer-request CF Function stamps the real hostname first.
  const host  = req.headers?.['x-sg-site-host']?.[0]?.value
             ?? req.headers?.['x-forwarded-host']?.[0]?.value
             ?? req.headers?.host?.[0]?.value
  const cfVer = req.headers?.['x-sg-cf-version']?.[0]?.value ?? ''
  if (!host) return req

  try {
    const mod = await loadModule(`https://${host}${RENDER_PATH}`)
    const out = await mod.render(req.uri, { host })
    return {
      status: '200', statusDescription: 'OK',
      headers: {
        'content-type':    [{ key: 'Content-Type',    value: out.content_type }],
        'cache-control':   [{ key: 'Cache-Control',   value: 'no-store, no-cache, must-revalidate' }],
        'x-sg-commit':     [{ key: 'X-Sg-Commit',     value: out.commit ?? '' }],
        'x-sg-version':    [{ key: 'X-Sg-Version',    value: VERSION }],
        'x-sg-cf-version': [{ key: 'X-Sg-Cf-Version', value: cfVer }],
        'x-sg-site-host':  [{ key: 'X-Sg-Site-Host',  value: host }],
      },
      body: out.body,
    }
  } catch (err) {
    return {
      status: '502', statusDescription: 'Bad Gateway',
      headers: { /* same tracing headers */ },
      body: `edge-render failed: ${err.message}\n`,
    }
  }
}
```

**Why `loadModule` writes to `/tmp`:** Node.js Lambda cannot `import()` an
HTTPS URL without `--experimental-network-imports`. Writing the fetched source
to a unique `/tmp` path (keyed by `sha256(url + code)`) and importing the
local file is the standard workaround. The unique path means each distinct
version of the orchestrator gets its own file — no stale-import issues.

---

## 4. The Host Resolution Problem (and Fix)

CloudFront's trigger sequence creates a hostname problem:

```
Viewer sends:    Host: qa.sgraph.ai
                       │
        viewer-request CF Function runs  ← Host is still qa.sgraph.ai here
                       │  stamps X-Sg-Site-Host: qa.sgraph.ai
                       ▼
        CloudFront rewrites Host for origin:
                    Host: 745506449035--static-sgraph-ai--eu-west-2
                          .s3.eu-west-2.amazonaws.com
                       │
        origin-request Lambda runs        ← Host is NOW the S3 URL
                       │  reads X-Sg-Site-Host → qa.sgraph.ai  ✓
```

**CloudFront policy required:** the `AllViewerExceptHostHeader` origin request
policy forwards all viewer-request headers (including `X-Sg-Site-Host` set by
the CF Function) to the Lambda, while excluding `Host` so S3 keeps its own
bucket hostname for all non-intercepted requests.

---

## 5. Layer 2 — Vault Resolution Chain

The orchestrator mirrors the browser vault-client resolution: a stable path
(`library/_nav.json`) is resolved to its current blob via a cryptographic
chain anchored at the vault's ref file.

```
manifest.vault.read_key  (base64url, public-by-design)
        │
        │  HMAC-SHA256(readKey, "sg-vault-v1:file-id:ref:{vaultId}")
        │  → take first 12 hex chars
        ▼
refId = "ref-pid-muw-{12hexchars}"
        │
        │  GET send.sgraph.ai/api/vault/read/{vaultId}/bare/refs/{refId}
        │  → AES-256-GCM decrypt
        ▼
ref = { commit_id: "obj-cas-imm-0c7206cad899" }
        │
        │  GET .../bare/data/{commit_id}
        │  → decrypt
        ▼
commit = { tree_id: "obj-cas-imm-..." }
        │
        │  GET .../bare/data/{tree_id}  → decrypt → tree.entries[]
        │  walk path segments: ["library", "_nav.json"]
        ▼
blob_id = "obj-cas-imm-..."   (the current nav blob)
        │
        │  GET .../bare/data/{blob_id}  → decrypt
        ▼
nav = { sections: [ { title, children: [{ title, slug, summary }] } ] }
        │
        │  renderLlmsTxt(manifest, nav, { baseUrl })
        ▼
"# sgraph.ai Library\n\n> A public knowledge base ...\n\n## Get Started\n..."
```

Every step is encrypted at rest (AES-256-GCM). The read key is
**public-by-design** — it only decrypts nav structure and page metadata, not
write access. Write keys never leave the team vault.

**Commit pinning:** the ref file is updated by `sgit push`. Each push changes
`commit_id`, which changes the tree walk result. The Lambda always reads the
current ref on every request (caching disabled), so content is live within
seconds of `@Content` publishing.

---

## 6. The Manifest — What @Dev and @Content Control

```json
{
  "schema": "sg-render/v1",
  "type": "llms.txt",
  "content_type": "text/plain; charset=utf-8",

  "vault": {
    "id": "pmcv9tfe",
    "read_key": "dJKFnqa4Ckip-XpsbkfxV4f7PJhkp0FkVPaYqJbyUMw",
    "nav_path": "library/_nav.json"
  },

  "site": {
    "title": "sgraph.ai Library",
    "summary": "A public knowledge base on how sgraph.ai delivers content from encrypted vaults.",
    "base_path": "/en-gb/library",
    "page_suffix": ".md"
  },

  "include": {
    "exclude_sections": ["Blog"],
    "exclude_slugs": [],
    "max_pages": 500
  }
}
```

**Manifest as the control plane:**

| Field | Who changes it | Effect |
|---|---|---|
| `vault.id` + `vault.read_key` | @Dev | points to a different vault entirely |
| `vault.nav_path` | @Dev | uses a different nav file within the vault |
| `site.title` / `site.summary` | @Dev | changes the llms.txt header |
| `site.base_path` + `page_suffix` | @Dev | changes URL format of all links |
| `include.exclude_sections` | @Dev | drops whole sections from output |
| `include.max_pages` | @Dev | caps output size (proven: 500→10 shrinks from 6.5 KB to 1.5 KB with zero code change) |
| Vault content (`_nav.json` + articles) | @Content | updates live on next request |

The manifest is environment-agnostic: `base_path` is a path, not a full URL.
The orchestrator builds `baseUrl = https://{host}{base_path}`, so one manifest
serves qa / dev / main / prod correctly.

---

## 7. The llms.txt Renderer

The renderer is registered in the orchestrator's `RENDERERS` map and selected
by `manifest.type`. Adding a new output format = adding one entry to this map.

```javascript
function renderLlmsTxt(manifest, nav, ctx) {
  const sections  = (nav.library ?? nav).sections ?? []
  const exSection = new Set(manifest.include?.exclude_sections ?? [])
  const exSlug    = new Set(manifest.include?.exclude_slugs ?? [])
  const max       = manifest.include?.max_pages ?? Infinity
  const { title, summary, page_suffix = '.md' } = manifest.site
  const baseUrl   = ctx.baseUrl   // e.g. https://qa.sgraph.ai/en-gb/library

  let out = `# ${title}\n\n> ${summary}\n\n`
  out += `Content is served live from an encrypted, content-addressed vault `
  out += `(id: ${manifest.vault.id}). Each page links to its Markdown source.\n\n`

  let pages = 0
  for (const s of sections) {
    if (exSection.has(s.title)) continue
    const kids = s.children ?? s.articles ?? []
    if (!kids.length) continue
    out += `## ${s.title}\n${s.description ?? ''}\n\n`
    for (const a of kids) {
      if (!a.slug || exSlug.has(a.slug) || pages >= max) continue
      out += `- [${a.title}](${baseUrl}/${a.slug}${page_suffix})`
      if (a.summary) out += `: ${a.summary}`
      out += `\n`
      pages++
      // recurse into children (sub-articles)
    }
    out += `\n`
  }
  return { body: out, meta: { pages, sections: sections.length } }
}

const RENDERERS = {
  'llms.txt': renderLlmsTxt,
  // 'markdown': renderMarkdown,   // next: per-page *.md
  // 'json':     renderJson,       // next: *.llm.json for @QA
}
```

---

## 8. Who Controls What — Agent Roles

```
┌────────────────┬───────────────────────────────────────────────┬──────────────┐
│  Agent         │  Controls                                     │  How         │
├────────────────┼───────────────────────────────────────────────┼──────────────┤
│  @Dev          │  Layer 1: Lambda bootstrap (index.mjs)        │  git + AWS   │
│  (dev.sgraph)  │  Layer 2: Orchestrator (sg-edge-render.mjs)   │  console     │
│                │  Layer 3: Manifests (manifests/*.json)        │              │
│                │  CloudFront Function (url-rewrite.js)         │              │
├────────────────┼───────────────────────────────────────────────┼──────────────┤
│  @Content      │  Layer 3: Vault content (nav, articles)       │  sgit push   │
│  (conductor)   │  → changes _nav.json → updates llms.txt       │  (no @Dev)   │
│                │    on the NEXT request, automatically         │              │
├────────────────┼───────────────────────────────────────────────┼──────────────┤
│  @QA           │  Verifies output via *.llm.json               │  fetch +     │
│  (observer)    │  Asserts: links resolve, no decrypt failures,  │  assert      │
│                │  commit_id == HEAD, content_type correct       │              │
└────────────────┴───────────────────────────────────────────────┴──────────────┘
```

**The key property:** @Content publishes new content → `sgit push` → vault
ref updates → next `GET /llms.txt` reflects the change. **@Dev is not in
the loop for content updates.**

---

## 9. Response Headers — The Tracing Suite

Every response (200 or 502) carries:

```
X-Sg-Version:    v0.1.6              Lambda@Edge bootstrap version
X-Sg-Cf-Version: v0.1.0              CloudFront Function version
X-Sg-Site-Host:  qa.sgraph.ai        resolved hostname (confirms host fix worked)
X-Sg-Commit:     obj-cas-imm-...     vault commit ID (cryptographic provenance)
Cache-Control:   no-store, ...       caching disabled (dev phase)
```

Debugging flow:
- `X-Sg-Site-Host` = S3 URL → CF Function not published or policy not set
- `X-Sg-Cf-Version` empty → CF Function not stamping (not published)
- 502 with correct `X-Sg-Site-Host` → orchestrator or vault error (check body)
- 502 with S3 URL in `X-Sg-Site-Host` → orchestrator fetch 403 (expected S3 block)

---

## 10. One Lambda, Four Environments

```
                    ┌─────────────────────────────┐
                    │  sg-website-edge-render      │
                    │  Lambda@Edge  us-east-1      │
                    │  version ARN: :6             │
                    └────────────┬────────────────┘
                                 │  same version
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼                      ▼
  qa.sgraph.ai          dev.sgraph.ai         main.sgraph.ai         sgraph.ai
  E3J38IKLQX1LG        E1IKPF30KT65ZW        (distribution)         (distribution)
  qa branch            dev branch            main branch            main/prod branch

  loads from:          loads from:           loads from:            loads from:
  https://             https://              https://               https://
  qa.sgraph.ai/        dev.sgraph.ai/        main.sgraph.ai/        sgraph.ai/
  core/edge-render/    core/edge-render/     core/edge-render/      core/edge-render/
  v1/sg-edge-render    v1/sg-edge-render     v1/sg-edge-render      v1/sg-edge-render
  .mjs                 .mjs                  .mjs                   .mjs
  (qa branch code)     (dev branch code)     (main branch code)     (prod code)
```

Each environment loads ITS OWN branch's orchestrator + manifests from its own
CloudFront origin. The Lambda version never changes across environments.

---

## 11. Extending to New File Types

To add `*.md` (per-page Markdown) and `*.llm.json` (structured @QA object):

**Step 1 — Add renderer to orchestrator** (`sg-edge-render.mjs`):
```javascript
async function renderMarkdown(manifest, nav, ctx) {
  // resolve slug from URI → find article blob_id → decrypt → return markdown
}

const RENDERERS = {
  'llms.txt': renderLlmsTxt,
  'markdown':  renderMarkdown,   // ← add
  'json':      renderJson,       // ← add
}
```

**Step 2 — Add manifest** (`manifests/library-page.md.json`):
```json
{
  "schema": "sg-render/v1",
  "type": "markdown",
  "content_type": "text/markdown; charset=utf-8",
  "vault": { "id": "pmcv9tfe", "read_key": "...", "nav_path": "library/_nav.json" }
}
```

**Step 3 — Update URI routing** in orchestrator:
```javascript
function manifestNameFor(uri) {
  if (uri === '/llms.txt') return 'llms.txt'
  if (uri.endsWith('.md'))       return 'library-page.md'
  if (uri.endsWith('.llm.json')) return 'library-page.llm.json'
  return null
}
```

**The Lambda bootstrap is not touched.** `INTERCEPT` already passes `.md` and
`.llm.json` through to the orchestrator.

---

## 12. Local Test

```sh
# Renders against the live vault — same code as Lambda, no AWS needed
node tests/edge-render/run-local.mjs /llms.txt qa.sgraph.ai

# Output:
# [edge-render] ok  uri=/llms.txt  host=qa.sgraph.ai  pages=50  commit=obj-cas-imm-0c7206cad899
# [edge-render] content-type="text/plain; charset=utf-8"  bytes=6569
# # sgraph.ai Library
# ...
```

Exit code 1 on failure or if body exceeds Lambda's 1 MB limit — doubles as a
CI smoke check.

---

## 13. Status & Next Steps

| | Item | Status |
|---|---|---|
| ✅ | Lambda bootstrap (v0.1.6) | Live on qa |
| ✅ | CloudFront Function (v0.1.0) | Live on qa + dev |
| ✅ | Orchestrator + llms.txt renderer | Live |
| ✅ | Manifest + vault resolution | Live |
| ✅ | `AllViewerExceptHostHeader` origin request policy | Configured |
| ⬜ | Wire dev / main / sgraph.ai distributions | Pending |
| ⬜ | `markdown` renderer — per-page `*.md` | Next |
| ⬜ | `json` renderer — `*.llm.json` for @QA | Next |
| ⬜ | Re-enable module cache (TTL_MS) once stable | Later |
