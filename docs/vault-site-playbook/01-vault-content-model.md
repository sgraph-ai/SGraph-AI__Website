# 01 — The Vault Content Model

**Part of:** Vault-Backed Site Publishing documentation set
**Prereq:** [`00-overview.md`](./00-overview.md)

How content is stored, addressed, structured, and keyed. This is the foundation
every other layer reads from.

---

## 1. What an sgit vault is

An **sgit vault** is an encrypted, content-addressed version-control store,
served over HTTPS by `https://send.sgraph.ai`. Conceptually it is "git, but every
object is AES-256-GCM encrypted and addressed by a content hash."

- **Vault ID** — a short identifier, e.g. `pmcv9tfe` (the Library content vault).
- **Read key** — a 32-byte AES key, base64url-encoded (43 chars, may contain `-`
  and `_`). Decrypts every object in the vault. May be public (see §6).
- **Write key / passphrase** — a separate secret in `passphrase:vault_id` form
  that authorizes pushes. **Never published. Never in this repo or any doc.**
- **Object** — an encrypted blob, addressed by hash: `obj-cas-imm-<hex>`.
  Immutable: any change produces a new object ID.
- **Ref / commit / tree** — like git, a ref points at a commit, which points at a
  root tree, which contains entries (named, encrypted) pointing at sub-trees or
  blobs.

### The two ways to address content

| Method | Looks like | Property | When to use |
|---|---|---|---|
| **Pinned object ID** | `obj-cas-imm-0def4605d6d4` | Immutable — always the exact same bytes | When you want a fixed snapshot; nav nodes that should never drift |
| **Content path** | `library/_nav.json` | Resolved to the *current* blob at read time by walking the tree | When you want "whatever is latest at this path"; the nav file itself |

Both are first-class in the renderers. The path → blob resolution is done by
`resolvePath()` (ref → commit → tree-walk → blob_id) and exists in both the
browser vault-client and the edge orchestrator.

---

## 2. The client interface (`sg-vault-client`)

Both layers use the same two primitives (the browser imports them from the
versioned vault-client module; the edge orchestrator reimplements them):

```js
import { importReadKey, readObject } from
  '/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js';

const key = await importReadKey(readKeyBase64url);     // → CryptoKey
const buf = await readObject('https://send.sgraph.ai', // server
                             vaultId, objectId, key);  // → ArrayBuffer (decrypted)
const text = new TextDecoder().decode(buf);
```

> **Key format gotcha:** always use the **base64url** read key (43 chars). The
> hex form (64 chars, `0-9a-f`) makes `importReadKey()` fail *silently*. This has
> bitten more than one agent.

For path resolution, the tree-walk (from `sg-edge-render.mjs:55`) is:

```
refId   = ref-pid-muw-<hmac12(key, "sg-vault-v1:file-id:ref:<vaultId>")>
ref     = readJson(refId)          → { commit_id }
commit  = readJson(ref.commit_id)  → { tree_id }
walk the tree by path segments, decrypting each entry name, until the last
segment → that entry's blob_id
```

You rarely call this yourself — the components and the orchestrator do — but it
explains why a `content_path` can be served without pinning an object ID.

---

## 3. The nav tree — `_nav.json`

Every vault-backed sub-site has a **navigation tree**, a JSON object stored in the
vault (conventionally at `<site>/_nav.json`, e.g. `library/_nav.json`). It is the
single source of truth for the site's structure. Both the browser nav component
and the edge orchestrator read it.

### Top-level shape

```json
{
  "library": {                         // wrapper key: "library" | "invest" | absent
    "home": {                          // OPTIONAL — curated root article
      "content_object_id": "obj-cas-imm-…",
      "render": "markdown"
    },
    "sections": [
      {
        "title": "Get Started",
        "description": "Your first vault operations.",
        "index": "claude-setup",       // OPTIONAL — slug of a child to show as the section landing
        "children": [ <article>, … ]   // also accepted: "articles"
      }
    ]
  }
}
```

The renderers tolerate three top-level forms: `{ library: { sections } }`,
`{ invest: { sections } }`, or a bare `{ sections }`. (See
`findArticle()` / `renderLlmsTxt()` — they unwrap `nav.library ?? nav.invest ??
nav`.) For a **new** site, prefer the bare `{ sections }` form unless you have a
reason to namespace.

### Article node

```json
{
  "title": "Set up Claude",
  "slug": "claude-setup",              // URL segment; compound for nested (parent/child)
  "content_object_id": "obj-cas-imm-…",// OR use content_path (one of the two)
  "content_path": "library/get-started/claude-setup.md",
  "render": "markdown",                // "markdown" | "json"
  "schema": "project-workstreams-v2",  // only when render=json (see §5)
  "vault_id": "pmcv9tfe",              // OPTIONAL per-article override
  "read_key": "<base64url>",           // OPTIONAL per-article override
  "description": "One-line summary.",
  "summary": "Shown in llms.txt after the link.",
  "children": [ <article>, … ]         // OPTIONAL — nested pages (arbitrary depth in SPA)
}
```

Notes:
- Provide **either** `content_object_id` (pinned) **or** `content_path`
  (resolved). The renderers try the object ID first, then fall back to the path.
- `vault_id` + `read_key` on an article let a single nav stitch content from
  **multiple vaults** (the Library nav does this for blog posts sourced from a
  separate vault). Omit to inherit the page-level vault.
- `slug` drives the URL: `/en-gb/<site>/<slug>/`. Nested children use a compound
  slug `parent/child` (the SPA flattens this; see doc 02).

---

## 4. Markdown content + typed fenced blocks

Article bodies are **Markdown**, rendered by `marked` in the browser. On top of
standard Markdown, the renderer supports **typed fenced YAML blocks** — a fenced
code block whose info-string is a known type, whose body is YAML, expanded into
rich HTML before parsing:

````
```feature-cards
cards:
  - title: Get Started
    description: Your first vault operations.
    link: /en-gb/library/get-started/
```
````

The full set (comparison, feature-cards, key-points, checklist, timeline,
skill-cards, component-gallery, component-table, proposal-card, code-comparison,
mermaid, …) plus inline tokens (`vault:` images, `vault-pdf:` embeds,
`{{screenshot: …}}` placeholders) are documented in the live authoring guide at
`/en-gb/library/guides/content-authoring-blocks`. `mermaid` lazy-loads
mermaid@11 from CDN and supports diagrams (incl. Wardley maps). Authors do not
touch code to use these — they are part of the content contract.

---

## 5. Structured JSON content — board schemas

Beyond Markdown, an article can be **structured JSON** (`render: "json"`) rendered
into a view chosen by its `schema`. This powers the Dev sub-site's live
workstream/issue/agent/release boards. The five schemas and their renderers are
documented in full in
[`../dev-board-implementation-spec.md`](../dev-board-implementation-spec.md):

| Schema | View |
|---|---|
| `project-workstreams-v2` | 4-column kanban + click-to-drill-down |
| `project-issues-v1` | flat issue card list |
| `project-agents-v2` | agent roster cards |
| `project-releases-v1` | release-log version groups |
| (unknown / omitted) | generic card list from the first array key |

A JSON board can be stored **in the vault** (pinned object ID) **or as a static
repo file** (set `content_object_id` to a root-relative `/path.json` — the shell
detects the leading `/` and uses a plain fetch, no decryption). Use the vault for
agent-authored data; use a static file for repo-tracked project data.

---

## 6. The public-read-key model & the vault registry

Public vaults are catalogued in
[`core/public-vaults.json`](../../sgraph_ai_website/v0/v0.2/v0.2.0/core/public-vaults.json)
(`schema: sg-public-vaults/v1`). This registry drives the auto-generated "Open
Vaults" directory and documents, per vault, the **published read key**, owner,
and purpose. The current entries:

| Vault ID | Read key (public, base64url) | Label | Owner | Served at |
|---|---|---|---|---|
| `pmcv9tfe` | `<library-public-read-key>` | Library Content | @Content | `/en-gb/library/` |
| `1lfehfjh` | `<project-status-public-read-key>` | Project Status | @Content | `/en-gb/dev/workstreams/` |
| `bf31a13c78c9` | `<dev-docs-public-read-key>` | Dev Docs | @Dev | `/en-gb/dev/` |
| `ub9jj0gq` | `<invest-public-read-key>` | Invest | @Invest | `/en-gb/invest/` |

These keys are **read-only and intentionally public** — they are already shipped
in the site's HTML. They are reproduced here because this doc set is itself
publishable. **The matching write keys are not in this repo and must never be.**

A vault may also carry an in-vault `_vault-meta.json` (owner-maintained) that the
directory enriches the registry with at view time.

### Rules to keep this safe at scale

1. Only list a vault here if its content is genuinely public.
2. Never put a write key / passphrase in the registry, the HTML, or a doc.
3. Rotating a published read key touches every place it is embedded (HTML
   attributes, JS consts, manifests, this registry) — see code review item CR-01h
   / the credentials note in doc 04. Plan for a single-source-per-site reference
   when you scale.

---

## 7. Authoring workflow (content side)

A content owner with a **write key** publishes like this (illustrative — the
write key lives only in their environment):

```bash
# Clone the content vault (write-capable: passphrase held privately)
sgit --base-url https://send.sgraph.ai clone <PASSPHRASE>:<VAULT_ID>
cd <VAULT_ID>

# Add or edit content
mkdir -p library/get-started
cp claude-setup.md library/get-started/claude-setup.md

# Update the nav tree to point at it (object id OR path)
$EDITOR library/_nav.json     # add an article node under the right section

# Commit + push — content is live on next page load, no CI
sgit commit "add claude-setup article"
sgit --base-url https://send.sgraph.ai --token "<PUSH_TOKEN>" push
```

The website never redeploys for this. That is the entire payoff of the model.

> Agents communicate and coordinate over a *separate* comms vault using the
> Email-FS protocol — that is an operational layer, not part of the rendering
> pipeline. See the team docs if you need to wire an agent into the workflow.
