---
title: "Design Thread — Three-Layer Interactive Loading UX for sg-article-viewer"
author: "@Dev (dev.sgraph, Claude Sonnet 4.6)"
date: 2026-06-01
status: DESIGN — not yet started
audience: @Dev, @UX, architects
related:
  - docs/architecture__edge-render-resolution.md (vault resolution mechanics)
  - docs/guide__llm-api-access.md (what the browser-side vault client resolves)
---

# Design Thread — Three-Layer Interactive Loading UX

## The Problem

The `sg-article-viewer` component currently shows a plain "Loading..." state while it resolves vault content client-side. The resolution process involves multiple network round-trips (ref → commit → tree walk → blob), AES-256-GCM decryption, and markdown parsing. None of this is visible to the user or debuggable by @QA without browser devtools.

The loading state is also terminal — once it disappears, there is no way to inspect what was loaded, from which vault commit, or how long each step took.

---

## The Mental Model

Three layers, three audiences:

- **Layer 1** — every user, every load. Tells them it's working. Gets out of the way.
- **Layer 2** — curious users and developers. "What just happened?" Opened intentionally.
- **Layer 3** — power users, @QA, agents. Full cryptographic provenance. Created on demand.

Layers 2 and 3 are never shown automatically — they are pulled, not pushed.

---

## Layer 1 — The Loading State

**Behaviour:** Visible only while content is loading. Disappears the moment content renders. After that, a small reopener indicator persists in the corner (fades in on hover, or always visible as a subtle icon).

**States:**
1. `resolving` — fetching HEAD ref and walking tree
2. `decrypting` — reading and decrypting blob
3. `rendering` — parsing markdown, building DOM
4. `done` — content visible, Layer 1 gone

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│                                                     │
│              sgraph.ai                              │
│                                                     │
│         ████████████░░░░░░░░░░  62%                 │
│         Decrypting content...                       │
│                                                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The bar fills across three phases:
- 0–30% → resolving (ref → commit → tree walk)
- 30–80% → decrypting (blob fetch + AES-GCM)
- 80–100% → rendering (markdown parse + DOM)

The label updates with each phase. No spinner — a deterministic bar that actually reflects real progress is more trustworthy than an indeterminate animation.

**After load — the reopener:**

```
                                          ⬡ loaded in 1.2s  ↗
```

Small, right-aligned, subtle. `↗` opens Layer 2. Fades to near-invisible after 5s but reappears on hover. Never disappears completely.

---

## Layer 2 — The Summary Panel

**Behaviour:** Slides in from the right (or appears as a bottom sheet on mobile) when the user clicks the reopener. Shows a recorded snapshot of the load — the steps, timing, and outcome. Does not re-fetch anything. Has a "Full trace →" link that opens Layer 3.

```
┌─────────────────────────────────────────┐
│  Content load summary              ✕   │
├─────────────────────────────────────────┤
│  vault      pmcv9tfe                   │
│  commit     0c7206cad899               │
│  loaded     2026-06-01 14:23:41 UTC    │
│  total time 1,241 ms                   │
├─────────────────────────────────────────┤
│  STEP            TIME      SIZE        │
│  ─────────────── ────────  ──────      │
│  HEAD ref        88 ms                 │
│  commit object   112 ms                │
│  tree walk       203 ms    4 hops      │
│  blob fetch      441 ms    18.4 KB     │
│  decrypt         14 ms                 │
│  markdown parse  383 ms                │
├─────────────────────────────────────────┤
│  ✓ No decryption errors                │
│  ✓ commit matches expected HEAD        │
│                                        │
│               Full trace →            │
└─────────────────────────────────────────┘
```

The panel is informational, not interactive beyond "close" and "open Layer 3". The commit ID is a link — clicking it opens the Layer 3 view scoped to that commit object.

---

## Layer 3 — The Full Trace

**Behaviour:** Created on demand when the user clicks "Full trace →". This is a new view (modal overlay or separate panel), built from the recorded trace data. Never shown automatically. Expensive to render (visualizations) but only built when asked.

```
┌──────────────────────────────────────────────────────────────────┐
│  Full request trace                                         ✕    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TIMELINE                                                        │
│                                                                  │
│  0ms      100       200       400       800      1200      1241  │
│  ├──────────────────────────────────────────────────────────┤   │
│  [HEAD ref  ██]                                                  │
│            [commit  ████]                                        │
│                    [tree walk  ████████]                         │
│                               [blob fetch  ████████████████]    │
│                                                       [dec ▌]   │
│                                                        [md █████]│
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  OBJECTS                                                         │
│                                                                  │
│  ref       HEAD → obj-cas-imm-0c7206cad899        [view ↗]      │
│  commit    obj-cas-imm-0c7206cad899               [view ↗]      │
│            author: @Content · 2026-05-31T21:35:57Z              │
│  tree      obj-cas-imm-a4f91c223de1               [view ↗]      │
│            4 entries / 3 hops to target                         │
│  blob      obj-cas-imm-f826911d9c9f   18,432 bytes [view ↗]     │
│            AES-256-GCM · tag verified ✓                         │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  RAW RESPONSES                             [expand all ↕]        │
│                                                                  │
│  ▶ HEAD ref response                                            │
│  ▶ commit object response                                        │
│  ▶ tree object response (hop 1 of 3)                            │
│  ▶ tree object response (hop 2 of 3)                            │
│  ▶ tree object response (hop 3 of 3)                            │
│  ▶ blob object response                                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Each `[view ↗]` opens a raw JSON/text panel inline — the actual SG/Send response body. The timeline is rendered as a simple CSS bar chart (no canvas needed). Raw responses are collapsed by default.

---

## Data Collection Architecture

The key design constraint: **all data must be collected during the real load**. Layers 2 and 3 render from a recorded trace, not from re-fetches.

### The Trace Object

Collected inside the vault resolution flow and held in component state:

```javascript
{
  vault_id:    string,          // e.g. "pmcv9tfe"
  commit_id:   string,          // e.g. "obj-cas-imm-0c7206cad899"
  resolved_at: string,          // ISO timestamp
  total_ms:    number,
  steps: [
    {
      name:       string,       // 'head-ref' | 'commit' | 'tree-walk' | 'blob' | 'decrypt' | 'parse'
      start_ms:   number,       // relative to load start
      end_ms:     number,
      size_bytes: number?,      // for network steps
      hops:       number?,      // for tree-walk
      error:      string?,
    }
  ],
  objects: [
    {
      role:  string,            // 'ref' | 'commit' | 'tree' | 'blob'
      id:    string,
      raw:   string | object?,  // only populated if full capture is enabled
    }
  ],
  errors:  string[],
  status:  string,              // 'ok' | 'decrypt-failed' | 'not-found' | 'error'
}
```

### Capture Modes

| Mode | What's captured | When |
|---|---|---|
| **Lightweight** | steps[] timings, final commit/vault IDs, error status | Always |
| **Full** | + objects[].raw (actual response bodies) | Opt-in |

Opt-in mechanism: a `localStorage` flag set the first time a user opens Layer 2. First load is always lightweight. Subsequent loads capture raw responses so Layer 3 has data to show. Alternatively, always-on (small overhead, simpler logic).

---

## Component Structure

```
<sg-article-viewer>
  ├── <sg-load-layer1>              visible during load only
  │     ├── progress bar
  │     └── phase label
  │
  ├── <article-content>             the rendered article
  │
  └── <sg-load-reopener>           persistent after load
        ├── "loaded in Xs" label
        └── ↗ trigger
              │
              └── <sg-load-layer2>   panel (created on first open)
                    ├── step table
                    ├── status badges
                    └── "Full trace →" trigger
                          │
                          └── <sg-load-layer3>  (created on demand)
                                ├── timeline chart (CSS bars)
                                ├── object list + [view ↗] expanders
                                └── raw response expanders
```

Layers 2 and 3 are created lazily — not in the DOM until first opened. Layer 3 is re-created each time it is opened (lightweight, since it renders from in-memory trace data). No network calls after the initial page load.

---

## Interaction Flow

```
Page load starts
  → Layer 1 appears (bar at 0%)
  → vault resolution begins, steps fire events into trace recorder
  → bar advances through phases as steps complete
  → content renders
  → Layer 1 fades out (200ms ease)
  → reopener fades in at top-right corner
  → after 5s, reopener fades to 15% opacity

User hovers reopener corner
  → reopener fades to 100%

User clicks ↗
  → Layer 2 slides in from right (bottom sheet on mobile)
  → renders recorded trace data — no network

User clicks "Full trace →"
  → Layer 3 modal builds from in-memory trace
  → timeline renders as CSS bar chart
  → object rows visible, raw responses collapsed

User clicks [view ↗] on any object
  → inline panel expands below that row
  → shows raw JSON or text

User closes Layer 3
  → Layer 2 still open

User closes Layer 2
  → returns to article
  → reopener remains
```

---

## Implementation Sequence

```
Phase 1 — Trace recording
  • Add trace recorder callback interface to vault resolution flow
  • Instrument each step (head-ref, commit, tree-walk, blob, decrypt, parse)
  • Hold trace in sg-article-viewer state after load completes

Phase 2 — Layer 1 (progress bar)
  • Replace "Loading..." with deterministic phase bar
  • Wire to trace recorder events for real-time progress
  • Fade out on load complete, show reopener

Phase 3 — Layer 2 (summary panel)
  • Build panel component from recorded trace
  • Step table, status badges, timing summary
  • "Full trace →" button (disabled if full capture not enabled)

Phase 4 — Layer 3 (full trace)
  • Timeline CSS bar chart from steps[]
  • Object list with inline raw expanders
  • Enable full capture mode via localStorage
```

---

## Open Questions

1. **Full capture mode**: always-on (simpler, small overhead) vs. opt-in via localStorage (first load lightweight)? Default recommendation: always-on — raw responses are small and it avoids a "no data yet" state on first Layer 3 open.

2. **Layer 2 position**: right-side panel (desktop) + bottom sheet (mobile) is the cleanest split. Alternatively a popover anchored to the reopener — simpler to implement, slightly worse for scan-ability.

3. **Layer 3 in-page vs. new tab**: modal overlay keeps reading context; new tab is better for side-by-side debugging. Recommendation: modal with an "open in new tab" button in the Layer 3 toolbar.

4. **Trace recorder interface**: the vault resolution code needs to emit timing events (or accept a recorder callback) as each step completes. This is the main implementation dependency — the trace object must be wired into the existing resolution flow before any of the UI layers can display real data.
