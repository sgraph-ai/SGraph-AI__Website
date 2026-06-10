# Dev Dashboard Board System — Technical Implementation Spec

**Author:** @Dev (Fable 5)  
**Date:** 2026-06-09  
**Status:** Live — boards are rendered at `dev.sgraph.ai/en-gb/dev/`

This document is a complete technical reference for the board/kanban system in
the `/en-gb/dev/` sub-site. It describes every schema, the full rendering
pipeline, and a step-by-step guide for creating a new board — either stored in
an encrypted vault or as a static JSON file in the repo.

---

## 1. Architecture overview

```
nav.json ──► sg-side-nav ──► nav:select event
                              │
                              ├─ render: "json" + content_object_id: "obj-cas-imm-..." 
                              │    → showJsonBoard() → vault-client fetch + AES-GCM decrypt
                              │
                              ├─ render: "json" + content_object_id: "/path/to/file.json"
                              │    → showJsonBoard() → plain fetch (no encryption)
                              │
                              └─ (other render values → showArticle / showCiView)
                                      │
                              renderJsonBoard(data, schema)
                              ├─ project-workstreams-v2 → renderWorkstreamsKanban()
                              │    + wireKanban() (click → renderWorkstreamDetail())
                              ├─ project-issues-v1      → card list
                              ├─ project-agents-v2      → card list
                              ├─ project-releases-v1    → version group list
                              └─ (generic fallback)     → card list from first array key
```

All board data is loaded and rendered **client-side** in `en-gb/dev/index.html`.
The rendering code lives entirely in the inline `<script type="module">` of that
file, roughly lines 212–599.

---

## 2. nav.json — how to register a board

Boards are registered as nav articles in `sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/dev/nav.json`.

### Fields

| Field | Required | Description |
|---|---|---|
| `title` | yes | Display name in sidebar and breadcrumbs |
| `slug` | yes | URL segment: the board appears at `/en-gb/dev/{slug}/` |
| `render` | yes | Must be `"json"` to trigger `showJsonBoard` |
| `schema` | yes | Tells `renderJsonBoard` which renderer to use (see §3) |
| `content_object_id` | yes | Either a vault blob ID (`obj-cas-imm-…`) **or** a root-relative path (`/en-gb/dev/boards/foo.json`) |
| `vault_id` | if encrypted | Vault containing the blob (omit for static path) |
| `read_key` | if encrypted | Base64url AES-256-GCM read key (omit for static path) |
| `description` | no | One-line description shown in landing card grid |

### Encrypted vault board

```json
{
  "title": "Workstreams & Tasks",
  "slug": "workstreams",
  "content_object_id": "obj-cas-imm-0def4605d6d4",
  "vault_id": "1lfehfjh",
  "read_key": "gYfzgJ5mlhn4pMgSdGcB1oASjETpPB7jVhaF0QQ3uUs",
  "render": "json",
  "schema": "project-workstreams-v2",
  "description": "All active workstreams and their tasks."
}
```

### Static (repo-stored) board

If the board data doesn't need encryption, set `content_object_id` to a
root-relative path. The shell detects the leading `/` and skips the vault client:

```json
{
  "title": "Code Review Items",
  "slug": "code-review",
  "content_object_id": "/en-gb/dev/boards/code-review.json",
  "render": "json",
  "schema": "project-workstreams-v2",
  "description": "10 items from the 2026-06-09 code review."
}
```

The corresponding file lives at:
`sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/dev/boards/code-review.json`

---

## 3. Board schemas

### 3.1 `project-workstreams-v2` (Kanban — recommended for task tracking)

The most powerful schema. Renders a four-column Kanban board. Clicking a
workstream card drills into its tasks (two-level navigation, implemented in
`wireKanban`/`renderWorkstreamDetail`).

**Top-level structure:**
```json
{
  "schema": "project-workstreams-v2",
  "title": "Optional board title",
  "description": "Optional board description",
  "workstreams": [...]
}
```

**Workstream object:**
```json
{
  "id": "WS-01",
  "title": "Human-readable workstream name",
  "description": "One or two sentences shown under the title in drill-down.",
  "color": "#6366f1",
  "status": "in-progress",
  "tasks": [
    {
      "id": "WS-01a",
      "title": "What needs to be done",
      "status": "done",
      "owner": "@Dev",
      "description": "Optional longer description shown as a sub-line."
    }
  ]
}
```

**Workstream `status` values:**

| Value | Column | Badge color |
|---|---|---|
| `queued` | Queued | `#94a3b8` (slate) |
| `next` | Up Next | `#f59e0b` (amber) |
| `in-progress` | In Progress | `#3b82f6` (blue) |
| `done` | Done | `#22c55e` (green) |

**Status auto-derivation:** if `status` is omitted from a workstream, it is derived
from task statuses: all done → `done`; any in-progress → `in-progress`; any next →
`next`; otherwise → `queued`. Explicit `status` always wins.

**Progress bar:** computed from `done / total` tasks (shown as a coloured thin bar
in the workstream card). Drill-down shows all tasks grouped by their own status
column.

**Color:** any CSS color string. Used for the left border stripe on cards, progress
bar fill, workstream dot, and drill-down heading. Choose one per workstream area
for visual grouping. Common palette:
- `#ef4444` red — security / blocking
- `#f59e0b` amber — high priority
- `#6366f1` indigo — architecture
- `#3b82f6` blue — infrastructure
- `#22c55e` green — done / shipped
- `#6b7280` gray — housekeeping

---

### 3.2 `project-issues-v1` (flat issue list)

Simple flat list of issue cards. No kanban columns; no drill-down.

```json
{
  "schema": "project-issues-v1",
  "issues": [
    {
      "id": "ISSUE-007",
      "title": "SPA blank for deep nav nodes",
      "status": "resolved",
      "priority": "high",
      "owner": "@Dev",
      "description": "Optional detail line."
    }
  ]
}
```

Status values (badge colored): `open`, `in-progress`, `resolved`, `blocked`.  
Priority values: `high`, `medium`, `low`.

---

### 3.3 `project-agents-v2` (agent roster)

```json
{
  "schema": "project-agents-v2",
  "agents": [
    {
      "alias": "@Dev",
      "id": "dev.sgraph",
      "session_status": "active",
      "model": "Claude Sonnet",
      "role": "Website code, PRs, QA",
      "location": "sgraph-ai/SGraph-AI__Website"
    }
  ]
}
```

Status values: `active`, `idle`.

---

### 3.4 `project-releases-v1` (release log)

```json
{
  "schema": "project-releases-v1",
  "releases": [
    {
      "version": "v1.2.0",
      "status": "released",
      "date": "2026-06-06",
      "tasks": [
        { "id": "T-42", "title": "library.home curated root", "owner": "@Dev" }
      ],
      "issues": [
        { "id": "ISSUE-007", "title": "SPA blank for deep nav — fixed" }
      ]
    }
  ]
}
```

---

### 3.5 Generic fallback

If `schema` is unknown or omitted, `renderJsonBoard` finds the first top-level
array key in the JSON and renders each item as a card using `title`/`name`/`id` +
`status` badge + `description`. Useful for quick prototyping.

---

## 4. The rendering pipeline (code walkthrough)

### Step 1 — nav:select

When a user clicks a board in the sidebar, `sg-side-nav` fires `nav:select`.  
In `dev/index.html`, the handler checks:

```javascript
if (effectiveRender === 'json') {
  showJsonBoard(content_object_id, vault_id || VAULT_ID, read_key || READ_KEY, schema, title);
}
```

### Step 2 — showJsonBoard (lines ~212–239)

Detects whether `objectId` starts with `/`:
- **Yes → plain fetch:** `fetch(objectId, { cache: 'no-store' })`
- **No → vault client:** `importReadKey` + `readObject` (AES-GCM decrypt)

Either path produces a `text` string which is `JSON.parse`d into `data`.

### Step 3 — renderJsonBoard (lines ~377–471)

Dispatches on `data.schema ?? schema` to one of the five renderers.  
Returns an HTML string — no DOM manipulation yet.

### Step 4 — wireKanban (lines ~585–599)

For `project-workstreams-v*` only. Attaches click listeners to each `[data-ws-id]`
card. Click → `renderWorkstreamDetail(ws)` → back button re-renders the board.

### Status badge helper (line ~384)

```javascript
const badge = s => {
  const color = STATUS_COLORS[s] ?? '#94a3b8';
  return `<span style="...background:${color}22;color:${color};border:1px solid ${color}44">${s}</span>`;
};
```

`STATUS_COLORS` map: `done: #22c55e`, `in-progress: #3b82f6`, `next: #f59e0b`,
`queued: #94a3b8`, `blocked: #ef4444`, `open: #ef4444`, `resolved: #22c55e`,
`released: #22c55e`, `planned: #94a3b8`, `active: #22c55e`, `idle: #94a3b8`.

---

## 5. Creating a new board — step-by-step

### Option A: Static (repo-stored) — no vault access required

1. **Create the JSON file** in
   `sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/dev/boards/{slug}.json`  
   Use any of the schemas from §3. Set `"schema"` at the top level.

2. **Add a nav entry** in `en-gb/dev/nav.json` under the appropriate section:
   ```json
   {
     "title": "My Board",
     "slug": "my-board",
     "content_object_id": "/en-gb/dev/boards/my-board.json",
     "render": "json",
     "schema": "project-workstreams-v2",
     "description": "One-line description."
   }
   ```

3. **Commit and push to `qa`**. The board is live at
   `qa.sgraph.ai/en-gb/dev/my-board/`. No vault keys required.

4. **Update the board** by editing the JSON file and committing. Because the
   file is served with `Cache-Control: no-store` (current deploy config),
   changes are live immediately after the deploy.

### Option B: Encrypted vault — requires vault write access

1. **Write the JSON** to the dev status vault (`1lfehfjh`) using `sgit`:
   ```bash
   # In a clone of vault 1lfehfjh:
   cp my-board.json boards/my-board.json
   sgit commit "add my-board board"
   sgit push
   ```
   Note the object ID from the commit output (e.g. `obj-cas-imm-abc123`).

2. **Add a nav entry** with the object ID and vault credentials:
   ```json
   {
     "title": "My Board",
     "slug": "my-board",
     "content_object_id": "obj-cas-imm-abc123",
     "vault_id": "1lfehfjh",
     "read_key": "<base64url read key>",
     "render": "json",
     "schema": "project-workstreams-v2"
   }
   ```

3. **Commit nav.json** and push to qa.

4. **Update the board** by pushing a new version to the vault and updating
   `content_object_id` in nav.json to the new object ID.  
   Note: because vault objects are content-addressed and immutable, every update
   produces a new object ID and requires a nav.json commit.

### Choosing between A and B

| | Static (Option A) | Encrypted vault (Option B) |
|---|---|---|
| Requires vault write key | No | Yes |
| Update requires code commit | Yes | Yes (nav.json change) + vault push |
| Content is public/readable | Yes (plain JSON on S3) | Yes (for dev vault — public read key) |
| Appropriate for | Project tracking, code review, non-sensitive data | Agent-authored content, same-privacy data |

For most project management boards, **Option A is simpler and equally appropriate**
— the dev vault's read key is committed in the repo anyway, so there is no privacy
difference.

---

## 6. Updating board item statuses

For static boards, edit the JSON and commit:

```json
{ "id": "CR-01a", "title": "Vendor DOMPurify", "status": "done" }
```

Column assignment is automatic: the workstream card moves to the "Done" column once
all its tasks are `done`, or to "In Progress" the moment one becomes `in-progress`.

For day-to-day updates, a typical edit cycle is:
1. Edit `en-gb/dev/boards/{slug}.json` in the repo
2. `git add + git commit + git push origin qa`
3. CI deploys in ~1 min; board updates live

---

## 7. Known limitations and future improvements

- **No in-browser editing:** boards are read-only. Editing requires a git commit.
  A future `json-edit` render mode could support vault-write-key-authenticated
  inline editing via `sgit push`.
- **No escaping in renderJsonBoard:** the `card()` helper and most schema renderers
  use raw string interpolation for `title`/`description` from the JSON. For static
  boards this is safe (you control the data); for vault-sourced boards, add
  `escH()` at every interpolation point (tracked in CR-01 on the code review board).
- **No real-time updates:** boards don't auto-refresh. A `setInterval` or
  `EventSource` connection to a server-sent-events endpoint could push live updates.
- **Schema is self-declared in the JSON:** `data.schema` overrides the nav entry's
  `schema` field. This means a single board file can change its own schema by
  updating its top-level `schema` key.
