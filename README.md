# Claude Code handover workflow

[![test](https://github.com/nrzz/claude-code-handover/actions/workflows/test.yml/badge.svg)](https://github.com/nrzz/claude-code-handover/actions/workflows/test.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![node >= 18](https://img.shields.io/badge/node-%3E%3D18-339933.svg) ![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg) [![part of the Claude Code toolkit](https://img.shields.io/badge/Claude%20Code-toolkit-d97757.svg)](https://github.com/nrzz/claude-code-toolkit)

Stop paying to reload one giant chat. Work in short sessions, let every new session start from a small handover file that Claude Code loads by itself, and keep everything that was decided where a later session can find it.

## What you get

- **HANDOVER.md** in your project: where you stopped, the exact next step and the decisions still in force, one section per work stream.
- **DECISIONS.md**: a dated, append-only log. Claude writes a line the moment something is decided, found or tried and failed.
- **CLAUDE.local.md** (personal, not committed) that imports the handover, so every new session knows where you were before you type anything.
- **`/handover`**: rewrites the handover at the end of a session.
- **Automatic recall**: when you ask something, the few lines from earlier sessions that match your question are placed in front of Claude before it answers. Nothing to type. `/recall <topic>` remains for a deeper search with dates.
- **A context guard**: warns from 35% of the context window (1M tokens by default; set `HANDOVER_CONTEXT_WINDOW` for a 200K model) and, at the end of a turn above that, asks Claude once to write the handover if HANDOVER.md is older than 30 minutes.
- **Effort defaults** in your settings so the model stops overthinking small jobs.

## What it costs in tokens

The point is to spend fewer tokens, so here is what the workflow itself adds:

| Part | Tokens | |
| --- | --- | --- |
| `CLAUDE.local.md`, your personal rules | about 450 per session | Loaded at the start of every session in the project |
| `HANDOVER.md` | about 170 when new | Loaded at the start of every session; the rewrite rules keep it under 120 lines. It is what replaces reloading a long chat |
| The latest decisions, at session start | up to about 450, usually less | The 8 newest dated lines of `DECISIONS.md`, from the SessionStart hook |
| Automatic recall | 0 for most prompts, about 110 to 200 when an earlier session matches strongly | Measured by `scripts/selftest.mjs` (the `tokens/hit` column). `HANDOVER_AUTORECALL=0` turns it off |
| The context guard | 0 below the limit (35% of the context window), one line per prompt above it | At the end of a turn above the limit with a HANDOVER.md older than 30 minutes, one paragraph asking for the handover, once |
| `/recall` in Claude's skill list | about 60 per session | Its description lets Claude search when you ask about an earlier decision; the search itself runs outside the model |
| `/handover` | 0 until you run it | User-only (`disable-model-invocation`), so it is not in the list Claude Code gives the model |
| `DECISIONS.md` and `claude-token-rules.md` | 0 | Read only when a task needs them |
| `init`, `status`, `uninstall` and the audit scripts | 0 | Plain Node, no model |

Against that, one cold return to a chat at 35% of a 1M context re-writes about 350K tokens (about $2.80 on Opus at list prices), and a fresh session that starts from the handover is about 70K.

## Set up in one command

In your project folder, in a terminal (Node 18 or newer):

```bash
npx -y github:nrzz/claude-code-handover init
```

It does what the setup prompt below tells Claude to do, with the same file contents and the same never-destroy rules, but without a model: it costs no tokens, asks no questions and takes a few seconds. It ends with a plain report of every file it created, appended to or left alone, every settings key it set or skipped and why, what git says about your four personal files, and the four lines to keep. Run it a second time and it changes nothing and says so.

| Option | What it does |
| --- | --- |
| `--models "Opus + Sonnet"` | The models your picker shows. Default `Opus + Sonnet`; `"Opus only"`, `"Fable + Opus + Sonnet"` and `"sonnet,haiku"` work too. It decides the effort defaults, the subagent model and the rules card. With one model, `init` writes the newest id of that family into `modelSettings` (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-1` or `claude-haiku-4-5-20251001` in this version); the pasted prompt uses the id your session runs on. |
| `--streams "main"` | Your work streams, one handover section each. Default `main`; for example `"backend, frontend"`. |
| `--dir <project>` | The project folder. Default: the current folder. |
| `--dry-run` | Say what would change and write nothing. |
| `--no-hooks` | Skip the context guard, automatic recall and `/recall`. The files `init` still writes (`CLAUDE.local.md`, `HANDOVER.md`, `DECISIONS.md` and the rules card) mention automatic recall, `/recall` and the guard, so edit those lines if you do not want them. |

Exit codes, for scripts: `0` when everything is in place, also when it already was; `1` when a step could not be done (one line on stderr says which, and the report says the rest); `2` when the command line was not understood.

What it writes:

- **In the project folder:** `CLAUDE.local.md` (your personal rules; `CLAUDE.md` instead in a folder that is not a git repository and has no CLAUDE.md), `HANDOVER.md`, `DECISIONS.md` and `claude-token-rules.md`, and the four file names in `.gitignore` in a git repository. An existing `CLAUDE.md` or `AGENTS.md` is never modified. An existing `CLAUDE.local.md`, `HANDOVER.md` or `.gitignore` gets only what is missing, and an existing `DECISIONS.md` is left as it is. An existing `claude-token-rules.md` is a generated card, so it is replaced; a copy that is not one of the cards `init` writes (one you edited, say) is first kept as `claude-token-rules.md.bak-YYYYMMDD` and reported. A personal file that git already tracks is reported with the `git rm --cached` command for you to run; the index is never changed.
- **In `~/.claude`, or `$CLAUDE_CONFIG_DIR` when you set it:** the `/handover` and `/recall` skills, a copy of the guard and recall scripts in `claude-code-handover/` (so the hooks never depend on npx's cache; a git clone that an older setup left there is updated with `git pull --ff-only`, or copied over when git cannot), and in `settings.json` the effort defaults and the three hooks, merged key by key after a backup named `settings.json.bak-YYYYMMDD`. A key that your organisation's managed settings already set is skipped and reported, a `cleanupPeriodDays` longer than 365 is kept, and a `settings.json` that is not valid JSON (comments and trailing commas count) is left alone and reported. The copy of the scripts is rewritten to match this version each time you run `init`, so keep your own files out of that folder.
- **The recall index**, in `claude-code-handover-data/` under that same config folder (or in `HANDOVER_DATA_DIR` when you set it): a local file of remarks from your own transcripts, which `init` builds for the project and the hooks keep up to date. It is safe to delete.

Where the prompt leaves a choice, the command takes the safe side. A `/handover` or `/recall` skill that differs from ours is kept next to the new one as `SKILL.md.bak-YYYYMMDD`, and a `claude-token-rules.md` you edited is kept as `claude-token-rules.md.bak-YYYYMMDD` (the card `init` wrote for another model list is simply replaced); when that name is taken, the time and then a counter are added, so a backup is never overwritten. A file that is not UTF-8 text (UTF-16, for example) is left alone and reported, because rewriting it would corrupt it. The `settings.json` backup is made only when the run changes the file, so a second run leaves no backup.

To undo it, and to see what is installed:

```bash
npx -y github:nrzz/claude-code-handover uninstall
npx -y github:nrzz/claude-code-handover status
```

`uninstall` backs up `settings.json`, then removes only what `init` added at user level: our three hook entries, the two skills (when they are still the copies `init` wrote) and the copy of the scripts (a file of yours in that folder stays). A git checkout of the scripts that an older setup made is removed only with `--purge`. It keeps what is yours or what you may still want, and says so: your project files, the effort settings `init` merged in (including `cleanupPeriodDays`), the `settings.json.bak-*` backups and the recall index (`claude-code-handover-data` in the config folder, safe to delete by hand). `--dry-run` shows what would go.

## Or let Claude set it up

If you would rather watch Claude do it, or want to adapt a step, paste the setup prompt instead. Claude does the work, so it spends tokens; the command above spends none.

1. Open Claude Code in your project folder (terminal, desktop app, or VS Code) and start a new session.
2. Open [SETUP-PROMPT.md](SETUP-PROMPT.md), click the copy button on the block, paste it as your message. No edits needed unless your model picker shows something other than Opus and Sonnet.
3. Allow the file and command permissions it asks for. It ends with a checklist and four lines to keep.

To check either way: open a new session and ask "which memory files loaded?". It should name CLAUDE.local.md and HANDOVER.md. Type `/` and `handover` and `recall` are in the list.

## Every day

- Morning: new session, type `continue`. The first reply names your next step.
- While working: nothing to do. Decisions are logged as they happen.
- Something from before matters: it arrives by itself with your question. For a deeper search, `/recall the topic`.
- When the guard warns (35% of the window): finish the step you are on, type `/handover`, close the session. If you ignore the warning, the guard asks Claude once, at the end of a turn, to write the handover, unless HANDOVER.md was written in the last 30 minutes.
- Break longer than an hour: start a new session instead of reopening the old one, unless the bar is under 15%. The next day: always a new session.

With several streams, say which one: `continue backend`, `/handover backend`.

## Nothing gets lost: five layers

A handover is a summary, and a summary alone would drop details. So it is not alone:

| Layer | What it guarantees | When it acts |
| --- | --- | --- |
| DECISIONS.md | Every decision, constraint, finding and failed attempt has a dated line on disk | The moment it happens, so a crash or a compaction cannot lose it |
| HANDOVER.md | The next session starts with the next step and the decisions still in force already in context | At every `/handover`, and when the guard asks for it above the limit |
| Context guard | A big session is told to hand over, and Claude is asked once to write the handover if it is stale | A warning with every prompt above the limit (35% of the window); at the end of a turn above it, one request, unless HANDOVER.md was written in the last 30 minutes |
| Automatic recall | What earlier sessions said about the thing you are asking is in front of Claude before it answers, including details a compaction dropped from the current session. A line is given to a session once, not on every prompt | On every prompt, only when the match is strong (rare shared words, a repeated phrase, or a ticket id); a session start also shows the newest decisions |
| `/recall` and the transcripts | Anything ever said in any session of the project can be found again, word for word | On demand; transcripts are kept for a year |

What this does not promise: a new session does not hold the whole old conversation in its head. It holds the state and the decisions, the relevant past lines arrive with each question, and it can look up the rest in seconds. That is also more than a long chat keeps, because a long chat silently drops details each time it compacts.

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
| ...caused by returning to a chat after 55 minutes or more | 42 events |
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

A folder that is not a git repository (rules go in CLAUDE.md), a repository that uses AGENTS.md (the new file imports it so it keeps loading), an existing CLAUDE.local.md or .gitignore (appended, never replaced), an existing HANDOVER.md or DECISIONS.md (kept), a personal file that git already tracks (flagged, with the untrack command for you to run), a model list without Sonnet (Haiku does the chores and the rules card names your models), settings that already hold other models, variables or hooks (merged at key level; an `effortLevel` you had saved for a model is brought in line: `high`, except `medium` for the model that does the chores, Sonnet or else Haiku, and for every model when you have only one; each change is reported), a settings file that is not valid JSON (left alone and reported), managed settings that override yours (reported and skipped), and a machine without git (the one command copies the scripts instead of cloning them, so the guard and automatic recall still install; only the git checks are skipped). With the pasted prompt, a machine without git or Node skips the guard and automatic recall, and everything else works.

Tuning the guard: the limit is 35% of `HANDOVER_CONTEXT_WINDOW` (tokens, default 1000000, so a limit of 350000). Set the window to your model's, for example `200000` for a 200K model, and the limit becomes 70000; the percentage in the warning follows the window too. `HANDOVER_CONTEXT_LIMIT` (tokens) sets the limit itself and wins when it is set. `HANDOVER_STALE_MINUTES` (default 30) is how old HANDOVER.md must be before the guard asks for a new one at the end of a turn. Put them in the `env` block of your settings. Set `HANDOVER_AUTORECALL` to 0 to turn automatic recall off, `HANDOVER_RECALL_STRICTNESS` (default 4) higher for fewer and surer recalls or lower for more, and `HANDOVER_RECALL_WINDOW_MB` (default 12, about 35,000 remarks) to change how much of the newest history is searched on every prompt. Older remarks stay reachable through `/recall` and the decisions log. The hook only acts in folders that have a HANDOVER.md. The recall index is a local file under `~/.claude/claude-code-handover-data/`, and recall reads the transcripts in `~/.claude/projects`; if you moved Claude Code's config folder with `CLAUDE_CONFIG_DIR`, both follow it. `HANDOVER_PROJECTS_DIR` and `HANDOVER_DATA_DIR` set either folder directly.

Terminal users: run `/statusline` once so the context percentage is always visible; the desktop app shows it in the composer.

## Audit your own usage

Node scripts (Node 18 or newer, no dependencies) read the local transcripts in `~/.claude/projects` (in `$CLAUDE_CONFIG_DIR/projects` when you set it; `--root <folder>` reads another folder). Nothing leaves your machine.

```bash
node scripts/usage-report.mjs
```

```bash
node scripts/cache-report.mjs
```

```bash
node scripts/recall.mjs the topic
```

```bash
node scripts/selftest.mjs --replay
```

The last one is the stress test described below; with `--replay` it also measures recall on your own history, read from the folders recall reads (`CLAUDE_CONFIG_DIR`, `HANDOVER_PROJECTS_DIR` and `HANDOVER_DATA_DIR` apply), and prints how many tokens it adds.

Dollar figures are estimates at published API list prices, the yardstick for how fast subscription limits fill. Pass `--root <path>` to point at another projects folder, and `--all` to recall across every project.

## What was verified, and how

Checked on 2026-10-01 with Claude Code 2.1.284 in the desktop app on Windows:

- **Loading.** A fresh session process was asked, with tools forbidden, to quote marker lines. It quoted a marker from CLAUDE.local.md in the working folder and a second marker from a file pulled in by an `@` import inside it, and it listed a test skill placed under the project's `.claude/skills/` and another under `~/.claude/skills/`.
- **The context guard, live.** Registered as a hook in a real session with the limit lowered for the test: the warning line arrived with the prompt, the Stop hook asked once for the handover before the turn could end, Claude wrote the decisions log and the handover, and the turn then ended. Nine unit cases against real transcripts cover the silent paths (below the limit, fresh handover, no handover file, already continued once, unreadable input).
- **Automatic recall, stress test.** `scripts/selftest.mjs` builds nine synthetic histories, from 479 to 94,472 remarks, and plants facts in them. It then asks, from another session, about each fact that sits inside the part of the history that recall searches (the newest 12 MB of the index: every fact in the eight smaller histories, 19 of the 60 in the largest), in a message of about 250 characters with unrelated instructions and filler around the question. Result of the last run: 156 of 156 facts found; 56 of 56 found again inside their own session after a compaction; 0 of 100 repeated to a session that still held them; 2 false injections in 360 unrelated prompts; 5 ms per prompt on a small history, 265 ms on the largest; 0.5 seconds to index 94,472 remarks.
- **Automatic recall, real history.** Replaying 345 real prompts from five weeks of work as if each were asked in a new session: recall added something on 57% of them, about 185 tokens when it did and 105 tokens per prompt on average, in 20 ms. Questions about things decided weeks earlier brought back the right lines (a measured number, a rule about an account, a carrier limitation, a ticket by its id), while "commit and push", "continue" or an unrelated coding question brought back nothing.
- **Automatic recall, live.** In a real session with tools forbidden: asked for a number that existed only in a chat from two weeks earlier, the session answered correctly, quoted the line and named the recall block as its source. The first live attempt returned nothing because the question sat inside a longer message; matching sentence by sentence fixed that, and the same session then answered.
- **The setup prompt.** Agents ran it end to end in throwaway folders, and every file they produced was diffed against the templates in this repo: a git repo with two streams; a folder without git that has an AGENTS.md and one model; four variants of a repo that already had a shared CLAUDE.md, a CLAUDE.local.md, a HANDOVER.md and a .gitignore, on Opus + Haiku; the zero-edit defaults; a settings file that is not valid JSON; and the full version, with the three hook events, the recall index and `/recall` installed next to an existing hook.
- **The scripts** ran against five weeks of real transcripts and against an empty folder. `/recall` found a topic discussed weeks earlier with its dates and session titles.
- **The one-command setup**, checked on 2026-10-04 on Windows with Node 24: `npm test` runs more than 300 tests of it, all passing (and then the recall stress test above), each in a throwaway home, config folder and project; nothing outside a temporary folder is read or written, and no real transcript is read. They hold the installer to the prompt: every code block of `setup-prompt.txt` equals its template, and `init` writes the files those blocks describe for a git project, a folder without git, an existing CLAUDE.md, CLAUDE.local.md, AGENTS.md, HANDOVER.md, DECISIONS.md and .gitignore, a personal file that git already tracks, every combination of Opus, Sonnet, Fable and Haiku (15), a settings file that is not valid JSON, a managed setting and hooks that were already there. A second run changes nothing (every file's bytes and modification time are compared), `--dry-run` writes nothing, and `uninstall` after `init` leaves the settings as they were except for the effort keys. The copied `context-guard.mjs` is run with a SessionStart, UserPromptSubmit and Stop event, as the hooks run it, and exits 0; its limit is 35% of `HANDOVER_CONTEXT_WINDOW` unless `HANDOVER_CONTEXT_LIMIT` is set, and its Stop event asks once, and not when HANDOVER.md was written in the last 30 minutes. Run by hand through `npx` from a local git repository, which is how a GitHub address is fetched, `init`, a second `init` ("nothing to do"), `status` and `uninstall` behaved the same.
- **Node versions and systems.** CI runs `npm test` on Linux, macOS and Windows with Node 20, 22 and 24, and on Linux with Node 18, the oldest version the package supports. On 2026-10-04 the suite and the recall stress test also passed on Windows with Node 18.20.

Not covered: organisation settings that are not files, such as server-managed settings, MDM profiles and the Windows registry (`init` reads `managed-settings.json` and the `managed-settings.d` folder where the Claude Code docs say they are, and skips the keys they set; the prompt reports and skips what it can see on disk), a live Claude Code session started after `init` (it writes the same files as the prompt, whose live checks are above), `npx` fetching the package from github.com itself, and the `/handover` entry in the composer menu, which is hidden from the model on purpose (`disable-model-invocation: true`), so only you can see it.

## Files

| Path | What it is |
| --- | --- |
| bin/claude-handover.mjs | The entry point of the one command: `init`, `uninstall`, `status` |
| src/ | The installer: one module per step, the settings merge, the report |
| test/ | The installer's tests (`node --test`), including a check that every code block of the setup prompt equals its template |
| SETUP-PROMPT.md | The one-paste setup, with a copy button |
| setup-prompt.txt | The same text, for select-all and copy |
| templates/CLAUDE.local.md | Personal rules file with the handover import |
| templates/HANDOVER.md, DECISIONS.md | The handover skeleton and the decisions log |
| templates/claude-token-rules.md | Rules card |
| templates/settings-multi-model.json, settings-single-model.json, hooks-settings.json | Settings keys to merge |
| skills/handover/SKILL.md, skills/recall/SKILL.md | The two commands, installed under `~/.claude/skills/` (`$CLAUDE_CONFIG_DIR/skills/` when you set it) |
| scripts/context-guard.mjs | The one hook: warning above the limit, one request for the handover at the end of a turn, automatic recall, session-start digest |
| scripts/memory-index.mjs | The index and search behind automatic recall |
| scripts/selftest.mjs | Stress test: synthetic histories with planted facts, and a replay of your real prompts |
| scripts/recall.mjs | Search past sessions |
| scripts/usage-report.mjs, cache-report.mjs | The audit |

Sources for the documented behaviour: [Manage costs](https://code.claude.com/docs/en/costs), [Model configuration](https://code.claude.com/docs/en/model-config), [How Claude remembers your project](https://code.claude.com/docs/en/memory), [Skills](https://code.claude.com/docs/en/skills), [Hooks](https://code.claude.com/docs/en/hooks), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing). All read on 2026-10-01.

## Contributing

Issues and pull requests are welcome: start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [good first issues](https://github.com/nrzz/claude-code-handover/issues?q=is%3Aopen+label%3A%22good+first+issue%22). Questions go to [Discussions](https://github.com/nrzz/claude-code-handover/discussions); security reports go through [SECURITY.md](SECURITY.md).

## Part of the Claude Code toolkit

Small, dependency-free tools that make Claude Code cheaper, safer and easier to share, all in the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit):

- [claude-code-team-sync](https://github.com/nrzz/claude-code-team-sync): share sessions, notes and team context with coworkers
- [claude-code-glow](https://github.com/nrzz/claude-code-glow): themes for the whole interface, a status line and a live HUD
- [claude-code-guardrails](https://github.com/nrzz/claude-code-guardrails): safety presets that stop risky commands and edits
- [claude-code-notify](https://github.com/nrzz/claude-code-notify): a ping when Claude needs you or finishes
- [claude-md-doctor](https://github.com/nrzz/claude-md-doctor): what your CLAUDE.md costs every session, and how to slim it
- [claude-code-starter-kits](https://github.com/nrzz/claude-code-starter-kits): a lean, safe .claude/ for your stack in one command
- [claude-cost-guard](https://github.com/nrzz/claude-cost-guard): daily and weekly token budgets with zero-token warnings
- [claude-session-replay](https://github.com/nrzz/claude-session-replay): search past sessions and export one as an HTML replay

Set up any of them, or all of them, from one page: `npx -y github:nrzz/claude-code-toolkit` opens it with the recommended tools switched on.

## License

MIT
