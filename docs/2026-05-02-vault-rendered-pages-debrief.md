# Technical Debrief: Vault-Rendered Pages on sgraph.ai

**Date:** 2026-05-02  
**Author:** @Code (dev.claude-code-web.s-QCF1P19ZNZ)  
**Pages:** `/en-gb/library/`, `/en-gb/dev/`  
**Status:** Live on qa.sgraph.ai

---

## What Was Built

Two pages that render their content entirely from encrypted vault objects — no CMS, no
server-side templating, no content deployment pipeline. The server stores only opaque
ciphertext. The browser fetches it, decrypts it with a public read key, and renders it.

The `/library/` page goes further: its navigation structure itself lives in the vault.
Adding an article requires only a vault commit — no code change, no redeploy.

---

## Architecture

### The Static Shell

Each page is a minimal HTML file:

- A `<sg-site-header>` and `<sg-site-footer>` web component (static nav chrome)
- One or more `<sg-vault-content>` custom elements with `object-id` attributes
- An import map that resolves bare module paths to `dev.tools.sgraph.ai`
- A single `<script type="module">` block that sets vault credentials on all elements

The HTML file itself contains no readable content. It is a wiring harness.

### The Vault Client (`sg-vault-client`)

```
/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js
```

Two functions drive everything:

```js
const cryptoKey = await importReadKey(READ_KEY);      // base64url → CryptoKey (AES-256-GCM)
const buffer    = await readObject(API_BASE, VAULT_ID, OBJECT_ID, cryptoKey);
```

`readObject` constructs the fetch URL:

```
https://send.sgraph.ai/api/vault/read/{vault-id}/bare%2Fdata%2F{object-id}
```

It downloads the encrypted blob, decrypts it with AES-256-GCM using the imported key,
and returns the plaintext as an `ArrayBuffer`. Decryption runs entirely in
`crypto.subtle` — the server sees only ciphertext and cannot decrypt it even under
compulsion.

### The `sg-vault-content` Web Component

A higher-level wrapper over the vault client. Accepts `vault-id`, `read-key`,
`object-id`, and `render` attributes. Fetches and decrypts the blob, then delegates
to a render sub-component:

| `render` value | Sub-component | Output |
|---|---|---|
| `markdown` | `sg-content-markdown` | Parsed + styled HTML |
| `json` | `sg-content-json` | Formatted JSON (shadow DOM) |
| `image` | `sg-content-image` | `<img>` from decrypted bytes |

**Shadow DOM note:** `sg-content-json` renders into shadow DOM. Its `textContent` is
not accessible from the light DOM. Attempting to parse the nav JSON via
`MutationObserver` on `textContent` silently fails. The fix: call `readObject` directly
in the module script instead of going through `sg-vault-content`.

### The Library Nav — Vault-Driven Navigation

The `/library/` page has no hardcoded article links. On load, a module script fetches
`_nav.json` from the vault (object-id `obj-cas-imm-6f633eaebed4`):

```json
{
  "library": {
    "sections": [
      {
        "title": "How It Works",
        "articles": [
          { "title": "Vault-Rendered Web Pages",         "content_object_id": "obj-cas-imm-5988e16398a5" },
          { "title": "Agent Communication via Email-FS", "content_object_id": "obj-cas-imm-ab2f9bb5b313" }
        ]
      }
    ]
  }
}
```

The script parses this, builds the sidebar nav in the DOM, and auto-loads the first
article. Clicking a nav item creates a fresh `<sg-vault-content>` with the article's
`content_object_id` and appends it to `#lib-article`. No page navigation, no router.

**To add an article:** commit a new markdown file to the vault, add its object-id to
`_nav.json` in the vault, commit `_nav.json`. The page picks it up on next load.
Zero code changes. Zero redeployment.

---

## Performance

Measured on qa.sgraph.ai (Chromium DevTools, `/en-gb/library/`):

| Metric | Cold (no cache) | Warm (cached) |
|---|---|---|
| Requests | 37 | 37 |
| Transferred | 306 kB | **6.0 kB** |
| Resources | 287 kB | 287 kB |
| Finish | 655 ms | **262 ms** |
| DOMContentLoaded | 220 ms | **80 ms** |
| Load | 222 ms | **97 ms** |

**Why the warm load is so fast:**

The 287 kB of resources (JS modules, CSS, fonts, vault blobs) are all immutable and
aggressively cacheable:

- **Vault blobs** are content-addressed (`obj-cas-imm-{sha256-prefix}`). Their URLs
  never change for a given object. The browser caches them indefinitely.
- **Web component JS** at versioned paths (`/v0/v0.1/v0.1.0/...`) is also immutable.
- The page HTML itself is tiny — its only job is to declare object-ids and load the
  client-side engine.

On a warm load, only 6.0 kB crosses the wire (the HTML shell + any cache
revalidation headers). Everything else is served from the browser's disk cache.
The vault is not contacted at all for already-seen objects.

---

## Content Authoring Flow

No developer involvement is needed to publish or update content:

```
@Content writes markdown → commits to vault → object-id is stable forever
@Content updates _nav.json in vault → page discovers new article on next load
```

The read key (`s68J93Gx5pzmP4FGo682Ns3JQ0aKdtSVKCjQKtSS_GA`) is public — it is
embedded in the HTML. The vault uses it for encryption at rest, but "public" here
means "anyone with the HTML can decrypt." The content is not secret; the architecture
gives the server zero ability to tamper with it.

---

## Two-Agent Development Model

This page was built by two AI agents working asynchronously through vault-based
email (Email-FS protocol, dap47prw vault):

- **@Content** (conductor, claude.ai chat) — authored all markdown content, defined
  the nav JSON schema, committed objects to the content vault, and sent object-ids
  to @Code via Email-FS messages.
- **@Code** (this agent, Claude Code web) — built the HTML shells, wired in
  object-ids from @Content's messages, implemented the vault-driven nav scaffold,
  debugged shadow DOM and schema issues, ran Playwright verification, and pushed
  to qa.

No human relay between content decisions and code landing in a PR. Communication
happened through encrypted vault messages. The pages on qa.sgraph.ai are evidence
that the operating model works.

---

## Key Files

| File | Role |
|---|---|
| `sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/library/index.html` | Library page shell |
| `sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/dev/index.html` | Dev page shell |
| `tests/e2e/qa-vault-content.spec.js` | Playwright verification (9 tests) |

---

## Lessons and Gotchas

1. **`sg-content-json` uses shadow DOM** — do not try to read its `textContent` from
   the light DOM. Import `readObject` from `sg-vault-client` and decode directly.

2. **`readObject` `apiBaseUrl` is the domain root** — the function appends
   `/api/vault/read/...` itself. Pass `https://send.sgraph.ai`, not a deeper path.

3. **Nav JSON schema is nested** — `data.library.sections`, not `data.sections`.
   Code reads `(data.library ?? data).sections` for forward-compatibility.

4. **sgit pulls before every push** — messages placed in your mailroom by other
   agents during a push window re-appear after the push. Clear them and force-push
   to sync remote mailroom state.

5. **Vault blobs are immutable** — an `object-id` is a SHA-256 content hash prefix.
   You cannot update an object in place; you commit a new object and update the
   reference (nav JSON or HTML attribute) to point to the new id.
