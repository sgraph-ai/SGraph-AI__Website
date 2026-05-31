# Sub-Site SPA Architecture — Debrief

**Date:** 2026-05-02
**Author:** @Dev (dev.claude-code-web.s-QCF1P19ZNZ)
**Branch:** claude/continue-website-work-4oy7L

---

## What Was Built

Library (`/en-gb/library/`) and Dev (`/en-gb/dev/`) are now full SPAs.
Each has:

- `sg-site-header` — persistent, always on top
- `sg-sub-nav` — sub-site identity bar (title + cross-links)
- `sg-side-nav` — vault-driven or JSON-driven left sidebar nav tree
- A content area loaded dynamically via `sg-vault-content`
- Path-based URL routing via `history.pushState` + CloudFront rewrite

Navigating between articles changes the URL (`/en-gb/library/vault-rendered-pages/`)
without a page reload. Back/forward works. Direct URL access works.

---

## Components

### `sg-sub-nav`

Path: `_common/js/components/sg-sub-nav/v0/v0.1/v0.1.0/sg-sub-nav.js`

Sticky bar sitting directly below `sg-site-header`. Shows the sub-site title
on the left and cross-links (to other sub-sites) on the right.

Attributes:

| Attribute    | Purpose |
|-------------|---------|
| `site-title` | Display name shown on the left ("Library", "Dev") |
| `links`      | Inline JSON: `[{"title":"Dev","href":"/en-gb/dev/"}]` |
| `src`        | URL of a nav JSON file — reads `cross_links` from it |
| `active-href` | Highlights the matching cross-link |

Priority: `links` attr > `src` fetch. The `links` attr is used for Library
(cross-links are stable enough to hardcode for now). The `src` attr is used
for Dev (reads `dev.cross_links` from `dev-nav.json`).

CSS class: `.sg-sub-nav__bar` is `position: sticky; top: var(--site-header-height)`.

### `sg-side-nav`

Path: `_common/js/components/sg-side-nav/v0/v0.1/v0.1.0/sg-side-nav.js`

Left sidebar nav tree. Handles two data sources and renders section/article lists.

Attributes:

| Attribute        | Purpose |
|-----------------|---------|
| `vault-id`       | Vault to fetch nav JSON from |
| `read-key`       | AES-256-GCM read key (base64url) |
| `nav-object-id`  | Vault object ID of the nav JSON |
| `src`            | URL of a local/remote nav JSON file |
| `active-slug`    | Slug of the currently highlighted article |
| `auto-select`    | Boolean; fires `nav:select` on first render for initial load |

Nav JSON schema handled:

```json
{ "library": { "sections": [...] } }   // vault nav
{ "dev":     { "sections": [...] } }   // dev-nav.json
{ "sections": [...] }                  // flat fallback
```

Articles with `href` are rendered as `<a>` tags (link-out).
Articles with `content_object_id` are rendered as `<button>` tags (SPA nav).

Custom event fired on button click (and on `auto-select` first render):

```js
CustomEvent('nav:select', {
  bubbles: true,
  detail: { title, slug, content_object_id, render }
})
```

### `auto-select` behaviour

When `auto-select` is present on `sg-side-nav`:

1. After the first `_render()` call with real data, `_dataLoaded` is set true.
2. The component looks for the button matching `active-slug` (or takes the first button).
3. It adds the active class and dispatches `nav:select` synthetically.
4. This triggers the page's `nav:select` listener which loads the article.

`_dataLoaded` is NOT reset when `active-slug` changes (only when the data source
changes), so re-setting `active-slug` from a `popstate` handler does not re-fire
the auto-select. Instead the `popstate` handler calls `btn.click()` directly.

---

## URL Routing

### Path pattern

```
/en-gb/library/vault-rendered-pages/   ← slug path
/en-gb/library/                         ← root (no slug)
```

The slug is extracted in JS:

```js
function slugFromPath() {
  const segments = location.pathname.split('/').filter(Boolean);
  // /en-gb/library/         → ['en-gb', 'library']         → ''
  // /en-gb/library/my-slug/ → ['en-gb', 'library', 'my-slug'] → 'my-slug'
  return segments.length > 2 ? segments[2] : '';
}
```

### On nav item click

```js
document.addEventListener('nav:select', e => {
  const { slug, content_object_id, render } = e.detail;
  const targetPath = slug ? `/en-gb/library/${slug}/` : '/en-gb/library/';
  if (location.pathname !== targetPath) {
    history.pushState({ slug }, '', targetPath);
  }
  loadArticle(content_object_id, render);
});
```

### On back/forward

```js
window.addEventListener('popstate', () => {
  const slug = slugFromPath();
  const btn = sideNav.querySelector(`.sg-side-nav__item[data-slug="${CSS.escape(slug)}"]`);
  if (btn) btn.click();
  else sideNav.setAttribute('active-slug', slug); // nav still loading
});
```

### On direct URL load

Before the nav renders, the page reads the slug from the URL and sets it on
`sg-side-nav`:

```js
const initialSlug = slugFromPath();
if (initialSlug) sideNav.setAttribute('active-slug', initialSlug);
```

When `sg-side-nav` renders, `auto-select` fires `nav:select` for the article
matching that slug (or the first article if no slug).

---

## CloudFront Rewrite

File: `cloudfront/url-rewrite.js`

The CloudFront Function runs on every Viewer Request, before S3 is contacted.
The SPA rewrite rules were added above the existing directory→index.html logic:

```js
// Library: all sub-paths are SPA slug routes
if (uri.endsWith('/') && uri.startsWith('/en-gb/library/') && uri !== '/en-gb/library/') {
    request.uri = '/en-gb/library/index.html';
    return request;
}

// Dev: sub-paths are SPA slug routes, except known real sub-pages
var DEV_REAL_PAGES = ['/en-gb/dev/vault-peek/'];
if (uri.endsWith('/') && uri.startsWith('/en-gb/dev/') && uri !== '/en-gb/dev/' &&
    !DEV_REAL_PAGES.some(function(p) { return uri === p; })) {
    request.uri = '/en-gb/dev/index.html';
    return request;
}
```

**Why a CloudFront Function and not a custom error response:**
- Custom error responses (403/404 → fallback page) are global — they affect all
  404s site-wide, including missing CSS/JS files, which confuses browser caching
  and error handling.
- The Function approach rewrites *before* S3 is contacted, so no 404 is ever
  generated for slug paths. Real 404s from genuinely missing assets pass through
  unaffected.

**Adding new real sub-pages under /en-gb/dev/:**
Add the path to `DEV_REAL_PAGES` in `url-rewrite.js` before deploying the page.
Example: adding `/en-gb/dev/vault-peek/` prevents that path from being rewritten
to the dev index.

---

## The `<base>` Tag Fix

### Problem

When CloudFront rewrites `/en-gb/library/vault-rendered-pages/` to serve
`library/index.html`, the physical HTML file is at `/en-gb/library/index.html`
but the browser sees the URL `/en-gb/library/vault-rendered-pages/`.

The HTML uses relative paths like `../../_common/fonts/fonts.css`.
The browser resolves these against the URL it sees, not the file's location:

```
/en-gb/library/vault-rendered-pages/ + ../../_common/fonts.css
= /en-gb/_common/fonts.css   ← WRONG: 404
```

From the library root URL the same path resolves correctly:

```
/en-gb/library/ + ../../_common/fonts.css
= /_common/fonts.css          ← correct
```

### Fix

Add `<base href="/en-gb/library/">` (or `/en-gb/dev/`) inside `<head>`:

```html
<head>
  <base href="/en-gb/library/">
  <link rel="stylesheet" href="../../_common/fonts/fonts.css">
  ...
```

The `<base>` tag pins all relative URL resolution to the sub-site root. The
relative paths `../../_common/...` now always resolve to `/_common/...`
regardless of what slug the browser URL shows.

**JavaScript is unaffected:** `location.pathname` and `history.pushState` read
and write the actual browser URL, which is still the slug path. `slugFromPath()`
works correctly. The `<base>` tag only affects relative URL resolution in HTML
attributes and `fetch()` with relative URLs.

**`fetch()` with relative URLs:** when `sg-side-nav` fetches `src="../../_common/data/dev-nav.json"`,
the browser resolves it against `document.baseURI` (which reflects the `<base>` tag),
so it correctly fetches `/_common/data/dev-nav.json`.

---

## Gotchas

1. **`<base>` tag breaks hash links.** Any `<a href="#section">` in the page
   resolves against the base href, not the current URL. Avoid bare hash links
   on SPA pages. Use absolute paths or JS-based scrolling instead.

2. **`DEV_REAL_PAGES` must be kept in sync.** When a new real sub-page is added
   under `/en-gb/dev/`, it must be added to `DEV_REAL_PAGES` in the CloudFront
   Function before deployment. Otherwise the CloudFront rewrite will intercept
   direct loads of that page.

3. **`auto-select` fires once per data load.** If vault credentials or `src` change,
   `_dataLoaded` resets and auto-select fires again on the next render. If only
   `active-slug` changes, no re-fire. This is intentional.

4. **Popstate before nav is loaded.** If the user hits back/forward before the
   `sg-side-nav` has finished fetching and rendering, `btn.click()` finds no
   button and falls back to setting `active-slug`. The article load is deferred
   until the nav renders. This is an acceptable edge case (occurs only within the
   first ~100ms of a cold page load).

5. **Library cross-links are hardcoded.** The library nav JSON in the vault does
   not yet have a `cross_links` key. The `sg-sub-nav` `links` attribute is used
   directly in `library/index.html`. When the vault nav JSON is updated to include
   `cross_links`, switch `sg-sub-nav` to use `vault-id` + `read-key` +
   `nav-object-id` attributes instead and remove the inline `links` attr.

---

## File Map

```
cloudfront/url-rewrite.js                              ← SPA rewrite rules
_common/css/style.css                                  ← section 29: sub-site + component CSS
_common/data/dev-nav.json                              ← nav JSON for /en-gb/dev/
_common/js/components/sg-sub-nav/v0/v0.1/v0.1.0/      ← sub-site top bar
_common/js/components/sg-side-nav/v0/v0.1/v0.1.0/     ← sidebar nav tree
en-gb/library/index.html                               ← Library SPA shell
en-gb/dev/index.html                                   ← Dev SPA shell
```
