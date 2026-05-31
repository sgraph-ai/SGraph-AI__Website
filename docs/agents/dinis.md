# Role Brief: @Dinis

**Agent name:** `human.dinis`
**Type:** Human project lead
**Model:** Any — typically using the Haiku mail reader for inbox management
**Responsible for:** Project direction, unblocking agents, final decisions

---

## What @Dinis Does

@Dinis is the human driving the project. Unlike the AI agents, @Dinis does not
follow the session lifecycle (no `start.json` / `end.json` required). @Dinis
reads mail, makes decisions, and communicates those decisions back to agents
via Email-FS.

@Dinis interacts with the vault primarily through a dedicated **Haiku mail
reader session** — a lightweight Claude session whose only job is to deliver
and display incoming mail so @Dinis can respond.

---

## The Mail Reader Pattern

To check email, start a new Claude session (Haiku model — cheapest, sufficient)
with this prompt:

```
You are an Email-FS mail reader for `human.dinis`.

Setup:
  pip install sgit-ai --break-system-packages
  sgit clone 5623t3c2vol5jyhpdb5lafk0:dap47prw
  sgit clone mist-drip-9145

Read: dap47prw/docs/v0.6/email-fs-skill-v0.6.md

Check mailrooms:
  ls dap47prw/mail/mailroom/human.dinis/
  ls mist-drip-9145/mail/mailroom/human.dinis/   (if exists)

For each message: show From / Subject / Body, then ask: Deliver, Skip, or Done?

Deliver = mv from mailroom to mail/human.dinis/inbox/ + create state core.json
Process = mv inbox → processed, update core.json
Done = sgit commit + ask before pushing

Never write into any other agent's folder.
Never touch mail/sessions/archived/.
Use OS mv (not sgit mv — it doesn't exist).
Push token: graphs-and-maps
Use --base-url https://send.sgraph.ai
```

---

## How @Dinis Sends Mail

@Dinis sends messages by writing `.eml` files into the agent mailrooms.
The mail reader session can do this on @Dinis's behalf, or @Dinis can
dictate the content and the mail reader writes it.

The message goes to `mail/mailroom/{recipient}/` in the relevant vault.

---

## Decision Authority

@Dinis makes final calls on:
- Architecture decisions (which approach to take when agents disagree)
- Voice/content direction (what the site says)
- Scope decisions (what to build, what to defer)
- Access decisions (who gets write keys to what)

Agents should escalate to @Dinis when they hit a decision requiring human
judgment, by sending mail with `X-EmailFS-Priority: high`.

---

## Current Inbox State

As of 02 May 2026, `human.dinis` inbox in dap47prw contains messages from:
- @Architect (Email-FS v0.6 delivery + v0.7 roadmap)
- @Content (status updates, Q2/Q3 findings, library nav live)
- @Dev (QA status, technical findings)

These are all in `mail/human.dinis/inbox/` — delivered but likely unprocessed.
The mail reader session can display them on next check.

---

## Key Decisions Already Made

These do not need re-litigating:

| Decision | What was decided |
|----------|-----------------|
| Library nav voice | Third person (official tech docs style) |
| Screenshots | @Content writes placeholders, @Dev provides Playwright shots |
| Library v1 scope | "How It Works" articles only — no "Meet @Agent" |
| Library future | Will migrate to `library.sgraph.ai` eventually |
| /dev/ page | Hidden (no nav entry) until testing complete |
| Nav refactor | `Use Cases · Technology · Library · Investor · Pricing` (locked) |
| Content vault | @Content has write key, read-key is public/embeddable |
| sg-library-nav | Needed but deferred — inline JS is fine for now |

---

## Vaults @Dinis Should Know About

| Vault | Purpose | Access |
|-------|---------|--------|
| `dap47prw` | Primary collab, Email-FS | Clone with `5623t3c2vol5jyhpdb5lafk0:dap47prw` |
| `mist-drip-9145` | Website dev team comms, issues files | Clone with `mist-drip-9145` |
| `form-form-3988` | Public website content | Clone with `form-form-3988` (write); read-key is `s68J93Gx5pzmP4FGo682Ns3JQ0aKdtSVKCjQKtSS_GA` |

The push token for all three is `graphs-and-maps`.
