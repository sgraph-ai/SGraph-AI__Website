# 00 — System Overview

**Part of:** Vault-Backed Site Publishing documentation set
**Audience:** Any agent standing up or maintaining a vault-backed site.

---

## 1. The problem this architecture solves

A traditional static site couples *content* and *presentation*: every copy edit
is a code commit and a redeploy. For a multi-agent system where content is
authored continuously (and often by different agents than the ones who own the
code), that coupling is the bottleneck.

sgraph.ai breaks the coupling:

```
   CONTENT                                 PRESENTATION
   (encrypted sgit vaults)                 (git repo: HTML / CSS / JS)
   authored by @Content, @Invest, …        owned by @Dev
   changes ≈ a vault push                  changes ≈ a git push + CI deploy
            \                                      /
             \____________  rendered  ___________/
                          at runtime
              (browser components + Lambda@Edge)
```

A content author pushes a new article to a vault and updates `_nav.json` — the
live site shows it on the next page load. No code change, no CI run. The website
code deploys on its own cadence and does not need to know what content exists.

---

## 2. The three layers

### Layer 0 — Storage: the vault

Content lives in an **sgit vault**: an encrypted, content-addressed version-
control store served over HTTPS by `https://send.sgraph.ai`. Each object is an
AES-256-GCM-encrypted blob addressed by a content hash (`obj-cas-imm-…`). A vault
has an ID (e.g. `pmcv9tfe`) and a read key. See `01-vault-content-model.md`.

### Layer 1 — Client-side rendering: Web Components

The browser loads a thin HTML **shell** that hosts a set of Web Components
(`sg-side-nav`, `sg-article-viewer`, …). They fetch the vault's `_nav.json`,
decrypt it with the page's read key, render the navigation, and on click fetch +
decrypt + render the selected article (Markdown → HTML, plus typed fenced blocks
and structured JSON board views). See `02-frontend-rendering.md`.

### Layer 2 — Edge rendering: Lambda@Edge

For agents and crawlers, a **Lambda@Edge** function intercepts requests for
`*.md`, `*.llm.json`, and `/llms.txt`. It loads a **render manifest**, walks the
same vault nav tree, decrypts the same objects, and emits Markdown / structured
JSON / a link index — no browser required. See `03-edge-rendering.md`.

### Plus — Delivery: CI/CD → S3 + CloudFront

The repo (shells, components, CSS, manifests, the orchestrator module) is
deployed to S3 and fronted by CloudFront via a GitHub Actions pipeline using
**IFD versioning** (an overlay model). See `04-ci-cd-pipeline.md`.

---

## 3. Request flows

### A browser loads `/en-gb/library/get-started/claude-setup/`

```
browser ─► CloudFront ─► viewer-request CF Function
                          (rewrites the SPA slug path → /en-gb/library/index.html)
                       ─► S3 returns the shell HTML
browser runs the shell:
   sg-side-nav  ─► fetch library/_nav.json blob ─► decrypt ─► render tree
   user already deep-linked, so the shell resolves the slug to an object id
   sg-article-viewer ─► fetch article blob ─► decrypt ─► marked.parse ─► innerHTML
```

### An agent fetches `/en-gb/library/get-started/claude-setup.md`

```
agent ─► CloudFront ─► viewer-request CF Function (passes *.md through)
                    ─► origin-request Lambda@Edge
                         loads the orchestrator module + the library-md manifest
                         walks library/_nav.json to find the slug → object id
                         fetches + decrypts the blob
                         returns text/markdown
```

Same vault, same content, two render paths — one for humans, one for machines.

### A content author publishes a new article

```
author ─► sgit write article.md to the content vault ─► sgit push
       ─► sgit edit library/_nav.json (add a node) ─► sgit push
live site shows it on next load. No CI, no code change.
```

---

## 4. The repository, top to bottom

```
sgraph_ai_website/
  version                              current release tag (auto-bumped by CI)
  v0/v0.2/v0.2.0/                      ← the active IFD source line (everything below ships)
    en-gb/
      library/index.html               SPA shell for the Library sub-site
      dev/index.html                   SPA shell for the Dev sub-site (+ board views)
      invest/index.html                SPA shell for the Invest sub-site
      dev/nav.json                     a static nav (the dev sub-site uses a repo nav)
      …                                static marketing pages (pricing, security, …)
    _common/
      css/style.css                    the global stylesheet
      js/components/                   the Web Component catalog (see doc 02)
      js/sg-vault-cache.js             request-dedup + cache layer
    core/
      edge-render/v1/sg-edge-render.mjs   the edge orchestrator (see doc 03)
      edge-render/v1/manifests/*.json     render manifests (one per representation)
      public-vaults.json                  registry of public vaults + read keys
    cloudfront/                        the viewer-request CF Function source
infra/lambda-edge/sg-edge-render/      the Lambda@Edge entry (loads the orchestrator)
.github/workflows/                     the CI pipeline (see doc 04)
sgraph_ai_website__deploy/             the Python deploy scripts (see doc 04)
docs/                                  architecture docs (incl. this set)
```

---

## 5. The trust model (read this before reusing the pattern)

The vaults listed in `core/public-vaults.json` use **public read keys** — the
keys are shipped in the website's HTML and in that registry. This is **safe and
intentional** because the content is meant to be world-readable; the encryption
is about integrity and a uniform storage model, not confidentiality for these
vaults.

Consequences you must internalise before copying this:

1. **A published read key provides zero confidentiality.** Anyone with the key
   (i.e. anyone who views the page source) can read every object in that vault.
   The "unlisted" invest sub-site is effectively public — it is simply not linked.
2. **Write keys are a different class of secret.** They must never appear in the
   repo, in published vault content, or in any doc. Distribute them only via a
   private team vault or a human.
3. **For confidential content, this exact pattern does not apply** — you would
   need per-user keys and server-side authorization, which this system does not
   provide. Use it only for public publishing.

The attacker model for the public pattern is therefore "whoever can write to a
vault can change what the site shows" — which is why the content vaults' write
keys are tightly held, and why the front-end should sanitize vault-derived HTML
(see the code review backlog, items CR-01).

---

## 6. The scaling vision

The pattern is now proven across three live sub-sites (Library, Dev, Invest) on
one shared content/presentation split. Scaling to *N* sites means, per site:

1. A vault (or a section of an existing vault) holding the content + a nav tree.
2. A read manifest (or set) so the edge layer can serve `.md`/`.llm.json`.
3. A shell HTML page wiring the components to that vault + nav.
4. A CloudFront/route entry so the SPA slugs resolve.
5. Nothing new in CI — the same pipeline deploys the new shell with everything else.

Doc 05 is the concrete step-by-step. The rest of this set is the reference each
step draws on.

The biggest current lever for *cheap* scaling is **reducing per-site code**: the
three shells today are ~95% duplicated inline script (code review item CR-05).
The target end-state is a single shared `sub-site-shell.js` module parameterised
by `{ base, siteTitle, vaultId, readKey }`, so a new site's front-end is one HTML
file plus a few attributes. Doc 02 describes both today's reality and that target.
