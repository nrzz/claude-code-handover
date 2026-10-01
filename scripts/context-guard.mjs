// Context guard hook for Claude Code.
// Registered for UserPromptSubmit (warns) and Stop (refuses to end a turn above the limit
// until HANDOVER.md has been rewritten). Reads the hook input on stdin, never throws.
//
// Settings (environment variables, all optional):
//   HANDOVER_CONTEXT_LIMIT   tokens that trigger the guard, default 350000 (35% of a 1M window)
//   HANDOVER_CONTEXT_WINDOW  window size used for the percentage, default 1000000
//   HANDOVER_STALE_MINUTES   how old HANDOVER.md may be before the Stop hook insists, default 30
import fs from "node:fs";
import path from "node:path";

const LIMIT = Number(process.env.HANDOVER_CONTEXT_LIMIT || 350000);
const WINDOW = Number(process.env.HANDOVER_CONTEXT_WINDOW || 1000000);
const STALE_MIN = Number(process.env.HANDOVER_STALE_MINUTES || 30);

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

// Last main-thread assistant message's context size, read from the tail of the transcript.
function contextTokens(transcriptPath) {
  try {
    const fd = fs.openSync(transcriptPath, "r");
    const size = fs.fstatSync(fd).size;
    const span = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(span);
    fs.readSync(fd, buf, 0, span, size - span);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"type":"assistant"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== "assistant" || o.isSidechain || !o.message || !o.message.usage) continue;
      const u = o.message.usage;
      const its = Array.isArray(u.iterations) && u.iterations.length ? u.iterations : [u];
      let ctx = 0;
      for (const it of its) {
        const cc = it.cache_creation || {};
        const cw = (cc.ephemeral_5m_input_tokens ?? it.cache_creation_input_tokens ?? 0) + (cc.ephemeral_1h_input_tokens || 0);
        ctx = Math.max(ctx, (it.input_tokens || 0) + (it.cache_read_input_tokens || 0) + cw);
      }
      if (ctx > 0) return ctx;
    }
  } catch { /* unreadable transcript: stay silent */ }
  return 0;
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || "{}"); } catch { input = {}; }
  const event = input.hook_event_name || "";
  const cwd = input.cwd || process.cwd();
  const handover = path.join(cwd, "HANDOVER.md");
  if (!fs.existsSync(handover)) return; // this project does not use the workflow
  const ctx = contextTokens(input.transcript_path || "");
  if (!ctx || ctx < LIMIT) return;
  const pct = Math.round((100 * ctx) / WINDOW);
  const ageMin = Math.round((Date.now() - fs.statSync(handover).mtimeMs) / 60000);

  if (event === "UserPromptSubmit") {
    process.stdout.write(`Context guard: the context is at ${pct}% (${Math.round(ctx / 1000)}K tokens). Finish the current step, then run /handover and start a fresh session. HANDOVER.md was last written ${ageMin} minutes ago.\n`);
    return;
  }
  if (event === "Stop") {
    if (input.stop_hook_active) return; // already continued once for this reason
    if (ageMin < STALE_MIN) return; // handover is fresh
    process.stdout.write(JSON.stringify({
      decision: "block",
      reason: `Context guard: the context is at ${pct}% and HANDOVER.md was last written ${ageMin} minutes ago. Before stopping: append any decision, constraint, finding or failed attempt from this session to DECISIONS.md as dated lines, then rewrite HANDOVER.md following the /handover rules for the stream you worked on, and tell the user to continue in a fresh session.`,
    }) + "\n");
  }
}

main();
