# Claude Code handover workflow

Stop paying to reload one giant chat. Work in short sessions, let every new session start from a small handover file that Claude Code loads by itself, and keep everything that was decided where a later session can find it.

## What you get

- **HANDOVER.md** in your project: where you stopped, the exact next step and the decisions still in force, one section per work stream.
- **DECISIONS.md**: a dated, append-only log. Claude writes a line the moment something is decided, found or tried and failed.
- **CLAUDE.local.md** (personal, not committed) that imports the handover, so every new session knows where you were before you type anything.
- **`/handover`**: rewrites the handover at the end of a session.
- **`/recall <topic>`**: searches every past session of the project and tells you what was said, with dates.
- **A context guard**: warns at 35% of the context bar and will not let a turn end above it until the handover is written.
- **Effort defaults** in your settings so the model stops overthinking small jobs.

## Set up in 3 steps

1. Open Claude Code in your project folder (terminal, desktop app, or VS Code) and start a new session.
2. Open [SETUP-PROMPT.md](SETUP-PROMPT.md), click the copy button on the block, paste it as your message. No edits needed unless your model picker shows something other than Opus and Sonnet.
3. Allow the file and command permissions it asks for. It ends with a checklist and four lines to keep.

To check: open a new session and ask "which memory files loaded?". It should name CLAUDE.local.md and HANDOVER.md. Type `/` and `handover` and `recall` are in the list.

## Every day

- Morning: new session, type `continue`. The first reply names your next step.
- While working: nothing to do. Decisions are logged as they happen.
- Something from before is unclear: `/recall the topic`.
- When the guard warns (35%): finish the step you are on, type `/handover`, close the session. If you ignore the warning, the guard makes Claude write the handover before the turn can end.
- Break longer than an hour, or next day: start a new session instead of reopening the old one, unless the bar is under 15%.

With several streams, say which one: `continue backend`, `/handover backend`.

## Nothing gets lost: four layers

A handover is a summary, and a summary alone would drop details. So it is not alone:

| Layer | What it guarantees | When it acts |
| --- | --- | --- |
| DECISIONS.md | Every decision, constraint, finding and failed attempt has a dated line on disk | The moment it happens, so a crash or a compaction cannot lose it |
| HANDOVER.md | The next session starts with the next step and the decisions still in force already in context | At every `/handover`, and forced by the guard above the limit |
| Context guard | A handover exists before a big session ends its turn | At 35% (warning) and at every turn end above it (holds the turn open once) |
| `/recall` and the transcripts | Anything ever said in any session of the project can be found again, word for word | On demand; transcripts are kept for a year |

What this does not promise: a new session does not hold the whole old conversation in its head. It holds the state and the decisions, and it can look up the rest in seconds. That is also more than a long chat keeps, because a long chat silently drops details each time it compacts.

## Why it works, in five lines

1. Claude Code sends your whole conversation with every request. Reading it from cache is cheap.
2. After a break longer than an hour the cache is gone, and the first message re-writes the whole context at the expensive rate. On a 500K chat that is about $4 on Opus and $10 on Fable, per return.
3. A fresh session costs about $0.55 to start, and the handover file is a few thousand tokens.
4. Long chats also get summarised when they fill up, which drops details, so the same files get read again and again.
5. Durable facts already live in Claude's auto memory, ticket status in your tracker, code history in git. The handover and the decisions log carry what none of them hold: where you were mid-task and why.

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

Pick model and effort once at session start. Never switch model mid-session: each switch re-caches the whole context. Subagents run on Sonnet (or Haiku) through one settings line. The setup writes these defaults into your settings; the rules card it creates in your project repeats this table for your own models.

## What the setup handles on its own

A folder that is not a git repository (rules go in CLAUDE.md), a repository that uses AGENTS.md (the new file imports it so it keeps loading), an existing CLAUDE.local.md or .gitignore (appended, never replaced), an existing HANDOVER.md or DECISIONS.md (kept), a personal file that git already tracks (flagged, with the untrack command for you to run), a model list without Sonnet (Haiku does the chores and the rules card names your models), settings that already hold other models, variables or hooks (merged at key level), a settings file that is not valid JSON (left alone and reported), managed settings that override yours (reported and skipped), and a machine without git or Node (the guard and `/recall` are skipped; everything else works).

Tuning the guard: set `HANDOVER_CONTEXT_LIMIT` (tokens, default 350000), `HANDOVER_CONTEXT_WINDOW` (default 1000000) or `HANDOVER_STALE_MINUTES` (default 30) in the `env` block of your settings. The guard only acts in folders that have a HANDOVER.md.

Terminal users: run `/statusline` once so the context percentage is always visible; the desktop app shows it in the composer.

## Audit your own usage

Node scripts (Node 18 or newer, no dependencies) read the local transcripts in `~/.claude/projects`. Nothing leaves your machine.

```bash
node scripts/usage-report.mjs
```

```bash
node scripts/cache-report.mjs
```

```bash
node scripts/recall.mjs the topic
```

Dollar figures are estimates at published API list prices, the yardstick for how fast subscription limits fill. Pass `--root <path>` to point at another projects folder, and `--all` to recall across every project.

## What was verified, and how

Checked on 2026-10-01 with Claude Code 2.1.284 in the desktop app on Windows:

- **Loading.** A fresh session process was asked, with tools forbidden, to quote marker lines. It quoted a marker from CLAUDE.local.md in the working folder and a second marker from a file pulled in by an `@` import inside it, and it listed a test skill placed under the project's `.claude/skills/` and another under `~/.claude/skills/`.
- **The context guard, live.** Registered as a hook in a real session with the limit lowered for the test: the warning line arrived with the prompt, the turn was held open, Claude wrote the decisions log and the handover, and the turn then ended. Nine unit cases against real transcripts cover the silent paths (below the limit, fresh handover, no handover file, already continued once, unreadable input).
- **The setup prompt.** Agents ran it end to end in throwaway folders, and every file they produced was diffed against the templates in this repo: a git repo with two streams; a folder without git that has an AGENTS.md and one model; four variants of a repo that already had a shared CLAUDE.md, a CLAUDE.local.md, a HANDOVER.md and a .gitignore, on Opus + Haiku; the zero-edit defaults; a settings file that is not valid JSON; and the full version with the guard and `/recall` installed next to an existing hook.
- **The scripts** ran against five weeks of real transcripts and against an empty folder. `/recall` found a topic discussed weeks earlier with its dates and session titles.

Not covered: server-managed organisation settings (the prompt reports and skips what it can see on disk), and the `/handover` entry in the composer menu, which is hidden from the model on purpose (`disable-model-invocation: true`), so only you can see it.

## Files

| Path | What it is |
| --- | --- |
| SETUP-PROMPT.md | The one-paste setup, with a copy button |
| setup-prompt.txt | The same text, for select-all and copy |
| templates/CLAUDE.local.md | Personal rules file with the handover import |
| templates/HANDOVER.md, DECISIONS.md | The handover skeleton and the decisions log |
| templates/claude-token-rules.md | Rules card |
| templates/settings-multi-model.json, settings-single-model.json, hooks-settings.json | Settings keys to merge |
| skills/handover/SKILL.md, skills/recall/SKILL.md | The two commands, installed under `~/.claude/skills/` |
| scripts/context-guard.mjs | The hook behind the 35% warning and the held turn |
| scripts/recall.mjs | Search past sessions |
| scripts/usage-report.mjs, cache-report.mjs | The audit |

Sources for the documented behaviour: [Manage costs](https://code.claude.com/docs/en/costs), [Model configuration](https://code.claude.com/docs/en/model-config), [How Claude remembers your project](https://code.claude.com/docs/en/memory), [Skills](https://code.claude.com/docs/en/skills), [Hooks](https://code.claude.com/docs/en/hooks), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing). All read on 2026-10-01.
