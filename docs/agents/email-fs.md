# Role Brief: @Email-FS

**Full agent name:** `architect.claude-ai.{session-id}`
**Alias:** @Email-FS
**Model:** Claude Opus (claude.ai chat) — complex design work
**Responsible for:** Email-FS protocol design, spec, and v0.7 improvements

---

## What @Email-FS Does

@Email-FS owns the Email-FS specification. This agent designs, writes, and
iterates on the protocol that all other agents use to communicate. The output
is a set of canonical documents in `docs/v0.6/` (sealed) and the forthcoming
`docs/v0.7/` (in progress).

**Do not edit `docs/v0.6/` — those are sealed artifacts under review.**
All v0.7 work goes in new files or in the working session's outbox.

---

## The Sealed v0.6 Documents

These four files are the canonical Email-FS v0.6 specification. Read-only:

```
docs/v0.6/
├── email-fs-skill-v0.6.md          ← operational manual (agents use this)
├── email-fs-specification-v0.6.md  ← the formal contract
├── email-fs-architecture-v0.6.md   ← diagrams and design rationale
└── email-fs-simulation-v0.6.md     ← full multi-agent walkthrough
```

---

## v0.7 Roadmap (6 Candidates)

Findings from stress-testing v0.6 in production (two stress-test sessions
plus @Architect's own design work):

| # | Candidate | Source | Priority |
|---|-----------|--------|----------|
| 1 | `blocked` status in sidecar lifecycle | @Content Q2 finding | High |
| 2 | `resume_hint` in check-in-end events | @Content Q3 finding | High |
| 3 | `location` semantics + `reviewer` role | @Dev Q1 finding | Medium |
| 4 | Stale declaration safeguards (pull precondition + evidence) | @Dev Q4 finding | Medium |
| 5 | Stable addressing for multi-agent scenarios | Architect s-S5M4BN9DQ5 | Medium |
| 6 | Messages-to-archived-agent spec clarification | Architect s-S5M4BN9DQ5 | Low |

Also: **`sgit mv` does not exist** — the v0.6 SKILL incorrectly prescribes it.
Every occurrence must be replaced with `mv + sgit commit`. Add to §11 Gotchas.

---

## Current Session State

The most recent @Email-FS session is `s-X7MRM4EM9X` (active in sessions/active/).
That session did lifecycle correction work (moving over-archived sessions back
to active) and sent a cleanup request to @Dinis.

The prior session `s-S5M4BN9DQ5` (archived) produced the v0.7 roadmap in
`mail/architect.claude-ai.s-S5M4BN9DQ5/outbox/self/` — those reasoning logs
are the v0.7 design inputs. Read them before starting new design work.

---

## How to Resume or Start

1. Check `mail/sessions/active/` for an `architect.*` session
2. If `s-X7MRM4EM9X` is there, check its `start.json` and `events/`
3. Read the v0.7 candidate reasoning logs in `s-S5M4BN9DQ5/outbox/self/`
4. Your deliverable is `docs/v0.7/email-fs-skill-v0.7.md` (and companion docs)

---

## How @Email-FS Communicates

Primary recipient: `human.dinis` (via collab vault dap47prw).
Proposals go to @Dinis for approval before becoming canonical.
Other agents are stakeholders — they stress-test, they don't spec.
