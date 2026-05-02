# Welcome to the sgraph.ai Multi-Agent Project

You are joining an active multi-agent collaboration. This file is your entry
point. Read it fully before touching anything else.

---

## Step 1 — What This Vault Is

This is **dap47prw** — the primary collaboration vault for the sgraph.ai
website project. It contains:

- The Email-FS protocol spec and skill (how agents communicate)
- The operating model (who does what)
- Agent mailboxes (your inbox is here)
- Session records (history of what has been done)
- Project documentation

This vault is shared. Other agents are working here simultaneously. Always
`sgit pull` before you do anything, and always `sgit push` after.

---

## Step 2 — Install the CLI

```bash
pip install sgit-ai --break-system-packages
```

Then clone this vault if you haven't already:

```bash
sgit clone 5623t3c2vol5jyhpdb5lafk0:dap47prw
cd dap47prw
```

---

## Step 3 — Read These Four Files (in order)

```
1. _claude/CLAUDE.md                    ← this file
2. docs/v0.6/email-fs-skill-v0.6.md    ← how to send/receive/process mail
3. docs/OPERATING_MODEL.md              ← who the agents are, current tasks
4. docs/agents/{your-role}.md           ← your specific role brief
```

Do not skip step 2. The Email-FS skill is your operational manual — it tells
you how to check your inbox, send messages, manage your session, and commit
correctly. Every agent follows it.

---

## Step 4 — Identify Your Role

| You are being asked to act as... | Read this file |
|----------------------------------|---------------|
| @Content (content strategy, vault authoring) | `docs/agents/content.md` |
| @Dev (website code, PRs, QA) | `docs/agents/dev.md` |
| @Dinis (human project lead, coordinator) | `docs/agents/dinis.md` |
| @Email-FS (protocol design, spec) | `docs/agents/email-fs.md` |
| New / unsure | Read `docs/OPERATING_MODEL.md` first |

---

## Step 5 — Check Your Inbox

After reading your role brief, follow the Email-FS check-in loop:

```bash
sgit pull
ls mail/mailroom/{your-agent-name}/       # any mail waiting?
# DELIVER: mv mail waiting in mailroom → your inbox
# READ: cat your inbox messages
# then act on them
```

Your agent name format: `{role}.{location}.{session-id}`
Example: `conductor.claude-ai.s-C9CW3ZSTXR`

If you are starting a fresh session (new brief, not resuming existing work):
- Generate a session-id (any 10-char alphanumeric string)
- Write `mail/sessions/active/{session-id}/start.json`
- Write your first reasoning log to `mail/{your-agent-name}/outbox/self/`

If you are resuming an existing session:
- Check `mail/sessions/active/` for a session matching your brief
- Read its `start.json` and `events/` to reconstruct context

---

## Step 6 — Key Facts

**Push token:** `graphs-and-maps`
```bash
sgit --token "graphs-and-maps" push
# or for prod server:
sgit --base-url https://send.sgraph.ai --token "graphs-and-maps" push
```

**sgit does NOT upload hidden files/dirs** (anything starting with `.`).
Use plain folder names. This `_claude/` folder uses underscore, not dot.

**`sgit mv` does not exist.** Use OS `mv` followed by `sgit commit`.

**The vault key** for this vault is `5623t3c2vol5jyhpdb5lafk0:dap47prw`
(passphrase:vault_id format). Keep this private.

**Other vaults in this project:**

| Vault | Key | Purpose | Who has write |
|-------|-----|---------|--------------|
| dap47prw | `5623t3c2vol5jyhpdb5lafk0:dap47prw` | Primary collab vault (this one) | All agents |
| mist-drip-9145 | `mist-drip-9145` | sgraph.ai dev team comms | All agents |
| form-form-3988 | `form-form-3988` | Website public content | @Content only |

---

## Step 7 — Current Project State

The sgraph.ai website is at `dev.sgraph.ai`. Active work:

- `/en-gb/dev/` — agent workflow docs, vault-rendered content ← in progress
- `/en-gb/library/` — tech dependencies + knowledge base ← in progress  
- `/en-gb/dev/vault-explainer/` — how the content vault works ← just tasked
- Email-FS v0.7 — protocol improvements ← design phase

See `docs/OPERATING_MODEL.md` for current task status per agent.

---

## What Not To Do

- Do not edit `docs/v0.6/` — those documents are sealed. The spec is under
  review; propose changes via email to @Email-FS or @Dinis.
- Do not write into another agent's `inbox/` or `processed/` directly.
  Use the `mail/mailroom/{recipient}/` delivery pattern.
- Do not edit sessions in `mail/sessions/archived/` — they are immutable.
- Do not push without pulling first.

---

*Last updated: 02 May 2026*
*Maintained by: @Content (conductor.claude-ai.s-C9CW3ZSTXR)*
