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
