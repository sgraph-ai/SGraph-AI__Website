# 04 — CI/CD & Deployment Pipeline

**Part of:** Vault-Backed Site Publishing documentation set
**Prereq:** [`00-overview.md`](./00-overview.md)

How the repo (shells, components, CSS, the orchestrator, manifests) gets from a
git push to live on S3 + CloudFront. **This is the layer that scales for free:**
once a new sub-site's files are in the repo, the *same* pipeline deploys them with
everything else — no new workflow.

---

## 1. The environments and the promotion flow

Four environments, each its own CloudFront distribution + S3 prefix:

```
push to qa   ──► CI Pipeline - QA   ──► qa.sgraph.ai     (no tag bump)
push to dev  ──► CI Pipeline - DEV  ──► dev.sgraph.ai    (minor tag bump)
push to main ──► CI Pipeline - MAIN ──► main.sgraph.ai   (major tag bump)
manual dispatch ─► CI Pipeline - PROD ─► sgraph.ai       (no tag bump)
```

Intended human/agent flow:

```
@Dev pushes to qa            → auto-deploy to qa.sgraph.ai (agent self-serve gate)
human/review promotes qa→dev → auto-deploy to dev.sgraph.ai
human promotes dev→main      → auto-deploy to main.sgraph.ai
human dispatches PROD        → deploys current main tip to sgraph.ai
```

QA is the agent self-serve lane: agents push to `qa` freely; a human or review
agent promotes onward after inspection.

---

## 2. The workflow files (`.github/workflows/`)

One **reusable base** + four thin **dispatchers**. This mirrors the
`SGraph-AI__App__Send` pattern.

### Dispatchers (one per environment)

```yaml
# ci-pipeline__qa.yml
on: { workflow_dispatch: {}, push: { branches: [qa] } }
jobs:
  deploy-qa:
    uses: ./.github/workflows/ci-pipeline.yml
    with: { git_branch: 'qa', target_deploy: 'qa', should_increment_tag: false }
    secrets: inherit
```

| Dispatcher | Trigger | `release_type` | `should_increment_tag` |
|---|---|---|---|
| `ci-pipeline__qa.yml` | push to `qa` | — | false |
| `ci-pipeline__dev.yml` | push to `dev` | `minor` | true |
| `ci-pipeline__main.yml` | push to `main` | `major` | true |
| `ci-pipeline__prod.yml` | manual dispatch | — | false |

### Base pipeline (`ci-pipeline.yml`) — three jobs

1. **`increment-tag`** — if `should_increment_tag`, bumps the git tag + `version`
   file via `owasp-sbot/OSBot-GitHub-Actions/.../git__increment-tag@dev`.
2. **`check-aws-credentials`** — gates the deploy on the four AWS secrets being
   present; if absent, the deploy job is skipped (so forks/CI-without-secrets
   don't fail).
3. **`deploy`** — the real work, `environment: ${{ inputs.target_deploy }}`,
   concurrency-grouped per env. Steps:
   - checkout, optional `git__update_branch@dev` (to pull the tag bump),
   - `setup-python@v5` (3.12), `configure-aws-credentials@v4`,
   - read `sgraph_ai_website/version`,
   - **resolve env** → sets `deploy_env` + `smoke_url`,
   - **`generate_static_api.py`** → writes `manifest.json` / static API JSON,
   - **`deploy_static_site.py`** → the S3 sync + CloudFront invalidation,
   - **`store_ci_artifacts.py`** → uploads git-diff/commit metadata.

Pinned env vars in the base:

```yaml
env:
  WEBSITE_DIR : sgraph_ai_website/v0/v0.2/v0.2.0   # the active IFD source line
  SITE_NAME   : sgraph-ai
  PACKAGE_NAME: sgraph_ai_website
```

### CloudFront distribution selection (note for multi-env)

```bash
if [ "$DEPLOY_ENV" == "qa" ]; then
  CF_ARGS="--cloudfront-distribution-id ${{ secrets.WEBSITE_CF_DIST_QA }}"
else
  CF_ARGS="--cloudfront-distribution-id ${{ secrets.WEBSITE_CF_DIST }} ${{ secrets.WEBSITE_CF_DIST_MAIN }}"
fi
```

> **Known issue (CR-03):** for any non-qa env this invalidates *both* `WEBSITE_CF_DIST`
> and `WEBSITE_CF_DIST_MAIN`, so a dev push flushes main's cache. When you add an
> environment, give it its own distribution secret and select per-env like qa does.

---

## 3. Required secrets & GitHub environments

Configured under **Settings → Secrets and variables → Actions**, and three
GitHub **Environments** (`dev`, `main`, `prod`; qa uses repo secrets):

| Secret | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS creds for S3 + CloudFront |
| `AWS_ACCOUNT_ID` / `AWS_DEFAULT_REGION` | account + region (used in bucket name + invalidation) |
| `WEBSITE_CF_DIST` | CloudFront dist (prod) |
| `WEBSITE_CF_DIST_MAIN` | CloudFront dist (main/stage) |
| `WEBSITE_CF_DIST_QA` | CloudFront dist (qa) |

> **None of these is a vault key.** The vault read keys are public and live in the
> repo; vault *write* keys are never in CI — content publishing is decoupled from
> code deploy (that's the whole model). The only secrets CI needs are AWS +
> CloudFront.

> **Hardening backlog (CR-03):** the external `OSBot-GitHub-Actions` actions are
> pinned to the mutable `@dev` branch and run with `secrets: inherit`; the PROD
> dispatcher passes `git_branch: 'main'` but the base `checkout` has no `ref:`, so
> a PROD dispatch deploys whatever ref it runs on. Pin actions to SHAs, add
> `ref: ${{ inputs.git_branch }}`, and add least-privilege `permissions:` blocks
> before treating prod as locked-down. Migrate to OIDC instead of static keys.

---

## 4. IFD versioning & the S3 overlay (how files actually land)

**IFD** = the versioned source tree under `sgraph_ai_website/v0/v0.2/v0.2.0/…`.
`deploy_static_site.py` does two syncs per deploy:

```
1. sync WEBSITE_DIR → s3://{bucket}/websites/sgraph-ai/{env}/releases/{version}/
      an immutable snapshot of this release
2. overlay the same files onto
      s3://{bucket}/websites/sgraph-ai/{env}/latest/
      a union: new/patched files added or overwritten; untouched files persist
```

`{bucket}` is derived from account + region
(`{account}--static-sgraph-ai--{region}` per the deploy script). CloudFront serves
from `latest/`.

Consequences:
- **Rollback** = re-sync an earlier `releases/{version}/` onto `latest/`.
- **Stale-file cleanup** is a deliberate, manual step (typically at a major
  bump) — the overlay does not delete files removed from source.
- **Version bumps:** dev push → minor, main push → major. (These inflate fast and
  carry little semantic meaning — noted in the review; cosmetic.)

After both syncs, CloudFront is invalidated (`/*`) and a smoke test curls
`smoke_url`.

> **Cache-Control (CR-07):** the deploy script currently uploads everything as
> `no-store` (a dev-phase setting that contradicts the README's tiered policy), so
> CloudFront caches nothing and the `/*` invalidation is redundant. Restore the
> tiered policy (HTML 300s / CSS+JS 1d / fonts+images 7d) for production scale.

---

## 5. The deploy scripts (`sgraph_ai_website__deploy/`)

| Script | Role |
|---|---|
| `deploy_static_site.py` | The core: validate files → (i18n, currently paused) → `s3 sync` releases/ + overlay latest/ → CloudFront invalidate → smoke test |
| `generate_static_api.py` | Emits `manifest.json` + static API JSON (versions, env, commit) consumed by the shells' footer + the dev CI view |
| `generate_i18n_pages.py` | Pre-renders 16 non-English locales from `en-gb/` + `i18n/*.json` (**paused** — translations target the old v0.1 routes) |
| `generate_sitemap.py` | Builds `sitemap.xml` (**stale + uncalled** — hardcodes v0.1 routes; update or delete before relying on it) |
| `store_ci_artifacts.py` | Uploads git-diff + commit metadata to S3 (note: depth-1 checkout makes the diff empty today — CR-04) |
| `website__run-locally.sh` | Replicates the IFD overlay locally and serves on `:10060` for local dev |

### Local dev

```bash
bash sgraph_ai_website__deploy/website__run-locally.sh
# serves the overlaid site at http://localhost:10060/
```

---

## 6. Testing in CI — current gap

All five workflows go **straight from push to deploy with no gating test**
(CR-04). `tests/edge-render/run-local.mjs` and `tests/e2e/qa-vault-content.spec.js`
exist but are wired into nothing, and the post-deploy smoke test only *warns* on
failure (it can't go red).

**When you scale, add a gating job before `deploy`:** run the edge-render harness
per manifest route, and a portable Playwright pass against the freshly deployed
qa URL. This is the single highest-value pipeline improvement and is cheap to add
to the reusable base workflow (so every site benefits at once).

---

## 7. What a new site adds to CI: *nothing*

This is the scaling headline. A new vault-backed sub-site is just more files under
`WEBSITE_DIR`:

- a shell `en-gb/<site>/index.html`,
- (optional) a static `nav.json` or board JSON,
- (optional) edge manifests under `core/edge-render/v1/manifests/`.

The existing pipeline picks them up on the next push. The only out-of-band steps
are **CloudFront routing** (the viewer-request function's SPA rewrite + any
`*_REAL_PAGES` allowlist) and, if you want machine-readable output, the `AREAS`
entry in the orchestrator. Both are covered in the playbook (doc 05).
