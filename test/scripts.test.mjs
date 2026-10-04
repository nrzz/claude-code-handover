// The scripts that init copies into Claude Code's config folder: where recall looks for transcripts and where the
// index goes (the config folder, which is $CLAUDE_CONFIG_DIR when that is set), and that the index does not rewrite
// its state file when no transcript has anything new. Transcripts here are made up, in a throwaway folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, exists, projectKey, read, withBox, write, writeTranscript } from "./helpers.mjs";

/** Run one of the repository's scripts in the project folder. `drop` lists environment variables to remove. */
function script(box, name, args, { env = {}, drop = [] } = {}) {
  const e = { ...box.env, ...env };
  for (const k of drop) delete e[k];
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", name), ...args], { cwd: box.project, env: e, encoding: "utf8", windowsHide: true, timeout: 60000 });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
const BARE = ["HANDOVER_PROJECTS_DIR", "HANDOVER_DATA_DIR"];
const key = (box) => projectKey(box.project);
/** `writeTranscript` writes under `<holder>.projects`; this holds a transcripts folder that is not the sandbox's own. */
const transcriptsIn = (folder) => ({ projects: path.join(folder, "projects") });

test("the index follows CLAUDE_CONFIG_DIR: transcripts are read from its projects folder and the index is kept in it", withBox((box) => {
  const config = path.join(box.root, "elsewhere");
  writeTranscript(transcriptsIn(config), box.project);
  writeTranscript(transcriptsIn(path.join(box.home, ".claude")), box.project, "22222222-aaaa-4aaa-8aaa-000000000002"); // the default place, which must not be read
  const r = script(box, "memory-index.mjs", ["--build"], { env: { CLAUDE_CONFIG_DIR: config }, drop: BARE });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^Index for ${key(box)}: 2 new entries\\.`));
  assert.ok(r.stdout.includes(path.join(config, "claude-code-handover-data", key(box))), r.stdout);
  assert.ok(exists(path.join(config, "claude-code-handover-data", key(box), "index.jsonl")));
  assert.ok(!exists(path.join(box.home, ".claude", "claude-code-handover-data")), "nothing is written under ~/.claude");
}));

test("without CLAUDE_CONFIG_DIR, or with it empty, the index uses ~/.claude", withBox((box) => {
  writeTranscript(transcriptsIn(path.join(box.home, ".claude")), box.project);
  for (const value of [undefined, "  "]) {
    const env = value === undefined ? {} : { CLAUDE_CONFIG_DIR: value };
    const r = script(box, "memory-index.mjs", ["--build"], { env, drop: [...BARE, ...(value === undefined ? ["CLAUDE_CONFIG_DIR"] : [])] });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(path.join(box.home, ".claude", "claude-code-handover-data", key(box))), r.stdout);
    fs.rmSync(path.join(box.home, ".claude", "claude-code-handover-data"), { recursive: true, force: true });
  }
}));

test("HANDOVER_PROJECTS_DIR and HANDOVER_DATA_DIR still win over the config folder", withBox((box) => {
  const config = path.join(box.root, "elsewhere");
  writeTranscript(transcriptsIn(config), box.project);
  const r = script(box, "memory-index.mjs", ["--build"], { env: { CLAUDE_CONFIG_DIR: config } }); // box.env holds HANDOVER_*: transcripts folder is empty
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^No past sessions for /, "it looked in HANDOVER_PROJECTS_DIR, not in the config folder");
  writeTranscript(box, box.project);
  const again = script(box, "memory-index.mjs", ["--build"], { env: { CLAUDE_CONFIG_DIR: config } });
  assert.match(again.stdout, /: 2 new entries\./);
  assert.ok(again.stdout.includes(path.join(box.data, key(box))), "and the index went to HANDOVER_DATA_DIR");
}));

test("recall finds what was said in the transcripts of the config folder", withBox((box) => {
  const config = path.join(box.root, "elsewhere");
  writeTranscript(transcriptsIn(config), box.project);
  const found = script(box, "recall.mjs", ["invoice", "exporter"], { env: { CLAUDE_CONFIG_DIR: config }, drop: BARE });
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /^\d+ match\(es\) for "invoice exporter"/);
  assert.match(found.stdout, /warm-cache setting/);
  const none = script(box, "recall.mjs", ["invoice", "exporter"], { drop: [...BARE, "CLAUDE_CONFIG_DIR"] }); // ~/.claude/projects has nothing
  assert.match(none.stdout, /^No match for "invoice exporter"/);
}));

test("the index's state file is not rewritten when no transcript has anything new", withBox((box) => {
  writeTranscript(box, box.project);
  const first = script(box, "memory-index.mjs", ["--build"]);
  assert.match(first.stdout, /: 2 new entries\./);
  const state = path.join(box.data, key(box), "state.json");
  const index = path.join(box.data, key(box), "index.jsonl");
  const past = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(state, past, past); // a rewrite would bring the modification time back to now
  fs.utimesSync(index, past, past);
  const bytes = read(state);
  const second = script(box, "memory-index.mjs", ["--build"]);
  assert.match(second.stdout, /: 0 new entries\./);
  assert.equal(fs.statSync(state).mtimeMs, past.getTime(), "state.json was not written");
  assert.equal(fs.statSync(index).mtimeMs, past.getTime(), "index.jsonl was not written");
  assert.equal(read(state), bytes);
  // a new line in the transcript is picked up, and then the state does change
  const transcript = path.join(box.projects, key(box), "11111111-aaaa-4aaa-8aaa-000000000001.jsonl");
  fs.appendFileSync(transcript, `${JSON.stringify({ type: "user", timestamp: "2026-10-01T09:00:00Z", message: { role: "user", content: "Another question about the nightly export job schedule." } })}\n`);
  const third = script(box, "memory-index.mjs", ["--build"]);
  assert.match(third.stdout, /: 1 new entries\./);
  assert.ok(fs.statSync(state).mtimeMs > past.getTime());
  assert.notEqual(read(state), bytes);
}));

test("the hook still runs and stays silent when there are no transcripts at all", withBox((box) => {
  write(box.p("HANDOVER.md"), "# Handover\n");
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "context-guard.mjs")], {
    cwd: box.project, env: { ...box.env, CLAUDE_CONFIG_DIR: path.join(box.root, "nowhere") }, encoding: "utf8", windowsHide: true,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: box.project, session_id: "s", transcript_path: "", prompt: "Which cache setting did we pick for the exporter?" }),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
}));
