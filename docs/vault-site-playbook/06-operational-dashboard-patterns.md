# 06 — Operational Dashboard Patterns

**Part of:** Vault-Backed Site Publishing documentation set
**Prereqs:** docs 00–05, and [`../dev-board-implementation-spec.md`](../dev-board-implementation-spec.md)

The vault-site playbook (docs 00–05) covers how to publish *content*. This doc
covers the **live operational surface** the sgraph.ai Dev sub-site ships — the
patterns that turn a documentation site into a self-describing, self-verifying
dashboard. These are the pieces other sites should consider adopting, with the
real code to copy from.

All file references are under
`sgraph_ai_website/v0/v0.2/v0.2.0/` unless noted; the Dev sub-site lives at
`en-gb/dev/`.

---

## Why an "operational dashboard" layer

A vault-backed site can do more than render articles. Because the components
already speak the vault protocol and fetch live data client-side, the same shell
can surface **live project state, live infrastructure status, and live proof that
the system works** — with no backend. The Dev sub-site demonstrates six reusable
patterns:

| # | Pattern | Lives in | What it proves / does |
|---|---|---|---|
| A | Structured-JSON boards (kanban / issues / agents / releases) | `en-gb/dev/index.html` + board spec | Live project management from JSON, no DB |
| B | Live CI / GitHub Actions view | `en-gb/dev/index.html` (`showCiView`) | Real build status, fetched in-browser |
| C | Public vault directory (self-verifying) | `en-gb/dev/vaults/index.html` | Proves "served from an encrypted vault" live |
| D | Dual-theme system | `_common/css/style.css` | Dark marketing + light docs in one site |
| E | Style guide / component gallery | `en-gb/dev/style-guide/index.html` | Living reference of every component |
| F | Static-vs-vault JSON sourcing | `showJsonBoard` | Same view, repo-file OR vault object |

Adopt the ones that fit your site. A, B and C are the high-value, distinctive ones.

---

## Pattern A — Structured-JSON boards

Multiple **nested kanban boards** (workstreams → drill-down to tasks), plus flat
issue lists, an agent roster, and a release log — all driven by JSON and rendered
client-side. This is the centrepiece of the Dev sub-site and is documented in
full (all five schemas, the render pipeline, the create-a-board steps) in
[`../dev-board-implementation-spec.md`](../dev-board-implementation-spec.md).

Recommend for your site when you have project state worth showing publicly
(roadmap, issues, release history, team roster). Key reusable bits:

- `renderWorkstreamsKanban()` + `wireKanban()` + `renderWorkstreamDetail()` — the
  two-level board with click-to-drill-down (`en-gb/dev/index.html`).
- The schema dispatch in `renderJsonBoard()` — `project-workstreams-v2`,
  `project-issues-v1`, `project-agents-v2`, `project-releases-v1`, generic.
- Status → colour mapping (`STATUS_COLORS`) shared across every board.

See the board spec for the copy-paste guide; don't re-document it here.

---

## Pattern B — Live CI / GitHub Actions view

A page that fetches the repo's recent workflow runs **directly from the GitHub
REST API in the browser** and renders them grouped by workflow, with status
colours, durations, branch/sha/actor, and filters. No server, no token (public
repo). Implemented as `showCiView()` in `en-gb/dev/index.html`.

The core fetch:

```js
const REPO = 'sgraph-ai/sgraph-ai__website';
const r = await fetch(
  `https://api.github.com/repos/${REPO}/actions/runs?per_page=30`,
  { headers: { 'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28' } });
const { workflow_runs } = await r.json();
```

Then group by `run.name`, map `run.conclusion ?? run.status` to a colour/icon, and
render rows. A workflow + status filter and a refresh button complete it.

Recommend for your site if it has a public repo and you want build/deploy status
visible to readers (it doubles as proof the CI described in doc 04 is real).
Caveats to copy along with the code:
- Unauthenticated GitHub API is rate-limited (60 req/hr per IP) — fine for a
  human-paced dashboard, not for polling.
- Open run links via a **delegated listener + `data-*` attribute**, not an inline
  `onclick` (the latter was an XSS foot-gun — see security review CR-01). The
  current code uses `data-run-url` + a delegated click handler.

---

## Pattern C — Public vault directory (self-verifying)

The single most on-brand pattern: a page that lists the site's public vaults and,
for each one, **verifies live in the browser** that the content really is served
from an encrypted, content-addressed vault — by resolving the vault's HEAD commit
and decrypting a probe object client-side. The server only ever sees ciphertext,
and the page proves it. Implemented in `en-gb/dev/vaults/index.html`.

Three layers compose it:

1. **Registry** — the card list is generated from `core/public-vaults.json`
   (the same registry doc 01 §6 describes).
2. **Live verify** — for each vault, `openVault()` derives the ref file-id,
   resolves HEAD → commit → tree, and `verifyCard()` decrypts to confirm the
   vault responds and the key works:
   ```js
   const refHex = await client.deriveFileIdHex(
       readKeyBytes, `sg-vault-v1:file-id:ref:${vaultId}`);
   // → resolve commit → tree → decrypt a probe object in-browser
   ```
3. **Self-describing enrichment** — if the vault root contains a
   `_vault-meta.json` (owner-maintained), the card is enriched with it at view
   time (`readRootJson(handle, '_vault-meta.json')`). The registry carries the
   minimum; the vault describes itself with the rest.

Recommend for any site built on this architecture — it makes the trust model
*demonstrable* rather than merely claimed, and the "add a vault" path is just a
registry entry (doc 05 §2). Reproduce the public-key safety rules from doc 00 §5
verbatim: read keys only, never write keys.

---

## Pattern D — Dual-theme system

One site, two design languages: a **dark "Aurora" marketing theme** for the
top-level pages and a **light "two-tone paper" theme** for the documentation
sub-sites. Both live in `_common/css/style.css` as separate `:root` token sets;
a sub-site opts into the light theme via `<body class="sub-site-page">` and the
`sub-site` shell classes.

Recommend when a site has both a marketing front and a docs/dashboard back —
readers get a calm, high-legibility surface for long-form content without losing
the branded marketing entry. Practical guidance to carry over:

- Drive everything from CSS custom properties (`--ss-*` for the sub-site theme,
  `--accent`, spacing scale) so a new sub-site inherits the theme by class alone.
- **Known debt to fix as you scale (CR-09):** today both themes plus the rich
  article components sit in one 3,900-line `style.css`, so marketing pages ship
  ~1,900 lines of sub-site CSS they never use. Split into
  `base / marketing / sub-site / article-rich` before reusing widely.

---

## Pattern E — Style guide / component gallery

A living reference page that renders every component and rich block in situ, so
authors and developers can see what's available and how it looks. Implemented at
`en-gb/dev/style-guide/index.html`. It pairs with the content-side authoring
guide (`/en-gb/library/guides/content-authoring-blocks`) — the style guide shows
the *rendered* components, the authoring guide shows the *YAML* that produces the
fenced-block ones.

Recommend for any site with more than a handful of components — it's the cheapest
way to keep the design system discoverable, and it doubles as a visual smoke test
after a CSS change. (This is the same idea as a Storybook, but build-step-free.)

---

## Pattern F — Static-vs-vault JSON sourcing

A small but powerful pattern that makes boards (Pattern A) frictionless: a board's
`content_object_id` can be **either** a vault object id **or** a root-relative
repo path. `showJsonBoard()` detects the leading `/` and uses a plain `fetch`
(no decryption) for repo files, or the vault client for vault objects:

```js
if (objectId.startsWith('/')) {
  const r = await fetch(objectId, { cache: 'no-store' });   // repo-tracked JSON
  text = await r.text();
} else {
  const key = await importReadKey(readKey);                 // vault object
  text = new TextDecoder().decode(
    await readObject('https://send.sgraph.ai', vaultId, objectId, key));
}
```

Recommend this for every board-style view: use a **repo file** for data that lives
naturally in git (the code-review board, a roadmap you edit in PRs) and a **vault
object** for agent-authored or same-privacy-as-content data. Same renderer, same
nav entry shape — only the source differs (doc 01 §5).

---

## Adoption checklist for a new site's dashboard

- [ ] Decide which patterns fit (A/C are the highest-value; B needs a public repo)
- [ ] Boards: define your schemas / reuse the four in the board spec; choose
      static-file vs vault per board (Pattern F)
- [ ] CI view: set `REPO`; open run links via delegated listener, not inline onclick
- [ ] Vault directory: add vaults to `public-vaults.json`; optionally add
      `_vault-meta.json` to each vault root for richer cards
- [ ] Theme: opt sub-sites into the light theme via `body.sub-site-page`; drive
      everything from CSS tokens
- [ ] Style guide: stand up a page that renders your components for visual QA
- [ ] Re-apply the security rules: escape all vault-derived strings, no inline
      event handlers, public read keys only (CR-01)
