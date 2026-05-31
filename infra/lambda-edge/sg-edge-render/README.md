# sg-edge-render — Lambda@Edge bootstrap

Serves LLM/API representations of the site (`/llms.txt` now; `*.md`, `*.llm.json`
next) by decrypting content from the Content Vault at the edge.

## Architecture (three layers)

| Layer | What | Where | Changes |
|-------|------|-------|---------|
| 1. Bootstrap | `index.mjs` (this dir) — intercept + load orchestrator | Lambda@Edge | almost never |
| 2. Orchestrator | `sg-edge-render.mjs` — resolve vault, run renderer | shipped on site at `/core/edge-render/v1/` | @Dev, via CI |
| 3. Manifests + content | `manifests/*.json` + the encrypted vault | site + Content Vault | @Dev / @Content |

The bootstrap loads the orchestrator from the **same host as the request**
(`https://<host>/core/edge-render/v1/sg-edge-render.mjs`). One Lambda version is
attached to all four distributions; each environment runs its own branch's code.

## Why same-origin load (no hash pin)

The orchestrator is fetched from the same CloudFront origin already serving the
site — same trust boundary as the site serving its own `<script>` tags. No
third-party code, so no per-environment hash to maintain. (Defense-in-depth, if
ever wanted, belongs in the orchestrator verifying vault content hashes — not
here.)

## Deploy

Lambda@Edge has constraints: **us-east-1 only**, **no environment variables**,
attached by **versioned ARN**.

1. Package and publish (Node 20 runtime, handler `index.handler`):
   ```sh
   cd infra/lambda-edge/sg-edge-render
   zip -r function.zip index.mjs
   aws lambda create-function \
     --function-name sg-edge-render \
     --runtime nodejs20.x --handler index.handler \
     --role <edge-exec-role-arn> \
     --zip-file fileb://function.zip --region us-east-1
   aws lambda publish-version --function-name sg-edge-render --region us-east-1
   ```
   The execution role needs the `edgelambda.amazonaws.com` trust policy.

2. Attach the **published version ARN** to each of the four distributions
   (qa / dev / main / sgraph.ai) as an **origin-request** trigger. Either:
   - a single default behavior, or
   - dedicated behaviors with path patterns `/llms.txt`, `*.md`, `*.llm.json`
     (preferred — scopes the Lambda to exactly the intercepted paths).

3. Caching: responses set `Cache-Control: public, max-age=60` (near-live). Ensure
   the cache policy forwards the `Host` header and honors origin Cache-Control.

## Intercepted paths

`/llms.txt`, `*.md`, `*.llm.json`. Everything else passes straight through to the
SPA/S3 origin. The orchestrator (`.mjs`) and manifests (`.json`) are **not**
intercepted, so the bootstrap's own fetch for them resolves normally (no loop).

## Local test (no AWS needed)

```sh
node tests/edge-render/run-local.mjs /llms.txt qa.sgraph.ai
```

Loads the real orchestrator + manifest and renders against the live vault. Exits
non-zero on failure (also guards the 1 MB body limit), so it doubles as a smoke
check.

## Limits

Lambda@Edge generated responses cap at **1 MB** — fine for `/llms.txt` and
per-page `.md`. If a future `llms-full.txt` approaches it, split per-section.
