// The copy of the scripts under <config>/claude-code-handover: what is copied, that the hooks can run it with
// the JSON Claude Code sends, and what happens to a git checkout that an older setup made there.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BIN, HAS_GIT, ROOT, commitAll, copyTree, envWithoutGit, exists, flat, git, gitInit, names, read, readJson, runInit, snapshot, withBox, write,
} from "./helpers.mjs";
import { listFiles } from "../src/util.mjs";

const record = (r, file) => r.report.files.find((f) => f.file === file);
const gitTest = (name, fn) => test(name, { skip: !HAS_GIT && "git is not installed" }, withBox(fn));

/** The hook as settings.json says it, run with the JSON Claude Code would send on stdin. */
function runHook(box, event, extra = {}, cwd = box.project) {
  const hook = readJson(box.settings).hooks[event][0].hooks[0];
  assert.equal(hook.command, "node");
  const input = JSON.stringify({ hook_event_name: event, cwd, session_id: "test-session", transcript_path: "", ...extra });
  const r = spawnSync(process.execPath, hook.args, { cwd, env: box.env, input, encoding: "utf8", timeout: 60000, windowsHide: true });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

test("the copy holds the runtime files byte for byte, and nothing else", withBox((box) => {
  runInit(box);
  const expected = ["LICENSE", "package.json", ...fs.readdirSync(path.join(ROOT, "scripts")).map((f) => `scripts/${f}`), "skills/recall/SKILL.md"].sort();
  assert.deepEqual(listFiles(box.vendor), expected);
  for (const f of ["scripts/context-guard.mjs", "scripts/memory-index.mjs", "scripts/recall.mjs", "scripts/selftest.mjs", "skills/recall/SKILL.md", "package.json", "LICENSE"]) {
    assert.ok(expected.includes(f), `${f} is part of the copy`);
  }
  for (const f of expected) assert.ok(fs.readFileSync(path.join(box.vendor, ...f.split("/"))).equals(fs.readFileSync(path.join(ROOT, ...f.split("/")))), f);
  assert.equal(readJson(path.join(box.vendor, "package.json")).name, "claude-code-handover");
}));

test("the copied scripts need nothing from outside their folder, so npx's cache can go", withBox((box) => {
  runInit(box);
  for (const f of listFiles(path.join(box.vendor, "scripts"))) {
    const text = read(path.join(box.vendor, "scripts", f));
    for (const m of text.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)) {
      assert.ok(m[1].startsWith("node:") || m[1].startsWith("./"), `${f} imports ${m[1]}`);
    }
  }
}));

test("the vendored context guard runs as the hook does, and exits 0", withBox((box) => {
  runInit(box);
  const start = runHook(box, "SessionStart");
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /^Latest entries of DECISIONS\.md \(1 of 1\):\n- 2026-10-04 \[main\] Workflow set up\./);
  const prompt = runHook(box, "UserPromptSubmit", { prompt: "Which cache setting did we choose for the invoice exporter?" });
  assert.equal(prompt.status, 0, prompt.stderr);
  assert.equal(prompt.stdout, "", "nothing relevant in the past: nothing is added to the prompt");
  const stop = runHook(box, "Stop");
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stdout, "");
  assert.equal(stop.stderr, "");
}));

test("the vendored context guard stays silent in a folder that does not use the workflow", withBox((box) => {
  runInit(box);
  const elsewhere = path.join(box.root, "other-project");
  fs.mkdirSync(elsewhere);
  const r = runHook(box, "SessionStart", {}, elsewhere);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
}));

test("the vendored guard asks, at the end of a turn above the limit, for a handover that is older than 30 minutes", withBox((box) => {
  runInit(box);
  const transcript = path.join(box.root, "session.jsonl");
  const line = JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 10, cache_read_input_tokens: 400000, output_tokens: 5 } } });
  write(transcript, `${line}\n`);
  const old = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(box.p("HANDOVER.md"), old, old);
  const stop = runHook(box, "Stop", { transcript_path: transcript });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(JSON.parse(stop.stdout).decision, "block");
  const warn = runHook(box, "UserPromptSubmit", { transcript_path: transcript, prompt: "continue" });
  assert.match(warn.stdout, /^Context guard: the context is at 40%/);
}));

test("the copy is repaired where a file went missing or differs, and the others are not touched", withBox((box) => {
  runInit(box);
  const kept = path.join(box.vendor, "scripts", "recall.mjs");
  const keptTime = fs.statSync(kept).mtimeMs;
  fs.rmSync(path.join(box.vendor, "scripts", "memory-index.mjs"));
  fs.writeFileSync(path.join(box.vendor, "scripts", "context-guard.mjs"), "// an older version\n");
  const r = runInit(box);
  assert.ok(fs.readFileSync(path.join(box.vendor, "scripts", "memory-index.mjs")).equals(fs.readFileSync(path.join(ROOT, "scripts", "memory-index.mjs"))));
  assert.ok(fs.readFileSync(path.join(box.vendor, "scripts", "context-guard.mjs")).equals(fs.readFileSync(path.join(ROOT, "scripts", "context-guard.mjs"))));
  assert.equal(fs.statSync(kept).mtimeMs, keptTime, "an identical file is not rewritten");
  assert.equal(record(r, box.vendor).action, "copied");
  assert.match(record(r, box.vendor).note, /^2 files .*7 files already identical/);
}));

test("an empty folder at the scripts' place is used", withBox((box) => {
  fs.mkdirSync(box.vendor, { recursive: true });
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  assert.ok(exists(path.join(box.vendor, "scripts", "context-guard.mjs")));
}));

// ---------------------------------------------------------------------------------------------
// A git checkout left by an older setup (it ran `git clone` into this folder)
// ---------------------------------------------------------------------------------------------

/** A repository that holds this package's runtime files, and a bare copy of it to pull from. */
function makeUpstream(box) {
  const work = path.join(box.root, "upstream-work");
  const bare = path.join(box.root, "upstream.git");
  fs.mkdirSync(work);
  for (const rel of ["package.json", "LICENSE"]) fs.copyFileSync(path.join(ROOT, rel), path.join(work, rel));
  copyTree(path.join(ROOT, "scripts"), path.join(work, "scripts"));
  copyTree(path.join(ROOT, "skills"), path.join(work, "skills"));
  gitInit(box, work);
  commitAll(box, work, "release");
  git(box, box.root, "init", "-q", "--bare", bare);
  git(box, bare, "symbolic-ref", "HEAD", "refs/heads/main");
  git(box, work, "remote", "add", "origin", bare);
  git(box, work, "push", "-q", "origin", "main");
  return { work, bare };
}
const publish = (box, up, message) => {
  fs.appendFileSync(path.join(up.work, "scripts", "recall.mjs"), `\n// ${message}\n`);
  commitAll(box, up.work, message);
  git(box, up.work, "push", "-q", "origin", "main");
};

gitTest("a git checkout from an older setup is updated with git pull --ff-only, not copied over", (box) => {
  const up = makeUpstream(box);
  fs.mkdirSync(box.cfg, { recursive: true });
  git(box, box.root, "clone", "-q", up.bare, box.vendor);
  publish(box, up, "a newer upstream commit");
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  assert.equal(git(box, box.vendor, "rev-parse", "HEAD"), git(box, up.work, "rev-parse", "HEAD"), "the checkout moved to the new commit");
  assert.ok(read(path.join(box.vendor, "scripts", "recall.mjs")).endsWith("// a newer upstream commit\n"));
  assert.equal(git(box, box.vendor, "status", "--porcelain"), "", "nothing was copied over it");
  assert.equal(record(r, box.vendor).action, "updated");
  assert.match(record(r, box.vendor).note, /updated with git pull --ff-only/);
  assert.equal(r.guardInstalled, true);
  assert.equal(read(box.c("skills", "recall", "SKILL.md")), read(path.join(box.vendor, "skills", "recall", "SKILL.md")), "/recall is copied from the checkout, as the prompt says");
  const again = runInit(box);
  assert.equal(record(again, box.vendor).action, "unchanged");
  assert.match(record(again, box.vendor).note, /found nothing new/);
  assert.equal(again.changed, false, again.text);
});

gitTest("when git pull cannot run, the files are copied over the checkout instead", (box) => {
  fs.mkdirSync(box.cfg, { recursive: true });
  gitInit(box, box.vendor);
  write(path.join(box.vendor, "package.json"), '{ "name": "claude-code-handover", "version": "1.0.0" }\n');
  write(path.join(box.vendor, "scripts", "context-guard.mjs"), "// the version an old setup cloned\n");
  commitAll(box, box.vendor, "old");
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  assert.equal(record(r, box.vendor).action, "copied");
  assert.match(record(r, box.vendor).note, /git pull --ff-only failed \(.+\), so \d+ files were copied over it/);
  assert.ok(fs.readFileSync(path.join(box.vendor, "scripts", "context-guard.mjs")).equals(fs.readFileSync(path.join(ROOT, "scripts", "context-guard.mjs"))));
  assert.ok(exists(path.join(box.vendor, ".git")), "it stays a checkout");
  assert.equal(r.guardInstalled, true);
  assert.equal(runInit(box).changed, false, "and the next run finds it current");
});

gitTest("a checkout is copied over when git is not installed at all", (box) => {
  fs.mkdirSync(box.cfg, { recursive: true });
  gitInit(box, box.vendor);
  write(path.join(box.vendor, "scripts", "context-guard.mjs"), "// old\n");
  commitAll(box, box.vendor, "old");
  const r = runInit(box, { env: envWithoutGit(box) });
  assert.equal(r.code, 0, r.text);
  assert.equal(record(r, box.vendor).action, "copied");
  assert.ok(fs.readFileSync(path.join(box.vendor, "scripts", "context-guard.mjs")).equals(fs.readFileSync(path.join(ROOT, "scripts", "context-guard.mjs"))));
});

gitTest("somebody else's git repository at the scripts' place is never pulled into or copied over", (box) => {
  fs.mkdirSync(box.cfg, { recursive: true });
  gitInit(box, box.vendor);
  write(path.join(box.vendor, "README.md"), "# my own project\n");
  write(path.join(box.vendor, "scripts", "build.sh"), "echo hi\n");
  commitAll(box, box.vendor, "mine");
  const before = snapshot(box.vendor);
  const r = runInit(box);
  assert.deepEqual(snapshot(box.vendor), before, "not a file in it was touched");
  assert.equal(r.code, 1);
  assert.equal(record(r, box.vendor).action, "skipped");
  assert.match(r.problems[0], /exists and is not ours/);
  assert.equal(r.guardInstalled, false);
});

gitTest("--dry-run does not pull and does not copy over a checkout", (box) => {
  const up = makeUpstream(box);
  fs.mkdirSync(box.cfg, { recursive: true });
  git(box, box.root, "clone", "-q", up.bare, box.vendor);
  const head = git(box, box.vendor, "rev-parse", "HEAD");
  publish(box, up, "newer");
  const r = runInit(box, { dryRun: true });
  assert.equal(git(box, box.vendor, "rev-parse", "HEAD"), head);
  assert.match(record(r, box.vendor).note, /it would be updated with git pull --ff-only/);
});

// ---------------------------------------------------------------------------------------------
// Running from the installed folder itself
// ---------------------------------------------------------------------------------------------

test("run from a copy of the whole package that sits at the scripts' place, it does not copy onto itself", withBox((box) => {
  for (const d of ["bin", "src", "templates", "skills", "scripts"]) copyTree(path.join(ROOT, d), path.join(box.vendor, d));
  for (const f of ["package.json", "LICENSE"]) fs.copyFileSync(path.join(ROOT, f), path.join(box.vendor, f));
  const before = listFiles(box.vendor);
  const run = () => spawnSync(process.execPath, [path.join(box.vendor, "bin", "claude-handover.mjs"), "init", "--dir", box.project], { cwd: box.root, env: box.env, encoding: "utf8", timeout: 120000, windowsHide: true });
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(flat(r.stdout), /kept .*claude-code-handover this command is running from that folder, so there is nothing to copy onto itself/);
  assert.deepEqual(listFiles(box.vendor), before, "nothing was added to it");
  assert.ok(readJson(box.settings).hooks.Stop, "the hooks are registered");
  assert.ok(names(box.c("skills")).includes("recall"));
  assert.match(run().stdout, /Nothing to do/);
}));

test("the hooks run the copied scripts, never the installer", () => {
  assert.ok(read(BIN).startsWith("#!/usr/bin/env node\n"));
  assert.ok(!read(path.join(ROOT, "templates", "hooks-settings.json")).includes("claude-handover.mjs"));
});
