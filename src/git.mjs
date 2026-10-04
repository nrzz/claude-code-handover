// What the setup needs to know from git. Everything here only reads: it never changes the index or the history.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { samePath } from "./util.mjs";

/** Run git. Never throws; `missing` is true when there is no git on the PATH. */
export function git(args, { cwd, env = process.env, timeout = 30000 } = {}) {
  const r = spawnSync("git", args, {
    cwd, encoding: "utf8", timeout, windowsHide: true,
    env: { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
  const spawnError = r.error ? r.error.message : "";
  return {
    ok: r.status === 0,
    status: r.status,
    out: (r.stdout || "").trim(),
    err: [(r.stderr || "").trim(), spawnError].filter(Boolean).join(" ").replace(/\s+/g, " "),
    missing: !!(r.error && r.error.code === "ENOENT"),
  };
}

/**
 * The folder that holds the .git entry (a folder, or the file a worktree has) at or above `dir`, or null.
 * Like git itself it does not climb into a folder listed in GIT_CEILING_DIRECTORIES.
 */
export function findGitRoot(dir, env = process.env) {
  const ceilings = String(env.GIT_CEILING_DIRECTORIES || "").split(path.delimiter).filter(Boolean).map((p) => path.resolve(p));
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const up = path.dirname(cur);
    if (up === cur || ceilings.some((c) => samePath(c, up))) return null;
    cur = up;
  }
}

/** Which of `names` (files in `dir`) git already tracks. */
export function trackedAmong(dir, names, env) {
  const r = git(["ls-files", "--", ...names], { cwd: dir, env });
  if (!r.ok) return { tracked: [], error: r.missing ? "git was not found" : r.err || "git ls-files failed" };
  const listed = new Set(r.out.split("\n").map((l) => l.trim().replace(/^"|"$/g, "")).filter(Boolean));
  return { tracked: names.filter((n) => listed.has(n)), error: null };
}

/**
 * Which of `names` git shows as untracked in `git status`: not tracked and not hidden by .gitignore, .git/info/exclude
 * or the global ignore file. `ls-files --others --exclude-standard` lists exactly those, with paths relative to `dir`
 * (git status --porcelain prints paths relative to the repository root, which differs for a project in a sub-folder).
 */
export function untrackedAmong(dir, names, env) {
  const r = git(["ls-files", "--others", "--exclude-standard", "--", ...names], { cwd: dir, env });
  if (!r.ok) return { untracked: [], error: r.missing ? "git was not found" : r.err || "git ls-files failed" };
  const shown = new Set(r.out.split("\n").map((l) => l.trim().replace(/^"|"$/g, "")).filter(Boolean));
  return { untracked: names.filter((n) => shown.has(n)), error: null };
}
