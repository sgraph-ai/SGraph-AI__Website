# 05 — Playbook: Launch a New Vault-Backed Site

**Part of:** Vault-Backed Site Publishing documentation set
**Prereqs:** docs 00–04. This is the step-by-step that ties every layer together.

This is the document to follow when you have a new body of content and want it
live as a vault-backed sub-site, with both a browser SPA and machine-readable
`.md`/`.llm.json`/`llms.txt`.

---

## 0. Decide the shape first

Answer these before touching anything:

| Question | Default for a public knowledge site |
|---|---|
| **New vault or a section of an existing one?** | New vault if it has its own owner / rotation lifecycle; otherwise a folder + nav in an existing vault. |
| **Is the content genuinely public?** | It must be — this pattern uses published read keys (doc 00 §5). If confidential, **stop**: this architecture does not provide confidentiality. |
| **Markdown, structured JSON, or both?** | Markdown articles + optional JSON boards (doc 01 §4–5). |
| **Do agents need machine-readable output?** | Almost always yes → add edge manifests (step 5). |
| **Mount path?** | `/en-gb/<site>/` (e.g. `/en-gb/handbook/`). |

---

## 1. Create the vault & author content

With a **write key held privately** (never committed):

```bash
sgit --base-url https://send.sgraph.ai clone <PASSPHRASE>:<NEW_VAULT_ID>
cd <NEW_VAULT_ID>

# Lay out content however you like; convention mirrors the site structure:
mkdir -p handbook/get-started
$EDITOR handbook/get-started/welcome.md

# Author the nav tree (doc 01 §3)
$EDITOR handbook/_nav.json

sgit commit "initial handbook content + nav"
sgit --base-url https://send.sgraph.ai --token "<PUSH_TOKEN>" push
```

Minimal `handbook/_nav.json`:

```json
{
  "sections": [
    {
      "title": "Get Started",
      "description": "First steps.",
      "children": [
        { "title": "Welcome", "slug": "welcome",
          "content_path": "handbook/get-started/welcome.md",
          "render": "markdown", "description": "Start here." }
      ]
    }
  ]
}
```

Note the **read key** (base64url) for this vault — you'll need it in the shell and
manifests. The write key/passphrase stays out of the repo entirely.

---

## 2. Register the vault as public (optional but recommended)

Add an entry to
[`core/public-vaults.json`](../../sgraph_ai_website/v0/v0.2/v0.2.0/core/public-vaults.json)
so the vault shows in the Open Vaults directory and the read-key provenance is
documented:

```json
{
  "id": "<NEW_VAULT_ID>",
  "read_key": "<PUBLIC_READ_KEY_base64url>",
  "label": "Handbook",
  "owner": "@SomeAgent",
  "purpose": "The team handbook.",
  "site_url": "https://sgraph.ai/en-gb/handbook/"
}
```

Read key only. Never the write key.

---

## 3. Create the SPA shell

Copy the **most complete** shell as your starting point — currently
`en-gb/library/index.html` (doc 02 §4 explains why not dev/invest). Create
`en-gb/handbook/index.html` and change:

1. `<title>` and `<base href="/en-gb/handbook/">`.
2. Every `vault-id` / `read-key` / `nav-path` attribute on `<sg-sub-nav>`,
   `<sg-side-nav>`, `<sg-search>` to your vault + `handbook/_nav.json`.
3. The page-level `VAULT_ID` / `READ_KEY` consts in the inline script.
4. All `/en-gb/library/` literals in the inline script → `/en-gb/handbook/`
   (breadcrumb hrefs, `pushState` targets, slug parsing base).
5. `sg-sub-nav` `site-title` / `site-description`.

> If a shared `_common/js/sub-site-shell.js` exists by the time you do this
> (CR-05 target), prefer importing it and passing
> `{ base:'/en-gb/handbook/', siteTitle:'Handbook', vaultId, readKey }` instead of
> copy-pasting ~490 lines of inline script. If it doesn't exist yet, **strongly
> consider extracting it now** — you're about to create the 4th copy.

Apply the front-end hardening from doc 02 §6 to the new shell (escape nav-derived
strings, DOMPurify the marked output, set `document.title` on `nav:select`) rather
than inheriting the known gaps.

---

## 4. Wire CloudFront SPA routing

The sub-site is an SPA: deep links like `/en-gb/handbook/get-started/welcome/`
must serve the shell. Edit
[`cloudfront/url-rewrite-for__sgraph-ai.js`](../../sgraph_ai_website/cloudfront/url-rewrite-for__sgraph-ai.js):

1. Add an SPA rewrite branch (mirroring the library/invest blocks):
   ```js
   if (uri.indexOf('/en-gb/handbook/') === 0 && !isAsset(uri)) {
       request.uri = '/en-gb/handbook/index.html';
       return request;
   }
   ```
   (Place it **before** the generic `index.html`-append, and never rewrite
   `*.md` / `*.llm.json` / `llms.txt` — those go to the Lambda.)
2. If the sub-site has *real* (non-SPA) sub-pages, add them to a `*_REAL_PAGES`
   allowlist like `DEV_REAL_PAGES` so they aren't swallowed by the rewrite.
3. Bump `CF_VERSION`.
4. **Publish the function out-of-band** (it is not deployed by the CI pipeline —
   see the header of that file for the `aws cloudfront ... update-function`
   command), and attach to each distribution. Forgetting this means deep links
   404 / serve the wrong shell.

> The viewer-request function also stamps `x-sg-site-host` from the Host header —
> this is what lets the Lambda find the right origin (doc 03). Keep that line.

---

## 5. Add machine-readable representations (edge layer)

Two parts — both in the repo, both deployed by normal CI:

### 5a. Manifests

Create under `core/edge-render/v1/manifests/`:

- `handbook-page-md.json` (`type: markdown`)
- `handbook-page-llm.json` (`type: llm.json`)
- (extend the shared `llms.txt` manifest, or add a per-site one)

Use the `sg-render/v1` schema from doc 03 §2 with your vault id, **public read
key**, and `nav_path: handbook/_nav.json`, `base_path: /en-gb/handbook`.

### 5b. Orchestrator AREAS entry

Add one line to `AREAS` in
[`core/edge-render/v1/sg-edge-render.mjs`](../../sgraph_ai_website/v0/v0.2/v0.2.0/core/edge-render/v1/sg-edge-render.mjs):

```js
{ base: '/en-gb/handbook', md: 'handbook-page-md', json: 'handbook-page-llm' },
```

No Lambda change, no CloudFront change for `.md`/`.llm.json` (the Lambda already
intercepts those suffixes globally). Verify the Lambda's `host` allowlist (CR-02)
includes your environments.

---

## 6. Test locally, then ship through the gate

```bash
# Front-end: serve the overlaid site locally
bash sgraph_ai_website__deploy/website__run-locally.sh
# open http://localhost:10060/en-gb/handbook/

# Edge: render each representation against the live vault
node tests/edge-render/run-local.mjs /en-gb/handbook/get-started/welcome.md
node tests/edge-render/run-local.mjs /en-gb/handbook/get-started/welcome.llm.json
node tests/edge-render/run-local.mjs /llms.txt        # confirm the new section appears
```

Then ship through the promotion flow (doc 04 §1):

```bash
git add sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/handbook/ \
        sgraph_ai_website/v0/v0.2/v0.2.0/core/ \
        sgraph_ai_website/cloudfront/
git commit -m "feat: launch handbook vault-backed sub-site"
git push origin qa          # auto-deploys to qa.sgraph.ai
# verify on qa.sgraph.ai, then promote qa→dev→main→prod
```

---

## 7. Launch checklist

- [ ] Vault created; content + `_nav.json` pushed; read key noted (write key NOT committed)
- [ ] Vault registered in `public-vaults.json` (read key only)
- [ ] Shell `en-gb/<site>/index.html` created, all vault attrs + base path + site literals updated
- [ ] Front-end hardening applied (escaping, DOMPurify, `document.title`)
- [ ] CloudFront SPA rewrite branch added + function published + attached; `CF_VERSION` bumped
- [ ] Real sub-pages (if any) added to the `*_REAL_PAGES` allowlist
- [ ] Edge manifests created (`md` + `llm.json`); `AREAS` entry added; Lambda host allowlist covers envs
- [ ] Tested locally (front-end on :10060) and via `run-local.mjs` (all 3 representations + `/llms.txt`)
- [ ] Pushed to `qa`, verified on qa.sgraph.ai, promoted onward
- [ ] No write keys / passphrases / AWS secrets anywhere in the diff

---

## 8. What you did NOT have to do (the scaling payoff)

- No new CI workflow — the existing pipeline deployed the new files (doc 04 §7).
- No Lambda change — it's host-driven and suffix-driven (doc 03).
- No redeploy to publish content — once live, content authors push to the vault
  and the site updates on next load (doc 00 §1, doc 01 §7).

That asymmetry — **one-time wiring, then zero-friction content publishing** — is
the entire reason to build on this architecture. Each additional site is mostly
configuration, and the marginal cost trends toward "a shell file + a vault."
