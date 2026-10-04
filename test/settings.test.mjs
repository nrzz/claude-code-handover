// settings.json: reading it safely, merging the effort keys and the three hooks at key level, taking the hooks out.
// These tests call the planning functions directly: they are pure, so no folder is touched except where a file is read.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BLOCK, promptBlocks, sandbox, withBox, write } from "./helpers.mjs";
import { parseModels } from "../src/models.mjs";
import {
  isOurHook, managedSettingsPath, mergeHooks, ourHooks, planEffort, readManaged, readSettings, removeHooks, scriptOf, serializeSettings,
} from "../src/settings.mjs";

const keys = (t) => parseModels(t).keys;
const plan = (settings, models, managed) => planEffort(settings, keys(models), managed);
const actions = (entries, action) => entries.filter((e) => e.action === action).map((e) => e.key);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- the effort keys ------------------------------------------------------------------------

test("merging into an empty settings object gives exactly the block of the setup prompt", () => {
  assert.deepEqual(plan({}, "Opus + Sonnet").next, JSON.parse(promptBlocks()[BLOCK.multi]));
  const single = JSON.parse(promptBlocks()[BLOCK.single].replace("<the model id from Step 1>", "claude-opus-5-5"));
  assert.deepEqual(plan({}, "Opus only").next, single);
});

test("every other key stays, and so do other models' entries and other variables inside env", () => {
  const before = {
    theme: "dark",
    permissions: { allow: ["Bash(npm test)"] },
    env: { MY_VAR: "1", CLAUDE_CODE_SUBAGENT_MODEL: "opus" },
    modelSettings: { "claude-fable-5-1": { effortLevel: "high", note: "keep me" } },
    cleanupPeriodDays: 30,
  };
  const { next, entries } = plan(clone(before), "Fable + Opus + Sonnet");
  assert.equal(next.theme, "dark");
  assert.deepEqual(next.permissions, before.permissions);
  assert.deepEqual(next.env, { MY_VAR: "1", CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" });
  assert.deepEqual(next.modelSettings, { "claude-fable-5-1": { effortLevel: "high", note: "keep me" }, "claude-sonnet-5-5": { effortLevel: "medium" } });
  assert.equal(next.effortLevel, "high");
  assert.equal(next.cleanupPeriodDays, 365);
  assert.deepEqual(actions(entries, "set").sort(), ["cleanupPeriodDays", "effortLevel", "env.CLAUDE_CODE_SUBAGENT_MODEL", "modelSettings.claude-sonnet-5-5.effortLevel"]);
});

test("the input is never modified", () => {
  const before = { env: { A: "1" }, modelSettings: { "claude-opus-5-5": { effortLevel: "max" } } };
  const copy = clone(before);
  plan(before, "Opus + Sonnet");
  assert.deepEqual(before, copy);
});

test("applying the same merge twice changes nothing the second time", () => {
  for (const models of ["Opus + Sonnet", "Opus only", "Opus + Haiku", "Fable + Opus + Sonnet"]) {
    const first = plan({ modelSettings: { "claude-opus-5-5": { effortLevel: "max" } } }, models);
    const second = plan(first.next, models);
    assert.deepEqual(second.next, first.next, models);
    assert.deepEqual(actions(second.entries, "set").concat(actions(second.entries, "adjusted")), [], models);
  }
});

const ADJUST = [
  ["Opus + Sonnet",
    { "claude-opus-5-5": { effortLevel: "xhigh" }, "claude-sonnet-5-5": { effortLevel: "high" }, "claude-haiku-4-5": { effortLevel: "low" }, "claude-opus-4-6": { effortLevel: "medium" } },
    { "claude-opus-5-5": "high", "claude-sonnet-5-5": "medium", "claude-haiku-4-5": "high", "claude-opus-4-6": "high" }],
  ["Opus + Haiku",
    { "claude-haiku-4-5": { effortLevel: "high" }, "claude-opus-5-5": { effortLevel: "max" }, "claude-sonnet-5-5": { effortLevel: "medium" } },
    { "claude-haiku-4-5": "medium", "claude-opus-5-5": "high", "claude-sonnet-5-5": "high" }],
  ["Opus only",
    { "claude-opus-5-5": { effortLevel: "max" }, "claude-sonnet-5-5": { effortLevel: "high" } },
    { "claude-opus-5-5": "medium", "claude-sonnet-5-5": "medium" }],
  ["Fable + Opus",
    { "claude-opus-5-5": { effortLevel: "medium" }, "claude-fable-5-1": { effortLevel: "xhigh" } },
    { "claude-opus-5-5": "high", "claude-fable-5-1": "high" }],
  ["Sonnet only",
    { "claude-sonnet-5-5": { effortLevel: "low" }, "claude-opus-5-5": { effortLevel: "high" } },
    { "claude-sonnet-5-5": "medium", "claude-opus-5-5": "medium" }],
];
for (const [models, existing, expected] of ADJUST) {
  test(`existing per-model levels are brought in line for "${models}" and each change is reported`, () => {
    const { next, entries } = plan({ modelSettings: clone(existing) }, models);
    for (const [id, level] of Object.entries(expected)) assert.equal(next.modelSettings[id].effortLevel, level, id);
    const changed = Object.keys(existing).filter((id) => existing[id].effortLevel !== expected[id]);
    const reported = entries.filter((e) => e.action === "adjusted" || (e.action === "set" && e.key.startsWith("modelSettings."))).map((e) => e.key.split(".")[1]);
    for (const id of changed) assert.ok(reported.includes(id), `${id} was changed and must be reported`);
    for (const e of entries.filter((x) => x.action === "adjusted")) assert.match(e.detail, /was "/);
  });
}

test("an entry without an effortLevel, or with other keys, is not touched beyond effortLevel", () => {
  const { next } = plan({ modelSettings: { "claude-opus-5-5": { thinking: "on" }, "claude-haiku-4-5": { effortLevel: "low", thinking: "off" } } }, "Opus + Sonnet");
  assert.deepEqual(next.modelSettings["claude-opus-5-5"], { thinking: "on" });
  assert.deepEqual(next.modelSettings["claude-haiku-4-5"], { effortLevel: "high", thinking: "off" });
});

test("with no Sonnet in the list the Sonnet entry is dropped, and the report says so", () => {
  const { next, entries } = plan({}, "Opus + Haiku");
  assert.equal(next.modelSettings, undefined);
  assert.deepEqual(next.env, { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" });
  assert.ok(entries.some((e) => e.key === "modelSettings.claude-sonnet-5-5.effortLevel" && e.action === "skipped"));
});

test("no subagent model for one model, and none when there is neither Sonnet nor Haiku; the report says why", () => {
  for (const [models, reason] of [["Opus only", /one model only/], ["Opus + Fable", /no Sonnet or Haiku/]]) {
    const { next, entries } = plan({}, models);
    assert.equal(next.env, undefined, models);
    assert.match(entries.find((e) => e.key === "env.CLAUDE_CODE_SUBAGENT_MODEL").detail, reason);
  }
});

test("the report says that a subagent model set earlier is left as it is when this run sets none", () => {
  const { next, entries } = plan({ env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet", MY_VAR: "1" } }, "Opus only");
  assert.deepEqual(next.env, { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet", MY_VAR: "1" });
  assert.equal(entries.find((e) => e.key === "env.CLAUDE_CODE_SUBAGENT_MODEL").detail, 'one model only: no subagent model is set; the value "sonnet" that is already there is left as it is');
});

test("a longer retention than 365 days is kept, a shorter one is raised", () => {
  const long = plan({ cleanupPeriodDays: 730 }, "Opus only");
  assert.equal(long.next.cleanupPeriodDays, 730);
  assert.equal(long.entries.find((e) => e.key === "cleanupPeriodDays").action, "kept");
  assert.equal(plan({ cleanupPeriodDays: 30 }, "Opus only").next.cleanupPeriodDays, 365);
  assert.equal(plan({ cleanupPeriodDays: 365 }, "Opus only").entries.find((e) => e.key === "cleanupPeriodDays").action, "unchanged");
});

test("a key that managed settings set is skipped and reported, the others are applied", () => {
  const { next, entries } = plan({ theme: "dark" }, "Opus + Sonnet", { effortLevel: "max", env: { OTHER: "1" } });
  assert.equal(next.effortLevel, undefined, "managed settings outrank this file, so it is not written");
  const skipped = entries.find((e) => e.key === "effortLevel");
  assert.equal(skipped.action, "skipped");
  assert.match(skipped.detail, /managed settings set it to "max"/);
  assert.equal(next.cleanupPeriodDays, 365);
  assert.deepEqual(next.env, { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" }, "a managed env without our variable does not block it");
});

test("managed settings are compared leaf by leaf: the subagent variable, one model's level, the retention", () => {
  const { next, entries } = plan(
    { modelSettings: { "claude-sonnet-5-5": { effortLevel: "high" }, "claude-opus-5-5": { effortLevel: "max" } } },
    "Opus + Sonnet",
    { env: { CLAUDE_CODE_SUBAGENT_MODEL: "opus" }, modelSettings: { "claude-sonnet-5-5": { effortLevel: "low" } }, cleanupPeriodDays: 30 },
  );
  assert.equal(next.env, undefined);
  assert.equal(next.cleanupPeriodDays, undefined);
  assert.equal(next.modelSettings["claude-sonnet-5-5"].effortLevel, "high", "the managed leaf is not touched, not even adjusted");
  assert.equal(next.modelSettings["claude-opus-5-5"].effortLevel, "high", "other models are still adjusted");
  assert.deepEqual(actions(entries, "skipped").sort(), ["cleanupPeriodDays", "env.CLAUDE_CODE_SUBAGENT_MODEL", "modelSettings.claude-sonnet-5-5.effortLevel"]);
});

test("a modelSettings or env that is not an object is left alone and reported", () => {
  const a = plan({ modelSettings: "oops", env: ["x"] }, "Opus + Sonnet");
  assert.equal(a.next.modelSettings, "oops");
  assert.deepEqual(a.next.env, ["x"]);
  assert.ok(a.entries.some((e) => e.key === "modelSettings" && e.action === "skipped"));
  assert.ok(a.entries.some((e) => e.key === "env.CLAUDE_CODE_SUBAGENT_MODEL" && e.action === "skipped"));
  assert.equal(a.next.effortLevel, "high", "the other keys are still applied");
});

// ---- the three hooks ------------------------------------------------------------------------

const CFG = "C:/Users/me/.claude";
const SCRIPT = `${CFG}/claude-code-handover/scripts/context-guard.mjs`;
const ours = () => ({ type: "command", command: "node", args: [SCRIPT], timeout: 10 });
const other = (n = 1) => ({ type: "command", command: "node", args: [`/tools/other-${n}.mjs`] });
const countOurs = (settings, event) => ourHooks({ [event]: settings.hooks[event] }).length;

test("hooks are added for the three events, exactly as the prompt's block says", () => {
  const { next, entries } = mergeHooks({}, CFG);
  const expected = JSON.parse(promptBlocks()[BLOCK.hooks].split("<home>/.claude").join(CFG));
  assert.deepEqual(next, expected);
  assert.deepEqual(entries.map((e) => [e.key, e.action]), [["hooks.SessionStart", "added"], ["hooks.UserPromptSubmit", "added"], ["hooks.Stop", "added"]]);
});

test("hooks already there are kept and ours goes in as a group of its own", () => {
  const before = { hooks: { Stop: [{ matcher: "*", hooks: [other(1), other(2)] }], PreToolUse: [{ hooks: [other(3)] }] }, theme: "dark" };
  const { next } = mergeHooks(clone(before), CFG);
  assert.deepEqual(next.hooks.Stop[0], before.hooks.Stop[0]);
  assert.deepEqual(next.hooks.Stop[1], { hooks: [ours()] });
  assert.deepEqual(next.hooks.PreToolUse, before.hooks.PreToolUse);
  assert.equal(next.theme, "dark");
  assert.deepEqual(Object.keys(next.hooks), ["Stop", "PreToolUse", "SessionStart", "UserPromptSubmit"]);
});

test("a hook of ours that already runs the guard from this folder is not added again", () => {
  const first = mergeHooks({}, CFG).next;
  const second = mergeHooks(first, CFG);
  assert.deepEqual(second.next, first);
  assert.ok(second.entries.every((e) => e.action === "unchanged"));
  for (const ev of ["SessionStart", "UserPromptSubmit", "Stop"]) assert.equal(countOurs(second.next, ev), 1);
});

test("our guard run from another path, or through ~, is rewritten in place, never duplicated", () => {
  const variants = [
    { type: "command", command: "node ~/.claude/claude-code-handover/scripts/context-guard.mjs" },
    { type: "command", command: 'node "D:\\old\\home\\.claude\\claude-code-handover\\scripts\\context-guard.mjs"' },
    { type: "command", command: "node", args: ["D:/old/home/.claude/claude-code-handover/scripts/context-guard.mjs"], timeout: 5 },
  ];
  for (const v of variants) {
    const before = { hooks: { SessionStart: [{ matcher: "startup", hooks: [other(1), v] }] } };
    const { next, entries } = mergeHooks(clone(before), CFG);
    assert.equal(countOurs(next, "SessionStart"), 1, JSON.stringify(v));
    assert.deepEqual(next.hooks.SessionStart, [{ matcher: "startup", hooks: [other(1), ours()] }], "the group's matcher and the other hook are kept");
    assert.equal(entries.find((e) => e.key === "hooks.SessionStart").action, "updated");
  }
});

test("a path that differs only in slash style counts as the same, in exec form or as a shell command", () => {
  const exec = { hooks: { Stop: [{ hooks: [{ type: "command", command: "node", args: ["C:\\Users\\me\\.claude\\claude-code-handover\\scripts\\context-guard.mjs"] }] }] } };
  assert.equal(mergeHooks(exec, CFG).entries.find((e) => e.key === "hooks.Stop").action, "unchanged");
  const shell = { hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "C:\\Users\\me\\.claude\\claude-code-handover\\scripts\\context-guard.mjs"' }] }] } };
  const r = mergeHooks(shell, CFG);
  assert.equal(r.entries.find((e) => e.key === "hooks.Stop").action, "unchanged");
  assert.equal(countOurs(r.next, "Stop"), 1, "it works as it is, so it is neither rewritten nor doubled");
});

test("a hooks value of the wrong kind is left alone, one event at a time", () => {
  const a = mergeHooks({ hooks: "nope" }, CFG);
  assert.equal(a.next.hooks, "nope");
  assert.equal(a.entries[0].action, "skipped");
  const b = mergeHooks({ hooks: { Stop: "x" } }, CFG);
  assert.equal(b.next.hooks.Stop, "x");
  assert.equal(b.entries.find((e) => e.key === "hooks.Stop").action, "skipped");
  assert.equal(countOurs(b.next, "SessionStart"), 1, "the other events still get their hook");
});

test("the input is not modified by a hooks merge", () => {
  const before = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node ~/.claude/claude-code-handover/scripts/context-guard.mjs" }] }] } };
  const copy = clone(before);
  mergeHooks(before, CFG);
  assert.deepEqual(before, copy);
});

test("what counts as our hook", () => {
  assert.ok(isOurHook(ours()));
  assert.ok(isOurHook({ command: "node /home/me/.claude/claude-code-handover/scripts/context-guard.mjs" }));
  assert.ok(isOurHook({ command: "node", args: ["C:\\x\\claude-code-handover\\scripts\\context-guard.mjs"] }));
  assert.ok(!isOurHook(other()));
  assert.ok(!isOurHook({ command: "node", args: ["/x/claude-cost-guard/guard.mjs"] }));
  assert.ok(!isOurHook({ command: "node", args: ["/x/some-other-tool/scripts/context-guard.mjs"] }));
  assert.ok(!isOurHook(null) && !isOurHook("node") && !isOurHook({}));
  assert.equal(scriptOf({ command: 'node "C:\\a b\\claude-code-handover\\scripts\\context-guard.mjs"' }).endsWith("claude-code-handover/scripts/context-guard.mjs"), true);
});

test("a config folder with spaces in its path is one argument in exec form, and is recognised as the same on the next run", () => {
  const cfg = "C:/Users/John Smith/.claude";
  const script = `${cfg}/claude-code-handover/scripts/context-guard.mjs`;
  const first = mergeHooks({}, cfg);
  assert.equal(scriptOf(first.next.hooks.Stop[0].hooks[0]), script, "the whole path, not the part after the last space");
  const second = mergeHooks(first.next, cfg);
  assert.deepEqual(second.next, first.next);
  assert.ok(second.entries.every((e) => e.action === "unchanged"), JSON.stringify(second.entries));
  // the same path written as a shell command, quoted or with backslashes
  assert.equal(scriptOf({ command: `node "${script}"` }), script);
  assert.equal(scriptOf({ command: `node '${script}'` }), script);
  assert.equal(scriptOf({ command: 'node "C:\\Users\\John Smith\\.claude\\claude-code-handover\\scripts\\context-guard.mjs"' }), script);
  const shell = { hooks: { Stop: [{ hooks: [{ type: "command", command: `node "${script}"` }] }] } };
  assert.equal(mergeHooks(shell, cfg).entries.find((e) => e.key === "hooks.Stop").action, "unchanged");
  assert.equal(scriptOf({ command: "node", args: ["--flag", script] }), script, "the guard may follow other arguments");
  assert.equal(scriptOf({ command: "node", args: ["/other/thing.mjs"] }), "");
  assert.equal(scriptOf(null), "");
});

test("removing our hooks takes out only ours, then the groups, events and hooks key it leaves empty", () => {
  const added = mergeHooks({ hooks: { Stop: [{ hooks: [other(1)] }] }, theme: "dark" }, CFG).next;
  const { next, removed, events } = removeHooks(added);
  assert.equal(removed, 3);
  assert.deepEqual(events.sort(), ["SessionStart", "Stop", "UserPromptSubmit"]);
  assert.deepEqual(next, { hooks: { Stop: [{ hooks: [other(1)] }] }, theme: "dark" });
  const only = removeHooks(mergeHooks({ theme: "dark" }, CFG).next);
  assert.deepEqual(only.next, { theme: "dark" });
});

test("removing from settings without our hooks changes nothing", () => {
  const s = { hooks: { Stop: [{ hooks: [other(1)] }], Bad: "x" }, a: 1 };
  const r = removeHooks(s);
  assert.equal(r.removed, 0);
  assert.deepEqual(r.next, s);
  assert.deepEqual(removeHooks({}).next, {});
  assert.deepEqual(removeHooks({ hooks: [] }).next, { hooks: [] });
});

// ---- reading and writing --------------------------------------------------------------------

test("settings.json is read as missing, ok or invalid, and never changed", withBox((box) => {
  const f = path.join(box.root, "s.json");
  assert.equal(readSettings(f).status, "missing");
  write(f, '{"a":1}');
  assert.deepEqual(readSettings(f).data, { a: 1 });
  write(f, "");
  assert.deepEqual(readSettings(f), { status: "ok", data: {}, raw: "" });
  write(f, "  \n");
  assert.equal(readSettings(f).status, "ok");
  write(f, '\ufeff{"a":2}');
  assert.deepEqual(readSettings(f).data, { a: 2 }, "a byte order mark is ignored");
  for (const bad of ['{"a":', "[]", "null", "42", '"text"', "{'a':1}", '{\n  "theme": dark,\n  "env": {}\n}\n', `{\n  "a": ${"x".repeat(400)}\n}`]) {
    write(f, bad);
    const r = readSettings(f);
    assert.equal(r.status, "invalid", bad);
    assert.equal(r.data, null);
    assert.ok(r.reason.length > 5);
    assert.ok(!/[\r\n]/.test(r.reason), "the reason is one line, whatever the parser quoted from the file");
    assert.ok(r.reason.length < 260, "and it is short");
  }
  fs.rmSync(f);
  fs.mkdirSync(f); // a folder where the file should be
  assert.equal(readSettings(f).status, "invalid");
}));

test("serialising keeps a byte order mark that the file had, and adds none to a new file", () => {
  const mark = String.fromCharCode(0xfeff);
  assert.equal(serializeSettings({ a: 1 }, `${mark}{\n  "x": 1\n}\n`), `${mark}{\n  "a": 1\n}\n`);
  assert.equal(serializeSettings({ a: 1 }, null), '{\n  "a": 1\n}\n');
});

test("serialising keeps the indentation and line ending the file had", () => {
  const data = { a: { b: 1 } };
  assert.equal(serializeSettings(data, null), '{\n  "a": {\n    "b": 1\n  }\n}\n');
  assert.equal(serializeSettings(data, '{\n    "x": 1\n}\n'), '{\n    "a": {\n        "b": 1\n    }\n}\n');
  assert.equal(serializeSettings(data, '{\n\t"x": 1\n}\n'), '{\n\t"a": {\n\t\t"b": 1\n\t}\n}\n');
  assert.equal(serializeSettings(data, '{\r\n  "x": 1\r\n}\r\n'), '{\r\n  "a": {\r\n    "b": 1\r\n  }\r\n}\r\n');
  assert.equal(serializeSettings(data, '{"x":1}'), '{\n  "a": {\n    "b": 1\n  }\n}\n');
});

test("the managed settings file is where the Claude Code docs say, and can be overridden for tests", () => {
  assert.equal(managedSettingsPath({}, "win32"), "C:\\Program Files\\ClaudeCode\\managed-settings.json");
  assert.equal(managedSettingsPath({ ProgramFiles: "D:\\Programs" }, "win32"), "D:\\Programs\\ClaudeCode\\managed-settings.json");
  assert.equal(managedSettingsPath({}, "darwin"), "/Library/Application Support/ClaudeCode/managed-settings.json");
  assert.equal(managedSettingsPath({}, "linux"), "/etc/claude-code/managed-settings.json");
  assert.equal(managedSettingsPath({ CLAUDE_HANDOVER_MANAGED_SETTINGS: path.join("x", "m.json") }, "linux"), path.resolve("x", "m.json"));
  assert.equal(managedSettingsPath({ CLAUDE_HANDOVER_MANAGED_SETTINGS: "  " }, "linux"), "/etc/claude-code/managed-settings.json");
});

test("managed settings: none, found, or not valid JSON", withBox((box) => {
  assert.equal(readManaged(box.env).status, "none");
  assert.deepEqual(readManaged(box.env).files, []);
  write(box.managed, '{"effortLevel":"high"}');
  const m = readManaged(box.env);
  assert.equal(m.status, "ok");
  assert.deepEqual(m.data, { effortLevel: "high" });
  assert.deepEqual(m.files, [box.managed]);
  write(box.managed, "{oops");
  const bad = readManaged(box.env);
  assert.equal(bad.status, "invalid");
  assert.equal(bad.ignored[0].file, box.managed);
  assert.deepEqual(bad.data, {});
}));

test("managed-settings.d files are merged after managed-settings.json, in alphabetical order; hidden and non-json files are ignored", withBox((box) => {
  const dir = path.join(box.root, "managed-settings.d");
  write(box.managed, JSON.stringify({ effortLevel: "low", env: { A: "1", B: "from the main file" }, modelSettings: { m1: { effortLevel: "low" } } }));
  write(path.join(dir, "20-second.json"), JSON.stringify({ effortLevel: "xhigh", env: { B: "from 20" } }));
  write(path.join(dir, "10-first.json"), JSON.stringify({ cleanupPeriodDays: 7, env: { B: "from 10", C: "3" }, modelSettings: { m2: { effortLevel: "high" } } }));
  write(path.join(dir, ".hidden.json"), JSON.stringify({ hiddenKey: true }));
  write(path.join(dir, "notes.txt"), "not json");
  write(path.join(dir, "30-broken.json"), "{ nope");
  const m = readManaged(box.env);
  assert.equal(m.status, "ok");
  assert.deepEqual(m.files.map((f) => path.basename(f)), ["managed-settings.json", "10-first.json", "20-second.json"]);
  assert.deepEqual(m.ignored.map((i) => path.basename(i.file)), ["30-broken.json"]);
  assert.deepEqual(m.data, {
    effortLevel: "xhigh", cleanupPeriodDays: 7, env: { A: "1", B: "from 20", C: "3" }, modelSettings: { m1: { effortLevel: "low" }, m2: { effortLevel: "high" } },
  });
  assert.equal(m.data.hiddenKey, undefined);
}));

test("only drop-in files, with no managed-settings.json, are managed settings too", withBox((box) => {
  write(path.join(box.root, "managed-settings.d", "10-x.json"), '{"cleanupPeriodDays":9}');
  const m = readManaged(box.env);
  assert.equal(m.status, "ok");
  assert.deepEqual(m.data, { cleanupPeriodDays: 9 });
}));

test("the sandbox's managed settings file is a temp path, never the machine's real one", () => {
  const box = sandbox();
  try {
    assert.ok(box.managed.startsWith(box.root));
    assert.notEqual(readManaged(box.env).path, managedSettingsPath({}, process.platform));
  } finally { box.cleanup(); }
});
