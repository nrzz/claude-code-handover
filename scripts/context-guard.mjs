// The one hook of the handover workflow. Registered for three events:
//   SessionStart      shows the newest lines of DECISIONS.md and refreshes the index
//   UserPromptSubmit  warns when the context is above the limit, and adds automatic recall:
//                     the few things from earlier sessions that match what was just asked
//   Stop              at the end of a turn above the limit, asks once for HANDOVER.md to be rewritten, unless it was
//                     written in the last HANDOVER_STALE_MINUTES; and indexes what was said in this turn
// It only acts in folders that have a HANDOVER.md. It never throws and never blocks on an error.
//
// Settings (environment variables, all optional):
//   HANDOVER_CONTEXT_WINDOW  the model's context window in tokens, default 1000000. The default limit and the
//                            percentage shown follow it: set 200000 for a 200K model
//   HANDOVER_CONTEXT_LIMIT   tokens that trigger the guard, default 35% of HANDOVER_CONTEXT_WINDOW (350000 with the
//                            default window). When it is set, it wins
//   HANDOVER_STALE_MINUTES   how old HANDOVER.md must be before the Stop hook asks for a rewrite, default 30
//   HANDOVER_AUTORECALL      set to 0 to turn automatic recall off
import fs from "node:fs";
import path from "node:path";

// A window that is not a positive number counts as unset, so a typo cannot turn the default limit into 0 or NaN.
const windowSetting = Number(process.env.HANDOVER_CONTEXT_WINDOW);
const WINDOW = Number.isFinite(windowSetting) && windowSetting > 0 ? windowSetting : 1000000;
const LIMIT = Number(process.env.HANDOVER_CONTEXT_LIMIT || Math.round((WINDOW * 35) / 100));
const STALE_MIN = Number(process.env.HANDOVER_STALE_MINUTES || 30);
const AUTORECALL = process.env.HANDOVER_AUTORECALL !== "0";

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

async function memory() {
  try { return await import("./memory-index.mjs"); } catch { return null; }
}

async function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || "{}"); } catch { input = {}; }
  const event = input.hook_event_name || "";
  const cwd = input.cwd || process.cwd();
  const handover = path.join(cwd, "HANDOVER.md");
  if (!fs.existsSync(handover)) return; // this project does not use the workflow

  const ctx = contextTokens(input.transcript_path || "");
  const over = ctx >= LIMIT;
  const pct = Math.round((100 * ctx) / WINDOW);
  const ageMin = Math.round((Date.now() - fs.statSync(handover).mtimeMs) / 60000);
  const mem = AUTORECALL ? await memory() : null;
  let out = "";

  if (event === "SessionStart") {
    if (mem) { try { mem.updateIndex(cwd, { budgetMs: 1500 }); out += mem.digest(cwd); } catch { /* stay silent */ } }
  } else if (event === "UserPromptSubmit") {
    if (over) out += `Context guard: the context is at ${pct}% (${Math.round(ctx / 1000)}K tokens). Finish the current step, then run /handover and start a fresh session. HANDOVER.md was last written ${ageMin} minutes ago.\n`;
    // Recall for what the person asked: drop injected blocks, unwrap messages relayed from another session.
    const prompt = String(input.prompt || "")
      .replace(/<(system-reminder|task-notification)[\s\S]*?<\/\1>/g, " ")
      .replace(/<\/?cross-session-message[^>]*>/g, " ")
      .replace(/^\s*Another Claude session sent a message:/i, " ")
      .replace(/This came from another Claude session[\s\S]*$/i, " ")
      .trim();
    // In a long paste the question is at the start or the end; the bulk in between is not matched.
    const asked = prompt.length > 1000 ? prompt.slice(0, 600) + " . " + prompt.slice(-300) : prompt;
    if (mem && prompt && !prompt.startsWith("/") && !prompt.startsWith("<") && !prompt.startsWith("[SYSTEM NOTIFICATION")) {
      try { mem.updateIndex(cwd, { budgetMs: 800 }); out += mem.recallBlock(cwd, asked, { sessionId: input.session_id || "", remember: true }); } catch { /* stay silent */ }
    }
  } else if (event === "Stop") {
    if (mem) { try { mem.updateIndex(cwd, { budgetMs: 1500 }); } catch { /* stay silent */ } }
    if (over && !input.stop_hook_active && ageMin >= STALE_MIN) {
      out = JSON.stringify({
        decision: "block",
        reason: `Context guard: the context is at ${pct}% and HANDOVER.md was last written ${ageMin} minutes ago. Before stopping: append any decision, constraint, finding or failed attempt from this session to DECISIONS.md as dated lines, then rewrite HANDOVER.md following the /handover rules for the stream you worked on, and tell the user to continue in a fresh session.`,
      }) + "\n";
    }
  }
  if (out) process.stdout.write(out);
}

main().catch(() => {});
