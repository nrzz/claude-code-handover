# Claude Code handover workflow

Stop paying to reload one giant chat. Work in short sessions, and let every new session start from a small handover file that Claude Code loads by itself.

## What you get

- **HANDOVER.md** in your project: where you stopped and the exact next step, one section per work stream, under 60 lines.
- **CLAUDE.local.md** (personal, not committed) that imports it, so every new session knows where you were before you type anything.
- **`/handover`**, a command that rewrites the handover file at the end of a session.
- **Effort defaults** in your settings so the model stops overthinking small jobs.

## Set up in 3 steps

1. Open Claude Code in your project folder (terminal, desktop app, or VS Code) and start a new session.
2. Open [SETUP-PROMPT.md](SETUP-PROMPT.md), click the copy button on the block, paste it as your message. No edits needed unless your model picker shows something other than Opus and Sonnet.
3. Allow the file and command permissions it asks for. It ends with a checklist and four lines to keep.

To check: open a new session and ask "which memory files loaded?". It should name CLAUDE.local.md and HANDOVER.md. Type `/` and `handover` is in the list.

## Every day

- Morning: new session, type `continue`. The first reply names your next step.
- Same sitting: keep working. When the context bar passes 35%, finish the step you are on and type `/handover`. Hard stop at 50%.
- Break longer than an hour, or next day: start a new session instead of reopening the old one, unless the bar is under 15%.
- End: `/handover`, close the session.

With several streams, say which one: `continue backend`, `/handover backend`.

## Why it works, in five lines

1. Claude Code sends your whole conversation with every request. Reading it from cache is cheap.
2. After a break longer than an hour the cache is gone, and the first message re-writes the whole context at the expensive rate. On a 500K chat that is about $4 on Opus and $10 on Fable, per return.
3. A fresh session costs about $0.55 to start, and the handover file is two thousand tokens.
4. Long chats also get summarised when they fill up, which drops details, so the same files get read again and again.
5. Durable facts already live in Claude's auto memory, ticket status in your tracker, code history in git. The handover file carries the one thing none of them hold: where you were mid-task.

## The numbers behind it

An audit of 19 sessions and 1,840 requests over five weeks (23 Aug to 30 Sep 2026), weighed at API list prices:

| Finding | Number |
| --- | --- |
| Total weight | about $806 |
| Share on the most expensive model | 90% |
| Requests run at effort max | 79% |
| Weight from cache re-writes | 61% |
| Weight from output tokens (half of it thinking) | 22% |
| Full re-writes of a 400K to 700K context | 55 events, 41% of everything |
| ...caused by returning to a chat after more than an hour | 42 events |
| ...caused by switching model mid-chat | 10 events |
| Times the long chats ran out of context and were summarised | 6 |
| Weight per prompt in the long-lived chats | $1.40 to $5.40 |
| Weight per prompt in short single-task chats | $0.60 to $1.00 |

One cold return by context size, at list prices:

| Context | Opus 5.5 | Fable 5.1 |
| --- | --- | --- |
| 15% (150K) | $1.20 | $3.00 |
| 35% (350K) | $2.80 | $7.00 |
| 50% (500K) | $4.00 | $10.00 |
| Fresh session, about 70K | $0.55 | $1.40 |

## Model and effort

Effort `high` is the documented default on most models and `medium` on Opus 5.5 and Sonnet 5.5. The docs warn that `max` "may show diminishing returns and is prone to overthinking".

| Job | Model | Effort |
| --- | --- | --- |
| Summaries, ticket updates, commit messages, small edits, reading terminal output | Sonnet (or your cheapest) | medium |
| Writing code, bug fixes, anything that needs verification or has edge cases | Opus | high |
| Whole-repo audit, security review, long autonomous build with a full brief | Fable if available, else Opus | high |
| A hard problem where high already failed | same model | xhigh, one session |

Pick model and effort once at session start. Never switch model mid-session: each switch re-caches the whole context. The setup writes these defaults into your settings; the rules card it creates in your project repeats this table for your own models.

## What the setup handles on its own

A folder that is not a git repository (rules go in CLAUDE.md), a repository that uses AGENTS.md (the new file imports it so it keeps loading), an existing CLAUDE.local.md or .gitignore (appended, never replaced), an existing HANDOVER.md (kept, only missing sections added), a CLAUDE.local.md that git already tracks (flagged, with the untrack command for you to run), a model list without Sonnet (Haiku does the chores and the rules card names your models), settings that already hold other models or variables (merged at key level, saved per-model efforts brought in line), a settings file that is not valid JSON (left alone and reported), and managed settings that override yours (reported and skipped).

Terminal users: run `/statusline` once so the context percentage is always visible; the desktop app shows it in the composer.

## Audit your own usage

Two Node scripts (Node 18 or newer, no dependencies) read the local transcripts in `~/.claude/projects` and print the tables above for your own sessions. Nothing leaves your machine.

```bash
node scripts/usage-report.mjs
```

```bash
node scripts/cache-report.mjs
```

Dollar figures are estimates at published API list prices, the yardstick for how fast subscription limits fill. Pass `--root <path>` to point at another projects folder.

## What was verified, and how

Checked on 2026-10-01 with Claude Code 2.1.284 in the desktop app on Windows:

- **Loading.** A fresh session process was asked, with tools forbidden, to quote marker lines. It quoted a marker from CLAUDE.local.md in the working folder and a second marker from a file pulled in by an `@` import inside it, and it listed a test skill placed under the project's `.claude/skills/` and another under `~/.claude/skills/`.
- **The setup prompt.** Agents ran it end to end in throwaway folders, and every file they produced was diffed against the templates in this repo: a git repo with two streams; a folder without git that has an AGENTS.md and one model; four variants of a repo that already had a shared CLAUDE.md, a CLAUDE.local.md, a HANDOVER.md and a .gitignore, on Opus + Haiku; the zero-edit defaults; and a settings file that is not valid JSON.
- **The scripts** ran against five weeks of real transcripts and against an empty folder.

Not covered: server-managed organisation settings (the prompt reports and skips what it can see on disk), and the `/handover` entry in the composer menu, which is hidden from the model on purpose (`disable-model-invocation: true`), so only you can see it.

## Files

| Path | What it is |
| --- | --- |
| SETUP-PROMPT.md | The one-paste setup, with a copy button |
| setup-prompt.txt | The same text, for select-all and copy |
| templates/CLAUDE.local.md | Personal rules file with the handover import |
| templates/HANDOVER.md | The handover file skeleton |
| templates/claude-token-rules.md | Rules card |
| templates/settings-multi-model.json, settings-single-model.json | Settings keys to merge |
| skills/handover/SKILL.md | The `/handover` command, goes to `~/.claude/skills/handover/` |
| scripts/usage-report.mjs, cache-report.mjs | The audit |

Sources for the documented behaviour: [Manage costs](https://code.claude.com/docs/en/costs), [Model configuration](https://code.claude.com/docs/en/model-config), [How Claude remembers your project](https://code.claude.com/docs/en/memory), [Skills](https://code.claude.com/docs/en/skills), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing). All read on 2026-10-01.
