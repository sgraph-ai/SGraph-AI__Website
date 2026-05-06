# Content Viewer System

## Problem

The existing `sg-vault-content` component (from tools.sgraph.ai) provides basic vault fetch + markdown render,
but it has two gaps that matter for our content:

1. **YAML frontmatter** — markdown files include `---` delimited metadata blocks.
   `sg-vault-content` passes the raw frontmatter text through to the markdown renderer,
   so it appears as ugly dashes and key-value pairs at the top of the article.

2. **`vault:` image URIs** — images in vault markdown use `![alt](vault:obj-cas-imm-...)` syntax.
   `sg-vault-content` renders these as broken `<img>` tags because `vault:` is not a real URL scheme.

## Solution: `sg-article-viewer`

We replace `sg-vault-content` with our own `sg-article-viewer` custom element that owns the
full content pipeline end-to-end.

### Pipeline

```
vault fetch + decrypt
        │
        ▼
parseFrontmatter()
  ├─ meta  →  renderMetaStrip()
  └─ body  →  renderMarkdown() via marked@9
                    │
                    ▼
             resolveVaultImages()
             (async: vault fetch → blob URL)
```

### Frontmatter

Standard YAML-lite block at the top of a markdown file:

```markdown
---
title: My Article
author: Alice
date: 2026-04-30
status: draft
tags: [design, vault, architecture]
viewer: article
---

# Article body starts here
```

`parseFrontmatter()` reads lines between the opening and closing `---` delimiters.
Values that look like `[a, b, c]` are parsed into string arrays.
All other values are treated as plain strings.

The `viewer` key selects the rendering mode (see Viewer Types below).
The remaining meta keys are displayed as a strip below the article title.

### Viewer Types

| `viewer:` value | Behaviour |
|---|---|
| `article` (default) | Meta strip + markdown body with vault: image support |
| _(future)_ `gallery` | Grid of vault: images from frontmatter |
| _(future)_ `json-dashboard` | Parsed JSON body rendered as structured data view |

The viewer key is read from frontmatter and is extensible. Adding a new viewer type
requires only a new `_render<Type>()` method inside the component.

### `vault:` Image URIs

In markdown:

```markdown
![Screenshot of dashboard](vault:obj-cas-imm-4a3b2c1d9e8f)
```

The custom marked renderer converts this to:

```html
<img data-vault-obj="obj-cas-imm-4a3b2c1d9e8f" alt="Screenshot of dashboard" class="article-img article-img--loading">
```

After the synchronous markdown pass, `resolveVaultImages()` runs asynchronously.
For each `[data-vault-obj]` element:
1. Fetch + decrypt the vault object bytes
2. Sniff the first 4 bytes to determine MIME type (PNG/JPEG/GIF/WebP)
3. Create an object URL via `URL.createObjectURL()`
4. Set `img.src`, swap `--loading` class for `--loaded`
5. On error, swap for `--error` and set an accessible `alt` update

The blob URLs are revoked when the component is removed from the DOM (`disconnectedCallback`).

### Meta Strip

Fields rendered as the strip:

| Key | Display |
|---|---|
| `author` | Author name (plain text) |
| `date` | Formatted date |
| `status` | Badge with colour: `draft`=amber, `published`=green, `archived`=grey |
| `tags` | Pill list |

Other frontmatter keys are silently ignored for now.

### Events

`sg-article-viewer` fires `viewer:rendered` on `document` when the synchronous render
is complete (vault images may still be loading asynchronously):

```javascript
document.addEventListener('viewer:rendered', e => {
  console.log(e.detail.meta); // parsed frontmatter object
});
```

## Component Location

```
_common/js/components/sg-article-viewer/
  v0/v0.1/v0.1.0/
    sg-article-viewer.js
```

Loaded as a `<script type="module">` in each sub-site `index.html`.

## Usage

In `showArticle()` (both `library/index.html` and `dev/index.html`):

```javascript
const el = document.createElement('sg-article-viewer');
el.setAttribute('vault-id',  VAULT_ID);
el.setAttribute('read-key',  READ_KEY);
el.setAttribute('object-id', objectId);
renderEl.appendChild(el);
```

The `render` attribute from the nav JSON is no longer passed — viewer selection is
now driven entirely by the `viewer:` frontmatter key inside the content itself.

## Dependencies

- `/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js` — vault fetch/decrypt (via importmap)
- `https://cdn.jsdelivr.net/npm/marked@9/+esm` — markdown renderer (CDN, ESM)

Both are already available in the sub-site importmap or loaded as module scripts.
