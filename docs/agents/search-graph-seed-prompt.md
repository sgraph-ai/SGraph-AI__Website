# Task: Build the Fractal Search Graph

**To:** @content (Content Agent)
**From:** Engineering
**Priority:** Medium
**Vault:** pmcv9tfe (library vault)

---

## What you are building

The library now has a working fractal search engine (`sg-search` component). The search engine loads a **graph of JSON files** lazily — it only downloads the nodes whose keywords match the user's query. Each node has the same shape and can point to child nodes, creating a self-similar (fractal) structure that agents can update independently without touching the whole index.

Your job is to **populate this graph with real data** by reading every article in the library vault, extracting its content, and writing high-quality search nodes.

---

## Node schema (must be exact)

Every node file is a plain JSON object:

```json
{
  "v": 1,
  "id": "unique-string-id",
  "label": "Human-readable name",
  "keys": [
    "keyword or phrase that leads to this node",
    "another phrase users might type"
  ],
  "children": [
    {
      "label": "Child node label",
      "keys": ["words that route to this child", "more phrases"],
      "ref": "/en-gb/library/search/nodes/child-filename.json"
    }
  ],
  "articles": [
    {
      "slug": "section/subsection/article-name",
      "title": "Article Title",
      "keys": [
        "specific term", "concept", "what a user searching for this article might type"
      ],
      "snippet": "One or two sentences that describe this article clearly. Used as the search result preview.",
      "vault_id": "vault-id-here-if-different-from-library-vault",
      "object_id": "obj-cas-imm-...",
      "read_key": "base64url-read-key-if-needed",
      "render": "markdown"
    }
  ]
}
```

**Rules:**
- `keys` at every level should be terms a user would actually type into a search box (not internal IDs, not exact title duplicates — think synonyms, concepts, questions)
- `snippet` must be 1–3 sentences, written in plain English, describing what the article covers
- `slug` must match exactly what the library nav uses (the path after `/en-gb/library/`)
- Include `vault_id`, `object_id`, `read_key`, `render` only when the article is in a non-default vault (i.e. not `pmcv9tfe`). For blog/whats-new articles in vault `d3o9s0ff`, include all four fields
- `ref` values must be absolute paths: `/en-gb/library/search/nodes/filename.json`
- Do NOT invent articles. Only include articles that actually exist in the nav

---

## Files to create or update

The stub files already exist at:
```
sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/library/search/
  root.json
  nodes/
    getting-started.json
    teams.json
    content-team.json
    dev-team.json
    technology.json
    vault.json
    rendering.json
    updates.json
```

**Your task:**

1. Read the full nav tree from the library vault (`pmcv9tfe`, path `library/_nav.json`) to get the complete list of articles, slugs, vault IDs, object IDs, and read keys.

2. For each article in the nav tree: fetch and decrypt its content, read the frontmatter (`title`, `description`, `tags`, `keywords`), read the first 2–3 paragraphs.

3. Build or update the node files:
   - Map articles to the right node based on their section/path
   - Write `keys` arrays with 8–15 varied search terms per article (more = better recall)
   - Write `snippet` summaries (do NOT copy-paste frontmatter description verbatim — synthesise from the actual content)
   - Add new node files for new sections that don't have a node yet
   - Update `root.json` if new top-level sections are needed
   - Update parent nodes' `children` arrays to point to any new nodes you create

4. Keep the graph shallow (max 3–4 levels: root → section → subsection → articles). Avoid creating nodes with fewer than 2 articles — flatten those into their parent.

5. After writing all nodes, validate that every `ref` in every node file points to a file that exists.

---

## Quality bar for `keys`

Good keys think like a user, not a developer:

| Instead of... | Use... |
|---|---|
| `"sg-article-viewer"` (internal name) | `"article viewer"`, `"how articles load"`, `"content component"` |
| `"AES-GCM"` (jargon) | `"encryption"`, `"how content is encrypted"`, `"aes"`, `"decrypt"` |
| `"journalist"` (exact title) | `"writing articles"`, `"publish content"`, `"content author role"`, `"how to write an article"` |

Include both the jargon AND the plain English version. Users vary.

---

## Do NOT do

- Do not put write keys, admin tokens, or any credentials in the JSON files
- Do not add article slugs that don't exist in the nav tree
- Do not create nodes deeper than 4 levels
- Do not make `keys` arrays shorter than 6 items
- Do not copy `title` as the only key — it is already searched via the `title` field in the article object

---

## When you are done

Commit the updated node files with message:
```
feat(search): populate fractal search graph from nav tree
```

Then notify the engineering team that the search graph is ready for QA.
