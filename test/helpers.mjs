// Shared test helpers: a throwaway world (home, Claude config folder, project folder, transcripts) and ways to
// run the installer in it. Every test runs against folders under the OS temp directory and reaches them through
// CLAUDE_CONFIG_DIR, HOME and USERPROFILE. Nothing here reads or writes the real ~/.claude, and no real
// transcript is ever read: HANDOVER_PROJECTS_DIR and HANDOVER_DATA_DIR point into the throwaway world too.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { init, status, uninstall } from "../src/install.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BIN = path.join(ROOT, "bin", "claude-handover.mjs");
const TMP = fs.realpathSync(os.tmpdir());

// Safety net: a test that forgets its sandbox must still never reach the real ~/.claude. This process's own
// CLAUDE_CONFIG_DIR is a *file*, so anything that tries to use it as a folder fails loudly, and HOME and
// USERPROFILE point at a temp folder as well.
const SAFE = fs.realpathSync(fs.mkdtempSync(path.join(TMP, "ch-safe-")));
fs.writeFileSync(path.join(SAFE, "config-that-must-stay-empty"), "a file on purpose: a test that writes here forgot its sandbox\n");
process.env.CLAUDE_CONFIG_DIR = path.join(SAFE, "config-that-must-stay-empty");
process.env.HOME = SAFE;
process.env.USERPROFILE = SAFE;
process.env.HANDOVER_PROJECTS_DIR = path.join(SAFE, "projects-that-must-stay-empty");
process.env.HANDOVER_DATA_DIR = path.join(SAFE, "data-that-must-stay-empty");
process.env.CLAUDE_HANDOVER_MANAGED_SETTINGS = path.join(SAFE, "no-managed-settings.json");
process.on("exit", () => { try { fs.rmSync(SAFE, { recursive: true, force: true }); } catch { /* temp folder: the OS cleans up */ } });

/** Text with every run of white space turned into one space: the report breaks long prose into lines, and where depends on path lengths. */
export const flat = (s) => s.replace(/\s+/g, " ");

/** Matches an emoji or a pictograph: nothing the installer prints or the docs say may contain one. */
export const EMOJI = new RegExp("[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]", "u");

/** Sunday 4 October 2026, noon local time: the "now" of the in-process tests. */
export const NOW = new Date(2026, 9, 4, 12, 0, 0);
export const TODAY = "2026-10-04";

export const HAS_GIT = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;

/** A throwaway world. `box.env` is the environment to run the installer in. */
export function sandbox() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(TMP, "ch-")));
  const home = path.join(root, "home");
  const cfg = path.join(home, ".claude");
  const project = path.join(root, "project");
  const projects = path.join(root, "transcripts");
  const data = path.join(root, "data");
  const gitconfig = path.join(root, "gitconfig");
  for (const d of [home, project]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(gitconfig, "[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n");
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: cfg,
    HOME: home,
    USERPROFILE: home,
    HANDOVER_PROJECTS_DIR: projects,
    HANDOVER_DATA_DIR: data,
    CLAUDE_HANDOVER_MANAGED_SETTINGS: path.join(root, "managed-settings.json"),
    GIT_CEILING_DIRECTORIES: root, // a stray .git above the temp folder must not turn the project into a repository
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    NO_COLOR: "1",
  };
  for (const k of Object.keys(env)) if (/^(CLAUDE_CODE_|CLAUDECODE|HANDOVER_(CONTEXT|STALE|AUTORECALL|RECALL))/.test(k)) delete env[k];
  return {
    root, home, cfg, project, projects, data, env,
    managed: env.CLAUDE_HANDOVER_MANAGED_SETTINGS,
    settings: path.join(cfg, "settings.json"),
    vendor: path.join(cfg, "claude-code-handover"),
    p: (...parts) => path.join(project, ...parts),
    c: (...parts) => path.join(cfg, ...parts),
    cleanup() { fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 60 }); },
  };
}

/** Run `fn(box)` in a fresh sandbox and clean it up, also when `fn` throws. */
export function withBox(fn) {
  return async () => {
    const box = sandbox();
    try { await fn(box); } finally { box.cleanup(); }
  };
}

// ---- running the commands -------------------------------------------------------------------

export function capture() {
  const lines = { out: [], err: [] };
  return { lines, io: { out: (s = "") => lines.out.push(s), err: (s = "") => lines.err.push(s) } };
}

/** init in-process, in the sandbox, on the fixed date. Returns the command's result with `.text` as the report. */
export function runInit(box, opts = {}) {
  const { io, lines } = capture();
  const result = init({ dir: box.project, env: box.env, now: NOW, ...opts }, io);
  return { ...result, lines };
}
export function runUninstall(box, opts = {}) {
  const { io, lines } = capture();
  const result = uninstall({ env: box.env, now: NOW, ...opts }, io);
  return { ...result, lines };
}
export function runStatus(box, opts = {}) {
  const { io, lines } = capture();
  const result = status({ dir: box.project, env: box.env, ...opts }, io);
  return { ...result, lines };
}

/** The command line as a child process: `node bin/claude-handover.mjs ...args`. */
export function cli(box, args, { cwd, env, input, timeout = 120000 } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: cwd || box.project, env: { ...box.env, ...env }, input, encoding: "utf8", timeout, windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", out: (r.stdout || "") + (r.stderr || "") };
}

// ---- files ----------------------------------------------------------------------------------

export const read = (file) => fs.readFileSync(file, "utf8");
export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
export const exists = (file) => fs.existsSync(file);
export const names = (dir) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };

/**
 * Every file under `dir` as { "rel/path": "sha256:mtimeMs" }, to prove a run changed nothing. A file that was
 * rewritten with the same bytes still shows, through its modification time, unless `withTimes` is false.
 */
export function snapshot(dir, { withTimes = true } = {}) {
  const out = {};
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === ".git") continue; // git's own bookkeeping is not what these tests are about
      if (e.isDirectory()) { out[`${r}/`] = "dir"; walk(p, r); }
      else if (e.isFile()) out[r] = `${crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}${withTimes ? `:${fs.statSync(p).mtimeMs}` : ""}`;
    }
  };
  walk(dir, "");
  return out;
}

/** Copy a folder tree (fs.cpSync is still experimental on older Node versions). */
export function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(path.join(from, e.name), path.join(to, e.name));
    else if (e.isFile()) fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

// ---- git ------------------------------------------------------------------------------------

/** Run git in the sandbox (no global or system config, a fixed committer) and return its output; throws when it fails. */
export function git(box, cwd, ...args) {
  const r = spawnSync("git", ["-c", "init.defaultBranch=main", ...args], { cwd, env: box.env, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr || r.error}`);
  return (r.stdout || "").trim();
}
export function gitInit(box, dir = box.project) {
  fs.mkdirSync(dir, { recursive: true });
  git(box, dir, "init", "-q");
  git(box, dir, "symbolic-ref", "HEAD", "refs/heads/main");
}
export function commitAll(box, dir, message = "commit") {
  git(box, dir, "add", "-A");
  git(box, dir, "commit", "-q", "-m", message);
}

/** The environment with `git` hidden: the PATH holds only an empty folder. */
export function envWithoutGit(box) {
  const empty = path.join(box.root, "empty-path");
  fs.mkdirSync(empty, { recursive: true });
  const env = { ...box.env };
  for (const k of Object.keys(env)) if (/^path$/i.test(k)) delete env[k];
  env.PATH = empty;
  return env;
}

// ---- the setup prompt -----------------------------------------------------------------------

/** The code blocks of setup-prompt.txt, in order, as text without the fence lines (no trailing newline). */
export function promptBlocks() {
  const lines = fs.readFileSync(path.join(ROOT, "setup-prompt.txt"), "utf8").split("\n");
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    if (l.startsWith("```")) {
      if (cur === null) cur = [];
      else { blocks.push(cur.join("\n")); cur = null; }
    } else if (cur) cur.push(l);
  }
  return blocks;
}
/** Index of each block of setup-prompt.txt. */
export const BLOCK = { rules: 0, handover: 1, decisions: 2, skill: 3, multi: 4, single: 5, card: 6, hooks: 7 };

/** The rules card the prompt describes for these models, worked out from the prompt's own block (not from the code under test). */
export function expectedCard({ multi, third = "Opus", first = "Sonnet", second = "Opus" }) {
  const lines = promptBlocks()[BLOCK.card].split("\n");
  const m = lines.indexOf("## Model and effort by job (more than one model)");
  const o = lines.indexOf("## Effort by job (one model)");
  const t = lines.findIndex((l) => l.startsWith("Never max as a default"));
  const head = lines.slice(0, m);
  const tail = lines.slice(t);
  if (!multi) return [...head, ...lines.slice(o, t), ...tail].join("\n") + "\n";
  const section = lines.slice(m, o).map((l) => l
    .replace("| Sonnet | medium |", `| ${first} | medium |`)
    .replace("| Opus | high |", `| ${second} | high |`)
    .replace("| Fable if available, else Opus | high |", `| ${third} | high |`));
  return [...head, ...section, ...tail].join("\n") + "\n";
}

// ---- model lists ----------------------------------------------------------------------------

/** Every non-empty combination of the four model families as a sorted "a+b" key, 15 in all. */
export function modelCombinations() {
  const families = ["fable", "haiku", "opus", "sonnet"];
  const out = [];
  for (let mask = 1; mask < 1 << families.length; mask++) out.push(families.filter((_, i) => mask & (1 << i)).join("+"));
  return out.sort();
}
/** The combination a list of family keys names, in the same form: ["sonnet", "fable"] is "fable+sonnet". */
export const combinationOf = (keys) => [...keys].sort().join("+");

// ---- transcripts ----------------------------------------------------------------------------

/** Claude Code's folder name for a working directory: every non-alphanumeric character becomes "-". */
export const projectKey = (dir) => dir.replace(/[^A-Za-z0-9]/g, "-");

/** A small synthetic transcript for `projectDir`, in the sandbox's transcripts folder. */
export function writeTranscript(box, projectDir, sid = "11111111-aaaa-4aaa-8aaa-000000000001") {
  const file = path.join(box.projects, projectKey(projectDir), `${sid}.jsonl`);
  const rows = [
    { type: "custom-title", customTitle: "Test session", sessionId: sid },
    { type: "user", timestamp: "2026-09-30T10:00:00Z", message: { role: "user", content: "Which cache setting did we pick for the invoice exporter, and why?" } },
    { type: "assistant", timestamp: "2026-09-30T10:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "We picked the warm-cache setting for the invoice exporter because cold starts took eleven seconds." }], usage: { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 50 } } },
  ];
  write(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return file;
}
