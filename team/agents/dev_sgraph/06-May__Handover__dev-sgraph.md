# Handover — @Dev (dev.sgraph)

**Date:** 2026-05-06
**Outgoing session:** Claude Sonnet 4.6 (Claude Code, session ending due to context limit)
**Incoming session:** Next @Dev agent (Claude Code or Claude Web)
**Driver:** dinis.human (@Dinis)

---

## What happened this session

### Core goal achieved
Wired @Content's GenAI Cybersecurity Framework use-case into the live QA site.
The library SPA at `qa.sgraph.ai/en-gb/library/` now serves vault-driven content
including the full use-case section (5 sub-pages + a meta article).

### Changes shipped (all on `qa` branch, deployed to qa.sgraph.ai)

1. **`library/index.html`** — Four updates:
   - Vault credentials updated: `VAULT_ID=pmcv9tfe`, `READ_KEY=dJKFnqa4Ckip-XpsbkfxV4f7PJhkp0FkVPaYqJbyUMw` (base64url)
   - `NAV_OBJECT_ID` updated to `obj-cas-imm-495b4572d121` (nav v2.1 with meta article)
   - `slugFromPath()` bug fix: `segments[2]` → `segments.slice(2).join('/')` for nested paths
   - `showArticle()` now accepts per-article `vaultId`/`readKey` with fallback to page-level

2. **`en-gb/test/ci-check/index.html`** — New zero-dependency smoke-test page.
   Detects environment from hostname, shows green status + timestamp. Confirmed live.

3. **`sg-side-nav.js`** — Updated by another Claude session (commit `dce7dc2`) on `qa` branch.
   Article buttons now carry `data-vault-id` / `data-read-key` from nav JSON,
   passed through `nav:select` event detail.

### Branch state
- `qa` branch: deployed and live at qa.sgraph.ai
- `claude/review-repo-commits-cTq1F`: synced with `qa` (same HEAD `dce7dc2` or later)
- `dev` branch: **NOT yet updated** — waiting for @Dinis to merge `qa → dev`
- `main` branch: unchanged (production)

---

## Current vault state

### Content vault (pmcv9tfe) — READ ONLY for @Dev

Nav object currently wired: `obj-cas-imm-495b4572d121` (v2.1 — includes meta article)

All use-case content is live in the vault. No pending content updates from @Content.

### Collab vault (r8m13rgj)

Mail state:
- **@Dev inbox**: EMPTY — all mail processed
- **@Dev done/**: messages 001–004 archived
- **@Dev outbox**: replies 001–005 sent to @Content

Session notes: `mail/sessions/dev.sgraph/notes.md` — full log of this session.

---

## Open tasks for next session

### Waiting on @Dinis
- Merge `qa → dev` to promote all library changes to `dev.sgraph.ai`
- Merge `dev → main` when satisfied with production readiness

### Ready to do when needed
- **Playwright screenshots** of the library use-case pages (skipped this session per @Dinis).
  Use `npx playwright` or install via `pip install playwright && playwright install chromium`.
  Screenshot targets: `/en-gb/library/`, and each of the 5 use-case sub-pages.
- **Check for new mail** from @Content — they may push new content and send updated NAV_OBJECT_IDs.

### One-line update pattern for new content
When @Content pushes new nav and sends a new `NAV_OBJECT_ID`:
```js
// In library/index.html, update one constant:
const NAV_OBJECT_ID = 'obj-cas-imm-NEWID';
```
Then commit + push to `qa`. That's all — no other code changes needed.

---

## Critical lessons learned this session

### 1. Read key encoding: ALWAYS base64url, NEVER hex

The content vault read key has two representations:
- **Hex (64 chars, wrong):** `1814ee917a34b6bcfd756779a79aaa0bae0bc3ea11b0f84e3a2cfd6697b07708`
- **Base64url (43 chars, correct):** `dJKFnqa4Ckip-XpsbkfxV4f7PJhkp0FkVPaYqJbyUMw`

`importReadKey()` fails silently on hex. Always use the 43-char base64url form.
See `r8m13rgj/decisions/006-read-key-format.md`.

### 2. Nested slug routing requires `segments.slice(2).join('/')`

`slugFromPath()` in library SPA shells must join all segments after `/en-gb/library/`,
not just take `segments[2]`. Already fixed — don't regress this.

### 3. Per-article vault credentials

Nav JSON article entries can carry optional `vault_id` + `read_key` fields.
`sg-side-nav` passes them through `nav:select`. `showArticle()` uses them with
fallback to page-level credentials. Enables multi-vault navs.

---

## Key file paths

| File | Purpose |
|------|---------|
| `sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/library/index.html` | Library SPA shell |
| `sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/test/ci-check/index.html` | CI smoke-test page |
| `sgraph_ai_website/v0/v0.2/v0.2.0/_common/js/components/sg-side-nav/v0/v0.1/v0.1.0/sg-side-nav.js` | Side nav component |
| `sgraph_ai_website/v0/v0.2/v0.2.0/_common/js/components/sg-article-viewer/v0/v0.1/v0.1.0/sg-article-viewer.js` | Article renderer |
| `sgraph_ai_website/cloudfront/url-rewrite.js` | CloudFront SPA routing |
| `team/agents/dev_sgraph/ROLE.md` | Full @Dev role reference |

---

## Session start for incoming @Dev

```bash
# 1. Pull collab vault
cd /home/user/r8m13rgj && sgit pull

# 2. Read this handover and session notes
cat mail/sessions/dev.sgraph/notes.md

# 3. Check mail
ls mail/mailroom/dev.sgraph/    # transit — deliver to inbox
ls mail/dev.sgraph/inbox/       # unread

# 4. Sync repo
cd /home/user/SGraph-AI__Website
git fetch origin qa
git checkout claude/review-repo-commits-cTq1F
git merge origin/qa
```

Good luck — the hard infrastructure work is done. Most sessions from here will be
short: get NAV_OBJECT_ID from @Content, update one line, push to qa.
