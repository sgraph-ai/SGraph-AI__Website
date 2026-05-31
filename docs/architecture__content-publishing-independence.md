---
title: "Architecture Brief — Content-Publishing Independence (eliminate the @Dev redeploy bottleneck)"
author: "@Dev (dev.sgraph, Claude Opus 4.8)"
date: 2026-05-30
updated: 2026-05-31
status: READY TO BUILD — all open questions resolved empirically; PoC shipped in PR #21.
audience: a fresh Claude session to extend the resolution layer to articles, status boards, and journalist posts.
related:
  - mail/dev.sgraph/outbox/sgit.team/001-sgit-tree-nav-resolution-briefing.eml (original ask to @Sgit — now answered empirically)
  - mail/conductor.content/inbox/dev.sgraph/039-nav-v3.16-deployed-confirmed.eml (confirmed vault + tree walk)
---

# Content-Publishing Independence

## TL;DR

Every time a content agent (@Content, @Journalist, @Conductor) publishes new
content, the website breaks unless @Dev manually edits an HTML file and ships a
PR. We want content agents to publish freely with **zero @Dev involvement**.
This brief maps the why, the how (3 candidate approaches), and the what (concrete
build).

---

## 1. WHY — the problem

### The immutable-object-ID bottleneck

The site renders encrypted content from sgit vaults. Navigation, articles, and
status boards are all vault objects addressed by a **content hash**:

    obj-cas-imm-a4c9266f9cc5

These IDs are **immutable**. There is no "latest" alias. Every time content
changes, the re-encrypted object gets a **brand-new ID**. But the website
hardcodes those IDs in HTML:

    <sg-side-nav nav-object-id="obj-cas-imm-a4c9266f9cc5" ...>

So the publish loop today is:

    1. @Content edits + pushes content vault          (content agent)
    2. @Content reads new object ID from sgit          (content agent)
    3. @Content mails @Dev the new NAV_OBJECT_ID        (mail round-trip)
    4. @Dev edits the HTML attribute                    (@Dev)
    5. @Dev commits + opens PR + merges to qa           (@Dev)
    6. CI redeploys                                      (~1 min)

Steps 2–5 are pure friction. **@Dev is a human-in-the-loop for what should be a
content-only operation.**

### Evidence this is the #1 drag on the project

Counting just this project's mail history, @Dev has shipped a NAV_OBJECT_ID bump
for nav v2.2, v2.3, v2.4, v2.5, v2.6, v2.7, v2.8, v2.9, v3.0, v3.1, v3.2, v3.5,
v3.6, v3.7, v3.8, v3.9, v3.10, v3.11, v3.12, v3.13 — ~20 redeploys whose entire
diff was a 12-character hex string. Same pattern now looms for the status vault
(workstreams/issues/agents IDs) and the journalist vault.

### Knock-on effects

- **Staleness.** The board showed I-003 "in-progress" long after it shipped,
  purely because the update hadn't round-tripped. (See the status-vault update
  this session.)
- **Coupling.** Content cadence is throttled to @Dev's availability.
- **Error surface.** Hand-copied hex IDs get mistyped (we've had missing/old IDs
  cause "Failed to load content" — bug 029-adjacent).

---

## 2. HOW — candidate approaches

Three ways to get a **stable pointer** to "the current content", in rough order
of preference. The right pick depends on what sgit exposes (the open questions in
§4).

### Approach A — sgit tree-walk resolution (preferred; original ask to @Sgit)

sgit is a content-addressed, git-like store: each **commit** points to a **tree**,
and a tree maps stable **file paths** to immutable object IDs. The commit ref for
a branch changes on every publish, but the *path* (`nav/library.json`) is stable.

Browser-side loader would:

    1. Resolve branch HEAD commit  (e.g. branch "main" of the content vault)
    2. Read the tree from that commit
    3. Walk the tree to the stable path → get the current object ID
    4. readObject() that ID as today

HTML changes from a content-coupled ID to a **stable, never-changing** reference:

    nav-branch="main"
    nav-path="nav/library.json"

@Content publishes → HEAD moves → site picks up the new nav on next load. No @Dev.

- (+) No new infrastructure; uses sgit's existing commit/tree model.
- (+) One mechanism resolves nav, articles, status boards, journalist posts.
- (-) Requires sgit to expose: branch-HEAD lookup + tree/commit object schema +
      browser-callable API + auth model. **All still unanswered by @Sgit.**
- (-) Extra round-trips per page load (commit → tree → object). Mitigate with a
      sessionStorage cache keyed by branch+path+HEAD.

### Approach B — a tiny mutable pointer object ("latest" manifest)

Publish a small, well-known JSON manifest at a **stable object ID that we treat as
the entry point**, OR have the content agent overwrite a single pointer file the
site fetches over plain HTTPS (not the immutable CAS):

    GET https://send.sgraph.ai/pointers/library-nav   →   { "object_id": "obj-cas-imm-...", "version": "3.13" }

Site fetches the pointer, then readObject() the ID it names.

- (+) Dead simple; no tree-walking; trivial to cache/CDN.
- (+) Works today if the vault host can serve one mutable file per content stream.
- (-) Reintroduces a mutable layer outside the CAS guarantees (needs its own
      write-auth + integrity story; arguably a mini version of what sgit already
      does internally).
- (-) Someone has to define + host the pointer namespace.

### Approach C — build-time resolution (CI injects the latest ID)

Keep the HTML hardcoded, but a CI job (triggered on content publish, or on a
schedule) queries sgit for the current IDs and rewrites the attributes
automatically — removing the *human* from the loop but not the redeploy.

- (+) Zero browser/runtime change; no perf cost; CAS guarantees intact.
- (+) Could ship this week without @Sgit schema work.
- (-) Still a redeploy per publish (just automated); content isn't truly live.
- (-) Needs a publish→CI trigger (webhook from the vault, or polling).

---

## 3. WHAT — the concrete build (assuming Approach A)

Pending @Sgit answers, the build is:

1. **Vault-client resolution utility** — add to the vault-client layer:

       async function resolveObjectId(endpoint, vaultId, branch, path, readKey)
         → walks HEAD → tree → path, returns obj-cas-imm-...
         → caches in sessionStorage keyed by `${vaultId}:${branch}:${path}:${HEAD}`

2. **<sg-side-nav> + <sg-article-viewer> attributes** — accept `nav-branch` /
   `nav-path` (and `vault-branch`/`object-path` for articles) as an alternative
   to `nav-object-id` / `object-id`. If the branch/path form is present, resolve
   first, then proceed exactly as today.

3. **Migration** — flip library/index.html, dev/index.html, and the journalist
   extra-links from hardcoded IDs to branch+path. Keep ID form supported for
   anything not yet in a tree.

4. **Caching + invalidation** — sessionStorage with the HEAD ref baked into the
   key, so a new publish (new HEAD) is a cache miss and refreshes automatically;
   within a session, repeat loads skip the tree walk.

5. **Per-section sub-navs** — same resolver covers lazily-loaded section nav
   files (each content agent owning its own sub-tree JSON), since they're just
   more paths in the same tree.

---

## 4. API ANSWERS — empirically confirmed 2026-05-31

All seven questions from the original @Sgit briefing are now answered. No @Sgit
response was needed — the vault client source code plus a live Node.js probe
against the production vault (pmcv9tfe) gave definitive answers.

### a) Commit object schema

    {
      "schema":           "commit_v1",
      "tree_id":          "obj-cas-imm-...",   ← root tree reference
      "parents":          ["obj-cas-imm-..."],  ← parent commit(s)
      "timestamp_ms":     1748727600000,
      "branch_id":        "...",
      "message_enc":      "...",               ← AES-GCM encrypted
      "signature":        "...",
      "author_key_id":    "...",
      "author_signature": "...",
      "attestations":     [...]
    }

Key fields for resolution: `tree_id` (also accepted as `treeId` or `tree`).
The commit itself is a normal vault object — fetched via `readObject`.

### b) Tree object schema

    {
      "schema": "tree_v1",
      "entries": [
        { "name_enc": "<base64 AES-GCM>", "blob_id":  "obj-cas-imm-..." },
        { "name_enc": "<base64 AES-GCM>", "tree_id":  "obj-cas-imm-..." }
      ]
    }

- **Recursive, not flat.** Each directory level is a separate tree object.
- Names are **encrypted** (AES-256-GCM, same read key). `walkTree()` decrypts
  all `name_enc` fields and adds a `name` property to each entry.
- `blob_id` = leaf file; `tree_id` = subdirectory.

### c) API for branch HEAD

No separate branch endpoint. The HEAD ref is stored as a vault file at a
**deterministic file ID** derived from the read key:

    HMAC-SHA256(readKeyBytes, "sg-vault-v1:file-id:ref:{vaultId}") → first 12 hex chars
    → formatted as: ref-pid-muw-{hex12}

The ref file's JSON payload contains `{ commit_id: "obj-cas-imm-..." }`.
Named branches use domain `sg-vault-v1:file-id:branch-ref:{vaultId}:{branchName}`.
The default (HEAD) ref uses the shorter domain (no branch name suffix).

Fetched the same way as any vault object: `GET /api/vault/read/{vaultId}/{path}`.
Fully browser-callable with no extra credentials.

### d) Auth

The read key is sufficient for the entire resolution chain — ref, commit, tree,
and blob are all encrypted with the same AES-256-GCM read key. No separate
credential is needed to resolve HEAD or walk the tree.
The read key is public-by-design on the content vault (by @Content's choice).

### e) Stable path for @Content's nav JSON

    library/_nav.json

Root tree → entry with `name == "library"` (has `tree_id`) → sub-tree entry
with `name == "_nav.json"` (has `blob_id`). Confirmed by live tree walk:
`blob_id` resolved to `obj-cas-imm-73353c112dc7` (nav v3.16 ✓).

### f) Performance

Round-trip count for a full resolution (cold, no cache):
  1. Ref file        (determines commitId)
  2. Commit object   (determines treeId)
  3. Root tree       (finds "library" subtree)
  4. "library" tree  (finds "_nav.json" → blob_id)

With **sessionStorage caching keyed on `${vaultId}:${navPath}:${commitId}`**:
  - Subsequent same-session loads cost only 1 request (the ref fetch).
  - Cache automatically misses on new publish (commitId changes).
  - Cold load: 4 requests before nav fetch; all parallel-eligible within each
    level. Latency is comparable to one round-trip plus network jitter.

Verdict: acceptable for a public library load. The nav content fetch (request 5)
dominates; 4 tiny JSON requests are negligible.

### g) Resolution mechanism for other vault objects

Identical. The same chain (ref → commit → tree walk → blob_id) resolves any
file in the vault — articles, status boards, journalist posts, sub-nav JSONs.
The only difference is the `navPath` argument passed to the walker.

---

## 5. RECOMMENDATION — updated 2026-05-31

**Build Approach A now. Skip Approach C entirely.**

The original concern was dependency on @Sgit schema knowledge. That's gone —
§4 answers are confirmed. More importantly:

> **vault-client v1.2.2 already ships the full resolution chain.**
>
>   - `importReadKey` → import AES-256-GCM read key from base64url
>   - `deriveFileIdHex` → derive ref file ID via HMAC
>   - `openVaultTree` → ref → commit → root tree (3 requests)
>   - `walkTree` → decrypt tree entries and expose `name` fields
>   - `readObject` → fetch and decrypt any vault object by ID

No new infrastructure. No new @Sgit work. No new vault client version. The
browser already has everything it needs.

### What was built (PoC — PR #21)

A `_resolveNavObjectId(apiBaseUrl, vaultId, readKey, navPath)` function was
added to `sg-side-nav.js`. It:

  1. Derives the vault's default ref file ID from the read key
  2. Fetches the ref to get the current HEAD commit ID
  3. Checks sessionStorage for a cached blob ID keyed by `sg-nav:{vaultId}:{navPath}:{commitId}`
  4. On cache miss: walks commit → root tree → path segments → returns `blob_id`
  5. Caches the result; cache automatically misses when @Content publishes (new commitId)

`library/index.html` now uses:

    <sg-side-nav nav-path="library/_nav.json" vault-id="pmcv9tfe" read-key="..." ...>

instead of the previously hardcoded `nav-object-id="obj-cas-imm-..."`.

### What to extend next

- Apply the same `nav-path` pattern to `<sg-sub-nav>` (reads `cross_links`)
- Apply to `<sg-article-viewer>` (replace hardcoded `content_object_id` with
  a stable content path, enabling @Content to update articles without @Dev)
- Apply to the status boards (`dev/index.html`) and journalist post links
- Optional: add a `nav-branch` attribute (currently always uses the vault's
  default ref; named branches would use `sg-vault-v1:file-id:branch-ref:...`)

### Approach C (CI auto-rewrite) — no longer recommended

With Approach A live, Approach C would add CI complexity for zero user benefit.
The vault client already does at runtime what CI would have done at build time,
with the added benefit that content updates are live immediately (no redeploy at all).

### Approach B — still not recommended

The vault host does not offer a mutable pointer file. Approach B would require
new infrastructure that sgit already replaces cleanly.
