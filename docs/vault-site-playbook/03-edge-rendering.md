# 03 — Edge Rendering (Machine-Readable Representations)

**Part of:** Vault-Backed Site Publishing documentation set
**Prereq:** [`01-vault-content-model.md`](./01-vault-content-model.md)

How the same vault content is served as `.md`, `.llm.json`, and `/llms.txt` for
agents and crawlers — without a browser. This is what makes a vault-backed site a
first-class citizen for LLM consumption.

---

## 1. Why an edge layer at all

The browser renderer (doc 02) is great for humans but invisible to agents and
crawlers: they get an empty SPA shell. The edge layer gives every article three
machine-readable forms, served live from the same vault:

| URL | Content-Type | For |
|---|---|---|
| `/en-gb/library/<slug>.md` | `text/markdown` | Raw Markdown source of one article |
| `/en-gb/library/<slug>.llm.json` | `application/json` | One article + structured metadata (object id, commit, source) |
| `/llms.txt` | `text/plain` | The whole-site link index (the agent "front door") |

These are generated **on demand at the edge**, decrypting the current vault
content — so they never go stale relative to what the SPA shows.

---

## 2. The three pieces

```
infra/lambda-edge/sg-edge-render/index.mjs   ← Layer 1: the Lambda bootstrap (tiny, ~stable)
core/edge-render/v1/sg-edge-render.mjs        ← Layer 2: the orchestrator (format logic)
core/edge-render/v1/manifests/*.json          ← Layer 3: manifests (WHAT to include)
```

The separation is deliberate: the **Lambda almost never changes**, the
**orchestrator** owns *how* to render (and is shipped + deployed via normal CI as
a site asset), and the **manifests** own *what* each representation includes.

### Layer 1 — the Lambda (`infra/lambda-edge/sg-edge-render/index.mjs`)

Attached to **all four** CloudFront distributions as a single `origin-request`
function. It knows only two things:

1. **Which URIs to intercept:** `/llms.txt`, `*.md`, `*.llm.json`. Everything
   else passes straight through to S3 untouched.
2. **How to find the orchestrator:** it derives the site host from request
   headers (`x-sg-site-host` → `x-forwarded-host` → `host`), fetches
   `https://<host>/core/edge-render/v1/sg-edge-render.mjs`, writes it to `/tmp`,
   and `import()`s it. Then calls `mod.render(uri, { host })`.

Because the host comes from the request, one Lambda version serves every
environment — each request runs *its own* branch's orchestrator + manifests. You
test through the normal qa → dev → main → prod deploy flow and **never touch the
Lambda**.

> **Security note (CR-02 — now shipped):** the host is attacker-influenceable, so
> the Lambda validates it against a hardcoded `ALLOWED_HOSTS` set before
> fetching+executing the orchestrator; an unrecognised host passes straight
> through to S3. **When you wire a new distribution, add its hostname to
> `ALLOWED_HOSTS`** in `infra/lambda-edge/sg-edge-render/index.mjs` — otherwise its
> `.md`/`.llm.json`/`llms.txt` requests will fall through unrendered.

### Layer 2 — the orchestrator (`core/edge-render/v1/sg-edge-render.mjs`)

A self-contained ES module (no internal imports, so it's safe to write-and-import).
It:

1. `routeUri(uri)` → `{ manifestName, slug }` using the `AREAS` table.
2. Loads the manifest (`readManifest`).
3. Resolves the manifest's `vault.nav_path` to the current nav blob and decrypts
   it (`resolvePath` + `readJson`).
4. Dispatches on `manifest.type` to a renderer: `renderLlmsTxt`, `renderMarkdown`,
   or `renderLlmJson`.
5. Returns `{ content_type, body, commit, ...meta }`.

The `AREAS` table is the per-site routing:

```js
const AREAS = [
  { base: '/en-gb/library', md: 'library-page-md', json: 'library-page-llm' },
  { base: '/en-gb/invest',  md: 'invest-page-md',  json: 'invest-page-llm'  },
]
```

**To expose a new sub-site as machine-readable text, you add one entry here** plus
the manifests — no Lambda change, no orchestrator-logic change.

The renderers (the part you extend to support a *new file type*):

| `manifest.type` | Renderer | Output |
|---|---|---|
| `llms.txt` | `renderLlmsTxt` | Section-grouped link index (see §4) |
| `markdown` | `renderMarkdown` | The article's raw Markdown |
| `llm.json` | `renderLlmJson` | Article + `{ object_id, commit, source }` metadata |

Both `renderMarkdown` and `renderLlmJson` accept either a pinned
`content_object_id` or a `content_path` (resolved via `resolvePath`) on the nav
node — matching the content model in doc 01.

### Layer 3 — the manifests (`core/edge-render/v1/manifests/<name>.json`)

A manifest binds a representation to a vault + nav + inclusion rules. Schema
(`sg-render/v1`):

```json
{
  "schema": "sg-render/v1",
  "type": "llms.txt",                       // llms.txt | markdown | llm.json
  "content_type": "text/plain; charset=utf-8",
  "vault": {
    "id": "pmcv9tfe",
    "read_key": "<library-public-read-key>",  // PUBLIC read key
    "nav_path": "library/_nav.json"
  },
  "site": {
    "title": "sgraph.ai Library",
    "summary": "…",
    "base_path": "/en-gb/library",
    "page_suffix": ".md"
  },
  "include": {                              // llms.txt only
    "exclude_sections": [],                 // section titles to drop
    "exclude_slugs": [],                    // article slugs to drop
    "max_pages": 500
  }
}
```

The current manifest set: `library-page-md`, `library-page-llm`,
`invest-page-md`, `invest-page-llm`, `llms.txt`.

> Manifests contain the **public read key** — that's fine (same key as the HTML).
> They must never contain a write key.

---

## 3. Request flow (agent fetches a `.md`)

```
agent GET /en-gb/library/get-started/claude-setup.md
  │
  ▼ CloudFront (cache miss)
  ▼ viewer-request CF function — stamps x-sg-site-host = qa.sgraph.ai, passes *.md through
  ▼ origin-request Lambda@Edge
       host = "qa.sgraph.ai"
       fetch https://qa.sgraph.ai/core/edge-render/v1/sg-edge-render.mjs → import
       render("/…/claude-setup.md", { host }):
         routeUri → { name: "library-page-md", slug: "get-started/claude-setup" }
         load manifest library-page-md.json
         resolvePath(vault, library/_nav.json) → nav blob → decrypt
         findArticle(nav, "get-started/claude-setup") → node
         readObject(article object id) → decrypt → markdown text
       → 200 text/markdown
  ▼ CloudFront caches the response (keyed by URL)
```

---

## 4. `/llms.txt` generation (worked example — section filtering)

`renderLlmsTxt` walks every section of the nav and emits a Markdown link index.
Its filter rules, in order:

1. Skip the section if its title is in `include.exclude_sections`.
2. Skip the section if it has **no children** (empty `children`/`articles`).
3. Emit the heading + description, then each article (and one level of child
   pages), skipping any slug in `include.exclude_slugs`, up to `max_pages`.

There is no other filter — no index requirement, no per-article flag.

> Real example from this project: a `"Blog"` entry in `exclude_sections` once kept
> the Blog section out of `/llms.txt` even though it rendered everywhere else; an
> empty `"Dependencies"` section was dropped by rule 2. Removing `"Blog"` from the
> list put it back in the index. This is the kind of behaviour to **document per
> site** so the next maintainer isn't surprised.

---

## 5. Error handling & caching — current state and the gaps

What ships today (note these and improve them for a new site):

- **Errors return 502** with `edge-render failed: <message>` in the body
  (`index.mjs` catch block). An unknown slug therefore 502s, not 404s, and leaks
  internal detail (CR-10). For a new site, map "not found" → 404 with a generic
  body and log detail to CloudWatch only.
- **Caching is disabled** (`Cache-Control: no-store`) and the orchestrator is
  re-fetched every invocation (dev-phase setting). For production scale, re-enable
  the per-host TTL module cache in `loadModule` and set a short `max-age`
  (CR-07). The tree-walk also does sequential vault fetches per request — a
  crawler can cause a fetch storm without caching.
- **No fetch timeouts** in the orchestrator/Lambda (CR-06-adjacent). Add
  `AbortSignal.timeout(...)` to bare `fetch`es.

These are tracked in [`../code-review__2026-06-09.md`](../code-review__2026-06-09.md);
they are noted here so a new site doesn't inherit them silently.

---

## 6. Local testing

`tests/edge-render/run-local.mjs` renders a URI against the live vault without
deploying — useful for verifying a manifest or a new renderer. It is now a
**gating CI job** (CR-04 — shipped): the pipeline runs it for `/llms.txt` + a
`.md` + a `.llm.json` and blocks the deploy if any fails. Run it manually too:

```bash
node tests/edge-render/run-local.mjs /en-gb/library/get-started/claude-setup.md
```

When you add a new area + manifests, render one URL of each type through this
harness before deploying.
