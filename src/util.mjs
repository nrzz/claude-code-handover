// Shared helpers: where things live, text and file helpers, local dates.
// Node built-ins only. Nothing here reads or writes outside the paths it is given.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** A mistake in how the command was called: reported in one line, exit code 2. */
export class UsageError extends Error {}

export const NAME = "claude-code-handover";

/** The folder this package runs from: the repo, or the copy npx fetched. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || "0.0.0"; } catch { return "0.0.0"; }
})();

// ---------------------------------------------------------------------------------------------
// Where things live
// ---------------------------------------------------------------------------------------------

/** The home folder: what os.homedir() says, read from `env` so a test can point it elsewhere. */
export function homeDir(env = process.env) {
  const fromEnv = process.platform === "win32" ? env.USERPROFILE : env.HOME;
  return fromEnv && String(fromEnv).trim() ? path.resolve(String(fromEnv)) : os.homedir();
}

/** Claude Code's config folder: $CLAUDE_CONFIG_DIR when it is set, else ~/.claude. */
export function configDir(env = process.env) {
  const custom = env.CLAUDE_CONFIG_DIR && String(env.CLAUDE_CONFIG_DIR).trim();
  return path.resolve(custom || path.join(homeDir(env), ".claude"));
}
export const settingsFile = (cfg) => path.join(cfg, "settings.json");
export const skillFile = (cfg, name) => path.join(cfg, "skills", name, "SKILL.md");
/** Where the guard and the recall scripts are kept, so the hooks never depend on npx's cache. */
export const vendorDir = (cfg) => path.join(cfg, NAME);

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

export const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
export const toLF = (s) => s.replace(/\r\n/g, "\n");
/** The line ending a file already uses, so what is added to it looks like the rest. */
export const eolOf = (s) => (/\r\n/.test(s) ? "\r\n" : "\n");
export const forwardSlashes = (p) => p.replace(/\\/g, "/");

/**
 * `existing` followed by a blank line and `block` (LF text), in the file's own line ending.
 * Nothing in `existing` changes, except that a missing final newline is added.
 */
export function appendBlock(existing, block) {
  const eol = eolOf(existing);
  let out = existing;
  if (!out.trim()) return bomOf(out) + block.replace(/\n/g, eol);
  if (!/\n$/.test(out)) out += eol;
  if (!/(\r?\n){2}$/.test(out)) out += eol;
  return out + block.replace(/\n/g, eol);
}

/**
 * `existing` with `lines` added after its last line, in the file's own line ending: just the lines, no blank line and no
 * comment. A missing final newline is added; nothing else in `existing` changes.
 */
export function appendLines(existing, lines) {
  const eol = eolOf(existing);
  const head = existing && !/\n$/.test(existing) ? existing + eol : existing;
  return head + lines.map((l) => l + eol).join("");
}

/** A byte order mark at the start of `text` (U+FEFF), or "": a file that had one keeps it when it is rewritten. */
export const bomOf = (text) => (text.charCodeAt(0) === 0xfeff ? String.fromCharCode(0xfeff) : "");

const pad = (n) => String(n).padStart(2, "0");
/** Today as YYYY-MM-DD in local time. */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const compactTime = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

/** A file that is not plain UTF-8 text: rewriting it as text would change bytes that are not ours. */
export class NotTextError extends Error {}

const missing = (e) => e && (e.code === "ENOENT" || e.code === "ENOTDIR");

/**
 * The text of a file, or null when it does not exist. Throws NotTextError for a file that is not UTF-8 text
 * (UTF-16, or an older code page with accented letters): reading it as UTF-8 and writing it back would corrupt it.
 * Use this for a file that may be written back.
 */
export function readText(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { if (missing(e)) return null; throw e; }
  const text = buf.toString("utf8");
  if (buf.includes(0) || !Buffer.from(text, "utf8").equals(buf)) {
    throw new NotTextError(`${file} is not UTF-8 text (it may be UTF-16 or use an older code page), so it was left alone. Save it as UTF-8 and run init again.`);
  }
  return text;
}

/** Like readText, but a file that is not UTF-8 text is decoded as well as it can be: for looking at a file, never for writing it back. */
export function peekText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (e) { if (missing(e)) return null; throw e; }
}
export const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
export const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

/** True when both paths are the same place on disk (symlinks resolved, case ignored on Windows). */
export function samePath(a, b) {
  const norm = (p) => {
    let r;
    try { r = fs.realpathSync(p); } catch { r = path.resolve(p); }
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

/** <file>.bak-<YYYYMMDD>; when that exists, <file>.bak-<YYYYMMDD>-<HHMMSS>, then a counter. Never an existing path. */
export function backupPath(file, now = new Date()) {
  const day = localDate(now).replace(/-/g, "");
  let p = `${file}.bak-${day}`;
  if (!exists(p)) return p;
  p = `${file}.bak-${day}-${compactTime(now)}`;
  for (let n = 2; exists(p); n++) p = `${file}.bak-${day}-${compactTime(now)}-${n}`;
  return p;
}

/**
 * The only way files are written, copied or removed. In a dry run every call does nothing, so a dry run
 * runs the same code as the real one and cannot touch the disk by accident.
 */
export function makeWriter(dryRun) {
  return {
    dryRun: !!dryRun,
    write(file, text) {
      if (dryRun) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    },
    copy(from, to) {
      if (dryRun) return;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    },
    /** Copy `file` to a new .bak path and return that path. */
    backup(file, now) {
      const to = backupPath(file, now);
      if (!dryRun) fs.copyFileSync(file, to, fs.constants.COPYFILE_EXCL);
      return to;
    },
    remove(p) {
      if (dryRun) return;
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
    /** Remove an empty folder; a folder that still holds something is left. */
    removeIfEmpty(dir) {
      if (dryRun) return;
      try { fs.rmdirSync(dir); } catch { /* not empty, or already gone */ }
    },
  };
}

/** Every file under `dir`, as forward-slash paths relative to it, sorted. */
export function listFiles(dir, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
