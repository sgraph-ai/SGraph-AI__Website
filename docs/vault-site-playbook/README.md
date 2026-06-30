# Vault-Backed Site Publishing — Documentation Set

**Maintainer:** @Dev (dev.sgraph)
**Status:** Living document set — updated 2026-06-09
**Audience:** Agents (and humans) who need to build and publish a website whose
content lives in encrypted sgit vaults, following the pattern proven by
sgraph.ai.

---

## What this set is

sgraph.ai is a **static website with no build step** whose *content* is authored
and stored in **encrypted, content-addressed vaults** (sgit), separate from the
*presentation* code (HTML/CSS/JS) in the git repo. Content is rendered two ways:

- **Client-side** — Web Components fetch and decrypt vault objects in the browser
  and render Markdown + structured views.
- **Edge-side** — a Lambda@Edge function renders the same vault content as
  `.md`, `.llm.json`, and `/llms.txt` for agents and crawlers.

This decoupling is the whole point: **content authors (or agents) publish without
touching the website code, and the website code ships without redeploying for
every content change.** This set documents how it all fits together so the
pattern can be **replicated for new sites**.

---

## Read in this order

| # | Document | Covers |
|---|---|---|
| 00 | [`00-overview.md`](./00-overview.md) | The whole system at a glance: the three layers, request flows, the trust model, and the scaling vision. **Start here.** |
| 01 | [`01-vault-content-model.md`](./01-vault-content-model.md) | How content lives in vaults: sgit, content-addressing, the nav-tree schema, the public-read-key model, fenced blocks, and structured-JSON board schemas. |
| 02 | [`02-frontend-rendering.md`](./02-frontend-rendering.md) | The client-side renderer: the SPA shell, the Web Component catalog (with file paths), CSS, and how to wire a new sub-site front-end. |
| 03 | [`03-edge-rendering.md`](./03-edge-rendering.md) | The edge renderer: Lambda@Edge + the orchestrator module + render manifests; the `.md` / `.llm.json` / `llms.txt` representations. |
| 04 | [`04-ci-cd-pipeline.md`](./04-ci-cd-pipeline.md) | The deployment system: the GitHub Actions workflows, IFD versioning, the Python deploy scripts, the S3 layout, CloudFront, caching, and secrets. |
| 05 | [`05-playbook-launch-new-site.md`](./05-playbook-launch-new-site.md) | **The scaling playbook** — a step-by-step to stand up a brand-new vault-backed sub-site, tying every layer together. |
| 06 | [`06-operational-dashboard-patterns.md`](./06-operational-dashboard-patterns.md) | The **live operational surface** — structured-JSON boards, a live CI view, a self-verifying public vault directory, dual themes, and a style guide. The reusable dashboard patterns, with the real code. |

Related, already-published references:
- [`../dev-board-implementation-spec.md`](../dev-board-implementation-spec.md) — the structured-JSON board/kanban system (schemas + renderers).
- [`../code-review__2026-06-09.md`](../code-review__2026-06-09.md) — current known issues and remediation backlog; read before copying any pattern verbatim.

---

## Security note — read before you write any doc derived from this set

This set deliberately includes **public, read-only vault keys** (the same keys
already shipped in the website's HTML and in `core/public-vaults.json`). They
grant read access to content that is meant to be world-readable.

**Never include in any doc, vault file, or repo file:**
- Vault **write keys** or passphrases (the `passphrase:vault_id` form).
- Push tokens, AWS credentials, or any secret consumed by CI.

The read-only-key model is appropriate **only for content that is genuinely
public**. Do not reuse this pattern for a vault whose content must stay
confidential — see `01-vault-content-model.md` §"The trust model" for why.

---

## The core idea in one paragraph

A vault holds Markdown and JSON objects plus a `_nav.json` tree. The website repo
holds thin HTML "shells" and Web Components. At runtime the shell loads the nav
from the vault, the user clicks an article, and a component fetches + decrypts the
object and renders it — all client-side, no server. In parallel, a Lambda@Edge
function serves machine-readable `.md`/`.llm.json`/`llms.txt` of the same content
for agents. The repo is deployed to S3 + CloudFront by a GitHub Actions pipeline
using an **IFD overlay** (versioned source folders union-merged onto a `latest/`
prefix). To launch a new site you create a vault, author content + a nav tree,
copy a shell, register a read manifest, and let CI deploy — documented in 05.
