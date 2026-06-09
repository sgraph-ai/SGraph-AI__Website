# Code Review — SGraph-AI Website

**Reviewer:** @Dev (Fable 5)
**Date:** 2026-06-09
**Checkout reviewed:** `1f89f15` (merged qa→dev state)
**Scope:** full repo — front-end components, SPA shells, CSS, edge rendering, CloudFront, CI/CD, deploy scripts, tests

> **Caveat:** this workspace was re-provisioned at `1f89f15`, which predates the most
> recent pushes to `qa` (key-points + mermaid fenced blocks, `library.home` curated
> root, TOC suppression). Findings against `sg-article-viewer.js` and
> `en-gb/library/index.html` describe the tree as of this checkout; the newer commits
> change details (e.g. `FENCED_TYPES` contents) but none of the structural findings.

---

## 1. Executive summary

The codebase is an unusually disciplined **no-build static site**: plain HTML/CSS/JS,
Web Components, no framework, no bundler — and it successfully implements a genuinely
novel architecture (client-side and edge-side rendering of AES-GCM-encrypted vault
content). The docs/ folder is excellent; the architecture is well thought through and
well recorded.

The three systemic problems, in priority order:

1. **No HTML sanitization on any vault-content render path.** Vault markdown, nav
   JSON, frontmatter, and even URL slugs reach `innerHTML` unescaped in many places.
   The whole site's trust model is "the vault is the boundary" — but a single
   compromised vault writer (or nav JSON) gives stored XSS on sgraph.ai.
2. **Copy-paste drift across the three SPA shells.** ~450–500 of ~1,500 combined
   inline script lines exist in 2–3 copies, and they have *already* diverged (dev
   shell lacks loading UX, deep-link routing, 404 handling that library/invest have).
   Every new feature (e.g. `library.home`) currently has to be hand-ported.
3. **CI deploys with zero checks, and the pipeline itself has real supply-chain /
   pinning gaps.** Push → deploy with no test, no lint; prod dispatch doesn't
   actually pin to `main`; third-party actions pinned to a mutable `@dev` branch.

None of these is hard to fix, and the fixes are mostly mechanical. Detail below.

---

## 2. Architecture (as found)

```
browser ──► CloudFront (qa / dev / main / prod distributions)
              │
              ├─ viewer-request CF Function (url-rewrite-for__sgraph-ai.js)
              │    stamps x-sg-site-host, rewrites SPA slugs → index.html,
              │    DEV_REAL_PAGES allowlist, dir → index.html, bare → 302
              │
              ├─ origin-request Lambda@Edge (infra/lambda-edge/sg-edge-render)
              │    intercepts /llms.txt, *.md, *.llm.json only
              │    → fetches orchestrator JS from the site itself, import()s it
              │    → orchestrator fetches manifest + walks vault tree
              │      (send.sgraph.ai), AES-GCM decrypts, renders md/json/llms.txt
              │
              └─ S3 ({bucket}/websites/sgraph-ai/{env}/latest/)  ← everything else

client side:  SPA shells (library / dev / invest) ──► sg-side-nav fetches _nav.json
              from vault ──► sg-article-viewer fetches + decrypts article objects,
              marked.parse + typed fenced YAML blocks ──► innerHTML

deploy:       push to qa/dev/main ──► reusable GH Actions pipeline ──► Python
              deploy scripts ──► s3 sync releases/ + IFD overlay onto latest/
              ──► CloudFront invalidate /* ──► curl smoke (non-gating)
```

Strengths worth calling out:

- **The dual-representation idea** (every article addressable as HTML, `.md`, and
  `.llm.json`, plus `llms.txt` index) is genuinely good and well executed.
- **IFD versioning** gives cheap rollback and additive patching.
- The **debug panel** (Jaeger-style trace waterfall, fetch sequence log) is far
  better operational tooling than most marketing sites ever build.
- `sg-vault-cache`, request dedup, and the loading UX show real attention to
  perceived performance.
- The multi-agent process artifacts (docs/, team/, Email-FS) make the repo
  self-describing to a degree that made this review much easier.

---

## 3. High-severity findings

### 3.1 XSS: vault content reaches `innerHTML` unsanitized (front end, multiple sites)

- `sg-article-viewer.js:923,946` — `marked.parse(...)` output injected directly;
  **DOMPurify is not present anywhere in the repo**. marked passes raw inline HTML
  through, so `<img onerror=...>` in vault markdown executes.
- `sg-side-nav.js` has **no escaping at all** — `_render` interpolates `title`,
  `href`, slugs from vault `_nav.json` straight into `innerHTML` (e.g. lines
  255–271, 300–303, 351–353). Same in `sg-sub-nav.js:83–120`.
- The three SPA shells interpolate nav-derived strings unescaped in
  `showSectionIndex`, `showGroupIndex`, breadcrumbs, `buildLandingCards`,
  `buildNextPrev`, `buildToc` (library ~lines 355–603, invest ~279–439, dev
  ~610–764). `showNotFound` injects the URL-derived slug.
- dev shell's `escH` escapes `&<>` but not quotes, yet is used in attribute and
  `onclick="window.open('${...}')"` contexts (dev/index.html:345,500) — quote
  breakout.
- `sg-article-viewer.js:469` — frontmatter `viewer` value interpolated unescaped.
- Markdown links are not protocol-filtered: `[click](javascript:alert(1))`
  survives (`sg-article-viewer.js:878`).

**Attacker model:** anyone who can write to a content vault (or tamper with nav
JSON) gets stored XSS on the site — on pages that also hold vault read keys and
make authenticated-looking fetches. This defeats the trust story the site itself
advertises.

**Fix (one coordinated pass):**
1. Vendor DOMPurify (like fuse.js) and wrap every `marked.parse` output.
2. One shared `escHtml()` that also escapes `"` and `'`; apply at every
   interpolation in side-nav, sub-nav, and the three shells.
3. Allowlist link protocols (`https?:`, `mailto:`, relative) in the marked renderer.
4. Replace `onclick`-string patterns with `addEventListener` + `dataset`.

### 3.2 Lambda@Edge: host-header-derived remote code execution surface

`infra/lambda-edge/sg-edge-render/index.mjs:61–68` builds the orchestrator URL from
`x-sg-site-host` / `x-forwarded-host` / `host` request headers, then fetches that
JS, writes it to `/tmp`, and `import()`s it. On any distribution where the
viewer-request function does not overwrite these headers, a client-supplied header
makes the Lambda **fetch and execute attacker-controlled JavaScript**.

**Fix:** validate the host against a hardcoded allowlist before fetching. Cheap,
no behaviour change for legitimate traffic.

### 3.3 CI: prod deploy is not pinned to main; mutable third-party actions

- `ci-pipeline__prod.yml` passes `git_branch: 'main'` but the base pipeline never
  uses it — `actions/checkout@v4` checks out whatever ref the dispatch ran on.
  **Dispatching the prod workflow from any branch deploys that branch to sgraph.ai.**
- `ci-pipeline.yml:62,103` — `owasp-sbot/OSBot-GitHub-Actions/...@dev` actions are
  pinned to a **mutable branch**, run with `secrets: inherit`, and push tags/commits.
  Classic supply-chain exposure.
- No `permissions:` blocks; long-lived AWS keys rather than OIDC.

**Fix:** `checkout` with `ref: ${{ inputs.git_branch }}`; pin external actions to
commit SHAs; add least-privilege `permissions:`; migrate to OIDC role assumption.

### 3.4 Zero gating checks between commit and production CDN

All five workflows go push → deploy. The edge-render smoke harness
(`tests/edge-render/run-local.mjs`) and the Playwright spec exist but are wired
into nothing (and the e2e spec has machine-specific hardcoded paths). The ~19k-line
front end has zero unit tests. The post-deploy curl smoke in
`deploy_static_site.py:472–490` prints a WARNING and returns — the pipeline cannot
go red.

**Fix (minimum viable):** make the smoke test exit non-zero on failure; add a
gating CI job that runs the edge-render harness per manifest route; add
`package.json` + portable Playwright config so the e2e spec runs in Actions.

### 3.5 Stale-render race in sg-article-viewer

`_loadSeq` is checked after decrypt (`sg-article-viewer.js:442`) but **not** after
`_renderArticle`'s subsequent awaits (CDN imports, line 859) before the
`innerHTML` write at 946 — a slow stale load can overwrite a newer one. Compounded
by `attributeChangedCallback` firing `_load()` once per attribute (line 342), so
initial setup launches 4–5 concurrent loads.

**Fix:** pass `seq` into `_renderArticle` and bail before DOM injection; coalesce
attribute changes via `queueMicrotask` (sg-side-nav already does this correctly).

---

## 4. Medium-severity findings

### Front end / components

| Finding | Location | Note |
|---|---|---|
| Vault-cache replays failures as HTTP 200 | `sg-vault-cache.js:168–207` | Deduped joiners of a failed request get a synthetic 200 with the error body — fails mysteriously at decrypt. Store and replay `{status, statusText}`. |
| Blob URL leak across navigations | `sg-article-viewer.js:355,343` | `_blobUrls` only revoked on disconnect; every nav:select leaks prior object URLs. Revoke at top of `_load()`. |
| Body-attached panel never torn down | `sg-article-viewer.js:609` | `_layer2El` appended to `document.body`, never removed in `disconnectedCallback`; timer keeps firing. |
| Debug panel never restores console patches | `sg-debug-panel.js:1070` | Reconnect stacks `console.error/warn` wrappers; blind `window.fetch` restore can drop later patches. |
| Unpinned remote CDN imports | `sg-article-viewer.js:860,1343` | `marked@9`/`js-yaml@4` floating tags from jsdelivr/esm.sh, no SRI, on pages holding read keys. Vendor locally like fuse.js. |
| Read keys smeared across DOM/events | side-nav:269,299; search:259 | Keys are public by design, but re-emitting them into `data-read-key` attributes and document-level events invites copy-paste into non-public contexts. |

### SPA shells

- **Drift inventory (the cost of the copy-paste):** dev shell is missing the
  loading/cold-start UX, deep-link slug resolution (`findArticleBySlug`),
  `showNotFound`, `showGroupIndex`, recursive nav flattening, and mobile nav
  auto-collapse that library/invest have. Three different `setBreadcrumbs`
  signatures. invest dropped the group-index description that library renders.
- **Recommended structural fix:** extract `_common/js/sub-site-shell.js`
  parameterized by `{base, siteTitle, vaultId, readKey}` covering routing, loading
  state, TOC, breadcrumbs, prev/next, section/group/404 views; dev's CI/kanban
  views become plug-in renderers. ~1,500 inline lines → ~700 shared + ~50/page,
  and features like `library.home` land everywhere at once.
- Credentials repeated up to 4× per page (attributes + JS consts + extra-links
  JSON); rotation touches ~8 files. Single source per page.

### Edge / deploy

- **Every edge-render error is a 502 with internals leaked** — unknown slugs should
  be 404 with a generic body (`index.mjs:83–94`, `sg-edge-render.mjs:137,150`).
- **No caching on the edge path**: orchestrator re-fetched per invocation,
  `no-store` on responses, and `resolvePath` does ref→commit→per-level-tree→blob
  as sequential fetches. Crawler on llms.txt = fetch storm. Add TTL module cache +
  short `max-age`.
- **No fetch timeouts** anywhere in the Lambda path (`AbortSignal.timeout` missing).
- **`deploy_static_site.py` uploads everything as `no-store, no-cache`**
  (lines 65–69), contradicting its own docstring's tiered policy — so CloudFront
  caches nothing and the `/*` invalidation is redundant. Looks like a dev-phase
  toggle that never got reverted.
- **The html sync pass forces `text/html` on every unknown extension**
  (lines 223–237): `sitemap.xml`, `.mjs` (the edge orchestrator itself!), `.txt`
  are served with the wrong content type.
- **Dev deploys invalidate the main distribution** (`CF_ARGS` for non-qa envs
  includes both `WEBSITE_CF_DIST` and `WEBSITE_CF_DIST_MAIN`).
- `generate_sitemap.py` is stale (hardcoded 2026-03-01 lastmod, v0.1 routes) and
  uncalled; `validate_website_files` checks v0.1 paths that warn on every deploy.
- `DEV_REAL_PAGES` allowlist in the CF function is deployed manually out-of-band —
  forgetting the publish silently serves the SPA shell for a new real page.

---

## 5. Low-severity / hygiene

- `escHtml` triplicated (article-viewer, search, debug-panel) and none escape `'`.
- `_openVaultCtx`/`_resolvePathWithCtx` copy-pasted verbatim between side-nav and
  sub-nav (~60 lines); sg-search reimplements fetch+decrypt instead of using the
  vault client it already imports. One shared vault-read helper module would
  remove four implementations.
- Hand-rolled frontmatter parser (`sg-article-viewer.js:1267–1285`) coexists with
  js-yaml; quoted values keep quotes, nesting silently flattens.
- Status-badge regex rewrites `<td>Live</td>` across the entire rendered HTML —
  will mangle legitimate prose (`sg-article-viewer.js:936–941`).
- ~16 unconditional `console.log` calls ship in sg-site-header v1.0.6.
- Dead versions: sg-site-header v1.0.4/v1.0.5 unreferenced; an entire parallel
  site tree at `v0/v0.1/v0.1.0/` (divergent i18n.js, dropped contact-form.js).
- CF function: 302 drops query strings; `includes('.')` file heuristic checks the
  whole URI, not the last segment; `startsWith(area.base)` in the edge router
  matches `/en-gb/library-evil/`.
- `store_ci_artifacts.py` git diff is always empty in CI (depth-1 checkout).
- `gh-release-to-main.sh`: no `set -e`; dev back-merge never pushed.
- SPA shells: no `<noscript>`, no meta description/OG/canonical, `document.title`
  never updated on navigation (every article shows "Library — sgraph.ai" in tabs
  and bookmarks — one line in `nav:select` fixes it), TOC toggle has no accessible
  name, prev/next cards are click-only `<div>`s.
- style.css is 3,863 lines holding four design eras and two themes (four `:root`
  blocks); marketing pages download ~1,900 lines of sub-site CSS they never use.
  Split into base / marketing / sub-site / article-rich. Two parallel kanban
  implementations exist (CSS classes used only by article-viewer vs. inline styles
  in the dev shell).
- Google Fonts Inter is loaded by all three shells but unreferenced by style.css.

---

## 6. Vault read keys — a note on the threat model

Read keys are committed in ~8 HTML pages, 5 edge manifests, and
`core/public-vaults.json`. This is **documented as intentional** ("public
read-only" — `en-gb/dev/vaults/index.html:62`), and that's a coherent design: the
keys grant read access to content that is meant to be world-readable anyway.

Two consequences should be stated explicitly somewhere canonical:

1. **The encryption provides zero confidentiality for these vaults** — including
   the "unlisted" invest vault `ub9jj0gq`, which is effectively public.
2. **The pattern must never be copied for a non-public vault.** Worth a CI lint:
   only allowlisted vault IDs may appear in manifests/HTML. Rotation is also
   painful today (same key in up to 4 places per page) and git history makes every
   old key permanent — fine for public keys, fatal if the pattern leaks to private
   ones.

## 7. Test coverage

Effectively none enforced. The vault decryption chain exists in **two parallel
implementations** (browser components and the edge orchestrator) with no shared
test keeping them in sync — this is the single most valuable thing to test first,
since a divergence breaks either the site or the .md/.llm.json endpoints silently.

Suggested ladder (each step is independently useful):
1. Make the post-deploy smoke gating (exit non-zero).
2. Wire `tests/edge-render/run-local.mjs` into CI per manifest route.
3. `package.json` + portable Playwright; run the existing e2e spec on qa deploys.
4. Unit tests for the pure functions: `slugFromPath`/`flattenNavTree` (after shell
   extraction), fenced-block renderers, vault-cache status replay.

---

## 8. Prioritized recommendations

| # | Action | Effort | Pays off |
|---|---|---|---|
| 1 | DOMPurify + shared quote-safe `escHtml` across all render paths | S–M | Closes the stored-XSS class |
| 2 | Host allowlist in Lambda@Edge orchestrator loader | S | Closes the RCE surface |
| 3 | Pin CI actions to SHAs; honor `git_branch` in prod dispatch; `permissions:` blocks | S | Closes supply-chain + wrong-branch-to-prod |
| 4 | Make smoke tests gating; wire edge-render harness into CI | S | First-ever red pipeline capability |
| 5 | Extract shared `sub-site-shell.js` from the three SPA shells | M | Removes ~800 duplicated lines + the drift bug class |
| 6 | Fix `_renderArticle` seq race + vault-cache status replay + blob URL revocation | S | The three real runtime bugs |
| 7 | Restore tiered Cache-Control in deploy; fix content-type pass | S | Site is currently uncached end-to-end |
| 8 | Vendor marked/js-yaml (drop floating CDN imports) | S | Supply-chain on key-holding pages |
| 9 | Split style.css; delete dead component versions + v0.1 tree | M | Hygiene, payload size |
| 10 | 404s (not 502s) from edge renderer; `document.title` on SPA nav; noscript/meta | S | SEO + crawler correctness |

Items 1–4 are the ones I'd treat as blocking before any wider launch; 5 is the
best investment for development velocity; the rest are steady-state cleanup.
