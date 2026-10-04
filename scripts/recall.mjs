// Recall: search every past Claude Code transcript of this project for a topic.
// Prints the matching things you and Claude said, with date and session title, newest first.
// Usage: node recall.mjs <word or words> [--all] [--limit N] [--root <projects folder>]
//   --all    search every project on this machine, not only the current folder's
// Nothing leaves your machine. Transcripts live in ~/.claude/projects.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i > -1 ? args.splice(i, 1) && true : false; };
const opt = (name, dflt) => { const i = args.indexOf(name); if (i === -1) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const ALL = flag("--all");
const LIMIT = Number(opt("--limit", 40));
// Claude Code keeps its transcripts in <config folder>/projects: $CLAUDE_CONFIG_DIR when that is set, else ~/.claude.
const CONFIG = (process.env.CLAUDE_CONFIG_DIR || "").trim() ? path.resolve(process.env.CLAUDE_CONFIG_DIR.trim()) : path.join(os.homedir(), ".claude");
const ROOT = opt("--root", process.env.HANDOVER_PROJECTS_DIR || path.join(CONFIG, "projects"));
const words = args.join(" ").trim().toLowerCase().split(/\s+/).filter(Boolean);
if (!words.length) { console.log("Usage: node recall.mjs <word or words> [--all] [--limit N]"); process.exit(0); }

const projectKey = process.cwd().replace(/[^A-Za-z0-9]/g, "-");
const dirs = ALL ? fs.readdirSync(ROOT).map((d) => path.join(ROOT, d)) : [path.join(ROOT, projectKey)];

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n");
}
function snippet(text, pos) {
  const start = Math.max(0, pos - 220), end = Math.min(text.length, pos + 320);
  return (start > 0 ? "..." : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "..." : "");
}

const hits = [];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue; // main transcripts only, not subagent folders
    const file = path.join(dir, name);
    let title = "";
    let lines;
    try { lines = fs.readFileSync(file, "utf8").split("\n"); } catch { continue; }
    for (const line of lines) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === "custom-title") { title = o.customTitle || title; continue; }
      if ((o.type !== "user" && o.type !== "assistant") || !o.message || o.isSidechain) continue;
      const text = textOf(o.message.content);
      if (!text || text.startsWith("<")) continue; // skip injected system blocks
      const lower = text.toLowerCase();
      if (!words.every((w) => lower.includes(w))) continue;
      hits.push({ ts: o.timestamp || "", title, role: o.type, text: snippet(text, lower.indexOf(words[0])), project: path.basename(dir) });
    }
  }
}
// Local notes of the current folder, if present.
for (const f of ["DECISIONS.md", "HANDOVER.md"]) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const lower = line.toLowerCase();
    if (line && words.every((w) => lower.includes(w))) hits.push({ ts: "9999", title: f, role: "note", text: line.trim(), project: "" });
  }
}

hits.sort((a, b) => (a.ts < b.ts ? 1 : -1));
if (!hits.length) { console.log(`No match for "${words.join(" ")}" in ${ALL ? "any project" : "this project's"} transcripts${ALL ? "" : ` (${projectKey})`}.`); process.exit(0); }
console.log(`${hits.length} match(es) for "${words.join(" ")}", newest first${hits.length > LIMIT ? `, showing ${LIMIT}` : ""}:\n`);
for (const h of hits.slice(0, LIMIT)) {
  const when = h.ts === "9999" ? "current notes" : h.ts.slice(0, 16).replace("T", " ");
  console.log(`[${when}] ${h.title || h.project || "(untitled session)"} | ${h.role}\n  ${h.text}\n`);
}
