---
title: "Architecture — How /llms.txt and *.md Content Resolves"
author: "@Dev (dev.sgraph, Claude Sonnet 4.6)"
date: 2026-05-31
status: LIVE
audience: engineers, agents extending the renderer set, security reviewers
related:
  - docs/guide__llm-api-access.md (usage guide)
  - docs/architecture__llm-api-representations.md (design rationale)
  - infra/lambda-edge/sg-edge-render/ (Lambda bootstrap)
  - sgraph_ai_website/.../core/edge-render/v1/ (orchestrator + manifests)
---

# How the Content Resolves — Full Architecture

---

## 1. Overview: What Happens When You Fetch `/llms.txt`

```
 curl https://sgraph.ai/llms.txt
       │
       │ DNS → CloudFront PoP (e.g. LHR5-P7)
       ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │  CloudFront                                                         │
 │                                                                     │
 │  ➊ viewer-request   CloudFront Function: url-rewrite-for__sgraph-ai │
 │                      • reads Host: sgraph.ai                        │
 │                      • stamps X-Sg-Site-Host: sgraph.ai  ──────┐   │
 │                      • stamps X-Sg-Cf-Version: v0.1.0          │   │
 │                      • /llms.txt has a dot → no URI rewrite    │   │
 │                                                                 │   │
 │  ➋ cache check       CachingDisabled policy → always MISS      │   │
 │                                                                 │   │
 │  ➌ origin-request   Lambda@Edge: sg-website-edge-render        │   │
 │                      • reads X-Sg-Site-Host ←───────────────────┘  │
 │                      • /llms.txt matches INTERCEPT → handle         │
 │                      • fetches orchestrator from sgraph.ai          │
 │                      • runs render("/llms.txt", { host })           │
 │                      • returns 200 + body (never hits S3)           │
 │                                                                     │
 └─────────────────────────────────────────────────────────────────────┘
       │
       │ HTTP/2 200  Content-Type: text/plain
       │ X-Sg-Commit: obj-cas-imm-0c7206cad899
       │ X-Sg-Version: v0.1.6
       ▼
 # sgraph.ai Library
 > A public knowledge base ...
```

The response never touches S3. It is generated entirely by the Lambda@Edge
function using content decrypted from the vault in real time.

---

## 2. Why Two Edge Functions?

CloudFront has two kinds of edge function with different capabilities:

```
 ┌─────────────────────────┬──────────────────────────────────────────┐
 │  CloudFront Functions   │  Lambda@Edge                             │
 │  (viewer-request)       │  (origin-request)                        │
 ├─────────────────────────┼──────────────────────────────────────────┤
 │  Sub-millisecond JS     │  Full Node.js runtime                    │
 │  No network calls       │  Network calls ✓  (vault, orchestrator)  │
 │  5ms timeout            │  30 second timeout                       │
 │  Host = real viewer host│  Host = S3 bucket URL (rewritten)        │
 │  Runs at every PoP      │  Runs in us-east-1                       │
 └─────────────────────────┴──────────────────────────────────────────┘
```

This creates **the hostname problem**: by the time Lambda@Edge fires, CloudFront
has already replaced `Host: sgraph.ai` with the S3 bucket domain. The Lambda
needs to know the real public hostname to load the right orchestrator.

**The fix:** the CloudFront Function runs first (while Host is still correct)
and stamps `X-Sg-Site-Host: sgraph.ai` as a custom header. The Lambda reads
this header instead of `Host`.

```
 Viewer sends request
       │  Host: sgraph.ai
       ▼
 CloudFront Function (viewer-request)
       │  → adds X-Sg-Site-Host: sgraph.ai     ← saved here
       │  Host: sgraph.ai
       ▼
 CloudFront rewrites Host for origin
       │  Host: 745506449035--static-sgraph-ai--eu-west-2.s3.amazonaws.com
       │  X-Sg-Site-Host: sgraph.ai             ← still here
       ▼
 Lambda@Edge (origin-request)
       │  reads X-Sg-Site-Host → "sgraph.ai"   ← recovered
       │  loads orchestrator from https://sgraph.ai/core/...
```

The `AllViewerExceptHostHeader` origin request policy forwards all viewer-request
headers (including `X-Sg-Site-Host`) to the Lambda while excluding `Host` so
S3 still receives its own bucket URL for non-intercepted requests.

---

## 3. Three-Layer Architecture

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │ LAYER 1 — Bootstrap                                                  │
 │ infra/lambda-edge/sg-edge-render/index.mjs   (~90 lines, v0.1.6)    │
 │                                                                      │
 │ Knows:                                                               │
 │   • which URIs to intercept                                          │
 │   • how to load the orchestrator from the request host               │
 │                                                                      │
 │ Does NOT know: content, vault, rendering logic                       │
 │ Changes: almost never. One version on all 4 distributions.           │
 ├──────────────────────────────────────────────────────────────────────┤
 │ LAYER 2 — Orchestrator                                               │
 │ /core/edge-render/v1/sg-edge-render.mjs   (~180 lines)              │
 │ Served as a static asset from the site itself                        │
 │                                                                      │
 │ Knows:                                                               │
 │   • vault crypto (HMAC key derivation, AES-GCM decrypt)             │
 │   • vault object model (ref → commit → tree → blob)                 │
 │   • renderer registry { 'llms.txt', 'markdown', 'llm.json' }        │
 │   • URI → manifest routing                                           │
 │                                                                      │
 │ Changes: @Dev via CI. Adding a new file type = new renderer here.    │
 │          Lambda never changes.                                       │
 ├──────────────────────────────────────────────────────────────────────┤
 │ LAYER 3 — Manifests + Content Vault                                  │
 │ /core/edge-render/v1/manifests/*.json                                │
 │ Encrypted vault pmcv9tfe  at  send.sgraph.ai                         │
 │                                                                      │
 │ Knows:                                                               │
 │   • which vault, which nav file, which renderer                      │
 │   • output shape (title, summary, base_path, page_suffix)            │
 │   • include/exclude rules (sections, slugs, max_pages)               │
 │                                                                      │
 │ Changes: @Dev (manifests), @Content (vault content — no code touch). │
 └──────────────────────────────────────────────────────────────────────┘
```

---

## 4. The Vault Object Model

The vault is a content-addressed store: every object is identified by a
deterministic hash of its content (`obj-cas-imm-{12hex}`). Objects are
immutable; a "publish" creates new objects and updates a mutable ref pointer.

```
 MUTABLE                          IMMUTABLE (content-addressed)
 ────────                         ─────────────────────────────

 ref file                         commit object
 ┌──────────────────┐             ┌──────────────────────────┐
 │ ref-pid-muw-     │  commit_id  │ obj-cas-imm-0c7206cad899 │
 │ {12hexchars}     │────────────►│ { tree_id: "obj-cas-..."  │
 │ { commit_id:     │             │   author, timestamp, ... }│
 │   "obj-cas-..." }│             └──────────┬───────────────┘
 └──────────────────┘                        │ tree_id
  updated on each                            ▼
  sgit push                        tree object (root)
                                   ┌──────────────────────────┐
                                   │ obj-cas-imm-...          │
                                   │ { entries: [             │
                                   │   { name: "library",     │
                                   │     tree_id: "obj-..." } │
                                   │   { name: "state",  ...} │
                                   │ ]}                       │
                                   └──────────┬───────────────┘
                                              │ tree_id (library/)
                                              ▼
                                   tree object (library/)
                                   ┌──────────────────────────┐
                                   │ obj-cas-imm-...          │
                                   │ { entries: [             │
                                   │   { name: "_nav.json",   │
                                   │     blob_id: "obj-..." } │
                                   │   { name: "get-started", │
                                   │     tree_id: "obj-..." } │
                                   │ ]}                       │
                                   └──────────┬───────────────┘
                                              │ blob_id
                                              ▼
                                   blob: _nav.json (encrypted)
                                   ┌──────────────────────────┐
                                   │ obj-cas-imm-...          │
                                   │ AES-256-GCM ciphertext   │
                                   │ → decrypt →              │
                                   │ { library: {             │
                                   │   sections: [...] } }    │
                                   └──────────────────────────┘
```

All objects except the ref are immutable. The ref file is the only mutable
pointer in the system — a `sgit push` atomically updates it to the new commit.

---

## 5. The Vault Crypto Chain

Every object is encrypted with **AES-256-GCM**. The read key (a 32-byte
symmetric key, base64url-encoded) is **public-by-design** for the library
vault — it grants read-only access to nav structure and article content.
Write keys never leave the team vault.

```
 manifest.vault.read_key  (base64url string, public)
       │
       │  base64url decode
       ▼
 readKeyBytes  (32 bytes)
       │
       ├──────────────────────────────────────────────────────────────┐
       │  HMAC-SHA256(readKeyBytes,                                   │
       │              "sg-vault-v1:file-id:ref:{vaultId}")            │
       │  → take first 12 hex chars                                   │
       ▼                                                              │
 refId = "ref-pid-muw-{12hexchars}"                                   │
       │                                                              │
       │  GET /api/vault/read/{vaultId}/bare/refs/{refId}             │
       │  response: AES-GCM encrypted blob                            │
       │                                                              │
       │  AES-256-GCM decrypt(readKeyBytes, blob):                    │
       │    bytes[0:12]   → IV (nonce)                                │
       │    bytes[12:-16] → ciphertext                                │
       │    bytes[-16:]   → auth tag                                  │
       ▼                                                              │
 ref = { commit_id: "obj-cas-imm-0c7206cad899" }    (same key ───────┘
       │                                              used for all
       │  GET .../bare/data/{commit_id} → decrypt    object decrypts)
       ▼
 commit = { tree_id: "obj-cas-imm-..." }
       │
       │  GET .../bare/data/{tree_id} → decrypt
       ▼
 root tree = { entries: [ { name_enc: "...", tree_id/blob_id } ] }
       │
       │  Some entry names are encrypted (name_enc field).
       │  Decrypt with same readKeyBytes via AES-GCM.
       │  Walk path segments: ["library", "_nav.json"]
       ▼
 blob_id of _nav.json
       │
       │  GET .../bare/data/{blob_id} → decrypt
       ▼
 nav JSON (plaintext):
 {
   "library": {
     "sections": [
       { "title": "Get Started",
         "children": [
           { "title": "How to Set Up Claude with sgit",
             "slug": "get-started/claude-setup",
             "content_object_id": "obj-cas-imm-f826911d9c9f",
             "description": "...",
             "render": "markdown" }
         ]
       }
     ]
   }
 }
```

---

## 6. Full Data Flow — `/llms.txt`

```
 render("/llms.txt", { host: "sgraph.ai" })
       │
       │  routeUri → { name: "llms.txt", slug: null }
       ▼
 readManifest("llms.txt")
       │  GET https://sgraph.ai/core/edge-render/v1/manifests/llms.txt.json
       ▼
 manifest = {
   type: "llms.txt",
   vault: { id: "pmcv9tfe", read_key: "dJKF...", nav_path: "library/_nav.json" },
   site:  { title: "sgraph.ai Library", base_path: "/en-gb/library", ... },
   include: { exclude_sections: ["Blog"], max_pages: 500 }
 }
       │
       │  resolvePath("pmcv9tfe", key, "library/_nav.json")
       │  [4 vault round-trips: ref → commit → root tree → library tree]
       ▼
 { blob: "obj-cas-imm-...", commit: "obj-cas-imm-0c7206cad899" }
       │
       │  readJson("pmcv9tfe", blob, key)
       ▼
 nav = { library: { sections: [ ... 6 sections, 50+ articles ... ] } }
       │
       │  RENDERERS["llms.txt"](manifest, nav, { baseUrl, host })
       ▼
 renderLlmsTxt:
   for each section (not in exclude_sections):
     emit "## {section.title}\n{description}\n"
     for each article (up to max_pages):
       emit "- [{title}]({baseUrl}/{slug}{page_suffix}): {summary}\n"
       for each child article: same
       │
       ▼
 body = "# sgraph.ai Library\n\n> A public knowledge base...\n\n## Get Started\n..."
       │
 return { content_type: "text/plain; charset=utf-8", body, commit, pages: 50 }
```

**Network calls made (caching disabled):**
1. Fetch orchestrator JS from sgraph.ai (Layer 1 → Layer 2)
2. Fetch manifest JSON from sgraph.ai
3. Fetch ref object from send.sgraph.ai
4. Fetch commit object from send.sgraph.ai
5. Fetch root tree from send.sgraph.ai
6. Fetch library/ tree from send.sgraph.ai
7. Fetch nav blob from send.sgraph.ai

Total: ~7 round-trips → ~7 seconds cold (all vault calls hit send.sgraph.ai).

---

## 7. Full Data Flow — `/en-gb/library/get-started/claude-setup.md`

```
 render("/en-gb/library/get-started/claude-setup.md", { host })
       │
       │  routeUri → { name: "library-page-md", slug: "get-started/claude-setup" }
       ▼
 readManifest("library-page-md")
       │  GET .../manifests/library-page-md.json
       ▼
 manifest = {
   type: "markdown",
   vault: { id: "pmcv9tfe", read_key: "dJKF...", nav_path: "library/_nav.json" },
   site:  { base_path: "/en-gb/library" }
 }
       │
       │  resolvePath → nav blob   [same 4 vault round-trips as above]
       ▼
 nav = { library: { sections: [...] } }
       │
       │  RENDERERS["markdown"](manifest, nav, { slug: "get-started/claude-setup", ... })
       ▼
 renderMarkdown:
   findArticle(nav, "get-started/claude-setup")
       │  recursive search through sections → children
       ▼
   article = {
     title: "How to Set Up Claude with sgit",
     slug: "get-started/claude-setup",
     content_object_id: "obj-cas-imm-f826911d9c9f",   ← the article's blob
     render: "markdown"
   }
       │
       │  readObject("pmcv9tfe", "obj-cas-imm-f826911d9c9f", key)
       │  GET send.sgraph.ai/api/vault/read/pmcv9tfe/bare/data/obj-cas-imm-f826911d9c9f
       │  → AES-GCM decrypt → raw markdown bytes
       ▼
 body = "# How to Set Up Claude to Work with sgit\n\nThis walkthrough..."
       │
 return { content_type: "text/markdown; charset=utf-8", body, commit, slug, title }
```

**Key difference from llms.txt:** one extra vault call (8 total) to fetch the
article blob directly via `content_object_id`. The nav holds the blob ID for
each article — no tree walk needed for the content itself.

---

## 8. Full Data Flow — `/en-gb/library/get-started/claude-setup.llm.json`

Same resolution as `.md` up to and including fetching the article blob.
The renderer then wraps the content in a typed object:

```
 renderLlmJson(manifest, nav, { slug, commit, baseUrl }):
       │
       │  [same findArticle + readObject as markdown]
       ▼
 content_markdown = "# How to Set Up Claude..."
       │
       │  assemble response object
       ▼
 {
   schema: "sg-render/v1",
   slug: "get-started/claude-setup",
   title: "How to Set Up Claude with sgit",
   description: "Configure Claude with network access...",
   content_markdown: "# How to Set Up Claude...",   ← same bytes as .md
   links: {
     self:     "https://sgraph.ai/en-gb/library/get-started/claude-setup",
     markdown: "https://sgraph.ai/en-gb/library/get-started/claude-setup.md",
     json:     "https://sgraph.ai/en-gb/library/get-started/claude-setup.llm.json"
   },
   source: {
     vault_id:  "pmcv9tfe",
     object_id: "obj-cas-imm-f826911d9c9f",   ← the exact vault object
     commit_id: "obj-cas-imm-0c7206cad899"    ← HEAD at time of request
   },
   resolved_at: "2026-05-31T21:35:57.448Z"
 }
       │
       │  JSON.stringify → body string
       ▼
 return { content_type: "application/json; charset=utf-8", body, ... }
```

---

## 9. How the Orchestrator Gets Loaded

The Lambda does not bundle the orchestrator. It fetches it from the same
CloudFront distribution at runtime — this is what makes one Lambda serve four
environments with different code:

```
 Lambda receives request for sgraph.ai/llms.txt
       │
       │  host = "sgraph.ai"  (from X-Sg-Site-Host)
       │  url  = "https://sgraph.ai/core/edge-render/v1/sg-edge-render.mjs"
       ▼
 fetch(url)  →  CloudFront serves the .mjs file from S3
       │         (this request is NOT intercepted — .mjs doesn't match INTERCEPT)
       │
       │  res.text() → JavaScript source code (string)
       │
       │  Node cannot import() an HTTPS URL without --experimental flags.
       │  Hash the URL+code to get a unique filename:
       │  sha256(url + code).slice(0,16) → "a3f8b2c1..."
       │
       │  writeFileSync("/tmp/sg-orch-a3f8b2c1.mjs", code)
       │  import("/tmp/sg-orch-a3f8b2c1.mjs")
       ▼
 mod = { render: async function(...) { ... } }
       │
       │  mod.render(req.uri, { host })
       ▼
 [vault resolution chain runs inside the orchestrator]
```

**Why this is safe:** the orchestrator is fetched from the same CloudFront
origin already serving the site — same trust boundary as the site serving its
own `<script>` tags. No third-party code.

**Caching note (currently disabled):** in dev phase, the orchestrator is
re-fetched on every invocation so code changes appear immediately. When
re-enabled, the unique `/tmp` filename (keyed by URL+code hash) acts as a
natural cache — the same code version always imports from the same file,
Node's module cache handles deduplication.

---

## 10. One Lambda, Four Environments

```
                   ┌──────────────────────────────────┐
                   │  sg-website-edge-render :6        │
                   │  Lambda@Edge  us-east-1           │
                   └────────────────┬─────────────────┘
          ┌─────────────────────────┼──────────────────────────┐
          ▼                         ▼                          ▼                          ▼
 sgraph.ai                 main.sgraph.ai            qa.sgraph.ai              dev.sgraph.ai
 (prod)                    (main branch)             (qa branch)               (dev branch)
    │                          │                         │                         │
    │ loads from               │ loads from              │ loads from              │ loads from
    ▼                          ▼                         ▼                         ▼
 https://sgraph.ai/       https://main.sgraph.ai/   https://qa.sgraph.ai/    https://dev.sgraph.ai/
 core/edge-render/v1/     core/edge-render/v1/      core/edge-render/v1/     core/edge-render/v1/
 sg-edge-render.mjs       sg-edge-render.mjs        sg-edge-render.mjs       sg-edge-render.mjs
 (prod code + vault)      (main code + vault)       (qa code + vault)        (dev code + vault)
```

The `X-Sg-Site-Host` header is what routes each request to the right
environment's orchestrator and manifests. Without it, the Lambda would load
the S3 origin URL — which returns 403 since S3 is not publicly accessible.

---

## 11. Content Publish Flow

When @Content runs `sgit push`:

```
 @Content: sgit push
       │
       │  sgit encrypts new/changed objects with AES-256-GCM
       │  uploads blobs to send.sgraph.ai  (immutable, content-addressed)
       │  updates the ref file → new commit_id
       ▼
 Vault ref file updated atomically
       │
       │  Next request to sgraph.ai/llms.txt (or any .md / .llm.json):
       ▼
 Lambda fetches ref → gets new commit_id
       │
       │  walks new commit's tree → finds updated blobs
       │  decrypts → renders updated content
       ▼
 Response reflects new content
```

**No CloudFront cache to invalidate** — `CachingDisabled` policy means every
request is a cache miss and hits the Lambda. No CDN TTL to wait for.
**No redeploy** — the vault ref update is the entire publish operation.
**No @Dev involvement** — @Content's `sgit push` is the only step.

The `X-Sg-Commit` response header carries the commit_id that was resolved.
Two requests a second apart may return different commit_ids if @Content
published between them.

---

## 12. Security Properties

```
 What the read key grants:          What the read key does NOT grant:
 ─────────────────────────          ──────────────────────────────────
 • Read nav structure               • Write to the vault
 • Read article content             • Read write-protected objects
 • Derive the ref file ID           • Access other vaults
 • Decrypt any blob in this vault   • Modify the ref or any object
```

The read key for the library vault is **public-by-design** — it is embedded
in the manifest JSON served from the site. This is intentional: the library
content is public. The encryption exists to ensure content is served only
through the intended delivery path (CloudFront + Lambda), not directly from S3.

Write keys are distributed exclusively through the team vault and never appear
in website code, manifests, or published content.

Every decrypted blob is authenticated (AES-GCM auth tag). A corrupted or
tampered object fails with an authentication error before any content is
returned — the `X-Sg-Commit` header only appears on successfully authenticated
responses.
