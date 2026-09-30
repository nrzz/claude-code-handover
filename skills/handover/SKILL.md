---
name: handover
description: Rewrite HANDOVER.md in the current project so the next fresh session can continue this stream without the old context. Run at the end of a session or when the context bar passes 35 percent.
disable-model-invocation: true
argument-hint: [stream name]
---

Rewrite HANDOVER.md in the current working folder as a whole file (never append) so that a brand-new session with none of this conversation can continue the work.

Stream to update: $ARGUMENTS. If empty, use the stream this session worked on. Leave the other streams' sections exactly as they are.

Rules:

1. The whole file stays under 60 lines. Plain sentences. Current state only, no history. Keep the Pointers section at the end.
2. Fill the stream's section with exactly these lines:
   - Current task: one line.
   - Done recently: at most five dated bullets.
   - Next step: the exact first prompt for the next session, with its done-when.
   - Open decisions or blockers: who owes what.
   - Files in play: paths only.
3. Set the "Updated:" line to today's date and this session's title.
4. Check memory: if a durable fact or rule came up this session (a decision, a constraint, a correction from me), write or update the memory file and its MEMORY.md line. Task state never goes into memory.
5. If tickets changed this session, make sure their status comments match.
6. Reply with the section you wrote, then one line: "Next session: start new, <model> at <effort>, first prompt: <prompt>".
