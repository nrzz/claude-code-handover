// uninstall and status: what init added at user level goes, nothing else does, and status says what is where.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  HAS_GIT, commitAll, exists, flat, gitInit, names, read, readJson, runInit, runStatus, runUninstall, snapshot, withBox, write,
} from "./helpers.mjs";
import { listFiles } from "../src/util.mjs";

const record = (r, file) => r.report.files.find((f) => f.file === file);
const backups = (dir, prefix) => names(dir).filter((n) => n.startsWith(prefix));
const gitTest = (name, fn) => test(name, { skip: !HAS_GIT && "git is not installed" }, withBox(fn));

const ORIGINAL = {
  theme: "dark",
  permissions: { allow: ["Bash(npm test)"] },
  env: { MY_VAR: "1" },
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: "node", args: ["/tools/notify.mjs"] }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
  },
};

test("uninstall after init: our hooks, skills and copy of the scripts are gone, every other setting is intact", withBox((box) => {
  write(box.settings, `${JSON.stringify(ORIGINAL, null, 2)}\n`);
  write(box.c("skills", "mine", "SKILL.md"), "my own skill\n");
  runInit(box);
  const installed = readJson(box.settings);
  const projectFiles = ["CLAUDE.md", "HANDOVER.md", "DECISIONS.md", "claude-token-rules.md"];
  const projectBefore = Object.fromEntries(projectFiles.map((f) => [f, read(box.p(f))]));
  const r = runUninstall(box);
  assert.equal(r.code, 0, r.text);

  const after = readJson(box.settings);
  assert.deepEqual(after.hooks, ORIGINAL.hooks, "the hooks are what they were before init, byte for byte in meaning");
  assert.equal(after.theme, "dark");
  assert.deepEqual(after.permissions, ORIGINAL.permissions);
  assert.deepEqual(after.env, installed.env, "the effort settings init merged are left alone");
  for (const k of ["effortLevel", "modelSettings", "cleanupPeriodDays"]) assert.deepEqual(after[k], installed[k], k);

  assert.ok(!exists(box.c("skills", "handover")) && !exists(box.c("skills", "recall")));
  assert.equal(read(box.c("skills", "mine", "SKILL.md")), "my own skill\n", "a skill of the person's is untouched");
  assert.ok(!exists(box.vendor), "the copy of the scripts is gone");
  for (const f of projectFiles) assert.equal(read(box.p(f)), projectBefore[f], `${f} is left alone`);

  assert.match(flat(r.text), /Left alone, as promised: CLAUDE\.local\.md \(or CLAUDE\.md\), HANDOVER\.md, DECISIONS\.md and claude-token-rules\.md in your projects, and the effort settings/);
  assert.equal(record(r, box.settings).action, "updated");
  assert.match(record(r, box.settings).note, /3 hook entries of ours taken out/);
  const kept = backups(box.cfg, "settings.json.bak-");
  assert.equal(kept.length, 2, "one backup from init and one from uninstall");
  assert.deepEqual(readJson(box.c(kept[kept.length - 1] === "settings.json.bak-20261004" ? kept[0] : kept[kept.length - 1])), installed, "uninstall's backup is the file as it stood before");
}));

test("uninstall removes hooks that init created, so settings without any hooks before have none after", withBox((box) => {
  write(box.settings, '{"theme":"dark"}\n');
  runInit(box);
  runUninstall(box);
  assert.equal(readJson(box.settings).hooks, undefined);
  assert.ok(!exists(box.c("skills")), "the skills folder init made is removed when it is empty");
}));

test("a second uninstall has nothing to remove, says so and changes nothing", withBox((box) => {
  runInit(box);
  runUninstall(box);
  const before = snapshot(box.root);
  const again = runUninstall(box);
  assert.equal(again.code, 0);
  assert.equal(again.changed, false);
  assert.match(again.text, /Nothing to remove: the handover workflow is not installed here\./);
  assert.deepEqual(snapshot(box.root), before);
}));

test("uninstall where nothing was ever installed touches nothing, not even to make a backup", withBox((box) => {
  const before = snapshot(box.root);
  const r = runUninstall(box);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(snapshot(box.root), before);
  assert.ok(!exists(box.cfg));
  assert.match(r.text, /there is no settings\.json, so there are no hooks to remove/);
}));

test("uninstall also takes out our hook written as a shell command, and under another event", withBox((box) => {
  write(box.settings, JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "node ~/.claude/claude-code-handover/scripts/context-guard.mjs" }, { type: "command", command: "echo keep" }] }],
      PreCompact: [{ hooks: [{ type: "command", command: "node", args: ["C:\\Users\\me\\.claude\\claude-code-handover\\scripts\\context-guard.mjs"] }] }],
    },
  }));
  const r = runUninstall(box);
  assert.deepEqual(readJson(box.settings), { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo keep" }] }] } });
  assert.match(r.text, /removed\s+hooks\.PreCompact/);
}));

test("settings.json that is not valid JSON stops the uninstall before anything is removed", withBox((box) => {
  runInit(box);
  const broken = "{ not json";
  write(box.settings, broken);
  const before = snapshot(box.root);
  const r = runUninstall(box);
  assert.equal(r.code, 1);
  assert.deepEqual(snapshot(box.root), before, "nothing was removed, so no hook points at a deleted script");
  assert.match(r.problems[0], /is not valid JSON \(.+\), so nothing was removed/);
  assert.equal(read(box.settings), broken);
}));

test("a step that fails is reported as a problem and the other steps still run", withBox((box) => {
  runInit(box);
  fs.rmSync(box.c("skills", "handover", "SKILL.md"));
  fs.mkdirSync(box.c("skills", "handover", "SKILL.md")); // a folder where the file should be
  const r = runUninstall(box);
  assert.equal(r.code, 1);
  assert.match(r.problems[0], /^the \/handover skill: /);
  assert.equal(readJson(box.settings).hooks, undefined, "the hooks were taken out");
  assert.ok(!exists(box.c("skills", "recall")), "the other skill is gone");
  assert.ok(!exists(box.vendor), "and so is the copy of the scripts");
}));

test("a skill that differs from the copy init installs is left alone, the other one still goes", withBox((box) => {
  runInit(box);
  write(box.c("skills", "handover", "SKILL.md"), "---\nname: handover\n---\nedited by me\n");
  const r = runUninstall(box);
  assert.equal(read(box.c("skills", "handover", "SKILL.md")), "---\nname: handover\n---\nedited by me\n");
  assert.equal(record(r, box.c("skills", "handover", "SKILL.md")).action, "kept");
  assert.match(record(r, box.c("skills", "handover", "SKILL.md")).note, /differs from the copy init installs/);
  assert.ok(!exists(box.c("skills", "recall")));
}));

test("a skill folder with other files in it keeps them, and the report says why the folder stays", withBox((box) => {
  runInit(box);
  write(box.c("skills", "recall", "notes.txt"), "mine\n");
  const r = runUninstall(box);
  assert.ok(!exists(box.c("skills", "recall", "SKILL.md")));
  assert.equal(read(box.c("skills", "recall", "notes.txt")), "mine\n");
  assert.match(record(r, box.c("skills", "recall", "SKILL.md")).note, /its folder stays because it also holds notes\.txt/);
}));

test("the earlier copy of a skill that init kept as a backup stays when the skill goes", withBox((box) => {
  write(box.c("skills", "handover", "SKILL.md"), "my own version\n");
  runInit(box);
  runUninstall(box);
  assert.deepEqual(names(box.c("skills", "handover")), ["SKILL.md.bak-20261004"]);
  assert.equal(read(box.c("skills", "handover", "SKILL.md.bak-20261004")), "my own version\n");
}));

gitTest("a git checkout from an older setup is kept without --purge and removed with it", (box) => {
  fs.mkdirSync(box.cfg, { recursive: true });
  gitInit(box, box.vendor);
  write(path.join(box.vendor, "package.json"), '{ "name": "claude-code-handover" }\n');
  write(path.join(box.vendor, "scripts", "context-guard.mjs"), "// clone\n");
  commitAll(box, box.vendor, "clone");
  runInit(box);
  const r = runUninstall(box);
  assert.ok(exists(box.vendor), "kept");
  assert.equal(record(r, box.vendor).action, "kept");
  assert.match(record(r, box.vendor).note, /add --purge to remove it too/);
  assert.equal(readJson(box.settings).hooks, undefined, "the hooks are removed anyway");
  const purged = runUninstall(box, { purge: true });
  assert.ok(!exists(box.vendor));
  assert.equal(record(purged, box.vendor).action, "removed");
  assert.match(record(purged, box.vendor).note, /because you passed --purge/);
});

gitTest("--purge never removes somebody else's git repository at the scripts' place", (box) => {
  fs.mkdirSync(box.cfg, { recursive: true });
  gitInit(box, box.vendor);
  write(path.join(box.vendor, "README.md"), "# my own project\n");
  commitAll(box, box.vendor, "mine");
  const r = runUninstall(box, { purge: true });
  assert.ok(exists(path.join(box.vendor, "README.md")));
  assert.equal(record(r, box.vendor).action, "kept");
  assert.match(record(r, box.vendor).note, /does not look like a copy of this tool/);
});

test("--purge changes nothing for a plain copy, which is always removed", withBox((box) => {
  runInit(box);
  const r = runUninstall(box, { purge: true });
  assert.ok(!exists(box.vendor));
  assert.match(record(r, box.vendor).note, /the copy of the scripts that init made/);
}));

test("a file in the scripts folder that is not part of the copy stays, and so does the folder around it", withBox((box) => {
  runInit(box);
  write(path.join(box.vendor, "my-notes.txt"), "mine\n");
  write(path.join(box.vendor, "scripts", "my-extra.mjs"), "// mine\n");
  const r = runUninstall(box);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(listFiles(box.vendor), ["my-notes.txt", "scripts/my-extra.mjs"], "only what init copied is gone");
  assert.equal(record(r, box.vendor).action, "removed");
  assert.match(record(r, box.vendor).note, /the folder stays because it also holds my-notes\.txt, scripts\/my-extra\.mjs/);
  const again = runUninstall(box);
  assert.equal(again.code, 0, "what is left is not ours, so the next uninstall leaves it alone");
  assert.equal(record(again, box.vendor).action, "kept");
  assert.equal(read(path.join(box.vendor, "my-notes.txt")), "mine\n");
}));

test("a settings.json whose parse error quotes several lines does not break the report", withBox((box) => {
  runInit(box);
  write(box.settings, '{\n  "theme": dark,\n  "env": {}\n}\n');
  const r = runUninstall(box);
  assert.equal(r.code, 1);
  assert.match(r.text, /Problems\n {2}! /);
  assert.ok(r.problems.every((p) => !/[\r\n]/.test(p)));
  assert.ok(exists(box.vendor) && exists(box.c("skills", "handover", "SKILL.md")), "nothing was removed");
}));

test("a folder at the scripts' place that is not ours is never removed", withBox((box) => {
  runInit(box);
  fs.rmSync(path.join(box.vendor, "package.json"));
  write(path.join(box.vendor, "mine.txt"), "mine\n");
  const r = runUninstall(box, { purge: true });
  assert.ok(exists(path.join(box.vendor, "mine.txt")));
  assert.equal(record(r, box.vendor).action, "kept");
  assert.match(record(r, box.vendor).note, /does not look like a copy of this tool/);
}));

test("the recall index is kept and named, because it is the person's data", withBox((box) => {
  runInit(box);
  fs.mkdirSync(box.data, { recursive: true });
  write(path.join(box.data, "x", "index.jsonl"), "{}\n");
  const r = runUninstall(box, { purge: true });
  assert.ok(exists(path.join(box.data, "x", "index.jsonl")));
  assert.ok(flat(r.text).includes(`Kept: the recall index in ${box.data}.`));
}));

test("without HANDOVER_DATA_DIR the recall index is looked for in the config folder, as the scripts keep it", withBox((box) => {
  const env = { ...box.env };
  delete env.HANDOVER_DATA_DIR;
  runInit(box, { env });
  write(box.c("claude-code-handover-data", "x", "index.jsonl"), "{}\n");
  const r = runUninstall(box, { env });
  assert.ok(flat(r.text).includes(`Kept: the recall index in ${box.c("claude-code-handover-data")}.`), r.text);
  assert.ok(exists(box.c("claude-code-handover-data", "x", "index.jsonl")));
}));

test("uninstall --dry-run writes nothing and says what would be removed", withBox((box) => {
  runInit(box);
  const before = snapshot(box.root);
  const r = runUninstall(box, { dryRun: true });
  assert.deepEqual(snapshot(box.root), before);
  assert.match(r.text, /^claude-handover uninstall \S+  \(dry run: nothing is written\)/);
  assert.match(r.text, /would remove\s+.*SKILL\.md/);
  assert.match(r.text, /would back up\s+.*settings\.json\.bak-/);
  assert.match(r.text, /Dry run: nothing was removed\./);
  assert.equal(r.changed, true);
}));

// ---------------------------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------------------------

test("status before anything is installed says so, and changes nothing", withBox((box) => {
  const before = snapshot(box.root);
  const r = runStatus(box);
  assert.equal(r.code, 0);
  assert.deepEqual(snapshot(box.root), before);
  assert.equal(r.info.settings, "missing");
  assert.deepEqual(r.info.skills, { handover: "absent", recall: "absent" });
  assert.equal(r.info.vendor.state, "absent");
  assert.deepEqual(r.info.hooks, { SessionStart: "missing", UserPromptSubmit: "missing", Stop: "missing" });
  assert.match(r.text, /\/handover skill\s+not installed/);
  assert.match(r.text, /Not fully installed\./);
  assert.match(r.text, /HANDOVER\.md\s+missing/);
}));

gitTest("status after init says what is installed where", (box) => {
  gitInit(box);
  runInit(box, { streams: "main, backend" });
  const r = runStatus(box);
  assert.equal(r.code, 0);
  assert.deepEqual(r.info.skills, { handover: "same", recall: "same" });
  assert.equal(r.info.vendor.state, "ours");
  assert.match(r.info.vendor.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(r.info.hooks, { SessionStart: "registered", UserPromptSubmit: "registered", Stop: "registered" });
  assert.deepEqual(r.info.project.streams, ["main", "backend"]);
  assert.equal(r.info.project.rules, "CLAUDE.local.md");
  assert.deepEqual(r.info.project.gitignoreMissing, []);
  assert.match(r.text, /Installed\. Run init in a project folder to set one up\./);
  assert.match(r.text, /hook SessionStart\s+registered: .*claude-code-handover\/scripts\/context-guard\.mjs/);
  assert.match(r.text, /effort settings\s+effortLevel "high"; claude-sonnet-5-5 "medium"; subagents "sonnet"; cleanupPeriodDays 365/);
  assert.match(r.text, /HANDOVER\.md\s+present, streams: main, backend/);
  assert.match(r.text, /DECISIONS\.md\s+present, 1 dated line/);
  assert.match(r.text, /claude-token-rules\.md\s+present \(the table for more than one model\)/);
  assert.match(r.text, /\.gitignore\s+lists all four personal files/);
});

test("status notices an edited skill, a missing script and a settings file it cannot read", withBox((box) => {
  runInit(box);
  write(box.c("skills", "handover", "SKILL.md"), "edited\n");
  fs.rmSync(path.join(box.vendor, "scripts", "context-guard.mjs"));
  const r = runStatus(box);
  assert.equal(r.info.skills.handover, "differs");
  assert.match(r.text, /\/handover skill\s+installed, differs from this version's copy/);
  assert.equal(r.info.hooks.Stop, "script missing");
  assert.match(r.text, /hook Stop\s+registered, but the script is missing: /);
  write(box.settings, "{");
  const bad = runStatus(box);
  assert.equal(bad.code, 0, "status reports, it does not fail");
  assert.match(bad.text, /settings\.json\s+not usable: is not valid JSON/);
  assert.match(bad.text, /hook Stop\s+unknown/);
}));

test("status lists the managed settings files and the keys they set", withBox((box) => {
  write(box.managed, '{"effortLevel":"max"}');
  write(path.join(box.root, "managed-settings.d", "10-x.json"), '{"cleanupPeriodDays":9}');
  const r = runStatus(box);
  assert.match(flat(r.text), /managed settings .*managed-settings\.json, .*10-x\.json; sets: effortLevel, cleanupPeriodDays/);
  write(box.managed, "{oops");
  fs.rmSync(path.join(box.root, "managed-settings.d"), { recursive: true });
  assert.match(flat(runStatus(box).text), /managed settings .*managed-settings\.json is not valid JSON/);
}));

test("status names where our rules are, and whether the card is for one model", withBox((box) => {
  runInit(box, { models: "Opus only" });
  const r = runStatus(box);
  assert.equal(r.info.project.rules, "CLAUDE.md");
  assert.match(r.text, /personal rules\s+CLAUDE\.md has our rules block/);
  assert.match(r.text, /the table for one model/);
  assert.match(r.text, /git repository\s+no/);
}));
