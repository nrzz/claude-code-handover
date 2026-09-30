# Setup prompt

Fill the two lines at the top, then paste the whole block into a new Claude Code session opened in the project folder. Works for any project, any model mix, git or not.

````
MODELS I HAVE: <Opus only | Opus + Sonnet | Fable + Opus + Sonnet | Sonnet only>
MY STREAMS: <two or three names for the work streams in this folder, for example backend, frontend, infra>

Set up my token-saving workflow in this folder using the two lines above. Do all steps in this one session without asking me questions; where something is unclear, take the default I give and say so in the final report.

Background: long-lived chats waste usage two ways. Every return after a break longer than an hour re-writes the whole context to cache, and the same files get re-read many times after the chat is summarised. From now on: one task per session, a handover at a natural stop once the context bar passes 35 percent (hard stop at 50), a fresh session after any break longer than an hour unless the bar is under 15 percent, and a handover file that every new session loads by itself.

## Step 1: check the ground

- Say whether this folder is a git repository, and whether a CLAUDE.md already exists here or in a parent folder. Never modify an existing CLAUDE.md. My personal rules go in CLAUDE.local.md.
- Read the user settings file at ~/.claude/settings.json (Windows: C:\Users\<me>\.claude\settings.json). Create it as {} if it is missing. If a managed or organization setting would override any key from Step 6, say so in the report and skip that key.
- Note the exact model id this session runs on.

## Step 2: personal rules file

Create CLAUDE.local.md in this folder (use CLAUDE.md only if this is not a git repository and no CLAUDE.md exists) with exactly this content:

```
# Personal working rules (not committed)

Sessions are short: one task per session, then a fresh session. State between sessions lives in three places:

- @HANDOVER.md holds where the last session stopped and the exact next step. Read it first and begin the first reply by naming the next step.
- The issue tracker holds ticket status. Read tickets on demand, not all of them upfront.
- Auto memory holds durable facts and rules. It loads on its own.

## Handover ritual

- When I type /handover or say "handover", rewrite HANDOVER.md completely (current state only, under 60 lines), then update any memory file that gained a durable fact this session.
- Offer a handover unprompted when the task is finished or the context bar passes 35 percent; insist at 50 percent.
- Never re-read a large file whole when a section will do. Large logs, test output and long documents go to a subagent; only its answer comes back to this chat.
- Do not switch model inside a session. If the job needs another model, hand over and start a new session.
- Prefer command-line tools over MCP servers for the same job.
```

## Step 3: the handover file

Create HANDOVER.md next to it with this content, one section per stream from MY STREAMS:

```
# Handover (rewritten whole each time; under 60 lines; current state only)

Updated: <today> by the setup session. No work has been handed over yet.

## <stream name>
- Current task: (none yet)
- Done recently: (none yet)
- Next step: (write the exact first prompt for the next session, with its done-when)
- Open decisions or blockers: (who owes what)
- Files in play: (paths)

## Pointers (do not re-read the source documents)
- Rules card: claude-token-rules.md in this folder.
```

## Step 4: the /handover command

Create the skill at ~/.claude/skills/handover/SKILL.md (user level, so it is never committed and works in every project) with exactly this content:

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

1. The whole file stays under 60 lines. Plain sentences. Current state only, no history.
2. Fill the stream's section with exactly these lines:
   - Current task: one line.
   - Done this session: at most five dated bullets.
   - Next step: the exact first prompt for the next session, with its done-when.
   - Open decisions or blockers: who owes what.
   - Files in play: paths only.
3. Set the "Updated:" line to today's date and this session's title.
4. Check memory: if a durable fact or rule came up this session (a decision, a constraint, a correction from me), write or update the memory file and its MEMORY.md line. Task state never goes into memory.
5. If tickets changed this session, make sure their status comments match.
6. Reply with the section you wrote, then one line: "Next session: start new, <model> at <effort>, first prompt: <prompt>".
```

## Step 5: keep personal files out of the repo

If this folder is a git repository, add CLAUDE.local.md, HANDOVER.md and claude-token-rules.md to .gitignore (create it if needed) and confirm with git status that none of the three shows as untracked.

## Step 6: settings, chosen from MODELS I HAVE

Back up the user settings file as settings.json.bak-<today>, then merge the matching block into it, keeping every existing key. Print the result and confirm it parses as JSON.

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
  "cleanupPeriodDays": 365
}
```

Do not set a subagent model when I have one model only.

## Step 7: my rules card

Create claude-token-rules.md in this folder. Use the model table that matches MODELS I HAVE and drop the other one.

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
1. One task per session. Same sitting: hand over at the next natural stop once the bar passes 35 percent; hard stop at 50.
2. After a break of more than an hour: resume only if the bar is under 15 percent; otherwise start a fresh session from HANDOVER.md. Overnight: always fresh.
3. Type /handover <stream> at the stop. Then close the session.
4. Name sessions by stream and date, archive them after the handover.

## Context rules
- Ask for the section, not the whole file. Large logs, test output and long documents go to a subagent.
- No screenshots when text will do.
- Disable MCP servers you are not using in the session; prefer command-line tools.

## Daily loop
Morning: new session, model and effort per the table, type "continue <stream>". Done when the first reply names the next step.
End: /handover <stream>. Done when HANDOVER.md shows today's date.
```

## Step 8: report

Finish with: a checklist of each file created with its full path; each settings key applied or skipped and why; the git status result; then these four lines for me to keep:
1. Close this session. Open a new one here and ask "which memory files loaded, and what is my effort?" It should name CLAUDE.local.md and HANDOVER.md.
2. For each old chat you still need: open it, type /handover <stream>, close it for good.
3. Every morning: new session, "continue <stream>".
4. At a natural stop past 35 percent, or when done: /handover <stream>, close.
````
