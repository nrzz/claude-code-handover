// Stress test for automatic recall. Safe to run anywhere: it works in a temporary folder.
//   node scripts/selftest.mjs            synthetic histories in four sizes, several seeds
//   node scripts/selftest.mjs --replay   also replays the real prompts of the current folder's history
// It plants facts in generated sessions, then asks about them from another session inside long
// messages, and counts: facts found, false injections on unrelated prompts, repeats of lines that are
// still in the asking session, build time, time per prompt and tokens added.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handover-selftest-"));
process.env.HANDOVER_PROJECTS_DIR = path.join(tmp, "projects");
process.env.HANDOVER_DATA_DIR = path.join(tmp, "data");
const realProjects = path.join(os.homedir(), ".claude", "projects");
const realData = path.join(os.homedir(), ".claude", "claude-code-handover-data");
const WINDOW = Number(process.env.HANDOVER_RECALL_WINDOW_MB || 12) * 1024 * 1024;
const mem = await import("./memory-index.mjs");

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const SYL = "ba be bi bo bu da de di do du fa fe fi fo fu ga ge gi go gu ka ke ki ko ku la le li lo lu ma me mi mo mu na ne ni no nu pa pe pi po pu ra re ri ro ru sa se si so su ta te ti to tu va ve vi vo vu".split(" ");
function makeVocab(r, n) { const v = new Set(); while (v.size < n) { let w = ""; const k = 2 + Math.floor(r() * 3); for (let i = 0; i < k; i++) w += SYL[Math.floor(r() * SYL.length)]; v.add(w); } return [...v]; }
// Zipf-like pick: low ranks are common words, high ranks are rare.
function pick(r, vocab) { return vocab[Math.min(vocab.length - 1, Math.floor(Math.pow(r(), 2.2) * vocab.length))]; }
function sentence(r, vocab, n) { const w = []; for (let i = 0; i < n; i++) w.push(pick(r, vocab)); return w.join(" "); }
const tokens = (chars) => Math.round(chars / 4);

function run(sessions, turns, seed) {
  const r = rng(seed);
  const vocab = makeVocab(r, 3000);
  const proj = path.join(tmp, `proj-${sessions}-${turns}-${seed}`);
  fs.mkdirSync(proj, { recursive: true });
  const dir = mem.transcriptsDir(proj);
  fs.mkdirSync(dir, { recursive: true });
  const facts = [];
  const nFacts = Math.min(60, Math.max(6, Math.round(sessions * 0.6)));
  const factAt = new Map();
  for (let f = 0; f < nFacts; f++) {
    const s = Math.floor(r() * sessions), t = Math.floor(r() * turns);
    const fact = { id: f, s, t, keys: [`zq${f}alpha`, `xv${f}bravo`, `wj${f}carol`], value: `VALUE${f}X`, compacted: r() < 0.25 };
    if (factAt.has(`${s}:${t}`)) continue;
    facts.push(fact);
    factAt.set(`${s}:${t}`, fact);
  }
  for (let s = 0; s < sessions; s++) {
    const lines = [JSON.stringify({ type: "custom-title", customTitle: `session ${s}`, sessionId: `sess-${s}` })];
    for (let t = 0; t < turns; t++) {
      const ts = `2026-0${1 + (s % 9)}-${String(1 + (t % 27)).padStart(2, "0")}T10:00:00Z`;
      lines.push(JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content: sentence(r, vocab, 8 + Math.floor(r() * 20)) } }));
      const fact = factAt.get(`${s}:${t}`);
      let text = sentence(r, vocab, 40 + Math.floor(r() * 80));
      if (fact) text = `${sentence(r, vocab, 12)}. Decision: the ${fact.keys[0]} ${fact.keys[1]} must use the ${fact.keys[2]} setting ${fact.value} because ${sentence(r, vocab, 10)}. ${sentence(r, vocab, 20)}`;
      lines.push(JSON.stringify({ type: "assistant", timestamp: ts, message: { role: "assistant", content: [{ type: "text", text }], usage: { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 50 } } }));
      if (fact && fact.compacted) lines.push(JSON.stringify({ type: "user", isCompactSummary: true, timestamp: ts, message: { role: "user", content: "This session is being continued from a previous conversation" } }));
    }
    fs.writeFileSync(path.join(dir, `sess-${s}.jsonl`), lines.join("\n") + "\n");
  }
  const t0 = Date.now();
  let added = 0, res;
  do { res = mem.updateIndex(proj, { budgetMs: 4000 }); added += res.added; } while (!res.complete);
  const buildMs = Date.now() - t0;
  const again = mem.updateIndex(proj).added; // must be 0: nothing new
  const indexPath = path.join(mem.dataDir(proj), "index.jsonl");
  const size = fs.statSync(indexPath).size;
  // Facts that sit in the part of the index that automatic recall searches.
  const span = Math.min(size, WINDOW);
  const buf = Buffer.alloc(span);
  const fd = fs.openSync(indexPath, "r");
  fs.readSync(fd, buf, 0, span, size - span);
  fs.closeSync(fd);
  const windowText = buf.toString("utf8");
  const live = facts.filter((f) => windowText.includes(f.value));

  let found = 0, foundCompacted = 0, compactedTotal = 0, leaked = 0, eligibleSame = 0, qMs = 0, qN = 0, worst = 0, chars = 0;
  for (const f of live) {
    const prompt = `${sentence(r, vocab, 9)}. Do not change anything yet and keep the answer short. What did we decide about the ${f.keys[0]} ${f.keys[1]} for this project? Reply in one line. ${sentence(r, vocab, 7)}.`;
    const a = Date.now();
    const block = mem.recallBlock(proj, prompt, { sessionId: "another-session" });
    const d = Date.now() - a; qMs += d; qN++; worst = Math.max(worst, d); chars += block.length;
    if (block.includes(f.value)) found++;
    // Asked inside the session that holds the fact: must stay silent unless a compaction dropped it.
    const same = mem.recallBlock(proj, prompt, { sessionId: `sess-${f.s}` });
    // A later compaction in the same session also frees every remark before it.
    const freed = facts.some((g) => g.s === f.s && g.compacted && g.t >= f.t);
    if (freed) { compactedTotal++; if (same.includes(f.value)) foundCompacted++; }
    else { eligibleSame++; if (same.includes(f.value)) leaked++; }
  }
  let noise = 0, noiseN = 0;
  for (let i = 0; i < 40; i++) {
    // An unrelated prompt: a new topic (words never said before) held together by everyday words.
    const fresh = () => "nv" + Math.floor(r() * 1e9).toString(36);
    const mix = (n) => Array.from({ length: n }, () => (r() < 0.5 ? fresh() : vocab[Math.floor(r() * 60)])).join(" ");
    const prompt = `${mix(6 + Math.floor(r() * 10))}. ${mix(6)}?`;
    const a = Date.now();
    const block = mem.recallBlock(proj, prompt, { sessionId: "another-session" });
    const d = Date.now() - a; qMs += d; qN++; worst = Math.max(worst, d); noiseN++;
    if (block) { noise++; if (noise <= 2 && process.argv.includes("--why")) { const f = mem.search(proj, prompt, { sessionId: "another-session" })[0]; console.log("   false injection: prompt=\"" + prompt.slice(0, 110) + "\" | " + f.why + " score=" + f.score.toFixed(2) + " | " + f.text.slice(0, 120)); } }
  }
  // One chance match in forty unrelated prompts is tolerated; it costs about a hundred tokens.
  const ok = found === live.length && foundCompacted === compactedTotal && leaked === 0 && again === 0 && noise <= 1;
  return [sessions, turns, seed, added, (size / 1e6).toFixed(1), buildMs, Math.round(qMs / qN), worst, `${found}/${live.length}` + (live.length < facts.length ? ` (+${facts.length - live.length} older than the window)` : ""), `${foundCompacted}/${compactedTotal}`, `${leaked}/${eligibleSame}`, `${noise}/${noiseN}`, found ? tokens(chars / found) : 0, ok ? "PASS" : "FAIL"];
}

console.log("sessions turns seed remarks indexMB buildMs ms/prompt worstMs found afterCompaction repeatedInSession falseInjections tokens/hit result");
let failed = 0;
const sizes = process.argv.includes("--quick") ? [[5, 40, [1, 2]], [40, 150, [1]]] : [[5, 40, [1, 2, 3]], [40, 150, [1, 2, 3]], [40, 300, [1, 2]], [130, 300, [1]]];
for (const [s, t, seeds] of sizes) {
  for (const seed of seeds) {
    const row = run(s, t, seed);
    if (row[row.length - 1] !== "PASS") failed++;
    console.log(row.join("  "));
  }
}

if (process.argv.includes("--replay")) {
  // Replay every real prompt of this folder's history as if it were asked in a brand-new session.
  process.env.HANDOVER_PROJECTS_DIR = realProjects;
  process.env.HANDOVER_DATA_DIR = realData;
  const cwd = process.cwd();
  mem.updateIndex(cwd, { budgetMs: 8000 });
  const idx = path.join(mem.dataDir(cwd), "index.jsonl");
  if (fs.existsSync(idx)) {
    const prompts = fs.readFileSync(idx, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.r === "you");
    let hit = 0, chars = 0, ms = 0, worst = 0;
    for (const p of prompts) {
      const a = Date.now();
      const block = mem.recallBlock(cwd, p.x, { sessionId: "a-new-session" });
      const d = Date.now() - a; ms += d; worst = Math.max(worst, d);
      if (block) { hit++; chars += block.length; }
    }
    const n = Math.max(1, prompts.length);
    console.log(`\nReplay of ${prompts.length} real prompts: recall added something on ${hit} (${Math.round((100 * hit) / n)}%), ${tokens(chars / Math.max(1, hit))} tokens when it did, ${tokens(chars / n)} tokens per prompt on average, ${Math.round(ms / n)} ms per prompt (worst ${worst} ms).`);
  } else console.log("\nReplay: no index for this folder.");
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} run(s) FAILED` : "\nAll synthetic runs passed.");
process.exit(failed ? 1 : 0);
