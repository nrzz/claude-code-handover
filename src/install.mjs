// The three commands: init, uninstall and status. Each takes an options object and an io ({ out, err }) and
// returns { code, text, ... }: the exit code, the report as text, and the report's data for callers that want it.
// The work itself is in the step functions of project.mjs (the project folder) and user.mjs (Claude Code's config folder).
import fs from "node:fs";
import path from "node:path";
import { attempt, makeContext } from "./context.mjs";
import { consoleIO } from "./report.mjs";
import { FAMILIES, familyOf, modelsLabel } from "./models.mjs";
import { PERSONAL_FILES, handoverSkill, recallSkill, settingsBlock } from "./templates.mjs";
import {
  checksStep, describeUser, installSkill, recallSkillStep, runtimeFiles, settingsStep, vendorState, vendorStep,
} from "./user.mjs";
import {
  decisionsStep, describeProject, findBlock, gitCheckStep, gitignoreStep, handoverStep, inspectProject, personalRulesStep, rulesCardStep,
} from "./project.mjs";
import { HOOK_EVENTS, ourHooks, readManaged, readSettings, removeHooks, scriptOf, serializeSettings } from "./settings.mjs";
import { VERSION, isFile, listFiles, peekText, settingsFile, skillFile, toLF, vendorDir } from "./util.mjs";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------------------------

/** The four lines for the person to keep (Step 9), with the real names filled in. */
function keepLines(c, personalFile, guardOn) {
  const first = c.streams[0];
  const name = path.basename(personalFile || "CLAUDE.local.md");
  const lines = [
    "Keep these four lines",
    `  1. Open a new Claude Code session in ${c.dir} (close one that is already open: it does not see the new hooks and skills) and ask "which memory files loaded, and what is my effort?" It should name ${name} and HANDOVER.md.`,
    "  2. For each old chat you still need: open it, type /handover, close it for good.",
    guardOn
      ? '  3. Every morning: new session, type "continue". What earlier sessions said about your question arrives by itself; /recall followed by a topic is the deeper search.'
      : c.noHooks
        ? '  3. Every morning: new session, type "continue". (You passed --no-hooks, so automatic recall and /recall were not touched; run init without it to install them.)'
        : '  3. Every morning: new session, type "continue". (Automatic recall and /recall are not installed yet; see Problems above.)',
    "  4. At a natural stop past 35 percent, or when done: /handover, then close.",
  ];
  if (c.streams.length > 1) lines.push(`  (With more than one stream, add its name: "continue ${first}", "/handover ${first}".)`);
  return lines;
}

/** The models as read from --models, and what that means for the settings. */
function modelsFact(c) {
  const label = modelsLabel(c.keys);
  const block = settingsBlock(c.keys);
  let text;
  if (c.keys.length === 1) {
    text = `${label} only: effort ${block.effortLevel} for everything, no subagent model`;
  } else {
    const sub = block.env && block.env.CLAUDE_CODE_SUBAGENT_MODEL;
    const levels = Object.entries(block.modelSettings || {}).map(([id, e]) => `${FAMILIES[familyOf(id)].name} on ${e.effortLevel}`);
    text = [`${label}: effort ${block.effortLevel}`, ...levels, sub ? `subagents on ${FAMILIES[sub].name}` : "no subagent model"].join(", ");
  }
  if (c.modelsText.trim() !== label && c.modelsText.trim() !== `${label} only`) text += ` (read from "${c.modelsText.trim()}")`;
  if (c.ignoredModels.length) text += `; not recognised and ignored: ${c.ignoredModels.join(", ")}`;
  return text;
}

/**
 * Set up the workflow in a project folder and in Claude Code's config folder, as Steps 1 to 9 of setup-prompt.txt
 * describe, without asking anything. Running it again changes nothing and says so.
 */
export function init(opts = {}, io = consoleIO) {
  const c = makeContext("init", opts);
  const { R } = c;
  const info = inspectProject(c.dir, c.env);

  describeProject(c, info);
  R.fact("Models", modelsFact(c));
  R.fact("Streams", c.streams.join(", "));
  attempt(c, "reading the config folder", () => describeUser(c));

  const personalFile = attempt(c, "the personal rules file", () => personalRulesStep(c, info));
  attempt(c, "HANDOVER.md", () => handoverStep(c));
  attempt(c, "DECISIONS.md", () => decisionsStep(c));
  attempt(c, "the /handover skill", () => installSkill(c, "handover", handoverSkill(), "the /handover command, available in every project"));
  attempt(c, ".gitignore", () => gitignoreStep(c, info));

  let vendored = false;
  if (!c.noHooks) {
    vendored = !!attempt(c, "the guard and recall scripts", () => vendorStep(c));
    if (vendored) attempt(c, "the /recall skill", () => recallSkillStep(c));
  }
  const settings = attempt(c, "settings.json", () => settingsStep(c, { hooks: vendored }));
  attempt(c, "the rules card", () => rulesCardStep(c));

  const guardOn = vendored && !!(settings && settings.hooksOk);
  if (c.noHooks) {
    R.guard.push("Skipped: you passed --no-hooks, so the context guard, automatic recall and the /recall command were neither installed nor changed. A copy that is already there is left as it is.");
  } else if (guardOn) {
    R.guard.unshift(
      `${c.dryRun ? (R.changed ? "Would be installed" : "Installed (already in place)") : "Installed"}: the context guard and automatic recall.`,
      `  Three hooks (SessionStart, UserPromptSubmit, Stop) run the scripts in ${vendorDir(c.cfg)}.`,
      // Indented lines are not wrapped by the report, so this sentence is broken by hand to stay within 100 columns.
      "  The guard warns from 35 percent of the context window (HANDOVER_CONTEXT_WINDOW, 1M tokens",
      "  by default; set it for a 200K model) and, at the end of a turn above that, asks once for the",
      "  handover if HANDOVER.md is older than 30 minutes.",
    );
  } else if (!vendored) {
    R.guard.unshift("Not installed: the scripts could not be put in place (see Problems).");
  } else {
    R.guard.unshift("Not installed: the hooks are not registered (see Problems). The scripts are in place.");
  }
  if (vendored && !c.dryRun) attempt(c, "the recall index", () => checksStep(c));
  attempt(c, "the git check", () => gitCheckStep(c, info));

  R.closing = keepLines(c, personalFile, guardOn);
  const done = c.dryRun
    ? (R.changed ? "Dry run: nothing was written. Run the same command without --dry-run to do this." : "Dry run: nothing would change, everything is already in place.")
    : R.problems.length ? `Finished with ${plural(R.problems.length, "problem")}; see "Problems" above. Everything that could be done was done.`
      : R.changed ? `Done: ${plural(R.written, "item")} written or changed.`
        : "Nothing to do: everything was already in place, and no file was changed.";
  const text = R.format({ version: VERSION, done });
  io.out(text);
  return { code: R.code, text, report: R, changed: R.changed, problems: R.problems, personalFile, guardInstalled: guardOn };
}

// ---------------------------------------------------------------------------------------------
// uninstall
// ---------------------------------------------------------------------------------------------

/** Remove a skill's SKILL.md when it is the copy init installs; keep it when it differs. */
function removeSkill(c, name, packaged) {
  const { R, w } = c;
  const file = skillFile(c.cfg, name);
  const text = peekText(file);
  if (text === null) { R.file("unchanged", file, "not installed"); return; }
  if (toLF(text) !== packaged) {
    R.file("kept", file, "it differs from the copy init installs (edited by you, or from another version), so I left it; delete its folder by hand if you want it gone");
    return;
  }
  const others = fs.readdirSync(path.dirname(file)).filter((n) => n !== "SKILL.md");
  w.remove(file);
  w.removeIfEmpty(path.dirname(file));
  w.removeIfEmpty(path.dirname(path.dirname(file))); // <config>/skills, when that was all it held
  R.file("removed", file, `the /${name} command${others.length ? `; its folder stays because it also holds ${others.join(", ")}` : ""}`);
}

/**
 * Remove the copy of the scripts that init made. A file in that folder that is not part of the copy (a note someone
 * put there) stays, and so does the folder around it.
 */
function removeCopy(c, dir) {
  const { R, w } = c;
  const known = new Set(runtimeFiles());
  const all = listFiles(dir);
  const extras = all.filter((f) => !known.has(f));
  if (!extras.length) {
    w.remove(dir);
    R.file("removed", dir, "the copy of the scripts that init made");
    return;
  }
  for (const f of all.filter((x) => known.has(x))) w.remove(path.join(dir, ...f.split("/")));
  for (const sub of ["scripts", "skills/recall", "skills"]) w.removeIfEmpty(path.join(dir, ...sub.split("/")));
  R.file("removed", dir, `the copy of the scripts that init made; the folder stays because it also holds ${extras.join(", ")}`);
}

/**
 * Take out only what init added at user level: our three hook entries, the /handover and /recall skills (when they are
 * ours) and the copy of the scripts. A git checkout of the scripts is removed only with --purge. settings.json is backed up first.
 * Project files and the effort settings stay.
 */
export function uninstall(opts = {}, io = consoleIO) {
  const c = makeContext("uninstall", opts);
  const { R, w } = c;
  const file = settingsFile(c.cfg);
  R.settingsFile = file;
  R.fact("Config folder", c.cfg);

  const st = readSettings(file);
  if (st.status === "invalid") {
    R.file("skipped", file, `${st.reason}; I left it alone and changed nothing`);
    R.problem(`${file} ${st.reason}, so nothing was removed (the hooks must go first, or they would point at deleted scripts). Fix it, or take out the entries that run claude-code-handover/scripts/context-guard.mjs by hand, then run uninstall again.`);
  } else {
    // The hooks go first, so none is left pointing at a deleted script. A step that fails is reported and the others still run.
    attempt(c, "settings.json", () => {
      if (st.status !== "ok") {
        R.file("unchanged", file, "there is no settings.json, so there are no hooks to remove");
        return;
      }
      const r = removeHooks(st.data);
      if (!r.removed) {
        R.file("unchanged", file, "no hook of ours in it");
        return;
      }
      R.file("backup", w.backup(file, c.now), "a copy of settings.json as it was before this run");
      w.write(file, serializeSettings(r.next, st.raw));
      for (const event of r.events) R.setting(`hooks.${event}`, "removed", "our entry only; other hooks are untouched");
      R.file("updated", file, `${plural(r.removed, "hook entry", "hook entries")} of ours taken out; every other setting is untouched`);
    });
    attempt(c, "the /handover skill", () => removeSkill(c, "handover", handoverSkill()));
    attempt(c, "the /recall skill", () => removeSkill(c, "recall", recallSkill()));
    attempt(c, "the copy of the scripts", () => {
      const dir = vendorDir(c.cfg);
      const state = vendorState(dir);
      if (state === "absent") R.file("unchanged", dir, "not installed");
      else if (state === "ours" || state === "empty") removeCopy(c, dir);
      else if (state === "checkout" && c.purge) { w.remove(dir); R.file("removed", dir, "a git checkout from an older setup, removed because you passed --purge"); }
      else if (state === "checkout") R.file("kept", dir, "it is a git checkout from an older setup; add --purge to remove it too");
      else R.file("kept", dir, "it does not look like a copy of this tool, so I left it");
    });
  }

  // Where the recall index is kept: HANDOVER_DATA_DIR, else the config folder (the same rule as scripts/memory-index.mjs).
  const data = c.env.HANDOVER_DATA_DIR && String(c.env.HANDOVER_DATA_DIR).trim() ? path.resolve(c.env.HANDOVER_DATA_DIR) : path.join(c.cfg, "claude-code-handover-data");
  R.protect(data);
  if (fs.existsSync(data)) R.notes.push(`Kept: the recall index in ${data}. It is a local copy of remarks from your own transcripts and safe to delete.`);
  R.notes.push(
    "Left alone, as promised: CLAUDE.local.md (or CLAUDE.md), HANDOVER.md, DECISIONS.md and claude-token-rules.md in your projects, and the effort settings init merged into settings.json (effortLevel, modelSettings, env.CLAUDE_CODE_SUBAGENT_MODEL, cleanupPeriodDays). The settings.json.bak-* backups stay too. Delete any of them by hand if you want them gone.",
  );
  const done = c.dryRun
    ? (R.changed ? "Dry run: nothing was removed. Run the same command without --dry-run to do this." : "Dry run: there is nothing to remove.")
    : R.problems.length ? `Finished with ${plural(R.problems.length, "problem")}; see "Problems" above.`
      : R.changed ? `Done: ${plural(R.written, "item")} removed or changed.`
        : "Nothing to remove: the handover workflow is not installed here.";
  const text = R.format({ version: VERSION, done });
  io.out(text);
  return { code: R.code, text, report: R, changed: R.changed, problems: R.problems };
}

// ---------------------------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------------------------

const row = (label, value) => `  ${label.padEnd(24)}${value}`;

/** What is installed where: the user level, then the project folder. Changes nothing. Always exits 0. */
export function status(opts = {}, io = consoleIO) {
  const c = makeContext("status", opts);
  const info = {};
  const out = [`claude-handover status ${VERSION}`, ""];
  const custom = c.env.CLAUDE_CONFIG_DIR && String(c.env.CLAUDE_CONFIG_DIR).trim();
  out.push(`Config folder ${c.cfg} (${custom ? "from CLAUDE_CONFIG_DIR" : "the default, ~/.claude"})`);

  const st = readSettings(settingsFile(c.cfg));
  info.settings = st.status;
  out.push(row("settings.json", st.status === "missing" ? "missing" : st.status === "invalid" ? `not usable: ${st.reason}` : "found"));

  info.skills = {};
  for (const [name, packaged] of [["handover", handoverSkill()], ["recall", recallSkill()]]) {
    const file = skillFile(c.cfg, name);
    const text = peekText(file);
    info.skills[name] = text === null ? "absent" : toLF(text) === packaged ? "same" : "differs";
    out.push(row(`/${name} skill`, text === null ? "not installed" : `${toLF(text) === packaged ? "installed, same as this version's copy" : "installed, differs from this version's copy"} (${file})`));
  }

  const dir = vendorDir(c.cfg);
  const state = vendorState(dir);
  let version = "";
  try { version = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version || ""; } catch { /* no package.json */ }
  info.vendor = { state, version };
  out.push(row("scripts", state === "absent" ? "not installed"
    : state === "ours" ? `${dir} (our copy${version ? `, version ${version}` : ""})`
      : state === "checkout" ? `${dir} (a git checkout from an older setup${version ? `, version ${version}` : ""})`
        : state === "empty" ? `${dir} (an empty folder)` : `${dir} (not ours)`));

  info.hooks = {};
  for (const event of HOOK_EVENTS) {
    const found = st.status === "ok" ? ourHooks({ [event]: st.data.hooks && st.data.hooks[event] }) : [];
    if (!found.length) { info.hooks[event] = "missing"; out.push(row(`hook ${event}`, st.status === "ok" ? "not registered" : "unknown")); continue; }
    const script = scriptOf(found[0].hook);
    const present = script && fs.existsSync(script);
    info.hooks[event] = present ? "registered" : "script missing";
    out.push(row(`hook ${event}`, `${present ? "registered" : "registered, but the script is missing"}: ${script || "(no path)"}${found.length > 1 ? ` (${found.length} entries)` : ""}`));
  }

  if (st.status === "ok") {
    const s = st.data;
    const bits = [];
    if (s.effortLevel !== undefined) bits.push(`effortLevel ${JSON.stringify(s.effortLevel)}`);
    if (s.modelSettings && typeof s.modelSettings === "object") for (const [id, e] of Object.entries(s.modelSettings)) if (e && e.effortLevel !== undefined) bits.push(`${id} ${JSON.stringify(e.effortLevel)}`);
    if (s.env && s.env.CLAUDE_CODE_SUBAGENT_MODEL !== undefined) bits.push(`subagents ${JSON.stringify(s.env.CLAUDE_CODE_SUBAGENT_MODEL)}`);
    if (s.cleanupPeriodDays !== undefined) bits.push(`cleanupPeriodDays ${s.cleanupPeriodDays}`);
    out.push(row("effort settings", bits.length ? bits.join("; ") : "none set"));
  }
  const managed = readManaged(c.env);
  out.push(row("managed settings", managed.status === "none" ? `none found (${managed.path})`
    : managed.status === "invalid" ? managed.ignored.map((i) => `${i.file} ${i.reason}`).join("; ")
      : `${managed.files.join(", ")}; sets: ${Object.keys(managed.data).join(", ") || "nothing"}`));

  const p = inspectProject(c.dir, c.env);
  out.push("", `Project folder ${c.dir}`);
  out.push(row("git repository", p.isGit ? "yes" : "no"));
  const block = personalRulesState(c);
  info.project = { rules: block.state };
  out.push(row("personal rules", block.text));
  const handover = peekText(path.join(c.dir, "HANDOVER.md"));
  const streams = handover === null ? [] : toLF(handover).split("\n").map((l) => /^##\s+(.+?)\s*$/.exec(l)).filter(Boolean).map((m) => m[1]).filter((n) => !/^Pointers\b/i.test(n));
  info.project.handover = handover === null ? "missing" : "present";
  info.project.streams = streams;
  out.push(row("HANDOVER.md", handover === null ? "missing" : `present, streams: ${streams.join(", ") || "none"}`));
  const decisions = peekText(path.join(c.dir, "DECISIONS.md"));
  const dated = decisions === null ? 0 : toLF(decisions).split("\n").filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l)).length;
  info.project.decisions = decisions === null ? "missing" : "present";
  out.push(row("DECISIONS.md", decisions === null ? "missing" : `present, ${plural(dated, "dated line")}`));
  const card = peekText(path.join(c.dir, "claude-token-rules.md"));
  info.project.card = card === null ? "missing" : "present";
  out.push(row("claude-token-rules.md", card === null ? "missing" : `present (${/^## Effort by job \(one model\)/m.test(card) ? "the table for one model" : "the table for more than one model"})`));
  if (p.isGit) {
    const ignore = peekText(path.join(c.dir, ".gitignore"));
    const listed = new Set(ignore === null ? [] : toLF(ignore).split("\n").map((l) => l.trim().replace(/^\/+/, "").replace(/^\*\*\//, "")));
    const missing = PERSONAL_FILES.filter((n) => !listed.has(n));
    info.project.gitignoreMissing = missing;
    out.push(row(".gitignore", !missing.length ? "lists all four personal files" : `missing: ${missing.join(", ")}`));
  }
  const installed = info.skills.handover !== "absent" && HOOK_EVENTS.every((e) => info.hooks[e] === "registered");
  out.push("", installed ? "Installed. Run init in a project folder to set one up." : "Not fully installed. Run init in a project folder to set up everything.");
  const text = out.join("\n") + "\n";
  io.out(text);
  return { code: 0, text, info };
}

/** Where our personal rules are in the project: CLAUDE.local.md, CLAUDE.md, or nowhere. */
function personalRulesState(c) {
  for (const name of ["CLAUDE.local.md", "CLAUDE.md"]) {
    const text = peekText(path.join(c.dir, name));
    if (text === null) continue;
    const found = findBlock(toLF(text));
    if (found) return { state: name, text: `${name} has our rules block${found === "edited" ? " (edited)" : ""}` };
  }
  return { state: "missing", text: isFile(path.join(c.dir, "CLAUDE.local.md")) ? "CLAUDE.local.md exists without our block" : "missing" };
}
