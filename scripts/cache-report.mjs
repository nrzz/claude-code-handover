// Cache report from local Claude Code transcripts: cold returns, model switches, cost per prompt, biggest reads.
// Reads <config folder>/projects/**/*.jsonl: ~/.claude, or $CLAUDE_CONFIG_DIR when that is set. Nothing leaves your machine.
// Usage: node scripts/cache-report.mjs [--root <projects folder>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argRoot = process.argv.indexOf("--root");
// The folders recall reads: --root, else HANDOVER_PROJECTS_DIR, else <config folder>/projects.
const CONFIG = (process.env.CLAUDE_CONFIG_DIR || "").trim() ? path.resolve(process.env.CLAUDE_CONFIG_DIR.trim()) : path.join(os.homedir(), ".claude");
const ROOT = argRoot > -1 ? process.argv[argRoot + 1] : process.env.HANDOVER_PROJECTS_DIR || path.join(CONFIG, "projects");

const PRICE = {
  "claude-fable-5-1": [10, 50, 0.25, 12.5, 20],
  "claude-fable-5": [10, 50, 1, 12.5, 20],
  "claude-opus-5-5": [4, 20, 0.2, 5, 8],
  "claude-opus-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-8": [5, 25, 0.5, 6.25, 10],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5, 4],
  "claude-sonnet-5": [2, 10, 0.2, 2.5, 4],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25, 2],
};
function priceFor(model) {
  const k = Object.keys(PRICE).find((p) => model && model.startsWith(p));
  return k ? PRICE[k] : [5, 25, 0.5, 6.25, 10];
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const money = (n) => "$" + n.toFixed(2);

const files = walk(ROOT);
if (!files.length) { console.log(`No transcripts under ${ROOT}`); process.exit(0); }
const reqs = [];
const seen = new Set();
const toolUse = new Map();
const readBytes = new Map();
const titles = new Map();
const prompts = new Map();
for (const f of files) {
  const isAgentFile = path.relative(ROOT, f).split(/[\\/]/).length > 2;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "custom-title") { titles.set(o.sessionId, o.customTitle); continue; }
    if (o.type === "user") {
      const c = o.message && o.message.content;
      if (!o.isSidechain && !isAgentFile) {
        const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join(" ") : "";
        if (text && !text.startsWith("<")) prompts.set(o.sessionId, (prompts.get(o.sessionId) || 0) + 1);
      }
      if (Array.isArray(c)) for (const b of c) {
        if (b.type !== "tool_result") continue;
        const tu = toolUse.get(b.tool_use_id); if (!tu || tu.name !== "Read") continue;
        const k = String(tu.input.file_path || "?").replace(/\\/g, "/");
        const t = readBytes.get(k) || { bytes: 0, count: 0 }; t.bytes += JSON.stringify(b.content || "").length; t.count++; readBytes.set(k, t);
      }
      continue;
    }
    if (o.type !== "assistant" || !o.message) continue;
    const m = o.message;
    for (const b of m.content || []) if (b.type === "tool_use") toolUse.set(b.id, { name: b.name, input: b.input || {} });
    const rid = o.requestId || m.id; if (!rid || !m.usage || seen.has(rid)) continue; seen.add(rid);
    const u = m.usage; let inp = 0, cw5 = 0, cw1 = 0, cr = 0, out = 0;
    const its = Array.isArray(u.iterations) && u.iterations.length ? u.iterations : [u];
    for (const it of its) {
      inp += it.input_tokens || 0; cr += it.cache_read_input_tokens || 0; out += it.output_tokens || 0;
      const cc = it.cache_creation || {}; cw5 += cc.ephemeral_5m_input_tokens ?? (it.cache_creation_input_tokens || 0); cw1 += cc.ephemeral_1h_input_tokens || 0;
    }
    const [pi, po, pr, pw5, pw1] = priceFor(m.model);
    reqs.push({ sid: o.sessionId, ts: o.timestamp || "", model: m.model || "?", side: !!o.isSidechain || isAgentFile, cw: cw5 + cw1, ctx: inp + cr + cw5 + cw1, cost: (inp * pi + out * po + cr * pr + cw5 * pw5 + cw1 * pw1) / 1e6, cwCost: (cw5 * pw5 + cw1 * pw1) / 1e6 });
  }
}
reqs.sort((a, b) => (a.ts < b.ts ? -1 : 1));

console.log("=== CACHE RE-WRITE EVENTS (main thread, 50K+ tokens written at once) ===");
const bySession = new Map();
for (const r of reqs) { if (r.side) continue; const a = bySession.get(r.sid) || []; a.push(r); bySession.set(r.sid, a); }
const events = []; const causes = {}; const causeCost = {}; let totalCwCost = 0;
for (const [sid, arr] of bySession) for (let i = 0; i < arr.length; i++) {
  const r = arr[i]; totalCwCost += r.cwCost; if (r.cw < 50e3) continue;
  const prev = arr[i - 1]; const gapMin = prev ? (new Date(r.ts) - new Date(prev.ts)) / 60000 : Infinity;
  let cause = !prev ? "first request" : prev.model !== r.model ? "model switch" : gapMin >= 55 ? "cold return (55+ min)" : r.cw / Math.max(1, r.ctx) > 0.5 ? "other invalidation" : "normal growth";
  causes[cause] = (causes[cause] || 0) + 1; causeCost[cause] = (causeCost[cause] || 0) + r.cwCost;
  events.push({ sid, ts: r.ts, cw: r.cw, ctx: r.ctx, gapMin, cause, cost: r.cwCost, model: r.model });
}
console.log(`events ${events.length} | ${money(events.reduce((a, e) => a + e.cost, 0))} of all cache writes ${money(totalCwCost)}`);
for (const k of Object.keys(causes)) console.log(`  ${k.padEnd(24)} ${String(causes[k]).padStart(4)} events  ${money(causeCost[k])}`);
console.log("\nlargest 15:");
for (const e of events.sort((a, b) => b.cw - a.cw).slice(0, 15))
  console.log(`${e.ts.slice(0, 16)} ${(titles.get(e.sid) || e.sid.slice(0, 8)).slice(0, 30).padEnd(30)} | wrote ${fmt(e.cw).padStart(8)} of ${fmt(e.ctx).padStart(8)} | gap ${isFinite(e.gapMin) ? fmt(e.gapMin).padStart(6) + " min" : "     first"} | ${e.cause.padEnd(22)} | ${money(e.cost)} | ${e.model.replace("claude-", "")}`);

console.log("\n=== COLD RETURNS PER SESSION (gap of 55 minutes or more, with >100K context) ===");
for (const [sid, arr] of bySession) {
  let returns = 0, cost = 0; const days = new Set();
  for (let i = 1; i < arr.length; i++) { days.add(arr[i].ts.slice(0, 10)); const g = (new Date(arr[i].ts) - new Date(arr[i - 1].ts)) / 60000; if (g >= 55 && arr[i].ctx > 100e3) { returns++; cost += arr[i].cwCost; } }
  if (returns) console.log(`${(titles.get(sid) || sid.slice(0, 8)).slice(0, 40).padEnd(40)} | cold returns ${String(returns).padStart(3)} | re-cache ${money(cost).padStart(8)} | active days ${days.size}`);
}

console.log("\n=== WEIGHT PER PROMPT YOU SENT ===");
const per = new Map();
for (const r of reqs) { const s = per.get(r.sid) || { cost: 0 }; s.cost += r.cost; per.set(r.sid, s); }
for (const [sid, s] of [...per].sort((a, b) => b[1].cost - a[1].cost)) { const n = prompts.get(sid) || 0; if (n) console.log(`${(titles.get(sid) || sid.slice(0, 8)).slice(0, 44).padEnd(44)} | ${money(s.cost).padStart(8)} / ${String(n).padStart(3)} prompts = ${money(s.cost / n)} per prompt`); }

console.log("\n=== BIGGEST Read TARGETS (bytes returned into context) ===");
for (const [k, t] of [...readBytes].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 15)) console.log(`${fmt(t.bytes).padStart(10)} bytes | ${String(t.count).padStart(3)}x | ${k}`);
