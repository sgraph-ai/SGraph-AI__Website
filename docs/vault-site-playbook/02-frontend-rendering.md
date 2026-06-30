# 02 — Front-End Rendering (Client-Side)

**Part of:** Vault-Backed Site Publishing documentation set
**Prereq:** [`01-vault-content-model.md`](./01-vault-content-model.md)

How a vault-backed sub-site renders in the browser: the shell, the Web Component
catalog, the CSS, and how to wire a new front-end.

---

## 1. The shell + components pattern

A sub-site front-end is a single thin **HTML shell** (e.g.
`en-gb/library/index.html`) that:

1. Declares an **import map** pointing the vault-client bare specifier at the
   hosted module.
2. Loads the Web Components it needs (`<script type="module">`).
3. Places the components in a three-column layout (nav · content · TOC).
4. Contains an **inline `<script type="module">`** that wires the components
   together: routing, loading state, breadcrumbs, prev/next, and the
   `nav:loaded` / `nav:select` event handlers.

The components do the heavy lifting (vault fetch, decrypt, render); the shell is
orchestration glue.

### Minimal shell skeleton

```html
<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8">
  <title>Library — sgraph.ai</title>
  <base href="/en-gb/library/">
  <link rel="stylesheet" href="../../_common/css/style.css">

  <!-- vault-client resolved from the hosted tools origin -->
  <script type="importmap">
  { "imports": {
      "/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js":
        "https://dev.tools.sgraph.ai/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js"
  } }
  </script>

  <script src="../../_common/js/sg-vault-cache.js"></script>
  <script type="module" src="../../_common/js/components/sg-article-viewer/v0/v0.1/v0.1.0/sg-article-viewer.js"></script>
  <script type="module" src="../../_common/js/components/sg-search/v0/v0.1/v0.1.0/sg-search.js"></script>
</head>
<body class="sub-site-page">
  <sg-site-header site="Send"></sg-site-header>

  <sg-sub-nav site-title="Library"
              vault-id="pmcv9tfe"
              read-key="<library-public-read-key>"
              nav-path="library/_nav.json"></sg-sub-nav>

  <div class="sub-site" id="sub-site-shell">
    <div class="sub-site__sidebar">
      <sg-search id="sg-search" root-url="/en-gb/library/search/root.json"
                 vault-id="pmcv9tfe" read-key="…"></sg-search>
      <sg-side-nav vault-id="pmcv9tfe" read-key="…"
                   nav-path="library/_nav.json" tree-label="Library"
                   home-href="/en-gb/library/" auto-select></sg-side-nav>
    </div>
    <div class="sub-site__loading" id="loading-state">…spinner…</div>
    <div class="sub-site__landing"  id="landing" hidden>…section cards…</div>
    <div class="sub-site__content"  id="article-content" hidden>
      <div id="article-crumbs"></div>
      <div id="article-render"></div>
      <div id="next-prev"></div>
    </div>
    <div class="sub-site__toc" id="article-toc" hidden>…</div>
  </div>

  <script type="module"> /* the shell wiring — see §4 */ </script>
  <script type="module" src="…/sg-site-header/v1/v1.0/v1.0.6/sg-site-header.js"></script>
  <script type="module" src="…/sg-sub-nav/v0/v0.1/v0.1.0/sg-sub-nav.js"></script>
  <script type="module" src="…/sg-side-nav/v0/v0.1/v0.1.0/sg-side-nav.js"></script>
</body>
</html>
```

> The read key appears in several attributes here. It is a **public** key (doc 01
> §6). Never put a write key in a shell.

---

## 2. The Web Component catalog

All under `sgraph_ai_website/v0/v0.2/v0.2.0/_common/js/components/<name>/<ver>/`.
The vault-backed-site-relevant ones:

| Component | Active version | Role |
|---|---|---|
| `sg-side-nav` | v0.1.0 | Fetches `_nav.json`, decrypts it, renders the sticky file-tree. Emits `nav:loaded` (whole tree) and `nav:select` (a clicked article). Supports `extra-links` (inject nav nodes from other vaults), `auto-select`, per-article `vault_id`/`read_key`. |
| `sg-sub-nav` | v0.1.0 | The sub-site band: title, description, cross-links to sibling sub-sites. |
| `sg-article-viewer` | v0.1.0 | The core renderer. Fetches + decrypts an object, runs `marked.parse` + typed fenced blocks + inline `vault:`/`vault-pdf:` tokens, injects HTML. Has a three-phase loading UX and a debug "Layer 2" panel. |
| `sg-search` | v0.1.0 | Fuse.js-backed search over a fetched node index (`root.json`). |
| `sg-debug-panel` | v0.1.0 | Dev tool: a Jaeger-style trace waterfall + per-request fetch log + raw vault content tab. Listens for `debug:*` events. |
| `sg-site-header` | **v1.0.6** | The persistent dark header; env-aware cross-site links + locale slot. (v1.0.4/v1.0.5 exist but are dead — do not reference.) |
| `sg-site-footer` | v1.0.0 | Shared footer. |

Supporting (not components, but in `_common/js/`):
- `sg-vault-cache.js` — wraps `fetch` to dedup concurrent identical vault GETs and
  cache responses; the debug panel reads its trace. Load it **before** the
  components (plain `<script>`, not a module) so it patches `fetch` first.
- `i18n.js` — locale selector (the marketing pages; locale generation is paused).
- The **vault-client** itself is *not* in this repo — it's imported from
  `dev.tools.sgraph.ai` via the import map. Bumping its version means editing the
  import map in each shell.

### The event contract (this is the integration surface)

```
sg-side-nav  ──emits──►  nav:loaded   detail: { sections, totalArticles, home }
             ──emits──►  nav:select   detail: { title, slug, content_object_id,
                                                render, schema, sectionTitle,
                                                parentTitle, vault_id, read_key }
             ──emits──►  nav:section  detail: { title, sectionSlug }
```

The shell listens for these and decides what to show. `sg-article-viewer` is
driven purely by attributes (`vault-id`, `read-key`, `object-id`, `render`), so
the shell creates one and sets attributes; the viewer does the rest.

---

## 3. CSS

One global stylesheet: `_common/css/style.css` (~3,900 lines). It carries the
dark marketing theme **and** the light "two-tone paper" sub-site theme **and** the
rich article-component styles (kanban, timeline, cards, …). Per-page CSS files
(`pricing.css`, `how-it-works.css`, …) layer on top.

Design tokens are CSS custom properties at `:root` (`--ss-*` for sub-site theme,
`--accent`, spacing `--sp-*`, etc.). New rich blocks should use the tokens, not
hardcoded hexes.

> **Known debt (CR-09):** the single stylesheet means marketing pages download
> ~1,900 lines of sub-site CSS they never use. When scaling, split into
> `base / marketing / sub-site / article-rich`. Documented here so you don't
> mistake the monolith for the intended end-state.

---

## 4. The shell wiring (inline module)

Each shell's inline `<script type="module">` implements the same set of functions.
The canonical set (from `en-gb/library/index.html`):

| Function | Purpose |
|---|---|
| `slugFromPath()` | Read the URL slug (`segments.slice(2).join('/')` — handles nesting). |
| `nav:loaded` handler | Cache sections, build landing cards, route the initial URL (home / section / deep-link). |
| `nav:select` handler | `pushState` + render the chosen article (`showArticle` or `showJsonBoard`). |
| `showHome()` | If `nav.home` is set, render the curated root article; else `showLanding()`. |
| `showArticle(objectId, render, vaultId, readKey, opts)` | Create an `<sg-article-viewer>` and wire the TOC observer (`opts.suppressToc` skips it). |
| `showSectionIndex` / `showGroupIndex` | Auto-generated index pages for section / group nodes. |
| `showNotFound(slug)` | 404 view. |
| `buildToc` / `buildNextPrev` / `setBreadcrumbs` | The chrome. |
| `popstate` handler | Back/forward navigation. |

### IMPORTANT — current duplication (CR-05)

Today these functions are **copy-pasted across the three shells** (library, dev,
invest), ~95% identical, and have **drifted**: the dev shell lacks the loading UX,
deep-link routing, `showNotFound`, and recursive nav flattening that library/invest
have. **Do not treat any one shell as canonical.** `en-gb/library/index.html` is
the most complete reference.

**The intended end-state for scaling** is a single shared module
`_common/js/sub-site-shell.js`, parameterised by `{ base, siteTitle, vaultId,
readKey, plugins }`, that every shell imports. Then a new site's front-end is one
HTML file (markup + attributes) plus a few lines:

```js
import { mountSubSite } from '/_common/js/sub-site-shell.js';
mountSubSite({ base: '/en-gb/myteam/', siteTitle: 'My Team',
               vaultId: 'xxxx', readKey: '…' });
```

When you build a new site (doc 05), prefer extracting this module first if it
doesn't exist yet — it is the single biggest scaling win and removes the drift
bug class. Until then, copy the **library** shell and adapt.

---

## 5. SPA routing

The sub-sites are single-page apps: `/en-gb/library/anything/here/` must serve the
shell `index.html`, then the inline script resolves the slug. This requires a
CloudFront rewrite rule (doc 03 §"viewer-request function") — the front-end alone
cannot do it, because a hard navigation to a deep slug must still hit the shell.

Real (non-SPA) sub-pages under a sub-site root must be allow-listed in the CF
function (the `DEV_REAL_PAGES` pattern) or they will be rewritten to the shell.

---

## 6. Front-end gotchas worth knowing

- **bfcache reload guard:** every shell does
  `window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); })`
  to avoid a stale shell after mobile back/forward.
- **Read-key format:** base64url only (doc 01 §2).
- **Sanitize all vault-derived HTML** (CR-01 — now shipped). `sg-article-viewer`
  runs `marked` output through a locally-vendored DOMPurify before injection, and
  `sg-side-nav` / `sg-sub-nav` / the three shells escape every nav-derived
  interpolation via the shared `_common/js/sg-escape.js` (`escHtml` + `safeUrl`).
  When building a new site, **reuse `sg-escape.js` and keep this pattern** — never
  interpolate vault strings into `innerHTML` raw, and route link hrefs through
  `safeUrl` to block `javascript:` URLs.
- **`document.title` is not updated on SPA navigation** today (CR-10) — add a
  one-liner in `nav:select` for a new site.
