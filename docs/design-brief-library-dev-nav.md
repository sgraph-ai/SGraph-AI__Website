# Design Brief — Library & Dev Sub-Site Navigation

**For:** Claude Design  
**From:** @Dinis / sgraph.ai  
**Date:** 2026-05-02  
**Deliverable:** Visual mockups (desktop + mobile) for the Library and Dev sub-site shells

Two screenshots are attached:
- `pic1` — `/en-gb/library/vault-rendered-pages/` (Library sub-site)
- `pic2` — `/en-gb/dev/two-agent-operating-model/` (Dev sub-site)

---

## What These Pages Are

sgraph.ai has two content sub-sites, each with the same SPA shell:

- **Library** — technical knowledge base: how the product works, underlying concepts, dependencies. Public-facing, growing fast.
- **Dev** — documentation about how the site itself is built: two-agent operating model, Email-FS, vault-as-comms. Developer/internal audience.

Each sub-site has:
1. A persistent top site header (`sg-site-header`) — branding + primary nav
2. A sub-site bar directly below it — sub-site identity + cross-links between Library ↔ Dev
3. A left sidebar nav tree — sections + article links
4. A main content area — vault-rendered markdown

Navigation between articles is SPA (no page reload). URLs update: `/en-gb/library/vault-rendered-pages/`.

---

## The Core Problem: Content Is About to Explode

Right now the Library has 2 articles and the Dev sub-site has 3 + 1 tool link. That is the MVP baseline.

Over the next weeks/months, both will grow significantly:

**Library (expected):**
- 10–20 articles across 4–6 sections (How It Works, Technology, Security, Use Cases, Integrations, Reference)
- Longer articles — 1,000–3,000 words each, with headings, code blocks, diagrams
- Articles that reference each other

**Dev (expected):**
- 8–15 articles (operating model, Email-FS spec, vault architecture, agent onboarding guides)
- Tool pages linked from the nav (Vault Peek, and future tools)
- Richer articles with ASCII diagrams, code samples, multi-step walkthroughs

The current layout — narrow static sidebar, no in-article navigation, no search, minimal sub-site identity — will not scale. We need to design for depth.

---

## What Is Working (Keep)

- The three-layer stack: `sg-site-header` → sub-site bar → content. This is right. Do not change the layer logic.
- Dark colour palette — stay on-brand with the rest of sgraph.ai.
- Section labels in ALL CAPS with article list beneath — good hierarchy signal.
- SPA routing with path-based URLs — keep this; just improve the visual affordance.
- The "Library" / "Dev" identity in the sub-site bar — correct; needs more visual weight.

---

## What Needs Redesigning

### 1. Sidebar — needs to scale

Currently: 220px wide, no scroll, no grouping affordance, no active state that stands out enough.

Needs:
- Handle 15–20 articles without feeling cluttered
- Clear visual hierarchy: section heading → article list
- Active article is immediately obvious (current accent-tinted background is subtle)
- Collapsible sections for when there are many (optional — only if it doesn't add complexity)
- Sticky within the viewport even on long articles
- Mobile: the sidebar collapses — needs a clear trigger (hamburger or drawer) and does not compete with the article

### 2. In-article navigation — currently absent

For longer articles (1,000+ words with multiple headings), readers need a way to navigate within the article. Consider:
- A right-hand "on this page" table of contents (auto-generated from h2/h3 headings)
- Or: sticky article title + scroll-linked highlight in sidebar
- Back-to-top affordance

### 3. Sub-site bar — needs identity and utility

Currently it shows "LIBRARY" or "DEV" in small caps and a single cross-link. It is functional but sparse.

Needs:
- Stronger sub-site identity (this is where the reader knows which world they are in)
- Potentially: search bar for the sub-site's articles (especially for Library)
- The cross-link (Library ↔ Dev) should feel like a tab or toggle, not just a text link in the corner

### 4. Article reading experience

Currently the article renders as plain markdown in the content area with no constraints. As articles get longer:
- Max comfortable reading width (60–75ch) — the current full-width column is too wide on large screens
- Better typography scaling for long-form: generous line height, slightly larger body text
- Code blocks — distinct background, monospace, optional copy button
- Internal cross-references between articles (e.g. "see also: Vault Architecture")

### 5. Next / Previous article navigation

No way to move sequentially through articles. For a knowledge base this is table stakes — add next/previous article links at the bottom of each article.

---

## Design Constraints

- **No full page reloads** — this is a SPA. Navigation between articles must feel instant.
- **Two audiences**: Library is public/external (polished, calm, authoritative). Dev is internal/technical (denser, can be more utilitarian). The designs can share a shell but the tone can differ slightly.
- **Vault-rendered content** — the article body is decrypted markdown rendered in the browser. The shell cannot know the article's heading structure until after render. Any "on this page" TOC must be built by parsing the rendered DOM, not the source.
- **Mobile must work** — sidebar collapses, article is full width, sub-site bar stays.
- **Dark theme only** — no light mode at this stage.
- **Component-based** — the design will be implemented as web components (`sg-side-nav`, `sg-sub-nav`) developed in this repo before being moved to the tools repo. Avoid designs that require bespoke per-page layouts.

---

## Specific Questions for the Design to Answer

1. Where does search live — in the sub-site bar, the sidebar, or a separate overlay?
2. Does the sidebar collapse on desktop at small viewport widths, or stay pinned?
3. Right-hand TOC panel — is it worth the column complexity, or is a sticky in-article anchor list sufficient?
4. How do we visually distinguish Library (public, product) from Dev (internal, technical) while keeping the same shell?
5. What does the empty state look like on first load before any article is selected?
6. How do breadcrumbs or "you are here" signals work when a user lands directly on a deep URL?

---

## Technical Notes for Context

- Sub-site bar: `<sg-sub-nav site-title="Library" links='[...]'>` — sticky, `height: 2.75rem`, sits at `top: 3.75rem` (below site header).
- Sidebar: `<sg-side-nav auto-select>` — fires `nav:select` custom event on article click; page JS loads the article and pushes URL.
- Content area: `<sg-vault-content>` renders decrypted markdown via `sg-content-markdown`.
- CSS grid: `220px sidebar | 1fr content`, currently no right column.
- Style tokens available: `--accent` (teal `#4ECDC4`), `--bg-primary` (navy), `--bg-secondary` (deep blue), `--border-color` (slate), `--text-primary`, `--text-secondary`.
