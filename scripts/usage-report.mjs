// Usage report from local Claude Code transcripts: tokens and estimated weight per session, model, effort and tool.
// Reads <config folder>/projects/**/*.jsonl: ~/.claude, or $CLAUDE_CONFIG_DIR when that is set. Nothing leaves your machine.
// Usage: node scripts/usage-report.mjs [--root <projects folder>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argRoot = process.argv.indexOf("--root");
// The folders recall reads: --root, else HANDOVER_PROJECTS_DIR, else <config folder>/projects.
const CONFIG = (process.env.CLAUDE_CONFIG_DIR || "").trim() ? path.resolve(process.env.CLAUDE_CONFIG_DIR.trim()) : path.join(os.homedir(), ".claude");
const ROOT = argRoot > -1 ? process.argv[argRoot + 1] : process.env.HANDOVER_PROJECTS_DIR || path.join(CONFIG, "projects");

// $/MTok at published API list prices (2026-10-01): [input, output, cacheRead, cacheWrite5m, cacheWrite1h]
const PRICE = {
  "claude-fable-5-1": [10, 50, 0.25, 12.5, 20],
  "claude-fable-5": [10, 50, 1, 12.5, 20],
  "claude-opus-5-5": [4, 20, 0.2, 5, 8],
  "claude-opus-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-8": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-7": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-6": [5, 25, 0.5, 6.25, 10],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5, 4],
  "claude-sonnet-5": [2, 10, 0.2, 2.5, 4],
  "claude-sonnet-4-6": [3, 15, 0.3, 3.75, 6],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25, 2],
};
function priceFor(model) {
  if (PRICE[model]) return PRICE[model];
  const k = Object.keys(PRICE).find((p) => model && model.startsWith(p));
  return k ? PRICE[k] : [5, 25, 0.5, 6.25, 10];
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
if (!files.length) { console.log(`No transcripts under ${ROOT}`); process.exit(0); }
const requests = new Map();
const titles = new Map();
const toolUseNames = new Map();
const toolResultBytes = new Map();
const userPrompts = new Map();

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  const project = rel.split("/")[0];
  const isAgentFile = rel.split("/").length > 2;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const sid = o.sessionId;
    if (o.type === "custom-title" && sid) { titles.set(sid, o.customTitle); continue; }
    if (o.type === "user" && sid) {
      const c = o.message && o.message.content;
      let text = typeof c === "string" ? c : "";
      if (Array.isArray(c)) for (const b of c) {
        if (b.type === "tool_result") {
          const name = toolUseNames.get(b.tool_use_id) || "unknown";
          const t = toolResultBytes.get(name) || { bytes: 0, count: 0 };
          t.bytes += JSON.stringify(b.content || "").length; t.count++;
          toolResultBytes.set(name, t);
        } else if (b.type === "text") text += b.text || "";
      }
      // A prompt you typed: text that is not an injected system block (those start with "<").
      if (text && !text.startsWith("<") && !o.isSidechain && !isAgentFile) userPrompts.set(sid, (userPrompts.get(sid) || 0) + 1);
      continue;
    }
    if (o.type !== "assistant" || !o.message) continue;
    const m = o.message;
    for (const b of m.content || []) if (b.type === "tool_use") toolUseNames.set(b.id, b.name);
    const rid = o.requestId || m.id;
    if (!rid || !m.usage || requests.has(rid)) continue;
    const u = m.usage;
    let inp = 0, cw5 = 0, cw1 = 0, cr = 0, out = 0;
    const its = Array.isArray(u.iterations) && u.iterations.length ? u.iterations : [u];
    for (const it of its) {
      inp += it.input_tokens || 0; cr += it.cache_read_input_tokens || 0; out += it.output_tokens || 0;
      const cc = it.cache_creation || {};
      cw5 += cc.ephemeral_5m_input_tokens ?? (it.cache_creation_input_tokens || 0);
      cw1 += cc.ephemeral_1h_input_tokens || 0;
    }
    const think = (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0;
    const [pi, po, pr, pw5, pw1] = priceFor(m.model);
    requests.set(rid, {
      sid, project, ts: o.timestamp || "", model: m.model || "?", effort: o.effort || o.perTurnEffort || "?",
      sidechain: !!o.isSidechain || isAgentFile, inp, cw: cw5 + cw1, cr, out, think,
      ctx: inp + cr + cw5 + cw1, cost: (inp * pi + out * po + cr * pr + cw5 * pw5 + cw1 * pw1) / 1e6,
    });
  }
}

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const money = (n) => "$" + n.toFixed(2);

const perSession = new Map();
for (const r of requests.values()) {
  const s = perSession.get(r.sid) || { sid: r.sid, project: r.project, reqs: 0, out: 0, think: 0, cost: 0, maxCtx: 0, ctxSum: 0, models: {}, efforts: {}, first: r.ts, last: r.ts, sideCost: 0 };
  s.reqs++; s.out += r.out; s.think += r.think; s.cost += r.cost; s.maxCtx = Math.max(s.maxCtx, r.ctx); s.ctxSum += r.ctx;
  s.models[r.model] = (s.models[r.model] || 0) + r.cost; s.efforts[r.effort] = (s.efforts[r.effort] || 0) + 1;
  if (r.ts < s.first) s.first = r.ts; if (r.ts > s.last) s.last = r.ts; if (r.sidechain) s.sideCost += r.cost;
  perSession.set(r.sid, s);
}
let total = 0;
console.log("=== PER SESSION (estimated weight at API list prices) ===");
for (const s of [...perSession.values()].sort((a, b) => b.cost - a.cost)) {
  total += s.cost;
  const prompts = userPrompts.get(s.sid) || 0;
  const modelStr = Object.entries(s.models).sort((a, b) => b[1] - a[1]).map(([m, c]) => `${m.replace("claude-", "")} ${money(c)}`).join(", ");
  const effStr = Object.entries(s.efforts).map(([e, n]) => `${e}=${n}`).join(",");
  console.log(`${money(s.cost).padStart(8)} | ${(titles.get(s.sid) || s.project).slice(0, 40).padEnd(40)} | ${s.first.slice(0, 10)}..${s.last.slice(5, 10)} | prompts ${String(prompts).padStart(3)} | reqs ${String(s.reqs).padStart(4)} | per prompt ${money(prompts ? s.cost / prompts : 0).padStart(6)} | max ctx ${fmt(s.maxCtx).padStart(8)} | avg ctx ${fmt(s.ctxSum / s.reqs).padStart(8)} | subagents ${money(s.sideCost)} | ${modelStr} | effort ${effStr}`);
}
console.log(`TOTAL ${money(total)} across ${perSession.size} sessions, ${requests.size} requests`);

console.log("\n=== PER MODEL ===");
const perModel = new Map();
for (const r of requests.values()) {
  const s = perModel.get(r.model) || { reqs: 0, out: 0, think: 0, cost: 0 };
  s.reqs++; s.out += r.out; s.think += r.think; s.cost += r.cost; perModel.set(r.model, s);
}
for (const [m, s] of [...perModel].sort((a, b) => b[1].cost - a[1].cost))
  console.log(`${m.padEnd(26)} reqs ${String(s.reqs).padStart(5)} | out ${fmt(s.out).padStart(10)} | thinking ${fmt(s.think).padStart(10)} | ${money(s.cost).padStart(8)} (${(100 * s.cost / total).toFixed(1)}%)`);

console.log("\n=== WEIGHT BY COMPONENT ===");
let cIn = 0, cOut = 0, cCr = 0, cCw = 0;
for (const r of requests.values()) { const [pi, po, pr] = priceFor(r.model); cIn += r.inp * pi / 1e6; cOut += r.out * po / 1e6; cCr += r.cr * pr / 1e6; }
cCw = total - cIn - cOut - cCr;
console.log(`uncached input ${money(cIn)} | cache writes ${money(cCw)} (${(100 * cCw / total).toFixed(0)}%) | cache reads ${money(cCr)} (${(100 * cCr / total).toFixed(0)}%) | output ${money(cOut)} (${(100 * cOut / total).toFixed(0)}%)`);

console.log("\n=== PER EFFORT (main thread) ===");
const perEffort = new Map();
for (const r of requests.values()) { if (r.sidechain) continue; const s = perEffort.get(r.effort) || { reqs: 0, out: 0, think: 0, cost: 0 }; s.reqs++; s.out += r.out; s.think += r.think; s.cost += r.cost; perEffort.set(r.effort, s); }
for (const [e, s] of [...perEffort].sort((a, b) => b[1].reqs - a[1].reqs))
  console.log(`${String(e).padEnd(8)} reqs ${String(s.reqs).padStart(5)} | output per request ${fmt(s.out / s.reqs).padStart(6)} | thinking per request ${fmt(s.think / s.reqs).padStart(6)} | ${money(s.cost)}`);

console.log("\n=== WEIGHT BY CONTEXT SIZE (main thread) ===");
for (const [lo, hi, label] of [[0, 100e3, "<100K"], [100e3, 200e3, "100-200K"], [200e3, 400e3, "200-400K"], [400e3, 600e3, "400-600K"], [600e3, 2e6, ">600K"]]) {
  let n = 0, c = 0;
  for (const r of requests.values()) if (!r.sidechain && r.ctx >= lo && r.ctx < hi) { n++; c += r.cost; }
  console.log(`${label.padEnd(9)} reqs ${String(n).padStart(5)} | ${money(c).padStart(8)} (${(100 * c / total).toFixed(1)}%)`);
}

console.log("\n=== TOOL RESULTS (what filled the context) ===");
const totalBytes = [...toolResultBytes.values()].reduce((a, b) => a + b.bytes, 0) || 1;
for (const [n, t] of [...toolResultBytes].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 15))
  console.log(`${n.slice(0, 45).padEnd(45)} ~${fmt(t.bytes / 4).padStart(10)} tokens | calls ${String(t.count).padStart(5)} | ${(100 * t.bytes / totalBytes).toFixed(1)}%`);
console.log(`\n${files.length} transcript files under ${ROOT}`);
