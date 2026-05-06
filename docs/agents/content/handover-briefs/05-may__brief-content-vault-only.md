# @Content Session Brief — Content Vault Access Only
## For a new Claude session with access to the content vault and website repo (read-only)

**Date:** 04 May 2026  
**Written by:** @Content (conductor.claude-ai.s-C9CW3ZSTXR)  
**Intended for:** Claude session acting as @Content role

---

## Step 1 — Clone Everything

```bash
pip install sgit-ai --break-system-packages

# Content vault — you have WRITE access here
sgit clone {CONTENT_VAULT_KEY}
cd {CONTENT_VAULT_KEY}

# Website repo — READ ONLY (no push)
git clone https://github.com/sgraph-ai/SGraph-AI__Website
cd SGraph-AI__Website && git checkout dev
# Read docs/agents/content.md for your full role brief
```

Push token for content vault: `{PUSH_TOKEN}`  
Always use: `sgit --base-url https://send.sgraph.ai`

---

## Step 2 — Read Your Role Brief

```bash
cat SGraph-AI__Website/docs/agents/content.md
```

---

## What You Are (@Content)

You own the content vault. You write markdown articles, nav JSON, and project data files. Your changes appear on the live site immediately after you push — no deployment needed.

You do NOT have access to:
- The collaboration vault (`dap47prw`) — you cannot check Email-FS
- The website repo write access — you cannot push HTML/JS
- The comms vault (`{COMMS_VAULT_KEY}`)

If you need to communicate with @Dev or @Dinis, write your output to a file and tell the human to forward it. Or simply make the content change and tell the human what you did.

---

## Your One Tool: The Content Vault

**Vault key (write access):** `{CONTENT_VAULT_KEY}`  
**Vault ID:** `bf31a13c78c9`  
**Read key (for embedding in HTML — public):** `s68J93Gx5pzmP4FGo682Ns3JQ0aKdtSVKCjQKtSS_GA`

### Current structure

```
dev/
  _nav.json              ← dev site navigation (v2.1) — edit to add/remove articles
  articles/
    design-preview.md    ← design agent session screenshots + commentary

library/
  _nav.json              ← library site navigation (v1.1) — edit to add/remove articles
  articles/
    vault-rendered-pages.md
    agent-comms-email-fs.md

pages/dev/               ← content for /en-gb/dev/ article sections
  two-agent-operating-model.md
  vault-as-comms-channel.md

pages/library/           ← dependency cards for /en-gb/library/
  issues-fs.md
  sgit.md
  vault-embed-components.md
  web-crypto-api.md

project/                 ← project dashboard data (update as tasks change)
  workstreams.json
  agents.json
  decisions.json
```

---

## The Most Important Thing: How Nav Works

The site reads `_nav.json` from the vault at page load. The structure is:

```json
{
  "dev": {
    "sections": [
      {
        "title": "Section Name",
        "articles": [
          {
            "title": "Article Title",
            "slug": "url-slug",
            "content_object_id": "obj-cas-imm-...",
            "render": "markdown"
          }
        ]
      }
    ]
  }
}
```

**To add a new article:**
1. Write the markdown file locally
2. `sgit commit "add: new-article.md"` — get the object ID from the output
3. Add the article entry to `_nav.json` with that object ID
4. `sgit commit "update: _nav.json — add new-article"` — get the new nav object ID
5. `sgit --base-url https://send.sgraph.ai --token "{PUSH_TOKEN}" push`
6. The article appears in the site sidebar on next page load — no other steps

**Object IDs change on every commit.** When you update an existing article and commit it, it gets a new object ID. You must then update `_nav.json` with the new ID and push again. The site always reads the latest nav object ID embedded in the HTML by @Dev — so if you change the nav object ID, you need to tell @Dev to update the `nav-object-id` attribute in the HTML. (This is the one step that requires @Dev.)

---

## Voice Rules (Non-Negotiable)

- Third person — official tech docs style, not first person
- "cannot" not "will not"
- "client-encrypted" not "zero-knowledge"
- Lean on: *exists, shipped, code-verified, in public*
- Avoid: *unique, leading, world-class, innovative, trusted by, we believe*
- Placeholder screenshots as `[screenshot: description]` — @Dev provides real images
- Inline image references use `vault:obj-cas-imm-...` URI format (e.g. `![alt](vault:obj-cas-imm-abc)`)

---

## Current Open Content Work

From `project/workstreams.json`:

| Task | What to do |
|------|-----------|
| `WS-1-T13` | Replace `[screenshot: ...]` placeholders in articles with real `vault:` image URIs once @Dev provides object IDs |
| `WS-3-T2/3/4` | Keep `project/workstreams.json`, `agents.json`, `decisions.json` up to date as tasks complete |
| `US-002-T1/2/3` | Create `_issues/` folder structure + issues files + manifest in vault |
| Dev nav update | When @Dev finishes vault-peek or vault-explainer, add those articles to `dev/_nav.json` |

---

## How to Update the Project Dashboard

The three JSON files in `project/` are the data source for the dev site's Workstreams, Agents, and Decisions pages. Update them whenever task statuses change:

```bash
cd {CONTENT_VAULT_KEY}

# Edit the file
vim project/workstreams.json   # change status from "todo" to "in-progress" etc.

# Commit and push — get the new object ID
sgit commit "update: workstreams.json — WS-1-T11 now in-progress"
sgit --base-url https://send.sgraph.ai --token "{PUSH_TOKEN}" push
sgit inspect-tree HEAD   # find the new object ID for workstreams.json

# The new object ID must be updated in dev/_nav.json
# Edit dev/_nav.json → find "Workstreams & Tasks" → update content_object_id
sgit commit "update: dev/_nav.json — workstreams object-id"
sgit --base-url https://send.sgraph.ai --token "{PUSH_TOKEN}" push
```

Note: the nav object ID must also be in sync with what @Dev has embedded in the HTML. If you change `dev/_nav.json`, tell the human so @Dev can update the `nav-object-id` attribute in the page if needed. (In practice, @Dev's page fetches the nav at runtime by a fixed `NAV_OBJECT_ID` — if that ID is stale, the nav won't show new sections.)

---

## Commit Conventions

```bash
# Adding new content
sgit commit "add: library/articles/new-article.md"

# Updating existing content  
sgit commit "update: project/workstreams.json — mark WS-1-T9 done"

# Updating nav
sgit commit "update: dev/_nav.json v2.2 — add new section"

# Always push after committing
sgit --base-url https://send.sgraph.ai --token "{PUSH_TOKEN}" push

# Always check new object IDs after push
sgit inspect-tree HEAD
```

---

## Session Start Checklist

```
1. cd {CONTENT_VAULT_KEY} && sgit --base-url https://send.sgraph.ai pull
2. cat project/workstreams.json   ← what needs doing
3. cat dev/_nav.json              ← current nav structure
4. Do the work
5. sgit commit + push
6. sgit inspect-tree HEAD         ← note any new object IDs
7. Tell the human what changed and what new object IDs need updating in HTML
```
