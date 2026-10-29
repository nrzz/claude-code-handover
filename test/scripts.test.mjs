// The scripts that init copies into Claude Code's config folder: where recall looks for transcripts and where the
// index goes (the config folder, which is $CLAUDE_CONFIG_DIR when that is set), and that the index does not rewrite
// its state file when no transcript has anything new. Transcripts here are made up, in a throwaway folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ROOT, exists, projectKey, read, runInit, withBox, write, writeTranscript } from "./helpers.mjs";
import { parseSince, search } from "../scripts/memory-index.mjs";

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

test("parseSince reads hours, days and weeks back, and dates as local midnight", () => {
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  assert.equal(parseSince(undefined, now), null);
  assert.equal(parseSince(null, now), null);
  assert.equal(parseSince("12h", now), now - 12 * 3600000);
  assert.equal(parseSince("7d", now), now - 7 * 86400000);
  assert.equal(parseSince("2w", now), now - 14 * 86400000);
  assert.equal(parseSince("7D", now), now - 7 * 86400000);
  assert.equal(parseSince("2026-09-01", now), new Date(2026, 8, 1).getTime());
  for (const bad of ["", "7", "d", "7m", "7 days", "-7d", "2026-13-01", "2026-02-30", "yesterday"]) {
    assert.throws(() => parseSince(bad), /--since needs a number of hours, days or weeks \(12h, 7d, 2w\) or a date \(YYYY-MM-DD\)/);
  }
});

test("recall --since filters remarks by session timestamp, and rejects bad formats", withBox((box) => {
  const config = path.join(box.root, "elsewhere");
  const older = writeTranscript(transcriptsIn(config), box.project, "11111111-aaaa-4aaa-8aaa-000000000001");
  const oldRows = [
    { type: "custom-title", customTitle: "Old session", sessionId: "11111111-aaaa-4aaa-8aaa-000000000001" },
    { type: "user", timestamp: "2026-09-01T10:00:00Z", message: { role: "user", content: "Which cache setting did we pick for the invoice exporter, and why?" } },
    { type: "assistant", timestamp: "2026-09-01T10:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "We picked the warm-cache setting for the invoice exporter because cold starts took eleven seconds." }], usage: { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 50 } } },
  ];
  write(older, oldRows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const newer = path.join(transcriptsIn(config).projects, key(box), "22222222-aaaa-4aaa-8aaa-000000000002.jsonl");
  const newRows = [
    { type: "custom-title", customTitle: "Recent session", sessionId: "22222222-aaaa-4aaa-8aaa-000000000002" },
    { type: "user", timestamp: "2026-10-15T10:00:00Z", message: { role: "user", content: "Check the invoice exporter status." } },
    { type: "assistant", timestamp: "2026-10-15T10:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "The invoice exporter is running with warm-cache enabled." }], usage: { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 50 } } },
  ];
  write(newer, newRows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const allHits = script(box, "recall.mjs", ["invoice", "exporter"], { env: { CLAUDE_CONFIG_DIR: config }, drop: BARE });
  assert.equal(allHits.status, 0);
  assert.match(allHits.stdout, /4 match\(es\) for "invoice exporter"/);

  const sinceRecent = script(box, "recall.mjs", ["invoice", "exporter", "--since", "2026-10-01"], { env: { CLAUDE_CONFIG_DIR: config }, drop: BARE });
  assert.equal(sinceRecent.status, 0);
  assert.match(sinceRecent.stdout, /2 match\(es\) for "invoice exporter"/);
  assert.match(sinceRecent.stdout, /Recent session/);
  assert.ok(!sinceRecent.stdout.includes("Old session"));

  const none = script(box, "recall.mjs", ["invoice", "exporter", "--since", "2026-10-20"], { env: { CLAUDE_CONFIG_DIR: config }, drop: BARE });
  assert.equal(none.status, 0);
  assert.match(none.stdout, /^No match for "invoice exporter"/);

  const bad = script(box, "recall.mjs", ["invoice", "exporter", "--since", "not-a-date"], { env: { CLAUDE_CONFIG_DIR: config }, drop: BARE });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--since needs a number of hours, days or weeks/);
}));

test("search in memory-index filters past remarks with { since }", withBox((box) => {
  const origData = process.env.HANDOVER_DATA_DIR;
  const origProj = process.env.HANDOVER_PROJECTS_DIR;
  process.env.HANDOVER_DATA_DIR = box.data;
  process.env.HANDOVER_PROJECTS_DIR = box.projects;
  try {
    writeTranscript(box, box.project);
    script(box, "memory-index.mjs", ["--build"]);
    const found = search(box.project, "Which cache setting did we pick for the invoice exporter?", { since: "2026-09-01" });
    assert.ok(found.length >= 1);
    assert.match(found[0].text, /warm-cache setting/);

    const filteredOut = search(box.project, "Which cache setting did we pick for the invoice exporter?", { since: "2026-10-05" });
    assert.equal(filteredOut.length, 0);
  } finally {
    if (origData !== undefined) process.env.HANDOVER_DATA_DIR = origData; else delete process.env.HANDOVER_DATA_DIR;
    if (origProj !== undefined) process.env.HANDOVER_PROJECTS_DIR = origProj; else delete process.env.HANDOVER_PROJECTS_DIR;
  }
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
  // Still an hour old, so not written. (Not compared exactly: file systems store nanoseconds, and the
  // milliseconds read back can differ from the ones set by a fraction.)
  const old = (f) => Math.abs(fs.statSync(f).mtimeMs - past.getTime()) < 1000;
  assert.ok(old(state), "state.json was not written");
  assert.ok(old(index), "index.jsonl was not written");
  assert.equal(read(state), bytes);
  // a new line in the transcript is picked up, and then the state does change
  const transcript = path.join(box.projects, key(box), "11111111-aaaa-4aaa-8aaa-000000000001.jsonl");
  fs.appendFileSync(transcript, `${JSON.stringify({ type: "user", timestamp: "2026-10-01T09:00:00Z", message: { role: "user", content: "Another question about the nightly export job schedule." } })}\n`);
  const third = script(box, "memory-index.mjs", ["--build"]);
  assert.match(third.stdout, /: 1 new entries\./);
  assert.ok(fs.statSync(state).mtimeMs > past.getTime());
  assert.notEqual(read(state), bytes);
}));

// ---------------------------------------------------------------------------------------------
// The guard: its limit, its window, and when it asks for the handover
// ---------------------------------------------------------------------------------------------

/**
 * The guard as a hook runs it, in the project folder, with `event` (and `input`) as JSON on stdin. The transcript ends with
 * one assistant message that makes the context `tokens` long, and HANDOVER.md was last written `ageMin` minutes ago.
 * `env` adds environment variables. Returns what the guard printed.
 */
function guard(box, event, { tokens = 1000, ageMin = 0, env = {}, input = {} } = {}) {
  const transcript = path.join(box.root, "session.jsonl");
  write(transcript, `${JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 10, cache_read_input_tokens: tokens - 10, output_tokens: 5 } } })}\n`);
  write(box.p("HANDOVER.md"), "# Handover\n");
  const written = new Date(Date.now() - ageMin * 60000);
  fs.utimesSync(box.p("HANDOVER.md"), written, written);
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "context-guard.mjs")], {
    cwd: box.project, env: { ...box.env, ...env }, encoding: "utf8", windowsHide: true, timeout: 60000,
    input: JSON.stringify({ hook_event_name: event, cwd: box.project, session_id: "s", transcript_path: transcript, prompt: "continue", ...input }),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return r.stdout;
}
const warns = (percent, k) => new RegExp(`^Context guard: the context is at ${percent}% \\(${k}K tokens\\)\\. Finish the current step`);

test("the guard's default limit is 35% of the default 1M window: 350,000 tokens", withBox((box) => {
  assert.equal(guard(box, "UserPromptSubmit", { tokens: 349999 }), "", "just below the limit: silent");
  assert.match(guard(box, "UserPromptSubmit", { tokens: 350000 }), warns(35, 350));
  assert.match(guard(box, "UserPromptSubmit", { tokens: 400000 }), warns(40, 400));
}));

test("HANDOVER_CONTEXT_WINDOW moves the default limit with it: 70,000 tokens for a 200K window, 700,000 for a 2M one", withBox((box) => {
  const small = { HANDOVER_CONTEXT_WINDOW: "200000" };
  assert.equal(guard(box, "UserPromptSubmit", { tokens: 69999, env: small }), "");
  assert.match(guard(box, "UserPromptSubmit", { tokens: 70000, env: small }), warns(35, 70));
  assert.match(guard(box, "UserPromptSubmit", { tokens: 100000, env: small }), warns(50, 100));
  const big = { HANDOVER_CONTEXT_WINDOW: "2000000" };
  assert.equal(guard(box, "UserPromptSubmit", { tokens: 400000, env: big }), "", "35% of 2M is 700,000");
  assert.match(guard(box, "UserPromptSubmit", { tokens: 700000, env: big }), warns(35, 700));
}));

test("HANDOVER_CONTEXT_LIMIT wins over the window, which then only sets the percentage shown", withBox((box) => {
  const both = { HANDOVER_CONTEXT_WINDOW: "200000", HANDOVER_CONTEXT_LIMIT: "150000" };
  assert.equal(guard(box, "UserPromptSubmit", { tokens: 100000, env: both }), "", "above 35% of the window, below the limit");
  assert.match(guard(box, "UserPromptSubmit", { tokens: 160000, env: both }), warns(80, 160));
  const alone = { HANDOVER_CONTEXT_LIMIT: "100000" };
  assert.equal(guard(box, "UserPromptSubmit", { tokens: 99999, env: alone }), "");
  assert.match(guard(box, "UserPromptSubmit", { tokens: 120000, env: alone }), warns(12, 120));
}));

test("a window that is not a positive number counts as unset, so the default limit stays 350,000", withBox((box) => {
  for (const value of ["abc", "0", "-5", "  ", "", "NaN", "Infinity"]) {
    const env = { HANDOVER_CONTEXT_WINDOW: value };
    assert.equal(guard(box, "UserPromptSubmit", { tokens: 300000, env }), "", JSON.stringify(value));
    assert.match(guard(box, "UserPromptSubmit", { tokens: 400000, env }), warns(40, 400), JSON.stringify(value));
  }
}));

test("at the end of a turn above the limit the guard asks once, and only when HANDOVER.md is older than 30 minutes", withBox((box) => {
  const stop = (opts) => guard(box, "Stop", { tokens: 400000, ...opts });
  const asked = JSON.parse(stop({ ageMin: 60 }));
  assert.equal(asked.decision, "block");
  assert.match(asked.reason, /^Context guard: the context is at 40% and HANDOVER\.md was last written 60 minutes ago\. Before stopping:/);
  assert.equal(stop({ ageMin: 5 }), "", "written in the last 30 minutes: not asked");
  assert.equal(stop({ ageMin: 29 }), "", "29 minutes is still inside the default");
  assert.equal(JSON.parse(stop({ ageMin: 31 })).decision, "block", "31 minutes is outside it");
  assert.equal(stop({ ageMin: 60, input: { stop_hook_active: true } }), "", "already continuing because of this request: not asked again");
  assert.equal(stop({ tokens: 300000, ageMin: 60 }), "", "below the limit: not asked");
  assert.equal(stop({ ageMin: 60, env: { HANDOVER_STALE_MINUTES: "120" } }), "", "HANDOVER_STALE_MINUTES moves the 30 minutes");
  assert.equal(JSON.parse(stop({ ageMin: 20, env: { HANDOVER_STALE_MINUTES: "10" } })).decision, "block");
  assert.equal(stop({ ageMin: 60, env: { HANDOVER_CONTEXT_WINDOW: "2000000" } }), "", "a bigger window raises the limit the Stop event uses as well");
}));

test("HANDOVER_AUTORECALL=0 turns off both what recall adds to a prompt and the decisions shown at session start, as SECURITY.md says", withBox((box) => {
  write(box.p("DECISIONS.md"), "# Decisions\n\n- 2026-10-01 [main] We chose the warm-cache setting for the invoice exporter because cold starts took eleven seconds.\n");
  writeTranscript(box, box.project);
  const ask = { input: { prompt: "Which cache setting did we pick for the invoice exporter, and why?" } };
  assert.match(guard(box, "SessionStart"), /^Latest entries of DECISIONS\.md \(1 of 1\):\n- 2026-10-01 \[main\] We chose the warm-cache setting/);
  assert.match(guard(box, "UserPromptSubmit", ask), /^Automatic recall, from earlier sessions of this project/);
  const off = { HANDOVER_AUTORECALL: "0" };
  assert.equal(guard(box, "SessionStart", { env: off }), "", "no decisions digest");
  assert.equal(guard(box, "UserPromptSubmit", { ...ask, env: off }), "", "no recall lines");
}));

// ---------------------------------------------------------------------------------------------
// The /recall skill: it looks where init put the scripts and where Claude Code keeps the transcripts
// ---------------------------------------------------------------------------------------------

const SKILL_DIR = "${CLAUDE_SKILL_DIR}";
/** What Claude Code makes of the skill before the model reads it: ${CLAUDE_SKILL_DIR} is the folder that holds SKILL.md. */
const expandSkillDir = (text, skillFolder) => text.split(SKILL_DIR).join(skillFolder);

test("the /recall skill finds its folders from its own folder (CLAUDE_SKILL_DIR), never ~/.claude or a shell variable", () => {
  const text = read(path.join(ROOT, "skills", "recall", "SKILL.md"));
  assert.ok(!text.includes("~/.claude"));
  assert.ok(!/\$HOME|CLAUDE_CONFIG_DIR/.test(text), "nothing is left for the shell to expand, so Bash(node:*) covers the command as it is");
  assert.ok(text.includes(`\`node "${SKILL_DIR}/../../claude-code-handover/scripts/recall.mjs" $ARGUMENTS\``), "the command runs the script that init installs, with the folder quoted");
  assert.ok(text.includes(`${SKILL_DIR}/../../projects/<this folder's key>/*.jsonl`), "the fallback search looks where Claude Code keeps the transcripts");
  assert.equal(text.split(SKILL_DIR).length - 1, 2, "both paths use it, and nothing else does");
});

test("the command in the installed /recall skill reaches the scripts init installed, with CLAUDE_CONFIG_DIR set and without it", withBox((box) => {
  const config = path.join(box.root, "elsewhere");
  const set = { ...box.env, CLAUDE_CONFIG_DIR: config };
  delete set.HANDOVER_PROJECTS_DIR;
  delete set.HANDOVER_DATA_DIR;
  const unset = { ...set };
  delete unset.CLAUDE_CONFIG_DIR;
  for (const [env, folder] of [[set, config], [unset, path.join(box.home, ".claude")]]) {
    runInit(box, { env });
    writeTranscript(transcriptsIn(folder), box.project);
    const skillFolder = path.join(folder, "skills", "recall");
    const skill = read(path.join(skillFolder, "SKILL.md"));
    const command = /`node "([^"]+)" \$ARGUMENTS`/.exec(skill)[1];
    const scriptPath = expandSkillDir(command, skillFolder);
    assert.equal(path.resolve(scriptPath), path.join(folder, "claude-code-handover", "scripts", "recall.mjs"), "the path in the skill is where init put the script");
    const r = spawnSync(process.execPath, [scriptPath, "invoice", "exporter"], { cwd: box.project, env, encoding: "utf8", windowsHide: true, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /warm-cache setting/, "and the script finds what was said in the transcripts of that config folder");
    const projects = expandSkillDir(`${SKILL_DIR}/../../projects`, skillFolder);
    assert.equal(path.resolve(projects), path.join(folder, "projects"));
    assert.ok(fs.readdirSync(projects).includes(key(box)), "the fallback search path holds this project's transcripts");
  }
}));

// ---------------------------------------------------------------------------------------------
// selftest --replay follows the config folder, as recall does
// ---------------------------------------------------------------------------------------------

test("selftest --replay finds the real history where recall does: the config folder, unless HANDOVER_PROJECTS_DIR and HANDOVER_DATA_DIR say otherwise", withBox((box) => {
  const config = path.join(box.root, "elsewhere");
  const home = path.join(box.home, ".claude");
  const sid = (n) => `${String(n).repeat(8)}-aaaa-4aaa-8aaa-00000000000${n}`;
  writeTranscript(transcriptsIn(config), box.project, sid(1)); // one session in the config folder
  for (const n of [2, 3]) writeTranscript(transcriptsIn(home), box.project, sid(n)); // two in the default ~/.claude
  for (const n of [4, 5, 6]) writeTranscript(box, box.project, sid(n)); // three where HANDOVER_PROJECTS_DIR points
  // A small recall window keeps the synthetic part of the script (not under test here) quick.
  const replay = (opts) => {
    const r = script(box, "selftest.mjs", ["--quick", "--replay"], { ...opts, env: { HANDOVER_RECALL_WINDOW_MB: "1", ...opts.env } });
    const m = /Replay of (\d+) real prompts/.exec(r.stdout);
    return { ...r, prompts: m ? Number(m[1]) : null };
  };

  const a = replay({ env: { CLAUDE_CONFIG_DIR: config }, drop: BARE });
  assert.equal(a.prompts, 1, `CLAUDE_CONFIG_DIR is followed, not ~/.claude (two prompts there)\n${a.stdout}${a.stderr}`);
  assert.ok(exists(path.join(config, "claude-code-handover-data", key(box), "index.jsonl")), "and the index is kept in that config folder");
  assert.ok(!exists(path.join(home, "claude-code-handover-data")), "nothing is written under ~/.claude");

  const b = replay({ drop: [...BARE, "CLAUDE_CONFIG_DIR"] });
  assert.equal(b.prompts, 2, `with no CLAUDE_CONFIG_DIR it is ~/.claude\n${b.stdout}${b.stderr}`);
  assert.ok(exists(path.join(home, "claude-code-handover-data", key(box), "index.jsonl")));

  const c = replay({ env: { CLAUDE_CONFIG_DIR: config } }); // box.env holds HANDOVER_PROJECTS_DIR and HANDOVER_DATA_DIR
  assert.equal(c.prompts, 3, `HANDOVER_PROJECTS_DIR still wins over the config folder\n${c.stdout}${c.stderr}`);
  assert.ok(exists(path.join(box.data, key(box), "index.jsonl")), "and so does HANDOVER_DATA_DIR");
}));

test("selftest --replay says where it looked for transcripts when there is no history", withBox((box) => {
  const nowhere = path.join(box.root, "nowhere");
  const r = script(box, "selftest.mjs", ["--quick", "--replay"], { env: { HANDOVER_RECALL_WINDOW_MB: "1", CLAUDE_CONFIG_DIR: nowhere }, drop: BARE });
  assert.ok(r.stdout.includes(`Replay: no index for this folder (it looked for transcripts in ${path.join(nowhere, "projects", key(box))}).`), r.stdout + r.stderr);
}));

// ---------------------------------------------------------------------------------------------
// The cache report: the threshold is 55 minutes, and its headings say 55 minutes
// ---------------------------------------------------------------------------------------------

test("the cache report counts a return after 55 minutes or more as cold, and its headings say 55 minutes", withBox((box) => {
  const root = path.join(box.root, "cache-projects");
  const usage = (written) => ({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: written });
  const row = (n, ts, written) => ({ type: "assistant", sessionId: "sess-a", requestId: `req-${n}`, timestamp: ts, message: { id: `msg-${n}`, model: "claude-opus-5-5", content: [], usage: usage(written) } });
  const rows = [
    { type: "custom-title", customTitle: "Cache check", sessionId: "sess-a" },
    row(1, "2026-09-30T10:00:00Z", 60000), // the first request
    row(2, "2026-09-30T11:00:00Z", 150000), // 60 minutes later: cold
    row(3, "2026-09-30T11:54:00Z", 150000), // 54 minutes later: not cold
    row(4, "2026-09-30T12:49:00Z", 150000), // 55 minutes later: cold, the threshold is inclusive
  ];
  write(path.join(root, "project-a", "sess-a.jsonl"), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const r = script(box, "cache-report.mjs", ["--root", root]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /=== COLD RETURNS PER SESSION \(gap of 55 minutes or more, with >100K context\) ===/);
  assert.match(r.stdout, /Cache check\s+\| cold returns\s+2 \|/, "the 60 and the 55 minute gaps count, the 54 minute gap does not");
  assert.match(r.stdout, /cold return \(55\+ min\)\s+2 events/);
  assert.ok(!r.stdout.includes(">1h"), "no heading or label still says an hour");
}));

test("the usage and cache reports read the transcripts of CLAUDE_CONFIG_DIR, as recall does", withBox((box) => {
  const config = path.join(box.root, "elsewhere");
  const usage = (written) => ({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: written });
  const session = (title) => [
    { type: "custom-title", customTitle: title, sessionId: "sess-a" },
    ...[["2026-09-30T10:00:00Z", 60000], ["2026-09-30T11:00:00Z", 150000]].map(([ts, written], n) => (
      { type: "assistant", sessionId: "sess-a", requestId: `req-${n}`, timestamp: ts, message: { id: `msg-${n}`, model: "claude-opus-5-5", content: [], usage: usage(written) } })),
  ].map((r) => JSON.stringify(r)).join("\n") + "\n";
  write(path.join(config, "projects", "project-a", "sess-a.jsonl"), session("Session in the config folder"));
  write(path.join(box.home, ".claude", "projects", "project-a", "sess-a.jsonl"), session("Session in the default folder")); // must not be read
  for (const name of ["usage-report.mjs", "cache-report.mjs"]) {
    const r = script(box, name, [], { env: { CLAUDE_CONFIG_DIR: config }, drop: BARE });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes("Session in the config folder"), `${name}:\n${r.stdout}`);
    assert.ok(!r.stdout.includes("Session in the default folder"), `${name} read ~/.claude/projects`);
  }
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

// ---------------------------------------------------------------------------------------------
// Settings that are not numbers, words in any script, and the signature file
// ---------------------------------------------------------------------------------------------

test("a limit or a stale-minutes setting that is not a number counts as unset, so the guard keeps its defaults", withBox((box) => {
  for (const value of ["abc", "", "  ", "NaN", "-1", "0", "Infinity"]) {
    const env = { HANDOVER_CONTEXT_LIMIT: value };
    assert.equal(guard(box, "UserPromptSubmit", { tokens: 300000, env }), "", JSON.stringify(value));
    assert.match(guard(box, "UserPromptSubmit", { tokens: 400000, env }), warns(40, 400), JSON.stringify(value));
  }
  for (const value of ["abc", "", "NaN", "-5", "Infinity"]) {
    const env = { HANDOVER_STALE_MINUTES: value };
    assert.equal(guard(box, "Stop", { tokens: 400000, ageMin: 5, env }), "", JSON.stringify(value));
    assert.equal(JSON.parse(guard(box, "Stop", { tokens: 400000, ageMin: 60, env })).decision, "block", JSON.stringify(value));
  }
  assert.equal(JSON.parse(guard(box, "Stop", { tokens: 400000, ageMin: 0, env: { HANDOVER_STALE_MINUTES: "0" } })).decision, "block", "0 minutes: ask whenever a turn ends above the limit");
}));

// The index module in this process, pointed at the sandbox for the length of a test.
const mem = await import(pathToFileURL(path.join(ROOT, "scripts", "memory-index.mjs")).href);
function inBox(box, fn) {
  const saved = { HANDOVER_PROJECTS_DIR: process.env.HANDOVER_PROJECTS_DIR, HANDOVER_DATA_DIR: process.env.HANDOVER_DATA_DIR };
  process.env.HANDOVER_PROJECTS_DIR = box.projects;
  process.env.HANDOVER_DATA_DIR = box.data;
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const build = (box) => { let r; do { r = mem.updateIndex(box.project); } while (!r.complete); };

test("recall matches words in any script, with their vowel signs and accents, not only ASCII letters", withBox((box) => inBox(box, () => {
  const sid = "33333333-aaaa-4aaa-8aaa-000000000003";
  const rows = [
    { type: "user", timestamp: "2026-09-30T10:00:00Z", message: { role: "user", content: "விலைப்பட்டியல் ஏற்றுமதிக்கு எந்த கேச் அமைப்பை பயன்படுத்துகிறோம்?" } },
    { type: "assistant", timestamp: "2026-09-30T10:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "விலைப்பட்டியல் ஏற்றுமதிக்கு warm-cache அமைப்பை தேர்ந்தெடுத்தோம், ஏனெனில் குளிர் தொடக்கம் பதினொரு வினாடிகள் எடுத்தது." }], usage: {} } },
    { type: "assistant", timestamp: "2026-09-30T10:01:05Z", message: { role: "assistant", content: [{ type: "text", text: "Für den Rechnungsexport wurde die Größe der Warteschlange auf zwölf Einträge begrenzt." }], usage: {} } },
    { type: "assistant", timestamp: "2026-09-30T10:02:05Z", message: { role: "assistant", content: [{ type: "text", text: "The nightly build publishes the documentation site after the unit tests pass." }], usage: {} } },
  ];
  write(path.join(box.projects, key(box), `${sid}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  build(box);
  const words = mem.terms("Größe der Warteschlange: 12 Einträge, siehe ABC-42. விலைப்பட்டியல்!");
  for (const w of ["größe", "warteschlange", "einträge", "abc-42", "விலைப்பட்டியல்"]) assert.ok(words.includes(w), `${w} is a term: ${words}`);
  assert.ok(!words.includes("12"), "a number alone is not a term");
  const tamil = mem.search(box.project, "விலைப்பட்டியல் ஏற்றுமதிக்கு எந்த கேச் அமைப்பை தேர்ந்தெடுத்தோம்? ஒரு வரியில் சொல்லுங்கள்.", { sessionId: "new" });
  assert.ok(tamil.length >= 1 && tamil.some((f) => f.text.includes("warm-cache")), JSON.stringify(tamil));
  const german = mem.search(box.project, "Wie groß ist die Warteschlange für den Rechnungsexport?", { sessionId: "new" });
  assert.ok(german.length >= 1 && german.some((f) => f.text.includes("zwölf Einträge")), JSON.stringify(german));
  assert.deepEqual(mem.search(box.project, "Please rename the staging cluster and rotate its credentials.", { sessionId: "new" }), [], "an unrelated question stays silent");
})));

test("the signature file skips text searches without changing what recall finds, and is rebuilt when it does not match", withBox((box) => inBox(box, () => {
  writeTranscript(box, box.project);
  const sid = "44444444-aaaa-4aaa-8aaa-000000000004";
  const rows = [{ type: "custom-title", customTitle: "Filler", sessionId: sid }];
  for (let i = 0; i < 60; i++) {
    const text = `Filler remark number ${i} about the ${["parser", "scheduler", "renderer", "uploader"][i % 4]} module and its ${["tests", "docs", "metrics"][i % 3]}.${i === 17 ? " The retention window for uploads is forty days." : ""}`;
    rows.push({ type: "assistant", timestamp: "2026-09-29T10:00:00Z", message: { role: "assistant", content: [{ type: "text", text }], usage: {} } });
  }
  write(path.join(box.projects, key(box), `${sid}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  build(box);
  const dir = mem.dataDir(box.project);
  const entries = read(path.join(dir, "index.jsonl")).split("\n").filter(Boolean).length;
  assert.equal(entries, 62);
  const state = () => JSON.parse(read(path.join(dir, "state.json")));
  assert.equal(state().sig.entries, entries, "every entry is signed");
  assert.equal(state().sig.offset, fs.statSync(path.join(dir, "index.jsonl")).size, "up to the end of the index");
  assert.equal(fs.statSync(path.join(dir, "sig.bin")).size, entries * mem.SIG_BYTES);

  const ask = "Which cache setting did we choose for the invoice exporter, and what was the reason?";
  const expected = mem.search(box.project, ask, { sessionId: "new" });
  assert.ok(expected.length >= 1 && expected[0].text.includes("warm-cache"), JSON.stringify(expected));
  const retention = "What is the retention window for uploads?";
  const filler = mem.search(box.project, retention, { sessionId: "new" });
  assert.ok(filler.length >= 1 && /forty days/.test(filler[0].text), JSON.stringify(filler));
  assert.deepEqual(mem.search(box.project, "Tell me about the scheduler module metrics.", { sessionId: "new" }), [], "words that most remarks share are not a match");

  // A signature file that does not agree with state.json is left out of the search (same result) and rebuilt by the next update.
  fs.truncateSync(path.join(dir, "sig.bin"), mem.SIG_BYTES);
  assert.deepEqual(mem.search(box.project, ask, { sessionId: "new" }), expected, "the same result without a usable signature file");
  assert.deepEqual(mem.search(box.project, retention, { sessionId: "new" }), filler);
  build(box);
  assert.equal(fs.statSync(path.join(dir, "sig.bin")).size, entries * mem.SIG_BYTES, "rebuilt in full");
  assert.equal(state().sig.entries, entries);
  assert.deepEqual(mem.search(box.project, ask, { sessionId: "new" }), expected, "and the same result with it");

  // A new remark is signed as it is indexed, so the two files stay in step.
  fs.appendFileSync(path.join(box.projects, key(box), `${sid}.jsonl`), `${JSON.stringify({ type: "assistant", timestamp: "2026-09-29T11:00:00Z", message: { role: "assistant", content: [{ type: "text", text: "The uploader module now retries a failed chunk three times before it gives up." }], usage: {} } })}\n`);
  build(box);
  assert.equal(state().sig.entries, entries + 1);
  assert.equal(fs.statSync(path.join(dir, "sig.bin")).size, (entries + 1) * mem.SIG_BYTES);
  const retry = mem.search(box.project, "How many times does the uploader retry a failed chunk?", { sessionId: "new" });
  assert.ok(retry.length >= 1 && retry[0].text.includes("three times"), JSON.stringify(retry));
})));

test("the since filter leaves old remarks out and keeps each remark that stays with its own signature", withBox((box) => inBox(box, () => {
  const sid = "55555555-aaaa-4aaa-8aaa-000000000005";
  const remark = (timestamp, text) => ({ type: "assistant", timestamp, message: { role: "assistant", content: [{ type: "text", text }], usage: {} } });
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(remark("2026-09-01T10:00:00Z", `Old remark ${i} about the ${["parser", "scheduler", "renderer", "uploader"][i % 4]} module and its ${["tests", "docs", "metrics"][i % 3]}.`));
  for (let i = 0; i < 10; i++) rows.push(remark("2026-10-15T09:00:00Z", `Recent remark ${i} about the ${["parser", "scheduler", "renderer", "uploader"][i % 4]} module and its ${["tests", "docs", "metrics"][i % 3]}.`));
  rows.push(remark("2026-10-15T10:00:00Z", "The retention window for uploads is now forty days."));
  write(path.join(box.projects, key(box), `${sid}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  build(box);
  const dir = mem.dataDir(box.project);
  assert.equal(JSON.parse(read(path.join(dir, "state.json"))).sig.entries, 51, "every remark is signed");
  // The 11 remarks that stay are the index's last 11: each must be checked against its own signature, not the one at its new position.
  const ask = "What is the retention window for uploads?";
  const found = mem.search(box.project, ask, { sessionId: "new", since: "2026-10-01" });
  assert.ok(found.length >= 1 && /forty days/.test(found[0].text), JSON.stringify(found));
  fs.rmSync(path.join(dir, "sig.bin"));
  assert.deepEqual(mem.search(box.project, ask, { sessionId: "new", since: "2026-10-01" }), found, "the same result without the signature file");
  assert.deepEqual(mem.search(box.project, ask, { sessionId: "new", since: "2026-10-16" }), [], "and nothing from before the since moment");
})));

test("recall --who filters user messages, assistant responses and notes", withBox((box) => {
  const config = path.join(box.root, "elsewhere");
  const transcript = writeTranscript(transcriptsIn(config), box.project);

  const rows = [
    {
      type: "custom-title",
      customTitle: "Cache session",
      sessionId: "33333333-aaaa-4aaa-8aaa-000000000003",
    },
    {
      type: "user",
      timestamp: "2026-10-15T10:00:00Z",
      message: {
        role: "user",
        content: "Which invoice exporter cache setting did we choose?",
      },
    },
    {
      type: "assistant",
      timestamp: "2026-10-15T10:00:05Z",
      message: {
        role: "assistant",
        content: "We chose the warm invoice exporter cache setting.",
      },
    },
  ];
  write(transcript, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  write(
    path.join(box.project, "DECISIONS.md"),
    "- 2026-10-16 invoice exporter cache decision: use warm-cache.\n",
  );

  const options = {
    env: { CLAUDE_CONFIG_DIR: config },
    drop: BARE,
  };

  const you = script(
    box, "recall.mjs",
    ["invoice", "exporter", "--who", "you"],
    options,
  );
  assert.equal(you.status, 0, you.stderr);
  assert.match(you.stdout, /1 match\(es\) for "invoice exporter" from you/);
  assert.match(you.stdout, /Which invoice exporter cache setting/);
  assert.doesNotMatch(you.stdout, /We chose the warm invoice exporter/);

  const claude = script(
    box, "recall.mjs",
    ["invoice", "exporter", "--who", "claude"],
    options,
  );
  assert.equal(claude.status, 0, claude.stderr);
  assert.match(claude.stdout, /1 match\(es\) for "invoice exporter" from claude/);
  assert.match(claude.stdout, /We chose the warm invoice exporter/);
  assert.doesNotMatch(claude.stdout, /Which invoice exporter cache setting/);

  const notes = script(
    box, "recall.mjs",
    ["invoice", "exporter", "--who", "notes"],
    options,
  );
  assert.equal(notes.status, 0, notes.stderr);
  assert.match(notes.stdout, /1 match\(es\) for "invoice exporter" from notes/);
  assert.match(notes.stdout, /DECISIONS\.md/);
  assert.doesNotMatch(notes.stdout, /We chose the warm invoice exporter/);

  const combined = script(
    box, "recall.mjs",
    ["invoice", "exporter", "--who", "you", "--since", "2026-10-01", "--limit", "1", "--all"],
    options,
  );
  assert.equal(combined.status, 0, combined.stderr);
  assert.match(combined.stdout, /1 match\(es\) for "invoice exporter" from you/);

  const bad = script(
    box, "recall.mjs",
    ["invoice", "exporter", "--who", "invalid"],
    options,
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--who needs you, claude or notes/);
}));
