// settings.json: reading it without ever changing it, merging our effort keys and our three hooks at key level,
// and taking the hooks out again. The functions that plan a change are pure: they return new settings and a list
// of what changed, and leave the input alone.
import fs from "node:fs";
import path from "node:path";
import { bomOf, forwardSlashes, eolOf, isObject, stripBom } from "./util.mjs";
import { effortForModel } from "./models.mjs";
import { hooksBlock, settingsBlock } from "./templates.mjs";

const clone = (v) => structuredClone(v);
const show = (v) => (v === undefined ? "missing" : JSON.stringify(v));
const getPath = (obj, parts) => {
  let cur = obj;
  for (const p of parts) {
    if (!isObject(cur) || !Object.hasOwn(cur, p)) return undefined;
    cur = cur[p];
  }
  return cur;
};

// ---- reading and writing --------------------------------------------------------------------

/**
 * Read settings.json without modifying it.
 * status: "missing" | "ok" (an empty file counts as {}) | "invalid" (not JSON, not an object, or unreadable)
 */
export function readSettings(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return { status: "missing", data: {}, raw: null };
    return { status: "invalid", data: null, raw: null, reason: `cannot be read (${e && (e.code || e.message)})` };
  }
  const text = stripBom(raw);
  if (!text.trim()) return { status: "ok", data: {}, raw };
  try {
    const data = JSON.parse(text);
    if (isObject(data)) return { status: "ok", data, raw };
    return { status: "invalid", data: null, raw, reason: "is valid JSON but not a JSON object" };
  } catch (e) {
    // V8 quotes part of the file in its message, line breaks included: keep the first 160 characters, on one line.
    const why = String(e.message).replace(/\s+/g, " ").trim();
    return { status: "invalid", data: null, raw, reason: `is not valid JSON (${why.length > 160 ? `${why.slice(0, 160)}...` : why})` };
  }
}

/**
 * The text to write: the settings with the indentation, the line ending and the byte order mark the file already
 * had (2 spaces, LF and no mark when it is new).
 */
export function serializeSettings(data, raw) {
  const old = raw || "";
  const body = stripBom(old);
  const eol = eolOf(body);
  const m = /^([ \t]+)"/m.exec(body);
  const indent = m ? (m[1].includes("\t") ? "\t" : Math.min(m[1].length, 8)) : 2;
  return bomOf(old) + JSON.stringify(data, null, indent).replace(/\n/g, eol) + eol;
}

// ---- the organisation's managed settings ----------------------------------------------------

/**
 * Where the organisation's managed-settings.json lives on this system, as the Claude Code docs give it (the
 * folder next to it may hold a managed-settings.d with more files). CLAUDE_HANDOVER_MANAGED_SETTINGS overrides
 * the path, for tests.
 */
export function managedSettingsPath(env = process.env, platform = process.platform) {
  const override = env.CLAUDE_HANDOVER_MANAGED_SETTINGS;
  if (override && String(override).trim()) return path.resolve(String(override));
  if (platform === "win32") return path.win32.join(env.ProgramFiles && String(env.ProgramFiles).trim() ? String(env.ProgramFiles) : "C:\\Program Files", "ClaudeCode", "managed-settings.json");
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  return "/etc/claude-code/managed-settings.json";
}
/** The Windows path older Claude Code versions used. Current versions do not read it, so nothing there is managed. */
export const LEGACY_WINDOWS_MANAGED = "C:\\ProgramData\\ClaudeCode\\managed-settings.json";

const deepMerge = (a, b) => {
  if (!isObject(a) || !isObject(b)) return clone(b);
  const out = clone(a);
  for (const [k, v] of Object.entries(b)) out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : clone(v);
  return out;
};

/**
 * The managed settings from files: managed-settings.json first, then every *.json in the managed-settings.d folder
 * next to it in alphabetical order (hidden files and other extensions are ignored), later files over earlier ones.
 * A file that is not a valid JSON object is ignored and listed in `ignored`.
 * Returns { path, files, ignored, status: "none" | "ok" | "invalid", data, legacy }; `legacy` is set when a file
 * sits at the old Windows path, which current Claude Code does not read.
 * MDM profiles, the Windows registry and server-managed settings are not files and are not read.
 */
export function readManaged(env = process.env, platform = process.platform) {
  const file = managedSettingsPath(env, platform);
  const P = /^[A-Za-z]:[\\/]/.test(file) ? path.win32 : path;
  const dir = P.join(P.dirname(file), "managed-settings.d");
  const candidates = [file];
  try {
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort()) candidates.push(P.join(dir, name));
  } catch { /* no drop-in folder */ }
  const files = [];
  const ignored = [];
  let data = {};
  for (const f of candidates) {
    const r = readSettings(f);
    if (r.status === "missing") continue;
    if (r.status === "ok") { files.push(f); data = deepMerge(data, r.data); } else ignored.push({ file: f, reason: r.reason });
  }
  const none = !files.length && !ignored.length;
  const legacy = !env.CLAUDE_HANDOVER_MANAGED_SETTINGS && platform === "win32" && fs.existsSync(LEGACY_WINDOWS_MANAGED) ? LEGACY_WINDOWS_MANAGED : "";
  return { path: file, files, ignored, status: none ? "none" : files.length ? "ok" : "invalid", data, legacy };
}

// ---- Step 6: the effort keys ----------------------------------------------------------------

/**
 * Merge the effort keys for these models into `settings` at key level: every other key, other models' entries in
 * modelSettings and other variables in env stay. A key that managed settings already set is skipped. Then every
 * existing modelSettings entry that has an effortLevel is brought in line with the models, because a saved
 * per-model level outranks the top-level effortLevel.
 * Returns { next, entries }, one entry per key: { key, action: "set" | "unchanged" | "adjusted" | "kept" | "skipped", detail }.
 */
export function planEffort(settings, keys, managed = {}) {
  const next = clone(settings);
  const entries = [];
  const block = settingsBlock(keys);
  const add = (key, action, detail) => entries.push({ key, action, detail });
  const overruled = (key, parts) => {
    const v = getPath(managed, parts);
    if (v === undefined) return false;
    add(key, "skipped", `managed settings set it to ${show(v)}, which outranks this file`);
    return true;
  };
  const setLeaf = (key, cur, value, assign) => {
    if (cur === value) { add(key, "unchanged", `already ${show(value)}`); return; }
    assign();
    add(key, "set", cur === undefined ? `now ${show(value)}, was missing` : `now ${show(value)}, was ${show(cur)}`);
  };

  if (!overruled("effortLevel", ["effortLevel"])) {
    setLeaf("effortLevel", next.effortLevel, block.effortLevel, () => { next.effortLevel = block.effortLevel; });
  }

  const wanted = block.modelSettings || {};
  if (next.modelSettings !== undefined && !isObject(next.modelSettings)) {
    add("modelSettings", "skipped", "it is not an object in settings.json, so it was left alone");
  } else {
    const handled = new Set();
    for (const [id, entry] of Object.entries(wanted)) {
      const key = `modelSettings.${id}.effortLevel`;
      handled.add(id);
      if (overruled(key, ["modelSettings", id, "effortLevel"])) continue;
      const cur = next.modelSettings ? next.modelSettings[id] : undefined;
      if (cur !== undefined && !isObject(cur)) { add(key, "skipped", "the entry is not an object in settings.json, so it was left alone"); continue; }
      setLeaf(key, cur && cur.effortLevel, entry.effortLevel, () => {
        if (!next.modelSettings) next.modelSettings = {};
        if (!cur) next.modelSettings[id] = { effortLevel: entry.effortLevel };
        else cur.effortLevel = entry.effortLevel;
      });
    }
    if (keys.length > 1 && !keys.includes("sonnet")) {
      add("modelSettings.claude-sonnet-5-5.effortLevel", "skipped", "no Sonnet in your list, so no Sonnet entry is added");
    }
    for (const [id, cur] of Object.entries(next.modelSettings || {})) {
      if (handled.has(id) || !isObject(cur) || cur.effortLevel === undefined) continue;
      const key = `modelSettings.${id}.effortLevel`;
      const target = effortForModel(keys, id);
      if (cur.effortLevel === target || overruled(key, ["modelSettings", id, "effortLevel"])) continue;
      add(key, "adjusted", `now ${show(target)}, was ${show(cur.effortLevel)}; a saved per-model level outranks the top-level effortLevel`);
      cur.effortLevel = target;
    }
  }

  const subagent = block.env && block.env.CLAUDE_CODE_SUBAGENT_MODEL;
  const subKey = "env.CLAUDE_CODE_SUBAGENT_MODEL";
  if (!subagent) {
    const had = isObject(next.env) ? next.env.CLAUDE_CODE_SUBAGENT_MODEL : undefined;
    add(subKey, "skipped", `${keys.length === 1 ? "one model only" : "no Sonnet or Haiku in your list"}: no subagent model is set${had !== undefined ? `; the value ${show(had)} that is already there is left as it is` : ""}`);
  } else if (next.env !== undefined && !isObject(next.env)) {
    add(subKey, "skipped", "env is not an object in settings.json, so it was left alone");
  } else if (!overruled(subKey, ["env", "CLAUDE_CODE_SUBAGENT_MODEL"])) {
    setLeaf(subKey, next.env && next.env.CLAUDE_CODE_SUBAGENT_MODEL, subagent, () => {
      if (!next.env) next.env = {};
      next.env.CLAUDE_CODE_SUBAGENT_MODEL = subagent;
    });
  }

  if (!overruled("cleanupPeriodDays", ["cleanupPeriodDays"])) {
    const cur = next.cleanupPeriodDays;
    if (typeof cur === "number" && cur > block.cleanupPeriodDays) {
      add("cleanupPeriodDays", "kept", `${cur} days is longer than ${block.cleanupPeriodDays}, so transcripts are kept as long as you had set`);
    } else {
      setLeaf("cleanupPeriodDays", cur, block.cleanupPeriodDays, () => { next.cleanupPeriodDays = block.cleanupPeriodDays; });
    }
  }
  return { next, entries };
}

// ---- Step 8: the three hooks ----------------------------------------------------------------

export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"];
const GUARD_SUFFIX = "claude-code-handover/scripts/context-guard.mjs";
const GUARD_RE = /claude-code-handover\/scripts\/context-guard\.mjs/i;

/** The command and arguments of a hook as one slash-normalised string. */
const hookText = (h) => forwardSlashes([h.command, ...(Array.isArray(h.args) ? h.args : [])].filter((x) => typeof x === "string").join(" "));
/** True for a hook that runs the context guard, in exec form or as a shell command, with either slash style. */
export const isOurHook = (h) => isObject(h) && GUARD_RE.test(hookText(h));
/**
 * The path of the guard script a hook runs: the argument that holds it (exec form, where a path with spaces is one
 * argument), or the path inside a shell command, quoted or not. "" when there is none.
 */
export function scriptOf(h) {
  if (!isObject(h)) return "";
  for (const a of Array.isArray(h.args) ? h.args : []) {
    if (typeof a === "string" && forwardSlashes(a).toLowerCase().endsWith(GUARD_SUFFIX)) return forwardSlashes(a);
  }
  if (typeof h.command !== "string") return "";
  const text = forwardSlashes(h.command);
  const m = /["']([^"']*claude-code-handover\/scripts\/context-guard\.mjs)["']/i.exec(text) || /(\S*claude-code-handover\/scripts\/context-guard\.mjs)/i.exec(text);
  return m ? m[1] : "";
}
const norm = (p) => (process.platform === "win32" ? forwardSlashes(p).toLowerCase() : forwardSlashes(p));

/** Every hook of ours under `hooks`, as { event, group, index, hook }. */
export function ourHooks(hooks) {
  const found = [];
  if (!isObject(hooks)) return found;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group) => {
      if (!isObject(group) || !Array.isArray(group.hooks)) return;
      group.hooks.forEach((hook, index) => { if (isOurHook(hook)) found.push({ event, group, index, hook }); });
    });
  }
  return found;
}

/**
 * Add the three hooks for the guard in exec form, keeping every hook already there. An event that already runs
 * our guard from this path gets nothing added; one that runs it from another path or in shell form gets that entry
 * rewritten in place, so there is never a duplicate.
 * Returns { next, entries }, one entry per event: { key, action: "added" | "unchanged" | "updated" | "skipped", detail }.
 */
export function mergeHooks(settings, cfgSlash) {
  const next = clone(settings);
  const entries = [];
  if (next.hooks !== undefined && !isObject(next.hooks)) {
    entries.push({ key: "hooks", action: "skipped", detail: "is not an object in settings.json and was left alone" });
    return { next, entries };
  }
  const wanted = hooksBlock(cfgSlash).hooks;
  for (const event of HOOK_EVENTS) {
    const key = `hooks.${event}`;
    const entry = wanted[event][0].hooks[0];
    const want = norm(entry.args[0]);
    if (next.hooks && next.hooks[event] !== undefined && !Array.isArray(next.hooks[event])) {
      entries.push({ key, action: "skipped", detail: "is not a list in settings.json and was left alone" });
      continue;
    }
    const ours = ourHooks(next.hooks ? { [event]: next.hooks[event] } : {});
    if (ours.some((o) => norm(scriptOf(o.hook)) === want)) {
      entries.push({ key, action: "unchanged", detail: "already runs the guard from this folder" });
    } else if (ours.length) {
      const [first] = ours;
      first.group.hooks[first.index] = clone(entry);
      entries.push({ key, action: "updated", detail: `an entry of ours ran ${scriptOf(first.hook) || "the guard"}; it now runs ${entry.args[0]}` });
    } else {
      if (!next.hooks) next.hooks = {};
      if (!Array.isArray(next.hooks[event])) next.hooks[event] = [];
      next.hooks[event].push(clone(wanted[event][0]));
      entries.push({ key, action: "added", detail: `runs ${entry.args[0]}` });
    }
  }
  return { next, entries };
}

/**
 * The settings without any hook of ours. A group that this leaves empty goes too, then an event with no groups,
 * then the hooks key itself; hooks of other tools are not touched.
 * Returns { next, removed, events }.
 */
export function removeHooks(settings) {
  const next = clone(settings);
  const events = [];
  if (!isObject(next.hooks)) return { next, removed: 0, events };
  let removed = 0;
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const before = removed;
    const kept = [];
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) { kept.push(group); continue; }
      const hooks = group.hooks.filter((h) => { if (isOurHook(h)) { removed++; return false; } return true; });
      if (hooks.length || group.hooks.length === 0) kept.push({ ...group, hooks });
    }
    if (removed === before) continue;
    events.push(event);
    if (kept.length) next.hooks[event] = kept;
    else delete next.hooks[event];
  }
  if (removed && !Object.keys(next.hooks).length) delete next.hooks;
  return { next, removed, events };
}
