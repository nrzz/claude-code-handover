// The user-level steps of init, everything under Claude Code's config folder:
// Step 4 and the /recall skill, Step 6 and the hooks of Step 8 in settings.json, and the vendored copy of the
// scripts (Step 8, with a copy instead of `git clone` so the hooks never depend on npx's cache).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  NAME, ROOT, exists, forwardSlashes, isDir, isFile, listFiles, peekText, samePath, settingsFile, skillFile, stripBom, toLF, vendorDir,
} from "./util.mjs";
import { git } from "./git.mjs";
import { hooksBlock, recallSkill } from "./templates.mjs";
import { HOOK_EVENTS, mergeHooks, planEffort, readManaged, readSettings, serializeSettings } from "./settings.mjs";

// ---- the two skills -------------------------------------------------------------------------

/**
 * <config>/skills/<name>/SKILL.md with exactly `content`. An existing copy is replaced; one that differs is first
 * kept next to it as SKILL.md.bak-<date>, because it may be something the person edited.
 */
export function installSkill(c, name, content, what) {
  const { R, w } = c;
  const file = skillFile(c.cfg, name);
  const text = peekText(file); // only compared: a copy that differs is kept as a backup, then replaced
  if (text === null) {
    w.write(file, content);
    R.file("created", file, what);
  } else if (toLF(text) === content) {
    R.file("unchanged", file, `${what}; it is already in place`);
  } else {
    R.file("backup", w.backup(file, c.now), "your previous copy of the skill, which differed");
    w.write(file, content);
    R.file("replaced", file, what);
  }
}

// ---- the vendored copy ----------------------------------------------------------------------

/** What gets copied, relative to the package root, package.json first: it is what marks the folder as ours. */
export function runtimeFiles(root = ROOT) {
  return [
    "package.json",
    "LICENSE",
    ...listFiles(path.join(root, "scripts")).map((f) => `scripts/${f}`),
    ...listFiles(path.join(root, "skills", "recall")).map((f) => `skills/recall/${f}`),
  ];
}
const REQUIRED = ["scripts/context-guard.mjs", "scripts/memory-index.mjs", "scripts/recall.mjs", "skills/recall/SKILL.md"];

/**
 * What is at <config>/claude-code-handover: nothing, an empty folder, a git checkout of this project (older setups
 * cloned it), our copy, or something else. A git repository counts as ours only when it holds one of our scripts or
 * a package.json with our name: this tool never pulls into, or copies over, somebody else's repository.
 */
export function vendorState(dir) {
  if (!exists(dir)) return "absent";
  if (!isDir(dir)) return "foreign";
  let name = "";
  try { name = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name; } catch { /* no package.json */ }
  if (exists(path.join(dir, ".git"))) {
    const ours = name === NAME || ["context-guard.mjs", "memory-index.mjs", "recall.mjs", "usage-report.mjs"].some((f) => isFile(path.join(dir, "scripts", f)));
    return ours ? "checkout" : "foreign";
  }
  if (!fs.readdirSync(dir).length) return "empty";
  return name === NAME ? "ours" : "foreign";
}

/** Copy the runtime files into `to`, leaving those that are already identical. Returns { copied, unchanged } as relative paths. */
export function copyRuntime(to, w, root = ROOT) {
  const copied = [];
  const unchanged = [];
  for (const rel of runtimeFiles(root)) {
    const parts = rel.split("/");
    const src = fs.readFileSync(path.join(root, ...parts));
    let cur = null;
    try { cur = fs.readFileSync(path.join(to, ...parts)); } catch { /* not there yet */ }
    if (cur && cur.equals(src)) { unchanged.push(rel); continue; }
    w.write(path.join(to, ...parts), src);
    copied.push(rel);
  }
  return { copied, unchanged };
}

const headOf = (dir, env) => { const r = git(["-C", dir, "rev-parse", "HEAD"], { env }); return r.ok ? r.out : ""; };

/**
 * Put the scripts where the hooks will run them. Returns true when the copy is usable (or would be, in a dry run).
 * A git checkout from an older setup is updated with `git pull --ff-only`, and copied over when git cannot do it.
 */
export function vendorStep(c) {
  const { R, w } = c;
  const dir = vendorDir(c.cfg);
  const state = vendorState(dir);
  if (samePath(ROOT, dir)) {
    R.file("kept", dir, "this command is running from that folder, so there is nothing to copy onto itself");
    return true;
  }
  if (state === "foreign") {
    R.file("skipped", dir, `it exists but does not look like a copy of this tool (no package.json named ${NAME}), so I left it alone`);
    R.problem(`${dir} exists and is not ours, so the context guard and automatic recall were not installed. Move or delete it, then run init again.`);
    return false;
  }
  const count = (n) => `${n} file${n === 1 ? "" : "s"}`;
  if (state === "checkout") {
    if (c.dryRun) {
      R.file("kept", dir, "a git checkout from an older setup: it would be updated with git pull --ff-only");
      return true;
    }
    const before = headOf(dir, c.env);
    const pull = git(["-C", dir, "pull", "--ff-only"], { env: c.env, timeout: 90000 });
    if (pull.ok && REQUIRED.every((f) => fs.existsSync(path.join(dir, ...f.split("/"))))) {
      const after = headOf(dir, c.env);
      R.file(before && before === after ? "unchanged" : "updated", dir, before && before === after ? "a git checkout from an older setup; git pull --ff-only found nothing new" : "a git checkout from an older setup, updated with git pull --ff-only");
      return true;
    }
    const why = (pull.err || pull.out || "git pull did not succeed").split("\n")[0].slice(0, 160);
    const { copied } = copyRuntime(dir, w);
    R.file(copied.length ? "copied" : "unchanged", dir, `a git checkout from an older setup; git pull --ff-only failed (${why}), so ${copied.length ? `${count(copied.length)} ${copied.length === 1 ? "was" : "were"} copied over it` : "its files already match this version"}`);
    return true;
  }
  const { copied, unchanged } = copyRuntime(dir, w);
  if (copied.length) R.file("copied", dir, `${count(copied.length)} (the scripts, the recall skill, package.json, LICENSE)${unchanged.length ? `; ${count(unchanged.length)} already identical` : ""}; the hooks run from here, not from npx's cache`);
  else R.file("unchanged", dir, `${count(unchanged.length)}, all identical to this version`);
  return true;
}

/** /recall: the skill is copied from the vendored folder (from this package in a dry run, when that folder may not exist yet). */
export function recallSkillStep(c) {
  const vendored = path.join(vendorDir(c.cfg), "skills", "recall", "SKILL.md");
  const text = !c.dryRun && fs.existsSync(vendored) ? toLF(fs.readFileSync(vendored, "utf8")) : recallSkill();
  installSkill(c, "recall", text, "the /recall command");
}

// ---- Step 6 and the hooks of Step 8: settings.json ------------------------------------------

/** The hooks block as text, for a person to add by hand when settings.json could not be edited. */
const hooksSnippet = (cfgSlash) => JSON.stringify(hooksBlock(cfgSlash), null, 2).split("\n").map((l) => `    ${l}`).join("\n");

/** The facts about the user level: config folder, settings.json and managed settings. */
export function describeUser(c) {
  const { R } = c;
  const st = readSettings(settingsFile(c.cfg));
  const managed = readManaged(c.env);
  const custom = c.env.CLAUDE_CONFIG_DIR && String(c.env.CLAUDE_CONFIG_DIR).trim();
  R.fact("Config folder", `${c.cfg} (${custom ? "from CLAUDE_CONFIG_DIR" : "the default, ~/.claude"})`);
  R.fact("Home folder", c.home);
  R.fact("settings.json", st.status === "missing" ? "missing, so it is created" : st.status === "invalid" ? `found, but ${st.reason}` : "found");
  const bad = managed.ignored.map((i) => `${i.file} ${i.reason}`).join("; ");
  R.fact("Managed settings", managed.status === "none" ? `none found (${managed.path})`
    : managed.status === "invalid" ? `${bad}, so ${managed.ignored.length === 1 ? "it is" : "they are"} ignored`
      : `${managed.files.join(", ")} (what ${managed.files.length === 1 ? "it sets outranks" : "they set outrank"} this file)${bad ? `; ignored: ${bad}` : ""}`);
  if (managed.legacy) R.fact("Old managed file", `${managed.legacy} exists, but Claude Code no longer reads that path, so it is ignored here too`);
}

/**
 * One backup, one write: the effort keys for the person's models, and (unless `hooks` is false) the three hooks.
 * An invalid settings.json is left alone and both are skipped.
 * Returns { ok, hooksOk }: whether settings.json could be processed, and whether all three hooks are registered.
 */
export function settingsStep(c, { hooks }) {
  const { R, w } = c;
  const file = settingsFile(c.cfg);
  const cfgSlash = forwardSlashes(c.cfg);
  R.settingsFile = file;
  const st = readSettings(file);
  const managed = readManaged(c.env);

  if (st.status === "invalid") {
    R.file("skipped", file, `${st.reason}; I left it alone, so the effort settings${hooks ? " and the hooks were" : " were"} not applied`);
    R.problem(`${file} ${st.reason}. Fix it (or move it away), then run init again.`);
    if (hooks) R.guard.push(`The hooks were not registered. To do it by hand, merge this block into ${file} once it is valid JSON, keeping any hooks that are already there:`, ...hooksSnippet(cfgSlash).split("\n"));
    return { ok: false, hooksOk: false };
  }

  const effort = planEffort(st.data, c.keys, managed.data);
  let next = effort.next;
  const entries = [...effort.entries];
  let hooksOk = false;
  if (hooks) {
    const merged = mergeHooks(next, cfgSlash);
    next = merged.next;
    entries.push(...merged.entries);
    hooksOk = HOOK_EVENTS.every((ev) => merged.entries.some((e) => e.key === `hooks.${ev}` && e.action !== "skipped"));
    for (const e of merged.entries.filter((x) => x.action === "skipped")) {
      R.problem(`${e.key} ${e.detail}, so the guard hook was not registered there. Fix it by hand, then run init again.`);
    }
  }
  for (const e of entries) R.setting(e.key, e.action, e.detail);

  if (JSON.stringify(next) === JSON.stringify(st.data)) {
    if (st.status === "missing") {
      w.write(file, "{}\n");
      R.file("created", file, "an empty settings file ({}): every key was skipped");
    } else {
      R.file("unchanged", file, "every key was already in place");
    }
    return { ok: true, hooksOk };
  }
  const hadContent = st.status === "ok" && st.raw !== null && st.raw.trim() !== "";
  if (hadContent) R.file("backup", w.backup(file, c.now), "a copy of settings.json as it was before this run");
  w.write(file, serializeSettings(next, st.raw));
  const changed = entries.filter((e) => ["set", "adjusted", "added", "updated"].includes(e.action)).length;
  const summary = `${changed} key${changed === 1 ? "" : "s"} merged at key level; every other setting is untouched`;
  // Read the file back, as the setup prompt asks: what is on disk must parse and must be what was planned.
  let parses = c.dryRun;
  if (!c.dryRun) {
    try { parses = JSON.stringify(JSON.parse(stripBom(fs.readFileSync(file, "utf8")))) === JSON.stringify(next); } catch { parses = false; }
  }
  R.file(st.status === "missing" ? "created" : "updated", file, parses ? `${summary}${c.dryRun ? "" : "; read back and checked: it parses as JSON"}` : summary);
  if (!parses) R.problem(`${file} was written but could not be read back as the settings that were planned. A backup of the original is next to it; check the file.`);
  return { ok: true, hooksOk };
}

// ---- Step 8: prove it runs ------------------------------------------------------------------

/** Run one of the vendored scripts from the project folder; its first non-empty lines go in the report. */
function runVendored(c, script, args) {
  const r = spawnSync(process.execPath, [path.join(vendorDir(c.cfg), "scripts", script), ...args], {
    cwd: c.dir, env: c.env, encoding: "utf8", timeout: c.checkTimeoutMs, windowsHide: true,
  });
  const lines = (r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).map((l) => (l.length > 200 ? `${l.slice(0, 200)}...` : l));
  const timedOut = !!(r.error && r.error.code === "ETIMEDOUT");
  const failed = !timedOut && (r.status !== 0 || !!r.error);
  const err = (r.stderr || (r.error && r.error.message) || "").split("\n").find((l) => l.trim()) || "";
  return { failed, timedOut, lines, err: err.trim() };
}

/** Build the recall index for this project and run `recall.mjs setup`, as the setup prompt does. */
export function checksStep(c) {
  const { R } = c;
  for (const [label, script, args] of [["node scripts/memory-index.mjs --build", "memory-index.mjs", ["--build"]], ["node scripts/recall.mjs setup", "recall.mjs", ["setup"]]]) {
    const r = runVendored(c, script, args);
    if (r.timedOut) {
      // A very large history is slow, not a broken install.
      R.guard.push(`${label}: still running after ${c.checkTimeoutMs / 1000} seconds, so it was stopped. The history is very large; that is slow, not a failure.`);
    } else if (r.failed) {
      R.guard.push(`${label}: did not run cleanly${r.err ? ` (${r.err})` : ""}`);
      R.problem(`${label} failed in ${vendorDir(c.cfg)}, so the guard or recall may not work.`);
    } else {
      R.guard.push(`${label}:`, ...(r.lines.length ? r.lines : ["(no output)"]).map((l) => `  ${l}`));
    }
  }
}
