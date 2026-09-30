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
