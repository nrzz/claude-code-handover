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
