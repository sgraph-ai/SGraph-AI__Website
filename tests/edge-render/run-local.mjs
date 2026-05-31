/**
 * Local harness for the edge-render orchestrator. Stands in for Lambda@Edge:
 * loads the SAME orchestrator module, feeds it the repo manifest, and renders
 * against the LIVE content vault — so you can review exact output before any
 * CloudFront wiring.
 *
 *   node tests/edge-render/run-local.mjs /llms.txt
 *
 * Exit non-zero on failure so it can double as a CI smoke check.
 */
import { readFileSync } from 'node:fs'
import { render } from '../../sgraph_ai_website/v0/v0.2/v0.2.0/core/edge-render/v1/sg-edge-render.mjs'

const uri  = process.argv[2] ?? '/llms.txt'
const host = process.argv[3] ?? 'qa.sgraph.ai'

const manifestsDir = new URL(
  '../../sgraph_ai_website/v0/v0.2/v0.2.0/core/edge-render/v1/manifests/', import.meta.url)
const readManifest = async name =>
  JSON.parse(readFileSync(new URL(`${name}.json`, manifestsDir), 'utf8'))

try {
  const r = await render(uri, { host, readManifest })
  console.error(
    `[edge-render] ok  uri=${uri}  host=${host}  type=ok  ` +
    `pages=${r.pages ?? '-'}  commit=${r.commit}  ` +
    `content-type="${r.content_type}"  bytes=${Buffer.byteLength(r.body)}`)
  if (Buffer.byteLength(r.body) > 1_000_000) {
    console.error('[edge-render] FAIL: body exceeds Lambda@Edge 1 MB limit')
    process.exit(1)
  }
  process.stdout.write(r.body)
} catch (err) {
  console.error(`[edge-render] FAIL: ${err.message}`)
  process.exit(1)
}
