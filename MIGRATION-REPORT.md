# Migration Report — Website Extraction

**Source repo:**   `the-cyber-boardroom/SGraph-AI__App__Send` (commit: `9c6dd7e`)
**Target repo:**   `sgraph-ai/SGraph-AI__Website`
**Target branch:** `claude/refactor-sg-website-repo-hahze`
**Dev pack:**      `library/sgraph-send/dev_packs/v0.22.6__website-repo-extraction/`
**Date:**          2026-04-25
**Agent:**         Migration Agent (Claude Code web session)
 
---

## Scope

Extracted the sgraph.ai marketing website out of the Send monorepo into a
dedicated repo, per the dev pack phases 1–3. Phase 4 (QA against
`https://dev.sgraph.ai`) requires CI to run — that is out of scope for this
session and is blocked by the GitHub Actions secrets/environments listed below.

No changes were made to the source repo. No infrastructure (CloudFront, S3,
IAM, DNS) was touched. No Web Component code was edited.

---

## Files copied (counts)

| Section | Count | Expected | Notes |
|---------|-------|----------|-------|
| A — root files (excl. LICENSE) | 6 / 6 | 6 | `index.html`, `404.html`, `robots.txt`, `sitemap.xml`, `README.md` (rewritten), `.gitignore` (copied from source, replaces the GitHub-init Python boilerplate) |
| B — `en-gb/` tree | 22 | ~21 | Full inventory match — including `agents/{sherpa,ambassador,architect,designer}`, `agents/keys.json`, `pricing/*` (9 pages), `payment/{success,cancel}` |
| C — `i18n/` | 17 / 17 | 17 | 17 enumerated locale files copied; **`en.json` (21,965 bytes) left behind — see Deviation D1** |
| D — top-level `_common/` | 17 | ~15 | Whole tree copied. Includes `img/logo/previous/favicon.svg` (not in inventory but inside the "copy entire tree" scope) |
| E — versioned `v0/v0.2/v0.2.0/` | 80 | 80+ | 6 page snapshots, 5 versioned CSS, 8 fonts + fonts.css, 4 versioned JS, 10 homepage Web Components × 3 files = 30, `sg-site-header` at 3 versions (v1.0.4/.5 × 4 files + v1.0.6 × 3 files = 11), 13 use-case PNG/JPEG + 2 README.md, 1 versioned favicon |
| F — `cloudfront/` | 1 / 1 | 1 | `cloudfront/url-rewrite.js` |
| G — `scripts/` | 5 / 5 | 5 | `deploy_static_site.py`, `generate_i18n_pages.py`, `generate_sitemap.py`, `store_ci_artifacts.py`, `website__run-locally.sh` |
| H — workflow | 1 / 1 | 1 | `.github/workflows/deploy-website.yml` |
| **Total copied** | **149** | — | — |

Preserved from the original target repo: `LICENSE` (Apache 2.0).
New files created: `version`, `MIGRATION-REPORT.md` (this file).

---

## Edits applied

Every edit below was applied **after** the pure-copy step, so the diff is easy
to audit via the commit history.

### Scripts

| File | Edits |
|------|-------|
| `scripts/website__run-locally.sh` | (E1) `WEBSITE_DIR="$REPO_ROOT/sgraph_ai__website"` → `WEBSITE_DIR="$REPO_ROOT"`; comment-block source paths updated from `sgraph_ai__website/v0/...` to `v0/...` |
| `scripts/generate_i18n_pages.py` | (E3) `WEBSITE_DIR = Path(__file__).parent.parent / 'sgraph_ai__website'` → `WEBSITE_DIR = Path(__file__).parent.parent`; `--output-dir` help text updated |
| `scripts/generate_sitemap.py` | (E4) same `WEBSITE_DIR` rewrite as E3; `--output` help text updated |
| `scripts/deploy_static_site.py` | (E2) no hard-coded `--source-dir` default existed (arg is `required=True`); `--version-file` help text `Typically: sgraph_ai_app_send/version` → `Typically: version` |
| `scripts/store_ci_artifacts.py` | (E5) no changes — grep confirmed zero matches on `sgraph_ai__website` or `sgraph_ai_app_send` |

### Workflow — `.github/workflows/deploy-website.yml`

| Edit | Change |
|------|--------|
| W1 | Removed the `paths:` filter entirely (Option A per dev pack §06). Every push to `dev`/`main` now triggers a deploy — appropriate for a single-purpose repo. |
| W2 | `WEBSITE_DIR: sgraph_ai__website` → `WEBSITE_DIR: .` |
| W3 | `cat sgraph_ai_app_send/version` → `cat version` |
| W4 | `--version-file sgraph_ai_app_send/version` → `--version-file version` |
| W5 | Everything else unchanged (checkout, Python setup, AWS credentials, concurrency, env resolution, `store_ci_artifacts.py` step). |

### README

Rewrote `README.md` per dev pack §05 E7:
- One-line purpose at top
- Stack summary (static HTML/CSS/JS, Web Components, IFD versioning, 17 locales, S3+CloudFront)
- Local development via `bash scripts/website__run-locally.sh`
- Full repo layout tree
- IFD versioning explanation
- Deployment flow per branch/environment
- Cache policy table
- Required GitHub Actions secrets + environments
- Link back to `MIGRATION-REPORT.md` for provenance
- License (Apache 2.0)

Removed all Send-repo-specific references (`team/`, `library/`, `.claude/`, `.issues/`).

---

## New files created

| File | Contents |
|------|----------|
| `version` | `v0.0.1` (single line, trailing newline) — independent website release line, per dev pack decision #2 |
| `MIGRATION-REPORT.md` | This file |

`.gitignore` was copied from the source (not created fresh), so dev pack §03 Section I fallback was not needed.

---

## Sanity grep

After all edits, final check against the phase 4 acceptance criterion:

```
grep -rn 'sgraph_ai__website' --include='*.py' --include='*.sh' --include='*.yml' .
# Result: 0 matches (MIGRATION-REPORT.md excluded from grep — by design, see §03 end)

grep -rn 'sgraph_ai_app_send' --include='*.py' --include='*.sh' --include='*.yml' .
# Result: 0 matches
```

Both pass.

---

## Deviations from plan

### D1 — extra i18n locale file `en.json` not copied

Source contains **18** JSON files under `sgraph_ai__website/i18n/`, but the
inventory (`03_file-inventory-and-mapping.md` §C) enumerates **17**. The extra
file is `i18n/en.json` (21,965 bytes — notably smaller than the ~70–79KB of
the other locale files, suggesting it is either a stub or legacy).

Per inventory rule *"Anything not in this document does not move"*, `en.json`
was **not copied**. Target has the 17 enumerated files only.

**Action for the human:** decide whether `en.json` should be migrated,
retired in both repos, or left only in the Send repo.

### D2 — `inject_build_version.py` not moved

Per dev pack §03 G, `scripts/inject_build_version.py` moves only if it is
referenced by one of the migrating scripts or by the workflow. I grepped all
five moving scripts (`deploy_static_site.py`, `generate_i18n_pages.py`,
`generate_sitemap.py`, `store_ci_artifacts.py`, `website__run-locally.sh`) and
the workflow — **zero references**. It stays in the Send repo.

### D3 — `en-gb/` count is 22, dev-pack prose said "~21"

Dev pack §02 prose described the `en-gb/` tree as "~21 HTML/JSON files", but
§03 B explicitly enumerates **22** paths (including `agents/designer/index.html`
and both `payment/success/index.html` and `payment/cancel/index.html`). Source
has exactly 22. All 22 were copied. This is an inconsistency **inside** the
dev pack, not a migration discrepancy. Flagging for the human's awareness.

### D4 — `.gitignore` handling

The target repo was pre-created with a GitHub-init Python `.gitignore`
(4,628 bytes of Python venv/cache/etc patterns). Per inventory §A, the source
`sgraph_ai__website/.gitignore` (260 bytes, just the generated locale folders
`/en-us/`, `/pt-pt/`, …, `/tlh/`) was copied to the target root, **replacing**
the pre-existing file. This matches the inventory's "copy" directive literally.

The scripts are Python, so some contributors may find `__pycache__/` etc
useful. If the human wants those added, they can be appended post-migration;
I deliberately did not broaden the `.gitignore` beyond what the inventory
specified.

### D5 — workflow `paths:` filter

Per dev pack §06 Edit W1, two options were offered. I took **Option A**
(recommended): removed `paths:` entirely. Every push to `dev`/`main` in this
single-purpose repo now triggers the deploy. Cleaner than maintaining a path
allow-list against a repo whose sole purpose is this website.

---

## Commits

(One commit per logical step, to be recorded in the Commit log section below
after `git commit` completes.)

1. `copy: website static content and scripts from SGraph-AI__App__Send`
   — pure copy of sections A–H (149 files). No edits.
2. `fix(scripts): drop sgraph_ai__website prefix from path expressions`
   — E1 (website__run-locally.sh), E3 (generate_i18n_pages.py), E4 (generate_sitemap.py)
3. `fix(scripts): remove sgraph_ai_app_send/version hint from deploy_static_site.py help`
   — E2
4. `fix(workflow): adapt deploy-website.yml to standalone repo layout`
   — W1–W4
5. `docs: rewrite README for standalone repo context`
   — E7
6. `add: version file (v0.0.1) and migration report`

---

## Local verification (dev pack §04 Step 5)

**Not performed in this session.** The migration agent was operating on a
short-lived shell without AWS credentials, without a browser, and without the
port/network configured to run `bash scripts/website__run-locally.sh`. Human
should run locally after the push:

```bash
git fetch origin claude/refactor-sg-website-repo-hahze
git checkout claude/refactor-sg-website-repo-hahze
bash scripts/website__run-locally.sh
# open http://localhost:10060/en-gb/ in a browser
# check DevTools console for 404s / CORS errors
python3 scripts/generate_sitemap.py --dry-run
python3 scripts/generate_i18n_pages.py --dry-run
```

If the local run passes, a push to the target repo's `dev` branch will trigger
the first CI deploy.

---

## CI verification (dev pack §04 Step 6)

**Not performed in this session.** Requires the five GitHub Actions secrets
and three GitHub Environments (`dev`, `main`, `production`) to be configured
on `sgraph-ai/SGraph-AI__Website` — see next section.

---

## Action items for the human

### Secrets (must be added before the workflow can run)

Per dev pack §06, the target repo needs these five secrets. They can reuse
the values from the Send repo (same AWS credentials, same S3 bucket, same
CloudFront distributions — this is a code move, not an infra rebuild).

| Secret | Source |
|--------|--------|
| `AWS_ACCESS_KEY_ID` | Copy from `the-cyber-boardroom/SGraph-AI__App__Send` secrets |
| `AWS_SECRET_ACCESS_KEY` | Copy from `the-cyber-boardroom/SGraph-AI__App__Send` secrets |
| `WEBSITE_S3_BUCKET` | Copy from source secrets (convention: `{account-id}--static-sgraph-ai--{region}`) |
| `WEBSITE_CF_DIST` | Copy from source secrets (prod distribution — referenced as `E2YZA5CZTJE62H` in `cloudfront/url-rewrite.js`) |
| `WEBSITE_CF_DIST_MAIN` | Copy from source secrets |

The migration agent did **not** attempt to set these programmatically — no
credentials were in scope and the available tooling does not expose a secret-
write API to this session.

### GitHub Environments (must exist)

| Environment | Needed for |
|-------------|------------|
| `dev` | Pushes to `dev` branch |
| `main` | Pushes to `main` branch |
| `production` | Manual `workflow_dispatch` |

Each may have its own protection rules (required reviewers, branch
restrictions). Not configured by the migration agent.

### Open questions (from dev pack README)

These remain open — the agent did not opine on them. Each needs a human
decision before Phase 5 cutover:

1. Default branch — `dev` (matches Send repo) or `main` (GitHub default)?
2. Future shared Web Components package — in-repo or separate?
3. Disable vs delete the Send repo's `deploy-website.yml` at cutover?
4. Leave a tombstone `sgraph_ai__website/README.md` in Send pointing to
   this new repo?

### Verification next steps

1. Human reviews this report + the commit diffs on
   `claude/refactor-sg-website-repo-hahze`.
2. Add the five secrets; create the three environments; merge the branch
   into `dev`.
3. Watch the first `ci-pipeline__dev.yml` workflow run. Smoke-test
   `https://dev.sgraph.ai` per dev pack §07.
4. If dev looks good → Phase 5 (cutover + cleanup of the Send repo), per
   `phase_5__release/08_cutover-and-cleanup.md`.

---

## Addendum — post-migration restructure (2026-04-25)

The dev pack v0.22.6 specified a flat layout (drop the `sgraph_ai__website/`
prefix). After the initial migration landed, the human asked for a different
shape — namespace the website code into folders to keep the repo root minimal,
and adopt the same auto-increment CI pattern used by `SGraph-AI__App__Send`.
This addendum records that restructure on top of the original migration.

### Layout change (deviation D6)

Reverses the dev pack §02 flatten decision in favour of namespaced folders:

```
Before (post-initial migration)            After (this restructure)
────────────────────────────────           ──────────────────────────────
/index.html                                /sgraph_ai_website/index.html
/404.html                                  /sgraph_ai_website/404.html
/robots.txt                                /sgraph_ai_website/robots.txt
/sitemap.xml                               /sgraph_ai_website/sitemap.xml
/_common/                                  /sgraph_ai_website/_common/
/en-gb/                                    /sgraph_ai_website/en-gb/
/i18n/                                     /sgraph_ai_website/i18n/
/v0/                                       /sgraph_ai_website/v0/
/cloudfront/                               /sgraph_ai_website/cloudfront/
/version                                   /sgraph_ai_website/version
/scripts/                                  /sgraph_ai_website__deploy/
```

Repo root now contains only: `README.md`, `LICENSE`, `MIGRATION-REPORT.md`,
`.gitignore`, `.github/`, `sgraph_ai_website/`, `sgraph_ai_website__deploy/`.

Note: GitHub Actions discovers workflow YAML only at `.github/workflows/`, so
those files cannot be moved into a namespace folder. The Python scripts and
the run-locally shell script that the workflows call live in
`sgraph_ai_website__deploy/`.

### CI pipelines added (mirroring SGraph-AI__App__Send)

`deploy-website.yml` was deleted and replaced with the Send-style pattern:

| File | Trigger | Notes |
|------|---------|-------|
| `.github/workflows/ci-pipeline.yml` | `workflow_call` (reusable) | `increment-tag` → `check-aws-credentials` → `deploy` (concurrency-grouped per env). Uses OSBot's `git__increment-tag@dev` action. |
| `.github/workflows/ci-pipeline__dev.yml` | Push to `dev` | `release_type: minor`, `should_increment_tag: true`, `target_deploy: dev` |
| `.github/workflows/ci-pipeline__main.yml` | Push to `main` | `release_type: major`, `should_increment_tag: true`, `target_deploy: main` |
| `.github/workflows/ci-pipeline__prod.yml` | Manual `workflow_dispatch` only | `should_increment_tag: false`, `target_deploy: prod` |

The reusable pipeline gates the deploy job on AWS credentials being present
(via the `check-aws-credentials` job) — same defensive pattern Send uses.

### Path edits applied

| File | Change |
|------|--------|
| `sgraph_ai_website__deploy/website__run-locally.sh` | `WEBSITE_DIR="$REPO_ROOT/sgraph_ai_website"`; comment block points to new location |
| `sgraph_ai_website__deploy/generate_i18n_pages.py` | `WEBSITE_DIR = Path(__file__).parent.parent / 'sgraph_ai_website'`; `--output-dir` help text updated |
| `sgraph_ai_website__deploy/generate_sitemap.py` | same `WEBSITE_DIR` rewrite; `--output` help text updated |
| `sgraph_ai_website__deploy/deploy_static_site.py` | `--version-file` help text: `Typically: sgraph_ai_website/version` |
| `sgraph_ai_website__deploy/store_ci_artifacts.py` | unchanged |
| `.gitignore` (root) | reduced to `.local-server-website/`, `__pycache__/`, `*.pyc`, `.DS_Store`, `.venv/`, `.env` |
| `sgraph_ai_website/.gitignore` | new file — locale-folder ignores moved here so they remain relative to the website tree |
| `README.md` | rewritten to describe the namespaced layout and CI pipeline trio |

### Final repo root listing

```
.git/
.github/
  workflows/
    ci-pipeline.yml
    ci-pipeline__dev.yml
    ci-pipeline__main.yml
    ci-pipeline__prod.yml
.gitignore
LICENSE
MIGRATION-REPORT.md
README.md
sgraph_ai_website/
sgraph_ai_website__deploy/
```

### Open items added by the restructure

- **Verify OSBot `git__increment-tag` writes the version file.** Send's
  `version` file (`sgraph_ai_app_send/version`) is bumped automatically; if the
  action only updates the git tag and the file update is a separate Send-side
  step, we will need to add that step to `ci-pipeline.yml` (read latest tag →
  write to `sgraph_ai_website/version`) before the first deploy. Watch the
  first dev run.
- **Update GitHub Environment names.** The original plan referenced
  `production`; the new pipelines use `prod` to match the S3 path segment.
  Three environments needed on the new repo: `dev`, `main`, `prod`.
- **Send repo's dev pack** (v0.22.6) still references the flatten layout. If
  the dev pack is treated as living documentation, it should be updated; if
  it's a snapshot of the original plan, this addendum is the correction.
