# Setup prompt

1. Open Claude Code in your project folder (terminal, the desktop app's Code tab, or the VS Code extension) and start a new session.
2. Copy the whole block below (the copy button at its top right) and paste it as your message. The two lines at the top are defaults; change them only if they are wrong for you.
3. When Claude asks permission to create files or run a command, allow it. It finishes with a checklist and four lines to keep.

The same text is in [setup-prompt.txt](setup-prompt.txt) if you prefer select-all and copy.

````
MODELS I HAVE: Opus + Sonnet
MY STREAMS: main

(The two lines above are defaults. Change the first if your model picker shows something else, for example "Opus only" or "Fable + Opus + Sonnet". Change the second if you want separate work streams, for example "backend, frontend".)

Set up my token-saving workflow in this folder using the two lines above. Do all steps in this one session without asking me questions; where something is unclear, take the default I give and say so in the final report. Never destroy anything that already exists: where a file you are told to create is already there, append or skip as each step says, and report it. If a file you must read is not valid JSON, leave that file alone, skip the step that needed it, and tell me in the report.

Background: long-lived chats waste usage two ways. Every return after a break longer than an hour re-writes the whole context to cache, and the same files get re-read many times after the chat is summarised. From now on: one task per session, a handover at a natural stop once the context bar passes 35 percent (hard stop at 50), a fresh session after any break longer than an hour unless the bar is under 15 percent, a handover file that every new session loads by itself, a dated decisions log written as things happen, automatic recall of what earlier sessions said (with /recall for a deeper search), and a context guard that warns at 35 percent and will not let a turn end above it until the handover is written.

## Step 1: check the ground

- Say whether this folder is a git repository, whether a CLAUDE.md already exists here or in a parent folder, and whether an AGENTS.md exists here. Never modify an existing CLAUDE.md or AGENTS.md. My personal rules go in CLAUDE.local.md.
- Read the user settings file at ~/.claude/settings.json (Windows: C:\Users\<me>\.claude\settings.json). Create it as {} if it is missing. If a managed or organization setting would override any key from Step 6, say so in the report and skip that key.
- Note the exact model id this session runs on, and my absolute home folder path.

## Step 2: personal rules file

Create CLAUDE.local.md in this folder with exactly the content below. Three exceptions:
- If this folder is not a git repository and has no CLAUDE.md, name the file CLAUDE.md instead.
- If the file you are about to create already exists, keep its content and append the block below after a blank line instead of overwriting it.
- If an AGENTS.md exists here and no CLAUDE.md does, make `@AGENTS.md` the first line of the file, so AGENTS.md keeps loading.

```
# Personal working rules (not committed)

Sessions are short: one task per session, then a fresh session. State between sessions lives in four places:

- @HANDOVER.md holds where the last session stopped, the exact next step, and the decisions still in force. Read it first and begin the first reply by naming the next step.
- DECISIONS.md is the dated log of every decision, constraint, finding and failed attempt. Append to it the moment one comes up; never rewrite or delete lines there. Read it only when the task touches a past decision.
- The issue tracker holds ticket status. Read tickets on demand, not all of them upfront.
- Auto memory holds durable facts and rules. It loads on its own.

## Handover ritual

- When I type /handover or say "handover", rewrite HANDOVER.md completely (current state only, under 120 lines), then update any memory file that gained a durable fact this session.
- Offer a handover unprompted when the task is finished or the context bar passes 35 percent; insist at 50 percent.
- Lines marked "Automatic recall" arrive with my prompts when an earlier session said something relevant. Treat them as leads and check them before relying on them. For a deeper search run /recall <topic> before guessing.
- Never re-read a large file whole when a section will do. Large logs, test output and long documents go to a subagent; only its answer comes back to this chat.
- Do not switch model inside a session. If the job needs another model, hand over and start a new session.
- Prefer command-line tools over MCP servers for the same job.

## Compact instructions

When compacting, keep every decision and constraint, each failed attempt and why it failed, the exact next step, and the paths of files in play. Drop tool output and exploration that led nowhere.
```

## Step 3: the handover file and the decisions log

Create HANDOVER.md next to it with this content, one section per stream from MY STREAMS. If HANDOVER.md already exists, keep everything in it and append only the stream sections and the Pointers block that are missing, then say so in the report.

```
# Handover (rewritten whole each time; under 120 lines; current state only)

Updated: <today> by the setup session. No work has been handed over yet.

## <stream name>
- Current task: (none yet)
- Done recently: (none yet)
- Next step: (write the exact first prompt for the next session, with its done-when)
- Decisions in force: (up to 8 dated lines copied from DECISIONS.md that this stream still depends on)
- Open decisions or blockers: (who owes what)
- Files in play: (paths)

## Pointers (do not re-read the source documents)
- Rules card: claude-token-rules.md in this folder.
- Full log: DECISIONS.md in this folder. Past sessions: /recall <topic>.
```

Create DECISIONS.md next to it with this content. If it already exists, leave it exactly as it is.

```
# Decisions and findings (append only, one dated line each, never rewritten)

Format: `- YYYY-MM-DD [stream] what was decided or found, and why`. Write the line the moment it happens, not at the end.

- <today> [<first stream>] Workflow set up. Handover file loads at launch; /handover rewrites it; /recall searches past sessions.
```

## Step 4: the /handover command

Create the skill at ~/.claude/skills/handover/SKILL.md (user level, so it is never committed and works in every project) with exactly this content. An existing copy is replaced; it is the same file.

```
---
name: handover
description: Rewrite HANDOVER.md in the current project so the next fresh session can continue this stream without the old context. Run at the end of a session or when the context bar passes 35 percent.
disable-model-invocation: true
argument-hint: [stream name]
---

Rewrite HANDOVER.md in the current working folder as a whole file (never append) so that a brand-new session with none of this conversation can continue the work.

Stream to update: $ARGUMENTS. If empty, use the stream this session worked on. Leave the other streams' sections exactly as they are.

Rules:

1. First, append to DECISIONS.md every decision, constraint, finding or failed attempt from this session that is not there yet, as dated lines (`- YYYY-MM-DD [stream] text`). Never rewrite or delete lines in DECISIONS.md. Create it if it is missing.
2. The whole handover stays under 120 lines. Plain sentences. Current state only, no history. Keep the Pointers section at the end.
3. Fill the stream's section with exactly these lines:
   - Current task: one line.
   - Done recently: at most five dated bullets.
   - Next step: the exact first prompt for the next session, with its done-when.
   - Decisions in force: up to 8 dated lines, copied from DECISIONS.md, that the next session must still respect.
   - Open decisions or blockers: who owes what.
   - Files in play: paths only.
4. Set the "Updated:" line to today's date and this session's title.
5. Check memory: if a durable fact or rule came up this session (a decision, a constraint, a correction from me), write or update the memory file and its MEMORY.md line. Task state never goes into memory.
6. If tickets changed this session, make sure their status comments match.
7. Reply with the section you wrote, then one line: "Next session: start new, <model> at <effort>, first prompt: <prompt>".
```

## Step 5: keep personal files out of the repo

If this folder is a git repository, make sure .gitignore lists CLAUDE.local.md, HANDOVER.md, DECISIONS.md and claude-token-rules.md: create the file if it is missing, otherwise append only the lines that are not there yet. Run git status after Step 7, when all four files exist, and confirm that none of them shows as untracked. If one of them is already tracked by git, .gitignore cannot hide it: do not change the index, but put the exact untrack command (git rm --cached <file>) in the report for me to run. If this folder is not a git repository, skip this step and say so.

## Step 6: settings, chosen from MODELS I HAVE

Back up the user settings file as settings.json.bak-<today>, then merge the matching block into it at key level: every existing key stays, other models' entries inside modelSettings stay, other variables inside env stay; only the keys in the block are set. Print the result and confirm it parses as JSON.

If I have more than one model:

```
{
  "effortLevel": "high",
  "modelSettings": {
    "claude-sonnet-5-5": { "effortLevel": "medium" }
  },
  "env": { "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet" },
  "cleanupPeriodDays": 365
}
```

If I have one model only:

```
{
  "effortLevel": "medium",
  "modelSettings": {
    "<the model id from Step 1>": { "effortLevel": "medium" }
  },
  "cleanupPeriodDays": 365
}
```

Do not set a subagent model when I have one model only. If I have more than one model but no Sonnet, drop the Sonnet modelSettings entry, and set CLAUDE_CODE_SUBAGENT_MODEL to haiku when Haiku is in my list, otherwise leave env out.

A saved per-model level outranks the top-level effortLevel, so after the merge check every existing modelSettings entry: the model that does the chores (Sonnet, or Haiku when I have no Sonnet) goes to medium, every other model goes to high, and with one model only everything goes to medium. Report each entry you changed.

## Step 7: my rules card

Create claude-token-rules.md in this folder. Use the model table that matches MODELS I HAVE and drop the other one. In the multi-model table, make the model names match my list: the cheapest model I have in the first row (Haiku when there is no Sonnet), and the strongest I have in the third row. An existing copy is replaced; it is a generated card.

```
# Claude token rules

## Model and effort by job (more than one model)
| Job | Model | Effort |
| --- | --- | --- |
| Summaries, ticket updates, commit messages, small edits, reading terminal output | Sonnet | medium |
| Writing code, bug fixes, anything that needs verification or has edge cases | Opus | high |
| Whole-repo audit, security review, long autonomous build with a full brief | Fable if available, else Opus | high |
| A hard problem where high already failed | same model | xhigh for that one session |

## Effort by job (one model)
| Job | Effort |
| --- | --- |
| Summaries, ticket updates, commit messages, small edits, reading terminal output | medium |
| Bug fixes, integration debugging, anything that needs verification or has edge cases | high |
| A hard problem where high already failed | xhigh for that one session, then back |

Never max as a default. Pick model and effort once at session start; never change them mid-session.

## Session rules
About 7 percent of the context bar is fixed overhead. Reading a big context each turn is cheap; a cold return after a break of more than an hour re-writes the whole context and is the expensive moment. On Opus about $1.20 at 15 percent, $2.80 at 35, $4.00 at 50, against $0.55 for a fresh session; on Fable two and a half times that.
1. One task per session. Same sitting: hand over at the next natural stop once the bar passes 35 percent; hard stop at 50. The context guard warns at 35 and holds the turn open above it until the handover is written.
2. After a break of more than an hour: resume only if the bar is under 15 percent; otherwise start a fresh session from HANDOVER.md. Overnight: always fresh.
3. Type /handover at the stop. Then close the session.
4. Name sessions by stream and date, archive them after the handover.

## Nothing gets lost
- Decisions, constraints, findings and failed attempts go into DECISIONS.md the moment they happen.
- The handover carries the decisions still in force, not only the next step.
- What earlier sessions said about the thing you are asking arrives by itself with your prompt. /recall <topic> is the deeper search, with dates.
- Old transcripts stay on disk for a year.

## Context rules
- Ask for the section, not the whole file. Large logs, test output and long documents go to a subagent.
- No screenshots when text will do.
- Disable MCP servers you are not using in the session; prefer command-line tools.

## Daily loop
Morning: new session, model and effort per the table, type "continue". Done when the first reply names the next step.
End: /handover. Done when HANDOVER.md shows today's date.
```

## Step 8: the context guard and automatic recall (needs git and Node)

Run `git --version` and `node --version`. If either is missing, skip this step, say which one is missing, and go on; everything above works without it.

If both work:
1. Clone https://github.com/nrzz/claude-code-handover into ~/.claude/claude-code-handover. If that folder already exists, run `git pull` inside it instead.
2. Copy ~/.claude/claude-code-handover/skills/recall/SKILL.md to ~/.claude/skills/recall/SKILL.md (replace an existing copy).
3. Merge this block into the user settings file at key level, keeping any hooks already there. Replace <home> with my absolute home folder path from Step 1, using forward slashes.

```
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["<home>/.claude/claude-code-handover/scripts/context-guard.mjs"], "timeout": 10 } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["<home>/.claude/claude-code-handover/scripts/context-guard.mjs"], "timeout": 10 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["<home>/.claude/claude-code-handover/scripts/context-guard.mjs"], "timeout": 10 } ] }
    ]
  }
}
```

4. Build the recall index and prove it runs: from this folder, run `node <home>/.claude/claude-code-handover/scripts/memory-index.mjs --build` and then `node <home>/.claude/claude-code-handover/scripts/recall.mjs setup`, and show the first lines of both in the report.

## Step 9: report

Finish with: a checklist of each file created with its full path; each settings key applied or skipped and why; the git status result; whether the guard and automatic recall were installed; then these four lines for me to keep:
1. Close this session. Open a new one here and ask "which memory files loaded, and what is my effort?" It should name the rules file from Step 2 and HANDOVER.md.
2. For each old chat you still need: open it, type /handover, close it for good.
3. Every morning: new session, type "continue". What earlier sessions said about your question arrives by itself; /recall followed by a topic is the deeper search.
4. At a natural stop past 35 percent, or when done: /handover, then close.
(With more than one stream, add its name: "continue backend", "/handover backend".)
````
