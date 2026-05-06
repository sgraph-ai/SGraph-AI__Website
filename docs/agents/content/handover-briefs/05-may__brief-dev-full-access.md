# @Dev Session Brief — Full Access
## For a new Claude Code Web session with access to both vaults and the website repo

**Date:** 04 May 2026  
**Written by:** @Content (conductor.claude-ai.s-C9CW3ZSTXR)  
**Intended for:** Claude Code Web agent (@Dev role)

---

## Step 1 — Clone Everything

```bash
pip install sgit-ai --break-system-packages

# Primary collaboration vault (Email-FS, agent comms, role docs)
sgit clone {COLLAB_VAULT_KEY}
cd dap47prw && cat _claude/CLAUDE.md && cd ..

# Content vault (all website content — you have READ access only)
sgit clone {CONTENT_VAULT_KEY}
cd {content-vault-dir}

# Website repo (you have WRITE access)
git clone https://github.com/sgraph-ai/SGraph-AI__Website
cd SGraph-AI__Website && git checkout dev
```

Push token for all vaults: `{PUSH_TOKEN}`  
Always use: `sgit --base-url https://send.sgraph.ai`  
(`dev.send.sgraph.ai` and `send.sgraph.ai` are the same S3 bucket — use prod)

---

## Step 2 — Read Your Role Brief

```bash
cat dap47prw/docs/agents/dev.md
# Also in the repo:
cat SGraph-AI__Website/docs/agents/dev.md
```

---

## Step 3 — Check Your Inbox

```bash
cd dap47prw
sgit --base-url https://send.sgraph.ai pull
ls mail/mailroom/dev.claude-code-web.s-QCF1P19ZNZ/
# DELIVER any waiting mail → mv to mail/dev.claude-code-web.s-QCF1P19ZNZ/inbox/
cat mail/dev.claude-code-web.s-QCF1P19ZNZ/inbox/*.eml
```

---

## What You Are (@Dev)

You build and maintain the sgraph.ai website. You own the repo. You cannot push to the content vault — that is @Content's domain.

Your tools:
- `sgraph-ai/SGraph-AI__Website` — write access, branch off `dev`
- `dev.tools.sgraph.ai` — Web Components served here (CORS-open to sgraph.ai)
- `qa.sgraph.ai` — auto-deploys from dev branch
- Content vault `bf31a13c78c9` — READ KEY ONLY embedded in HTML
- Collab vault `dap47prw` — read+write for Email-FS comms

---

## Current State of the Site (v1.2.5)

**Live pages on qa.sgraph.ai:**
```
/en-gb/                    ← main site homepage
/en-gb/how-it-works/
/en-gb/vaults/
/en-gb/security/
/en-gb/pricing/
/en-gb/dev/                ← SPA sub-site (all slugs under /dev/ route here)
/en-gb/library/            ← SPA sub-site (all slugs under /library/ route here)
/en-gb/test/vault-embed/   ← test page, leave as-is
```

**Key components in `_common/js/components/`:**
- `sg-sub-nav` — top bar showing sub-site name + cross-link
- `sg-side-nav` — left sidebar, reads `_nav.json` from content vault
- `sg-site-header`, `sg-site-footer` — global header/footer

**SPA routing:** CloudFront Function rewrites slug URLs to `index.html`. Both `/en-gb/dev/` and `/en-gb/library/` are SPA shells. Deep links work. `DEV_REAL_PAGES` in the CloudFront Function must list any actual sub-pages (like `vault-peek/`).

**`<base>` tag:** both SPA shells have `<base href="/en-gb/dev/">` and `<base href="/en-gb/library/">` — this is critical for asset path resolution at slug URLs. Do not remove it.

---

## Content Vault Structure (READ ONLY for @Dev)

**Vault ID:** `bf31a13c78c9`  
**Read key:** `s68J93Gx5pzmP4FGo682Ns3JQ0aKdtSVKCjQKtSS_GA`

```
dev/
  _nav.json              obj-cas-imm-4cb7740ea1f2  ← dev site nav (v2.1)
  articles/
    design-preview.md    obj-cas-imm-56becf17cb75
library/
  _nav.json              obj-cas-imm-00ace0596531  ← library nav (v1.1)
  articles/
    vault-rendered-pages.md   obj-cas-imm-5988e16398a5
    agent-comms-email-fs.md   obj-cas-imm-ab2f9bb5b313
project/
  workstreams.json       obj-cas-imm-e306c120073b
  agents.json            obj-cas-imm-947e45c65098
  decisions.json         obj-cas-imm-f4682b2bbac0
pages/dev/
  two-agent-operating-model.md  obj-cas-imm-8a1b1a7a7eab
  vault-as-comms-channel.md     obj-cas-imm-8d2f4948842a
pages/library/
  issues-fs.md           obj-cas-imm-72c473faee5d
  sgit.md                obj-cas-imm-4f64b9b45690
  vault-embed-components.md  obj-cas-imm-7915f369814c
  web-crypto-api.md      obj-cas-imm-d1d8fb768542
```

**How @Dev reads vault content (NOT via sg-content-json for structured data):**
```js
import { importReadKey, readObject } from
  '/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js'
const key  = await importReadKey(READ_KEY)
const buf  = await readObject('https://send.sgraph.ai', VAULT_ID, OBJECT_ID, key)
const data = JSON.parse(new TextDecoder().decode(buf))
```
`sg-content-json` renders into shadow DOM — `textContent` is inaccessible. Always use `readObject` directly for structured data.

---

## Open Tasks (What Needs Building)

From `project/workstreams.json` in the content vault:

**WS-1 — Website (immediate):**
- `WS-1-T11` — vault-explainer page (`/en-gb/dev/vault-explainer/`) — brief in your inbox as `01KQNCERJ3`
- `WS-1-T12` — vault-peek page (`/en-gb/dev/vault-peek/`) — US-001
- `WS-1-T15` — open PRs for /dev/ and /library/ pages
- `WS-3-T5/6/7` — build UI renderers for Workstreams, Agents, Decisions pages (read JSON from vault, render as tables/kanban/cards)

**New pattern — `vault:` URI in markdown:**  
The design-preview article uses `vault:obj-cas-imm-...` image references.  
The markdown renderer needs to intercept this URI scheme and render via vault fetch+decrypt.

**`_section.json` schema** — needed for the new Library/Dev site design (folder home pages, section cards, empty states). Design agent produced the visual design — schema needs formalising before implementation.

---

## Key Technical Facts

**Import map** — copy verbatim into every new page head:
```html
<script type="importmap">
{
  "imports": {
    "/components/base/v1/v1.0/v1.0.0/sg-component.js":
        "https://dev.tools.sgraph.ai/components/base/v1/v1.0/v1.0.0/sg-component.js",
    "/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js":
        "https://dev.tools.sgraph.ai/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js",
    "/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js":
        "https://dev.tools.sgraph.ai/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js",
    "/components/vault-embed/sg-vault-key/v0/v0.1/v0.1.0/events.js":
        "https://dev.tools.sgraph.ai/components/vault-embed/sg-vault-key/v0/v0.1/v0.1.0/events.js",
    "/components/vault-embed/sg-vault-key/v0/v0.1/v0.1.0/sg-vault-key.js":
        "https://dev.tools.sgraph.ai/components/vault-embed/sg-vault-key/v0/v0.1/v0.1.0/sg-vault-key.js",
    "/components/vault-embed/sg-vault-fetch/v0/v0.1/v0.1.0/sg-vault-fetch.js":
        "https://dev.tools.sgraph.ai/components/vault-embed/sg-vault-fetch/v0/v0.1/v0.1.0/sg-vault-fetch.js",
    "/components/vault-embed/sg-vault-trace/v0/v0.1/v0.1.0/sg-vault-trace.js":
        "https://dev.tools.sgraph.ai/components/vault-embed/sg-vault-trace/v0/v0.1/v0.1.0/sg-vault-trace.js",
    "/components/content/sg-content-markdown/v0/v0.1/v0.1.0/sg-content-markdown.js":
        "https://dev.tools.sgraph.ai/components/content/sg-content-markdown/v0/v0.1/v0.1.0/sg-content-markdown.js",
    "/components/content/sg-content-image/v0/v0.1/v0.1.0/sg-content-image.js":
        "https://dev.tools.sgraph.ai/components/content/sg-content-image/v0/v0.1/v0.1.0/sg-content-image.js",
    "/components/content/sg-content-json/v0/v0.1/v0.1.0/sg-content-json.js":
        "https://dev.tools.sgraph.ai/components/content/sg-content-json/v0/v0.1/v0.1.0/sg-content-json.js"
  }
}
</script>
```

**Gotchas:**
- `sgit mv` does not exist — use OS `mv` then `sgit commit`
- sgit excludes hidden dirs — use `_issues/` not `.issues/`
- `readObject` base URL is `https://send.sgraph.ai` — no path suffix
- Library nav schema: `data.library.sections` (fallback: `data.sections`)
- Dev nav schema: `data.dev.sections`

---

## How to Communicate

Send mail via `dap47prw` (Email-FS). Read `dap47prw/docs/v0.6/email-fs-skill-v0.6.md`.

Your agent name: `dev.claude-code-web.{your-session-id}`  
@Content mailroom: `mail/mailroom/conductor.claude-ai.s-C9CW3ZSTXR/`  
@Dinis mailroom: `mail/mailroom/human.dinis/`

Commit format: `sgit commit "send: {ULID-short} to {recipient} — {subject}"`

---

## Session Start Checklist

```
1. sgit pull (both vaults)
2. ls mail/mailroom/dev.claude-code-web.{session-id}/   ← deliver waiting mail
3. ls mail/dev.claude-code-web.{session-id}/inbox/      ← read unread mail
4. cat project/workstreams.json                          ← check task state
5. git pull origin dev                                   ← sync website repo
6. Start work on highest-priority open task
```
