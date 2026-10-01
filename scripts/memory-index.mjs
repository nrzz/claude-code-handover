// Index and search of everything said in a project's past Claude Code sessions.
// Used by the hook (automatic recall on every prompt) and usable from the command line:
//   node memory-index.mjs --build            build or update the index for the current folder
//   node memory-index.mjs --ask "question"   show what automatic recall would inject
// The index lives in ~/.claude/claude-code-handover-data/<project>/ and never leaves the machine.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOME = os.homedir();
const CHUNK = 600;
const MAX_CHUNKS = 6;
const SKIP = ["<", "Stop hook feedback", "[Request interrupted", "Another Claude session sent a message", "This session is being continued", "Caveat:", "No response requested"];
const STOP = new Set(("the a an and or but if then else for to of in on at by with from as is are was were be been being it this that these those i you he she we they me my your our their its not no yes do does did done have has had can could should would will shall may might must just also only very more most less least so such than too into over under about above after before again once here there when where why how what which who whom all any both each few other some own same don now please need want make made get got give gave use used using let lets like one two new old way thing things still even much many well back then them him her out off put see say said tell told know think going come came take took look looks good right okay yes yeah").split(" "));

export const projectKey = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, "-");
export const transcriptsDir = (cwd) => path.join(process.env.HANDOVER_PROJECTS_DIR || path.join(HOME, ".claude", "projects"), projectKey(cwd));
export const dataDir = (cwd) => path.join(process.env.HANDOVER_DATA_DIR || path.join(HOME, ".claude", "claude-code-handover-data"), projectKey(cwd));

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n");
}
function loadState(dir) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")); } catch { s = {}; }
  s.files = s.files || {}; s.titles = s.titles || {}; s.compact = s.compact || {};
  return s;
}

// Reads only the bytes added to each transcript since the last call. Stops when the time budget is used up.
export function updateIndex(cwd, { budgetMs = 2500 } = {}) {
  const dir = transcriptsDir(cwd);
  if (!fs.existsSync(dir)) return { added: 0, complete: true };
  const out = dataDir(cwd);
  fs.mkdirSync(out, { recursive: true });
  const state = loadState(out);
  const started = Date.now();
  const lines = [];
  let complete = true;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    const sid = name.slice(0, -6);
    let size;
    try { size = fs.statSync(file).size; } catch { continue; }
    const st = state.files[name] || { offset: 0, line: 0 };
    if (size < st.offset) { st.offset = 0; st.line = 0; }
    if (size === st.offset) continue;
    if (Date.now() - started > budgetMs) { complete = false; break; }
    const len = size - st.offset;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, buf, 0, len, st.offset);
    fs.closeSync(fd);
    const lastNl = buf.lastIndexOf(10);
    if (lastNl === -1) continue;
    const text = buf.subarray(0, lastNl).toString("utf8");
    for (const line of text.split("\n")) {
      st.line++;
      if (!line) continue;
      if (line.includes('"type":"custom-title"')) { try { state.titles[sid] = JSON.parse(line).customTitle || state.titles[sid]; } catch { /* skip */ } continue; }
      if (line.includes('"isCompactSummary":true')) state.compact[sid] = st.line;
      if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if ((o.type !== "user" && o.type !== "assistant") || !o.message || o.isSidechain) continue;
      const t = textOf(o.message.content).trim();
      if (t.length < 12 || SKIP.some((p) => t.startsWith(p))) continue;
      const d = (o.timestamp || "").slice(0, 10);
      for (let i = 0, c = 0; i < t.length && c < MAX_CHUNKS; i += CHUNK, c++) {
        lines.push(JSON.stringify({ s: sid, n: st.line, d, r: o.type === "user" ? "you" : "claude", x: t.slice(i, i + CHUNK + 80) }));
      }
    }
    st.offset += lastNl + 1;
    state.files[name] = st;
  }
  if (lines.length) fs.appendFileSync(path.join(out, "index.jsonl"), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(out, "state.json"), JSON.stringify(state));
  return { added: lines.length, complete };
}

export function terms(prompt) {
  const seen = new Set();
  const out = [];
  for (const w of prompt.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (w.length < 3 || STOP.has(w) || seen.has(w) || /^\d+$/.test(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.slice(0, 40);
}

// Returns up to `max` past snippets that share at least two informative terms with the prompt.
export function search(cwd, prompt, { sessionId = "", max = 3 } = {}) {
  const q = terms(prompt);
  if (q.length < 2) return [];
  const out = dataDir(cwd);
  const state = loadState(out);
  const entries = [];
  const indexPath = path.join(out, "index.jsonl");
  if (fs.existsSync(indexPath)) {
    for (const line of fs.readFileSync(indexPath, "utf8").split("\n")) {
      if (!line) continue;
      try { entries.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }
  const dec = path.join(cwd, "DECISIONS.md");
  if (fs.existsSync(dec)) {
    for (const line of fs.readFileSync(dec, "utf8").split("\n")) {
      if (/^- \d{4}-\d{2}-\d{2}/.test(line)) entries.push({ s: "DECISIONS", d: line.slice(2, 12), r: "log", x: line.slice(13).trim(), dec: 1 });
    }
  }
  const N = entries.length;
  if (!N) return [];
  const res = q.map((t) => new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const df = new Array(q.length).fill(0);
  const hits = entries.map((e) => {
    const m = [];
    for (let i = 0; i < res.length; i++) if (res[i].test(e.x)) { m.push(i); df[i]++; }
    return m;
  });
  // Rare words weigh more. A snippet must share at least two of the prompt's words, cover half of
  // their combined weight, and reach a floor that two everyday words alone cannot reach.
  const MIN_SCORE = 2 * Math.log(1 + N / Math.max(1, 0.05 * N)); // two words that each appear in 5% of everything said (6.1 once the history is large)
  const idf = df.map((d) => (d > 0 ? Math.log(1 + N / d) : 0));
  const informative = idf.map((v, i) => [v, i]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]).slice(0, 10).map(([, i]) => i);
  if (informative.length < 2) return [];
  const useful = new Set(informative);
  // Words of the prompt that were never said before count against a match (at most two of them),
  // so "fix the typo in the readme" does not match every remark about a readme.
  const unseen = Math.min(2, df.filter((d) => d === 0).length);
  const total = informative.reduce((a, i) => a + idf[i], 0) + unseen * Math.log(1 + N);
  const compactLine = state.compact[sessionId] || 0;
  const promptHead = prompt.trim().slice(0, 80);
  const scored = [];
  entries.forEach((e, k) => {
    const m = hits[k].filter((i) => useful.has(i));
    if (m.length < 2) return;
    if (e.s === sessionId && !(compactLine && e.n < compactLine)) return; // still in this session's context
    if (e.x.startsWith(promptHead)) return;
    let score = m.reduce((a, i) => a + idf[i], 0);
    // It must contain the prompt's rarest known word, or else cover most of the prompt.
    const need = m.includes(informative[0]) ? 0.5 : 0.7;
    if (score < MIN_SCORE || score / total < need) return;
    if (e.dec) score *= 1.3; // a logged decision outranks a passing remark
    scored.push({ e, score, m });
  });
  scored.sort((a, b) => b.score - a.score || (a.e.d < b.e.d ? 1 : -1));
  const picked = [];
  const seen = new Set();
  const best = scored.length ? scored[0].score : 0;
  for (const s of scored) {
    if (s.score < 0.7 * best) break; // keep only snippets close to the best one
    const msgKey = s.e.dec ? "" : `${s.e.s}:${s.e.n}`; // one snippet per message
    const textKey = s.e.x.slice(0, 100).replace(/\s+/g, " "); // forked sessions repeat the same text
    if ((msgKey && seen.has(msgKey)) || seen.has(textKey)) continue;
    if (msgKey) seen.add(msgKey);
    seen.add(textKey);
    const rarest = s.m.reduce((a, i) => (idf[i] > idf[a] ? i : a), s.m[0]); // show the text around the rarest shared word
    const pos = Math.max(0, s.e.x.search(res[rarest]));
    const start = Math.max(0, pos - 110);
    const snip = (start > 0 ? "..." : "") + s.e.x.slice(start, start + 330).replace(/\s+/g, " ").trim() + (start + 330 < s.e.x.length ? "..." : "");
    picked.push({ date: s.e.d, who: s.e.r, where: s.e.dec ? "DECISIONS.md" : state.titles[s.e.s] || "earlier session", text: snip });
    if (picked.length >= max) break;
  }
  return picked;
}

export function recallBlock(cwd, prompt, opts) {
  const found = search(cwd, prompt, opts);
  if (!found.length) return "";
  return "Automatic recall, from earlier sessions of this project (check before relying on it):\n" +
    found.map((f) => `- [${f.date} | ${f.where} | ${f.who}] ${f.text}`).join("\n") + "\n";
}

// The newest lines of the decisions log, shown once when a session starts.
export function digest(cwd, count = 12) {
  const dec = path.join(cwd, "DECISIONS.md");
  if (!fs.existsSync(dec)) return "";
  const lines = fs.readFileSync(dec, "utf8").split("\n").filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l));
  if (!lines.length) return "";
  return `Latest entries of DECISIONS.md (${Math.min(count, lines.length)} of ${lines.length}):\n` + lines.slice(-count).map((l) => l.slice(0, 300)).join("\n") + "\n";
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const cwd = process.cwd();
  if (process.argv.includes("--build")) {
    let total = 0, r;
    do { r = updateIndex(cwd, { budgetMs: 4000 }); total += r.added; } while (!r.complete);
    console.log(`Index for ${projectKey(cwd)}: ${total} new entries. Stored in ${dataDir(cwd)}`);
  } else if (process.argv.includes("--ask")) {
    const qn = process.argv.slice(process.argv.indexOf("--ask") + 1).join(" ");
    updateIndex(cwd);
    console.log(recallBlock(cwd, qn) || "(nothing relevant enough to inject)");
  } else {
    console.log('Usage: node memory-index.mjs --build | --ask "question"');
  }
}
