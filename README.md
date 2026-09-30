# Claude Code handover workflow

Short sessions, a handover file that every new session loads by itself, and effort defaults that stop the model from overthinking. Set up with one pasted prompt. Measured on five weeks of real usage before it existed.

**Quick start:** open [SETUP-PROMPT.md](SETUP-PROMPT.md), fill the two lines at the top, paste the block into a new Claude Code session in your project folder, and follow the four lines it prints at the end. Nothing you already have is overwritten: existing files are appended to or left alone, and the report says which.

## The problem, measured

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

The same documents were read about 90 times inside one chat, because each summary had dropped them. A long chat is not an archive. It is a window that forgets, and you pay to refill it.

## The fix

Three parts, all created by [SETUP-PROMPT.md](SETUP-PROMPT.md):

1. **HANDOVER.md** in the project folder: one section per work stream with five fixed lines (current task, done recently, next step as the exact first prompt with a done-when, open decisions, files in play). Rewritten whole, under 60 lines.
2. **CLAUDE.local.md** imports it with an `@HANDOVER.md` line. Claude Code loads the file at launch and expands the import, so every new session starts knowing where the last one stopped. Cost: about two thousand tokens.
3. **`/handover`**, a user-level skill that rewrites the file, moves durable facts into memory, and tells you which model and effort to start the next session on. Only you can trigger it.

Durable facts live in Claude's auto memory. Ticket status lives in your tracker. Code history lives in git. The handover file carries the one thing none of those hold: where you were mid-task.

## Setup in one paste

1. Open [SETUP-PROMPT.md](SETUP-PROMPT.md) and fill the two lines at the top: the models you have, and your work streams.
2. Open a new Claude Code session in the project folder and paste the whole block.
3. When it finishes, close that session, open a new one and ask "which memory files loaded, and what is my effort?" It should name CLAUDE.local.md and HANDOVER.md.
4. For each old chat you still need: open it, type `/handover <stream>`, close it for good.

The files it creates are also in [templates/](templates/) and [skills/handover/SKILL.md](skills/handover/SKILL.md) if you prefer to copy them by hand.

Edge cases the prompt handles on its own: a folder that is not a git repository (the rules go in CLAUDE.md instead of CLAUDE.local.md), a repository that uses AGENTS.md (the new file imports it so it keeps loading), an existing CLAUDE.local.md or .gitignore (appended, never replaced), an existing HANDOVER.md (kept, with only the missing stream sections added), a CLAUDE.local.md that git already tracks (flagged, with the untrack command for you to run), a model list without Sonnet (Haiku does the chores and becomes the subagent model, and the rules card names your models), and settings that already hold other models or variables (merged at key level, with saved per-model efforts brought in line).

Terminal users: run `/statusline` once so the context percentage is always visible; the desktop app shows it in the composer.

## Daily loop

- Morning: new session, model and effort from the table below, type `continue <stream>`. Done when the first reply names the next step.
- Same sitting: hand over at the next natural stop once the context bar passes 35%. Hard stop at 50%.
- Break longer than an hour: resume only if the bar is under 15%. Otherwise fresh session from the handover. Overnight: always fresh.
- End: `/handover <stream>`, close, archive.

## Why 35 and 50, not lower

About 7% of the context bar is fixed overhead (tool definitions, connectors, memory index). Reading a big context each turn is cheap on current models. The expensive moment is a cold return: after a break longer than an hour the whole context is written to cache again. One cold return by size, at list prices:

| Context | Opus 5.5 | Fable 5.1 |
| --- | --- | --- |
| 15% (150K) | $1.20 | $3.00 |
| 35% (350K) | $2.80 | $7.00 |
| 50% (500K) | $4.00 | $10.00 |
| Fresh session, about 70K | $0.55 | $1.40 |

So size matters only when you come back cold. Work on in one sitting; never come back cold to a big chat.

## Model and effort

Effort `high` is the documented default on most models and `medium` on Opus 5.5 and Sonnet 5.5. The docs warn that `max` "may show diminishing returns and is prone to overthinking". The audit ran 1,189 requests at max.

| Job | Model | Effort |
| --- | --- | --- |
| Summaries, ticket updates, commit messages, small edits, reading terminal output | Sonnet | medium |
| Writing code, bug fixes, anything that needs verification or has edge cases | Opus | high |
| Whole-repo audit, security review, long autonomous build with a full brief | Fable if available, else Opus | high |
| A hard problem where high already failed | same model | xhigh, one session |

Pick model and effort once at session start. Never switch model mid-session: each switch re-caches the whole context.

## Audit your own usage

Two Node scripts (Node 18 or newer, no dependencies) read the local transcripts in `~/.claude/projects` (nothing leaves your machine) and print the same tables as above:

```bash
node scripts/usage-report.mjs
```

```bash
node scripts/cache-report.mjs
```

Dollar figures are estimates at published API list prices, useful as the yardstick for how fast subscription limits fill. Pass `--root <path>` to point at another projects folder.

## What was verified, and how

Checked on 2026-10-01 with Claude Code 2.1.284 in the desktop app on Windows:

- **Loading.** A fresh session process was asked, with tools forbidden, to quote marker lines. It quoted a marker from CLAUDE.local.md in the working folder and a second marker from a file pulled in by an `@` import inside it, and it listed a test skill placed under the project's `.claude/skills/` and another under `~/.claude/skills/`. So the three mechanisms this workflow relies on work as the docs describe.
- **The setup prompt.** Agents ran it end to end in throwaway folders, and every file they produced was diffed against the templates in this repo. Scenarios covered: a git repo with "Opus + Sonnet" and two streams (CLAUDE.local.md and the skill byte-identical, rules card equal to the template minus the one-model table, one handover section per stream, personal files git-ignored, settings merged without touching existing keys); a folder that is not a git repository, has an AGENTS.md and "Opus only" (rules went to CLAUDE.md with `@AGENTS.md` as its first line, one-model table, single-model settings, a saved xhigh entry for another model brought down to medium); and a repo that already had a shared CLAUDE.md, a CLAUDE.local.md, a HANDOVER.md and a .gitignore, with "Opus + Haiku" (existing lines kept and the block appended, shared CLAUDE.md untouched, only missing .gitignore lines added, Haiku set as the subagent model, no Sonnet entry written).
- **The scripts** ran against five weeks of real transcripts and against an empty folder.

Not covered: managed or organisation settings that override user settings (the prompt reports and skips those), and the `/handover` entry in the composer menu, which is hidden from the model on purpose (`disable-model-invocation: true`), so only you can see it. Type `/` in a new session to confirm it is there.

## Files

| Path | What it is |
| --- | --- |
| SETUP-PROMPT.md | The one-paste setup |
| templates/CLAUDE.local.md | Personal rules file with the handover import |
| templates/HANDOVER.md | The handover file skeleton |
| templates/claude-token-rules.md | Rules card |
| templates/settings-multi-model.json, settings-single-model.json | Settings keys to merge |
| skills/handover/SKILL.md | The `/handover` command, goes to `~/.claude/skills/handover/` |
| scripts/usage-report.mjs, cache-report.mjs | The audit |

Sources for the documented behaviour: [Manage costs](https://code.claude.com/docs/en/costs), [Model configuration](https://code.claude.com/docs/en/model-config), [How Claude remembers your project](https://code.claude.com/docs/en/memory), [Skills](https://code.claude.com/docs/en/skills), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing). All read on 2026-10-01.
