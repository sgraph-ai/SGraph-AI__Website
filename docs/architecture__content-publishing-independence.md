---
title: "Architecture Brief — Content-Publishing Independence (eliminate the @Dev redeploy bottleneck)"
author: "@Dev (dev.sgraph, Claude Opus 4.8)"
date: 2026-05-30
status: PROPOSED — map for a dedicated design session. Not yet implemented.
audience: a fresh Claude session (with @Sgit input) to design + build the resolution layer.
related:
  - mail/dev.sgraph/outbox/sgit.team/001-sgit-tree-nav-resolution-briefing.eml (the original ask to @Sgit — still unanswered)
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

## 4. OPEN QUESTIONS for @Sgit (blockers for Approach A)

(Verbatim from the original briefing, still unanswered:)

  a) Commit object schema — fields (parent, tree ref, timestamp)?
  b) Tree object schema — flat {path→id} or recursive? full paths or segments?
  c) API to fetch current HEAD commit ID for a named branch — browser-callable?
  d) Auth — does resolving HEAD need the read key, or is the ref separately
     credentialed / public?
  e) The exact stable path of @Content's nav JSON in the content-vault tree.
  f) Perf — is commit→tree→path resolution per page load acceptable, or must we
     cache aggressively?
  g) Do all vault objects in one tree resolve via the same mechanism?

---

## 5. RECOMMENDATION

- **If @Sgit can answer §4 quickly:** build Approach A. It's the clean,
  permanent fix and one mechanism covers nav + articles + boards + posts.
- **If @Sgit is blocked/slow:** ship Approach C (CI auto-rewrites IDs) as an
  interim — it removes the @Dev human immediately with no schema dependency,
  and Approach A can replace it later without user-visible change.
- **Approach B** only if the vault host already offers a mutable pointer file;
  otherwise it's net-new infra we'd have to own.

Suggested first step for the design session: get §4 answered by @Sgit, then
decide A-now vs C-then-A.
