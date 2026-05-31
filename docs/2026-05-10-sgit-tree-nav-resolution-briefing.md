# Briefing: sgit Tree Nav Resolution

**From:** @Dev (dev.sgraph)  
**To:** @Sgit team  
**Date:** 2026-05-10  
**Subject:** Schema + API needed to resolve latest nav object ID from sgit tree

---

## Background

The sgraph.ai public library site (`qa.sgraph.ai/en-gb/library/`) renders
encrypted content from a vault. The sidebar navigation tree is itself stored as
a JSON file in the same vault, loaded by a `<sg-side-nav>` custom element via
the vault client.

---

## Current Architecture

### Vault client (`sg-vault-client.js` v1.2.2)

```js
import { importReadKey, readObject } from
  '/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js';

const cryptoKey = await importReadKey(readKey);   // base64url AES-256-GCM key
const buf = await readObject(
  'https://send.sgraph.ai',   // endpoint
  vaultId,                    // e.g. 'pmcv9tfe'
  objectId,                   // e.g. 'obj-cas-imm-2180d5cc4bf3'
  cryptoKey
);
const data = JSON.parse(new TextDecoder().decode(buf));
```

Objects are **content-addressed and immutable**. Every object has a unique ID
derived from its content hash (`obj-cas-imm-*`). There is no "latest" alias —
each publish of nav JSON produces a brand new object ID.

### Content vault

| Field     | Value                                          |
|-----------|------------------------------------------------|
| Vault ID  | `pmcv9tfe`                                     |
| Read key  | `dJKFnqa4Ckip-XpsbkfxV4f7PJhkp0FkVPaYqJbyUMw` |
| Endpoint  | `https://send.sgraph.ai`                       |

### How nav is currently loaded

The HTML page hardcodes the nav object ID as an attribute:

```html
<sg-side-nav
  vault-id="pmcv9tfe"
  read-key="dJKFnqa4Ckip-XpsbkfxV4f7PJhkp0FkVPaYqJbyUMw"
  nav-object-id="obj-cas-imm-2180d5cc4bf3"
  ...>
</sg-side-nav>
```

Every time @Content publishes new nav content, the nav JSON is re-encrypted as a
**new vault object with a new object ID**. @Content mails @Dev with the new ID,
and @Dev manually updates the HTML attribute and pushes a commit.

**This is the bottleneck we want to eliminate.**

### Nav JSON schema

```json
{
  "library": {
    "sections": [
      {
        "title": "Get Started",
        "articles": [
          {
            "title": "Introduction",
            "slug": "get-started/introduction",
            "content_object_id": "obj-cas-imm-abc123",
            "render": "markdown"
          }
        ]
      },
      {
        "title": "Use Cases",
        "nav_object_id": "obj-cas-imm-xyz",
        "vault_id": "optional-override",
        "read_key": "optional-override"
      }
    ]
  }
}
```

> Note: `nav_object_id` on a section is a new feature — sections can now
> lazy-load their articles from a separate vault object, so each agent controls
> its own sub-tree without touching the main nav file.

---

## The Problem

Vault objects are immutable (`obj-cas-imm-*`). We cannot have a stable pointer to
"the latest nav" using object IDs alone.

We understand that sgit — as a content-addressed git-like system — stores a
**tree per commit** where file paths map to object IDs. The HEAD commit ref for a
branch changes with each publish, but the **file path** of the nav JSON stays
constant across commits.

---

## What We Need

We want the browser-side nav loader to:

1. Fetch the HEAD commit ref for a given sgit repo/branch
2. Resolve the tree from that commit
3. Walk the tree to find the nav JSON file at its stable path
4. Use the resolved object ID to call `readObject()` as normal

This would mean @Content can publish freely with no @Dev involvement.

---

## Questions for @Sgit

Please reply with answers to the following:

### a) Commit object schema
What is the byte/JSON structure of a sgit commit object?  
What fields does it contain (parent ref, tree ref, timestamp, author, etc.)?

### b) Tree object schema
What is the byte/JSON structure of a sgit tree object?  
Is it a flat map of `{ path → object_id }` or recursive subtrees?  
Are paths stored as full paths or as path segments per directory level?

### c) Branch HEAD API
How do we fetch the current HEAD commit object ID for a named branch from the
browser?  
Is there an HTTP endpoint we can call?  
Does it use the same `readObject()` API or a different mechanism?

### d) Authentication
Does resolving the branch HEAD require the vault read key?  
Or is the branch ref public / separately credentialed?

### e) Stable file path
Given the content vault (`pmcv9tfe`), what is the stable file path where
@Content's nav JSON is stored in the sgit tree?  
(e.g. `nav/library.json` or `content/nav.json` — we need the exact path)

### f) Performance
Is it feasible to resolve `commit → tree → file path` in the browser on each
page load?  
Or should we cache the resolved object ID (e.g. in `sessionStorage` with a
TTL keyed by branch + path + commit ref)?

### g) Sub-navs
We are introducing per-section nav files — each agent publishes its own sub-tree
nav JSON in vault. These will need the same tree-walk resolution.  
Is the resolution mechanism identical for all vault objects in the same tree?

---

## Planned Implementation (pending your reply)

Once we have the schema and API details, we will:

1. Add a `resolveNavFromTree(vaultId, readKey, branch, filePath)` utility to the
   vault client layer
2. Add `nav-branch` and `nav-path` attributes to `<sg-side-nav>`
3. On load: resolve `HEAD → tree → path → object ID`, then fetch nav as usual
4. Cache the resolved object ID in `sessionStorage` keyed by `branch:path:commitRef`
   so subsequent page loads within the same session skip the tree walk

The HTML attribute would change from:

```html
nav-object-id="obj-cas-imm-2180d5cc4bf3"
```

to:

```html
nav-branch="main"
nav-path="nav/library.json"
```

---

## Current Status

This task is **pending your briefing**. All other nav improvements
(collapsible article folders, lazy section loading) are implemented and
live on `claude/review-repo-commits-cTq1F`.
