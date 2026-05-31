/**
 * sg-edge-render — Lambda@Edge bootstrap (Layer 1)
 *
 * The ENTIRE function. It deliberately knows almost nothing:
 *   1. which request URIs to intercept (INTERCEPT)
 *   2. that it should load + run the orchestrator JS shipped on the SAME site
 *      (RENDER_PATH, resolved against the request Host)
 *
 * Everything else — content, structure, output shaping — lives in the
 * orchestrator (sg-edge-render.mjs) and the JSON manifests, both served from the
 * website and controlled by @Dev / @Content via normal CI. This function should
 * rarely, if ever, need to change.
 *
 * Why Host-derived (not a hardcoded URL): one Lambda version is attached to all
 * four CloudFront distributions (qa / dev / main / sgraph.ai). Each request's
 * Host header selects the right origin, so every environment runs ITS OWN
 * branch's orchestrator + manifests. Test on dev → qa → main → prod through the
 * normal deploy flow; the Lambda is never touched.
 *
 * Trigger: origin-request (fires on cache miss; result is cached by CloudFront).
 * Deploy:  us-east-1, publish a version, attach the version ARN to each
 *          distribution's behavior(s) for /llms.txt (+ *.md, *.llm.json later).
 */

import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const VERSION = 'v0.1.6'
const RENDER_PATH = '/core/edge-render/v1/sg-edge-render.mjs'

// Which requests this function answers. Everything else passes straight through
// to the SPA / S3 origin untouched.
const INTERCEPT = uri =>
  typeof uri === 'string' && (
    uri === '/llms.txt' ||
    uri.endsWith('.md') ||
    uri.endsWith('.llm.json')
  )

// Caching DISABLED for now (dev phase): the orchestrator is re-fetched on every
// invocation so code/manifest changes appear immediately. Re-enable the per-host
// TTL cache (e.g. 60_000ms) once behaviour is stable.
async function loadModule(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`load orchestrator ${url}: ${res.status}`)
  const code = await res.text()
  // Node can't import() an https URL without experimental flags; the orchestrator
  // is self-contained (no internal imports), so write-and-import is safe + simple.
  const file = `/tmp/sg-orch-${createHash('sha256').update(url + code).digest('hex').slice(0, 16)}.mjs`
  writeFileSync(file, code)
  return import(file)
}

export const handler = async (event) => {
  const req = event?.Records?.[0]?.cf?.request
  if (!req || !INTERCEPT(req.uri)) return req ?? event // ← pass through

  // At origin-request, CloudFront rewrites Host to the S3/origin domain.
  // Each distribution's viewer-request function stamps the real public hostname
  // into X-Sg-Site-Host (url-rewrite) or X-Forwarded-Host (vault-publish).
  const host   = req.headers?.['x-sg-site-host']?.[0]?.value
             ?? req.headers?.['x-forwarded-host']?.[0]?.value
             ?? req.headers?.host?.[0]?.value
  const cfVer  = req.headers?.['x-sg-cf-version']?.[0]?.value ?? ''
  if (!host) return req // can't derive orchestrator URL — pass through

  try {
    const mod = await loadModule(`https://${host}${RENDER_PATH}`)
    const out = await mod.render(req.uri, { host })
    return {
      status: '200',
      statusDescription: 'OK',
      headers: {
        'content-type':  [{ key: 'Content-Type',  value: out.content_type }],
        'cache-control': [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }],
        'x-sg-commit':      [{ key: 'X-Sg-Commit',      value: out.commit ?? '' }],
        'x-sg-version':     [{ key: 'X-Sg-Version',     value: VERSION }],
        'x-sg-cf-version':  [{ key: 'X-Sg-Cf-Version',  value: cfVer }],
        'x-sg-site-host':   [{ key: 'X-Sg-Site-Host',   value: host }],
      },
      body: out.body,
    }
  } catch (err) {
    return {
      status: '502',
      statusDescription: 'Bad Gateway',
      headers: {
        'content-type':     [{ key: 'Content-Type',     value: 'text/plain; charset=utf-8' }],
        'x-sg-version':     [{ key: 'X-Sg-Version',     value: VERSION }],
        'x-sg-cf-version':  [{ key: 'X-Sg-Cf-Version',  value: cfVer }],
        'x-sg-site-host':   [{ key: 'X-Sg-Site-Host',   value: host }],
      },
      body: `edge-render failed: ${err.message}\n`,
    }
  }
}
