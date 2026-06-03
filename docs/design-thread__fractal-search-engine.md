# Fractal Search Engine — Design

**Date:** 2026-06-01
**Status:** Design / pre-implementation

---

## Problem

The library contains encrypted vault content across a growing nav tree. Users need a way to find topics and specific articles without a backend search service, while keeping all content encrypted at rest.

---

## Core Constraints

- All content encrypted at rest (AES-GCM in vault)
- No backend — static host only
- Index files created and maintained by agents (daily agentic cron jobs)
- Must work with the existing `read_key` auth model (same key as library content)
- Index data must itself be encrypted (it contains summaries and tags derived from private content)

---

## Index Format: JSON

JSON is the right choice over TOML/YAML:

- Native in JS — no parser bundle needed
- LLMs generate it reliably without syntax errors (TOML/YAML trailing-comma and indentation bugs are real)
- Diff-friendly when agents do incremental updates
- Schema-validatable

---

## Architecture: Three Encrypted Vault Objects

```
vault/
  search/
    search-index.json      ← main search corpus (lazy-loaded on first search)
    search-topics.json     ← topic taxonomy / facets (loaded with nav)
    search-graph.json      ← concept → article edges (optional, day-2)
```

All three encrypted with the same read key as the library. Agents write them; JS reads them.

---

## `search-index.json` — The Corpus

```json
{
  "v": 1,
  "built_at": "2026-06-01T16:00:00Z",
  "entries": [
    {
      "slug": "sg-teams/content-team/roles/journalist",
      "title": "Journalist",
      "section": "SG Teams",
      "breadcrumb": ["SG Teams", "Content Team", "Roles", "Journalist"],
      "summary": "The journalist role is responsible for…",
      "tags": ["roles", "content", "writing", "publishing"],
      "keywords": ["vault", "article", "cms", "frontmatter"],
      "updated_at": "2026-05-28T10:00:00Z"
    }
  ]
}
```

### Fields and ownership

| Field | Source |
|---|---|
| `slug`, `title`, `section`, `breadcrumb` | Mechanical — extracted from nav tree |
| `summary` | Agent-written — 1–2 sentences synthesised from article body |
| `tags` | Agent-written — semantic labels (topic, role, tool, concept…) |
| `keywords` | Mechanical — all H2/H3 headings + frontmatter `keywords:` field |
| `updated_at` | From article frontmatter or vault object metadata |

The split is important: mechanical fields are always correct and cheap to regenerate. Agent-written fields carry semantic quality but are expensive — the agent pipeline only regenerates them when `updated_at` changes.

---

## `search-topics.json` — Faceted Taxonomy

```json
{
  "v": 1,
  "topics": [
    {
      "id": "getting-started",
      "label": "Getting Started",
      "icon": "⬡",
      "slugs": ["get-started/overview", "get-started/claude-setup"]
    },
    {
      "id": "roles",
      "label": "Team Roles",
      "icon": "👤",
      "slugs": [
        "sg-teams/content-team/roles/journalist",
        "sg-teams/content-team/roles/editor"
      ]
    }
  ]
}
```

This file loads alongside the nav data (it's small — just IDs and slug lists). It gives the search UI topic-chip filters without loading the full corpus, so the first interaction is instant.

Topics can be agent-generated (by clustering `tags` from the index) or manually curated — both work. The slugs list is always rebuilt mechanically from the index.

---

## `search-graph.json` — Concept Edges (Day-2)

```json
{
  "v": 1,
  "nodes": {
    "vault-client": { "label": "Vault Client", "type": "concept" },
    "aes-gcm":      { "label": "AES-GCM",      "type": "concept" }
  },
  "edges": [
    { "from": "vault-client", "to": "get-started/claude-setup",       "weight": 0.9 },
    { "from": "vault-client", "to": "library/architecture/overview",  "weight": 0.6 },
    { "from": "aes-gcm",      "to": "library/architecture/overview",  "weight": 0.8 }
  ]
}
```

Agents build this by reading articles and noting which concepts link to which pages. Powers:
- "Related articles" panels
- Concept-based search (search for "encryption" finds all AES-GCM-tagged pages)
- Future: knowledge graph visualisation

This is a pure day-2 feature; it does not block the search UI.

---

## Client-Side Search Flow

```
user opens search
  └─ search-topics.json already in memory (loaded with nav)
     shows topic chips immediately — zero latency

user types first character
  └─ fetch + decrypt search-index.json  (one vault round-trip, ~50–100 KB)
     initialise Fuse.js with entries
     subsequent keystrokes: local only, no network

user selects result
  └─ document.dispatchEvent(new CustomEvent('nav:select', { detail: { slug } }))
     same SPA navigation as clicking the sidebar
```

[Fuse.js](https://www.fusejs.io/) handles fuzzy matching — `fetch` finds "fetching", typo tolerance, weighted field search (title > tags > summary > keywords). It is 24 KB, loads from CDN alongside `marked`, no extra install.

---

## Agent Pipeline

Runs as a daily scheduled job (Claude agent or script with Claude API calls):

```
1. read nav-tree from vault  →  get all current slugs + updated_at values
2. read existing search-index.json from vault
3. for each slug in nav-tree:
     a. if updated_at unchanged AND slug exists in index  →  skip (no LLM call)
     b. else:
          fetch + decrypt article from vault
          extract headings (H1–H3) and frontmatter keywords mechanically
          call LLM: write 1–2 sentence summary, assign semantic tags
          upsert entry in index
4. remove entries whose slugs no longer exist in nav-tree
5. sort entries by slug  (stable diff across runs)
6. encrypt + write updated search-index.json to vault
7. rebuild search-topics.json by grouping slugs by their tags
8. encrypt + write search-topics.json to vault
```

Step 3b is the only LLM call per changed article — it's cheap (short context, one article at a time). The incremental diff in step 3a means most runs touch only a handful of articles.

The agent needs write access to the vault. The write key stays in the team vault and is never placed in the website repo or any published content.

---

## `sg-search` Web Component — Sketch

```html
<sg-search vault-id="pmcv9tfe" read-key="dJKFnqa4…" index-object="obj-search-index-xxx"></sg-search>
```

Attributes mirror `sg-article-viewer` — vault ID, read key, object ID for the index. The component:

1. On `connectedCallback`: fetches and decrypts `search-topics.json` (or receives it from the page if already loaded)
2. Renders a search input with topic chip filters
3. On first keypress: fetches and decrypts `search-index.json`, initialises Fuse.js
4. Renders dropdown of results with title, section breadcrumb, and matched summary snippet
5. On result click: dispatches `nav:select`

The search input and dropdown live in a lightweight overlay — no modal, no route change.

---

## Phased Delivery

### Phase 1 — Index + basic search UI
- Agent pipeline script that builds `search-index.json`
- `sg-search` component: input → Fuse.js → dropdown → `nav:select`
- Add search bar to library page header

### Phase 2 — Topic facets
- `search-topics.json` loaded with nav data
- Topic chip filters above results
- Agent pipeline extended to also write `search-topics.json`

### Phase 3 — Concept graph
- `search-graph.json` built by agent
- "Related articles" panel inside `sg-article-viewer`
- Concept-node search in `sg-search`

---

## Recommended Starting Point

The highest-value first step is the **agent pipeline** — once `search-index.json` exists in the vault with real data, the client UI becomes straightforward to build and test against real content. The UI is a day's work; the data quality is where the value lives.

Pipeline first, then UI.
