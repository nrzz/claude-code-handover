// Index and search of everything said in a project's past Claude Code sessions.
// Used by the hook (automatic recall on every prompt) and usable from the command line:
//   node memory-index.mjs --build            build or update the index for the current folder
//   node memory-index.mjs --ask "question"   show what automatic recall would inject
// The index lives in <config folder>/claude-code-handover-data/<project>/ and never leaves the machine. The config
// folder is $CLAUDE_CONFIG_DIR when that is set (Claude Code keeps its transcripts in <config folder>/projects), else
// ~/.claude. HANDOVER_PROJECTS_DIR and HANDOVER_DATA_DIR override the two folders.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOME = os.homedir();
const CONFIG = (process.env.CLAUDE_CONFIG_DIR || "").trim() ? path.resolve(process.env.CLAUDE_CONFIG_DIR.trim()) : path.join(HOME, ".claude");
const CHUNK = 600;
const WINDOW_BYTES = Number(process.env.HANDOVER_RECALL_WINDOW_MB || 12) * 1024 * 1024; // about 35,000 remarks
const MAX_CHUNKS = 6;
const SKIP = ["<", "Stop hook feedback", "[Request interrupted", "Another Claude session sent a message", "This session is being continued", "Caveat:", "No response requested"];
const STOP = new Set(("the a an and or but if then else for to of in on at by with from as is are was were be been being it this that these those i you he she we they me my your our their its not no yes do does did done have has had can could should would will shall may might must just also only very more most less least so such than too into over under about above after before again once here there when where why how what which who whom all any both each few other some own same don now please need want make made get got give gave use used using let lets like one two new old way thing things still even much many well back then them him her out off put see say said tell told know think going come came take took look looks good right okay yes yeah").split(" "));

export const projectKey = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, "-");
export const transcriptsDir = (cwd) => path.join(process.env.HANDOVER_PROJECTS_DIR || path.join(CONFIG, "projects"), projectKey(cwd));
export const dataDir = (cwd) => path.join(process.env.HANDOVER_DATA_DIR || path.join(CONFIG, "claude-code-handover-data"), projectKey(cwd));

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
  let changed = false; // state.json is only rewritten when a transcript had something new
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
    changed = true;
  }
  if (lines.length) fs.appendFileSync(path.join(out, "index.jsonl"), lines.join("\n") + "\n");
  if (changed) fs.writeFileSync(path.join(out, "state.json"), JSON.stringify(state));
  return { added: lines.length, complete };
}

export function terms(text) {
  const seen = new Set();
  const out = [];
  for (const w of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (w.length < 3 || STOP.has(w) || seen.has(w) || /^\d+$/.test(w)) continue;
    seen.add(w);
    out.push(w);
  }
  // Ticket-style ids such as ABC-123 are kept whole: they are the most specific words in a prompt.
  for (const id of text.toLowerCase().match(/[a-z]{2,}-\d+/g) || []) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out.slice(0, 40);
}

// Position where `word` starts a word in `text`, or -1. Both are lower case.
function wordStart(text, word) {
  let i = text.indexOf(word);
  while (i !== -1) {
    if (i === 0) return 0;
    const c = text.charCodeAt(i - 1);
    const alnum = (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || c === 95;
    if (!alnum) return i;
    i = text.indexOf(word, i + 1);
  }
  return -1;
}

// Up to `limit` positions where `word` starts a word in `text`.
function positions(text, word, limit = 4) {
  const out = [];
  let i = text.indexOf(word);
  while (i !== -1 && out.length < limit) {
    const c = i === 0 ? 32 : text.charCodeAt(i - 1);
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 122) || c === 95)) out.push(i);
    i = text.indexOf(word, i + 1);
  }
  return out;
}

// Length in characters of the tightest stretch of `text` that holds all `words`, tried around each
// occurrence of the rarest one.
function tightSpan(text, words, anchor) {
  const pos = words.map((w) => positions(text, w));
  let best = text.length;
  for (const a of positions(text, anchor)) {
    let lo = a, hi = a;
    for (const p of pos) {
      if (!p.length) continue;
      let nearest = p[0];
      for (const x of p) if (Math.abs(x - a) < Math.abs(nearest - a)) nearest = x;
      lo = Math.min(lo, nearest); hi = Math.max(hi, nearest);
    }
    best = Math.min(best, hi - lo);
  }
  return best;
}

// Natural log of the number of ways to choose k of n.
function logChoose(n, k) {
  let v = 0;
  for (let i = 1; i <= k; i++) v += Math.log((n - k + i) / i);
  return v;
}

// Returns up to `max` past snippets. The prompt is matched sentence by sentence, so a long message
// with instructions around one real question still finds what was said about that question.
export function search(cwd, prompt, { sessionId = "", max = 3, remember = false } = {}) {
  const sentences = prompt.split(/[.?!\n;]+/).map((s) => terms(s)).filter((s) => s.length >= 2).slice(0, 16);
  if (!sentences.length) return [];
  const q = [...new Set(sentences.flat())].slice(0, 80);
  const out = dataDir(cwd);
  const state = loadState(out);
  const entries = [];
  const indexPath = path.join(out, "index.jsonl");
  if (fs.existsSync(indexPath)) {
    // Only the newest part of the index is searched, so a prompt costs the same after years of use.
    // Older remarks stay reachable through /recall and the decisions log.
    const size = fs.statSync(indexPath).size;
    const span = Math.min(size, WINDOW_BYTES);
    const buf = Buffer.alloc(span);
    const fd = fs.openSync(indexPath, "r");
    fs.readSync(fd, buf, 0, span, size - span);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n");
    if (span < size) lines.shift(); // the first line is cut off
    for (const line of lines) {
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
  const df = new Array(q.length).fill(0);
  let lengthSum = 0;
  const hits = entries.map((e) => {
    const lx = e.x.toLowerCase();
    lengthSum += lx.length;
    const m = [];
    for (let i = 0; i < q.length; i++) if (wordStart(lx, q[i]) !== -1) { m.push(i); df[i]++; }
    return m;
  });
  const meanLength = lengthSum / N;
  // Rare words weigh more. A snippet must share at least two words with one sentence of the prompt,
  // cover half of that sentence, and show enough evidence that the overlap is not chance (see below).
  // The bar is lower while the history is small: there is little to match by chance.
  const STRICT = Number(process.env.HANDOVER_RECALL_STRICTNESS || 4) * Math.min(1, Math.log(N + 1) / Math.log(200));
  const LOGN = Math.log(N);
  const idf = df.map((d) => (d > 0 ? Math.log(1 + N / d) : 0));
  const surprise = df.map((d) => (d > 0 ? Math.log(N / d) : 0)); // how unlikely the word is in a random remark
  const rareLimit = Math.max(3, 0.02 * N); // a word is rare when at most 2% of remarks hold it
  const isId = q.map((w, i) => /^[a-z]{2,}-\d+$/.test(w) && df[i] > 0 && df[i] <= rareLimit);
  const at = new Map(q.map((w, i) => [w, i]));
  const compactLine = state.compact[sessionId] || 0;
  const promptHead = prompt.trim().slice(0, 80);
  const best = new Map();
  for (const sentence of sentences) {
    const idx = sentence.map((w) => at.get(w)).filter((i) => i !== undefined);
    const informative = idx.filter((i) => idf[i] > 0).sort((x, y) => idf[y] - idf[x]).slice(0, 10);
    if (informative.length < 2) continue;
    const useful = new Set(informative);
    // Words never said before count against a match (at most two), so "fix the typo in the readme"
    // does not match every remark about a readme.
    const unseen = Math.min(2, idx.filter((i) => df[i] === 0).length);
    const total = informative.reduce((s, i) => s + idf[i], 0) + unseen * Math.log(1 + N);
    entries.forEach((e, k) => {
      const m = hits[k].filter((i) => useful.has(i));
      if (!m.length) return;
      if (e.s === sessionId && !(compactLine && e.n < compactLine)) return; // still in this session's context
      if (e.x.startsWith(promptHead)) return;
      // A ticket-style id that both name is enough on its own: the remark is about that ticket.
      const id = m.find((i) => isId[i]);
      if (id !== undefined) {
        const prev = best.get(k);
        const score = STRICT + surprise[id] + (e.dec ? 1 : 0);
        if (!prev || prev.score < score) best.set(k, { score, m, why: `shared id=${q[id]} history=${N}` });
        return;
      }
      if (m.length < 2) return;
      const base = m.reduce((s, i) => s + idf[i], 0);
      const lx = e.x.toLowerCase();
      // A phrase of the prompt (two words in a row, at least one of them rare) that the remark repeats
      // word for word names the same thing: "cold start", "royal mail".
      for (let a = 0; a + 1 < idx.length; a++) {
        const i = idx[a], j = idx[a + 1];
        if (!m.includes(i) || !m.includes(j) || Math.min(df[i], df[j]) > rareLimit) continue;
        const pj = positions(lx, q[j]);
        if (positions(lx, q[i]).some((p) => pj.some((x) => x > p && x - p <= q[i].length + 3))) {
          const prev = best.get(k);
          const score = STRICT + m.reduce((s, t) => s + surprise[t], 0) / 4 + (e.dec ? 1 : 0);
          if (!prev || prev.score < score) best.set(k, { score, m, why: `shared phrase=${q[i]} ${q[j]} history=${N}` });
          return;
        }
      }
      // It must contain the sentence's rarest known word, or else cover most of the sentence.
      const need = m.includes(informative[0]) ? 0.5 : 0.7;
      if (base / total < need) return;
      // Evidence that the overlap is not chance: how rare the shared words are, plus how close together
      // they sit in the remark, minus what a history this large and a sentence this long give for free.
      const rare = m.reduce((p, i) => (idf[i] > idf[p] ? i : p), m[0]);
      const span = tightSpan(lx, m.map((i) => q[i]), q[rare]);
      const words = Math.max(20, Math.round(lx.length / 6));
      const near = Math.max(m.length, Math.round(span / 6) + 1);
      const closeness = (m.length - 1) * Math.log(Math.max(1, words / near));
      // A long remark holds any given word more often, so its matches count for less.
      const longer = Math.max(0, Math.log(lx.length / meanLength));
      let score = m.reduce((s, i) => s + Math.max(0, surprise[i] - longer), 0) + closeness - logChoose(informative.length, m.length) - LOGN;
      if (score < (e.dec ? STRICT - 1.5 : STRICT)) return; // the decisions log is curated, so its bar is lower
      if (e.dec) score += 1.5; // and a logged decision outranks a passing remark
      const prev = best.get(k);
      if (!prev || prev.score < score) best.set(k, { score, m, why: `shared=${m.map((i) => q[i]).join("+")} rarity=${base.toFixed(1)} closeness=${closeness.toFixed(1)} sentenceWords=${informative.length} history=${N}` });
    });
  }
  const scored = [...best].map(([k, v]) => ({ e: entries[k], score: v.score, m: v.m, why: v.why }));
  scored.sort((x, y) => y.score - x.score || (x.e.d < y.e.d ? 1 : -1));
  const picked = [];
  const seen = new Set();
  // A line already given to this session is not given again: it is still in its context.
  const memoPath = remember && sessionId ? path.join(out, "given", `${sessionId.replace(/[^A-Za-z0-9_-]/g, "")}.json`) : "";
  let given = [];
  if (memoPath) { try { given = JSON.parse(fs.readFileSync(memoPath, "utf8")); } catch { given = []; } }
  const already = new Set(given);
  const top = scored.length ? scored[0].score : 0;
  for (const s of scored) {
    if (s.score < 0.7 * top) break; // keep only snippets close to the best one
    const msgKey = s.e.dec ? "" : `${s.e.s}:${s.e.n}`; // one snippet per message
    const textKey = s.e.x.slice(0, 100).replace(/\s+/g, " "); // forked sessions repeat the same text
    if (already.has(textKey)) continue;
    if ((msgKey && seen.has(msgKey)) || seen.has(textKey)) continue;
    if (msgKey) seen.add(msgKey);
    seen.add(textKey);
    const rarest = s.m.reduce((p, i) => (idf[i] > idf[p] ? i : p), s.m[0]); // show the text around the rarest shared word
    const pos = Math.max(0, wordStart(s.e.x.toLowerCase(), q[rarest]));
    const start = Math.max(0, pos - 110);
    const snip = (start > 0 ? "..." : "") + s.e.x.slice(start, start + 330).replace(/\s+/g, " ").trim() + (start + 330 < s.e.x.length ? "..." : "");
    picked.push({ date: s.e.d, who: s.e.r, where: s.e.dec ? "DECISIONS.md" : state.titles[s.e.s] || "earlier session", text: snip, score: s.score, why: s.why });
    given.push(textKey);
    if (picked.length >= max) break;
  }
  if (memoPath && picked.length) {
    try { fs.mkdirSync(path.dirname(memoPath), { recursive: true }); fs.writeFileSync(memoPath, JSON.stringify(given.slice(-300))); } catch { /* not fatal */ }
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
export function digest(cwd, count = 8) {
  const dec = path.join(cwd, "DECISIONS.md");
  if (!fs.existsSync(dec)) return "";
  const lines = fs.readFileSync(dec, "utf8").split("\n").filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l));
  if (!lines.length) return "";
  return `Latest entries of DECISIONS.md (${Math.min(count, lines.length)} of ${lines.length}):\n` + lines.slice(-count).map((l) => l.slice(0, 220)).join("\n") + "\n";
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const cwd = process.cwd();
  if (process.argv.includes("--build")) {
    let total = 0, r;
    do { r = updateIndex(cwd, { budgetMs: 4000 }); total += r.added; } while (!r.complete);
    if (!fs.existsSync(transcriptsDir(cwd))) console.log(`No past sessions for ${projectKey(cwd)} yet. The index builds itself as sessions happen.`);
    else console.log(`Index for ${projectKey(cwd)}: ${total} new entries. Stored in ${dataDir(cwd)}`);
  } else if (process.argv.includes("--ask")) {
    const qn = process.argv.slice(process.argv.indexOf("--ask") + 1).join(" ");
    updateIndex(cwd);
    console.log(recallBlock(cwd, qn) || "(nothing relevant enough to inject)");
  } else {
    console.log('Usage: node memory-index.mjs --build | --ask "question"');
  }
}
