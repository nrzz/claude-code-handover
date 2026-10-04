// init: the files it writes in the project folder and in the config folder, with the same contents the setup prompt
// describes, and the never-destroy rules for everything that already exists. Every test runs in a throwaway world.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BLOCK, EMOJI, HAS_GIT, ROOT, TODAY, commitAll, envWithoutGit, exists, expectedCard, flat, git, gitInit, names, projectKey, promptBlocks, read,
  readJson, runInit, runStatus, snapshot, withBox, write, writeTranscript,
} from "./helpers.mjs";

const CHANGING = new Set(["created", "appended", "updated", "replaced", "backup", "copied", "removed"]);
const changedFiles = (r) => r.report.files.filter((f) => CHANGING.has(f.action) && f.action !== "backup").map((f) => f.file);
const record = (r, file) => r.report.files.find((f) => f.file === file);
const slash = (p) => p.replace(/\\/g, "/");
const guardScript = (box) => `${slash(box.cfg)}/claude-code-handover/scripts/context-guard.mjs`;
const expectedHooks = (box) => JSON.parse(promptBlocks()[BLOCK.hooks].split("<home>/.claude").join(slash(box.cfg))).hooks;
const RULES = () => `${promptBlocks()[BLOCK.rules]}\n`;
const fact = (r, label) => (r.report.ground.find(([k]) => k === label) || [])[1];
const backups = (dir, prefix) => names(dir).filter((n) => n.startsWith(prefix));
const gitTest = (name, fn) => test(name, { skip: !HAS_GIT && "git is not installed" }, withBox(fn));

// ---------------------------------------------------------------------------------------------
// The files of a fresh setup
// ---------------------------------------------------------------------------------------------

gitTest("a git project gets the files the setup prompt describes, with the same contents", (box) => {
  gitInit(box);
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  const b = promptBlocks();
  assert.equal(read(box.p("CLAUDE.local.md")), `${b[BLOCK.rules]}\n`);
  assert.equal(read(box.p("HANDOVER.md")), `${b[BLOCK.handover].replace("<today>", TODAY).replace("<stream name>", "main")}\n`);
  assert.equal(read(box.p("DECISIONS.md")), `${b[BLOCK.decisions].replace("<today>", TODAY).replace("<first stream>", "main")}\n`);
  assert.equal(read(box.c("skills", "handover", "SKILL.md")), `${b[BLOCK.skill]}\n`);
  assert.equal(read(box.p("claude-token-rules.md")), expectedCard({ multi: true }));
  assert.equal(read(box.p(".gitignore")), "CLAUDE.local.md\nHANDOVER.md\nDECISIONS.md\nclaude-token-rules.md\n");
  assert.equal(read(box.c("skills", "recall", "SKILL.md")), read(path.join(ROOT, "skills", "recall", "SKILL.md")));
  assert.deepEqual(readJson(box.settings), { ...JSON.parse(b[BLOCK.multi]), hooks: expectedHooks(box) });
  assert.ok(!exists(box.p("CLAUDE.md")), "a git project keeps its CLAUDE.md to the team");
  assert.equal(git(box, box.project, "status", "--porcelain"), "?? .gitignore", "git status shows only .gitignore: the four personal files are ignored");
  assert.equal(r.guardInstalled, true);
  assert.equal(r.personalFile, box.p("CLAUDE.local.md"));
});

gitTest("the report says, in plain words, what was done, what git says and what to keep", (box) => {
  gitInit(box);
  const r = runInit(box);
  for (const f of [box.p("CLAUDE.local.md"), box.p("HANDOVER.md"), box.p("DECISIONS.md"), box.p(".gitignore"), box.p("claude-token-rules.md"), box.settings, box.c("skills", "handover", "SKILL.md"), box.c("skills", "recall", "SKILL.md"), box.vendor]) {
    assert.ok(r.text.includes(f), `the report names ${f}`);
    assert.equal(record(r, f).action === "created" || record(r, f).action === "copied", true, f);
  }
  const text = flat(r.text);
  assert.match(text, /Git repository yes/);
  assert.match(text, /git status shows none of the four files as untracked/);
  assert.match(text, /Installed: the context guard and automatic recall/);
  assert.match(text, /node scripts\/memory-index\.mjs --build: No past sessions for /);
  assert.match(text, /node scripts\/recall\.mjs setup:/);
  assert.match(text, /Keep these four lines 1\. Open a new Claude Code session in .* and ask "which memory files loaded, and what is my effort\?" It should name CLAUDE\.local\.md and HANDOVER\.md\./);
  assert.match(text, / 2\. For each old chat you still need: open it, type \/handover, close it for good\./);
  assert.match(text, / 3\. Every morning: new session, type "continue"\. What earlier sessions said about your question arrives by itself; \/recall followed by a topic is the deeper search\./);
  assert.match(text, / 4\. At a natural stop past 35 percent, or when done: \/handover, then close\./);
  assert.ok(!text.includes("With more than one stream"), "one stream: no stream hint");
  assert.match(text, /Done: \d+ items written or changed\./);
  assert.ok(!EMOJI.test(r.text), "no emoji");
  assert.deepEqual(r.lines.err, []);
});

test("a folder that is not a git repository gets its rules in CLAUDE.md and no .gitignore", withBox((box) => {
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  assert.equal(read(box.p("CLAUDE.md")), RULES());
  assert.ok(!exists(box.p("CLAUDE.local.md")));
  assert.ok(!exists(box.p(".gitignore")));
  assert.equal(record(r, box.p(".gitignore")).action, "skipped");
  assert.match(r.text, /not a git repository/);
  assert.equal(r.personalFile, box.p("CLAUDE.md"));
  assert.match(flat(r.text), /It should name CLAUDE\.md and HANDOVER\.md\./);
  assert.equal(r.report.gitInfo.checked, false);
}));

test("a second run in a folder that is not a git repository keeps the rules in CLAUDE.md", withBox((box) => {
  runInit(box);
  const second = runInit(box);
  assert.ok(!exists(box.p("CLAUDE.local.md")), "CLAUDE.md now exists, but it is ours, so no second file is made");
  assert.equal(second.changed, false, second.text);
  assert.equal(record(second, box.p("CLAUDE.md")).action, "unchanged");
}));

test("a project inside a git repository is a git project", { skip: !HAS_GIT && "git is not installed" }, withBox((box) => {
  gitInit(box, box.root); // the repository is the sandbox root, the project a folder in it
  const env = { ...box.env, GIT_CEILING_DIRECTORIES: path.dirname(box.root) };
  const r = runInit(box, { env });
  assert.equal(r.code, 0, r.text);
  assert.ok(exists(box.p("CLAUDE.local.md")) && exists(box.p(".gitignore")));
  assert.ok(!exists(path.join(box.root, ".gitignore")), "the .gitignore goes in the project folder");
  assert.match(fact(r, "Git repository"), /the repository is at /);
  assert.deepEqual(r.report.gitInfo, { checked: true, tracked: [], untracked: [] });
}));

// ---------------------------------------------------------------------------------------------
// CLAUDE.md, CLAUDE.local.md and AGENTS.md
// ---------------------------------------------------------------------------------------------

gitTest("an existing CLAUDE.md in a git project is never modified", (box) => {
  gitInit(box);
  const mine = "# Team rules\r\nUse tabs.\r\n";
  write(box.p("CLAUDE.md"), mine);
  const r = runInit(box);
  assert.equal(read(box.p("CLAUDE.md")), mine);
  assert.equal(read(box.p("CLAUDE.local.md")), RULES());
  assert.match(fact(r, "CLAUDE.md"), /CLAUDE\.md \(never modified\)/);
});

test("an existing CLAUDE.md in a folder that is not a git repository is never modified either", withBox((box) => {
  const mine = "# Team rules\nUse tabs.\n";
  write(box.p("CLAUDE.md"), mine);
  runInit(box);
  assert.equal(read(box.p("CLAUDE.md")), mine);
  assert.equal(read(box.p("CLAUDE.local.md")), RULES(), "the rules go in CLAUDE.local.md instead");
}));

test(".claude/CLAUDE.md counts as a CLAUDE.md that is there", withBox((box) => {
  write(box.p(".claude", "CLAUDE.md"), "# Team\n");
  const r = runInit(box);
  assert.equal(read(box.p(".claude", "CLAUDE.md")), "# Team\n");
  assert.ok(!exists(box.p("CLAUDE.md")));
  assert.equal(read(box.p("CLAUDE.local.md")), RULES());
  assert.match(fact(r, "CLAUDE.md"), /\.claude/);
}));

test("a CLAUDE.md in a parent folder is reported and changes nothing else", withBox((box) => {
  write(path.join(box.root, "CLAUDE.md"), "# Above\n");
  const r = runInit(box);
  assert.match(fact(r, "CLAUDE.md"), /none here; one in a parent folder: .*CLAUDE\.md/);
  assert.equal(read(path.join(box.root, "CLAUDE.md")), "# Above\n");
  assert.equal(read(box.p("CLAUDE.md")), RULES(), "not a git repository and none here: the rules go in CLAUDE.md");
}));

gitTest("an existing CLAUDE.local.md keeps its text and gets our block after a blank line, once", (box) => {
  gitInit(box);
  write(box.p("CLAUDE.local.md"), "My own rule: be terse.\n");
  const first = runInit(box);
  const after = read(box.p("CLAUDE.local.md"));
  assert.equal(after, `My own rule: be terse.\n\n${RULES()}`);
  assert.equal(record(first, box.p("CLAUDE.local.md")).action, "appended");
  const second = runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), after, "the block is not appended twice");
  assert.equal(record(second, box.p("CLAUDE.local.md")).action, "unchanged");
});

test("appending to a file without a final newline, or with Windows line endings, keeps its style", withBox((box) => {
  gitInit(box);
  write(box.p("CLAUDE.local.md"), "no newline at the end");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), `no newline at the end\n\n${RULES()}`);
  fs.rmSync(box.p("CLAUDE.local.md"));
  write(box.p("CLAUDE.local.md"), "line one\r\nline two\r\n");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), `line one\r\nline two\r\n\r\n${RULES().replace(/\n/g, "\r\n")}`);
}));

gitTest("a CLAUDE.local.md whose block you edited is recognised and left alone", (box) => {
  gitInit(box);
  const edited = RULES().replace("under 120 lines", "under 80 lines");
  write(box.p("CLAUDE.local.md"), edited);
  const r = runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), edited);
  assert.match(record(r, box.p("CLAUDE.local.md")).note, /edited by you/);
});

gitTest("an empty CLAUDE.local.md is filled with the block", (box) => {
  gitInit(box);
  write(box.p("CLAUDE.local.md"), "\n");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), RULES());
});

gitTest("with an AGENTS.md and no CLAUDE.md, @AGENTS.md is the first line so AGENTS.md keeps loading", (box) => {
  gitInit(box);
  write(box.p("AGENTS.md"), "# Agents\nRun tests first.\n");
  const r = runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), `@AGENTS.md\n\n${RULES()}`);
  assert.equal(read(box.p("AGENTS.md")), "# Agents\nRun tests first.\n");
  assert.match(fact(r, "AGENTS.md"), /found here/);
  assert.match(record(r, box.p("CLAUDE.local.md")).note, /imports AGENTS\.md/);
});

test("the same in a folder that is not a git repository: CLAUDE.md starts with @AGENTS.md", withBox((box) => {
  write(box.p("AGENTS.md"), "# Agents\n");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.md")), `@AGENTS.md\n\n${RULES()}`);
  assert.equal(read(box.p("AGENTS.md")), "# Agents\n");
}));

gitTest("with an AGENTS.md and a CLAUDE.md, nothing imports AGENTS.md: the CLAUDE.md is the team's to edit", (box) => {
  gitInit(box);
  write(box.p("AGENTS.md"), "# Agents\n");
  write(box.p("CLAUDE.md"), "# Team\n");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), RULES());
  assert.equal(read(box.p("CLAUDE.md")), "# Team\n");
});

gitTest("an existing CLAUDE.local.md gets @AGENTS.md as its first line when AGENTS.md exists and it has no import", (box) => {
  gitInit(box);
  write(box.p("AGENTS.md"), "# Agents\n");
  write(box.p("CLAUDE.local.md"), "My own rule.\n");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), `@AGENTS.md\n\nMy own rule.\n\n${RULES()}`);
  fs.writeFileSync(box.p("CLAUDE.local.md"), "@AGENTS.md\nMy own rule.\n");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), `@AGENTS.md\nMy own rule.\n\n${RULES()}`, "an import that is already there is not added again");
});

// ---------------------------------------------------------------------------------------------
// HANDOVER.md and DECISIONS.md
// ---------------------------------------------------------------------------------------------

test("one section per stream, and the first stream names the first decision", withBox((box) => {
  const r = runInit(box, { streams: "backend, frontend" });
  const text = read(box.p("HANDOVER.md"));
  assert.deepEqual(text.split("\n").filter((l) => l.startsWith("## ")), ["## backend", "## frontend", "## Pointers (do not re-read the source documents)"]);
  assert.equal(read(box.p("DECISIONS.md")), `${promptBlocks()[BLOCK.decisions].replace("<today>", TODAY).replace("<first stream>", "backend")}\n`);
  assert.match(flat(r.text), /\(With more than one stream, add its name: "continue backend", "\/handover backend"\.\)/);
}));

test("an existing HANDOVER.md keeps everything; only a missing Pointers block is added, at the end", withBox((box) => {
  const mine = "# My handover\n\nUpdated: yesterday\n\n## main\n- Next step: ship it\n";
  write(box.p("HANDOVER.md"), mine);
  const r = runInit(box);
  const after = read(box.p("HANDOVER.md"));
  assert.ok(after.startsWith(`${mine}\n## Pointers (do not re-read the source documents)\n`));
  assert.equal(after.split("\n").filter((l) => l.startsWith("## main")).length, 1, "the main section is not added a second time");
  assert.equal(record(r, box.p("HANDOVER.md")).action, "appended");
  assert.equal(runInit(box).changed, false);
}));

test("missing stream sections are appended at the end, after an existing Pointers block, and the file is only added to", withBox((box) => {
  const mine = [
    "# Handover", "", "Updated: 2026-09-01 by me", "", "## main", "- Current task: the big one", "- Next step: ship it", "",
    "## Pointers (do not re-read the source documents)", "- Rules card: claude-token-rules.md in this folder.", "",
  ].join("\n");
  write(box.p("HANDOVER.md"), mine);
  const r = runInit(box, { streams: "main, backend, frontend" });
  const after = read(box.p("HANDOVER.md"));
  assert.ok(after.startsWith(`${mine}\n## backend\n- Current task: (none yet)\n`), "every original byte is a prefix of the new file");
  const headings = after.split("\n").filter((l) => l.startsWith("## "));
  assert.deepEqual(headings, ["## main", "## Pointers (do not re-read the source documents)", "## backend", "## frontend"]);
  assert.ok(after.endsWith("- Files in play: (paths)\n"), "the Pointers block is not added a second time");
  assert.equal(record(r, box.p("HANDOVER.md")).action, "appended");
  assert.match(record(r, box.p("HANDOVER.md")).note, /added the stream sections backend, frontend at the end/);
  assert.equal(runInit(box, { streams: "main, backend, frontend" }).changed, false);
}));

test("a HANDOVER.md with Windows line endings gets its new sections with Windows line endings", withBox((box) => {
  const mine = ["# Handover", "", "## main", "- Next step: ship it", "", "## Pointers (do not re-read the source documents)", "- Rules card: x", ""].join("\r\n");
  write(box.p("HANDOVER.md"), mine);
  runInit(box, { streams: "main, backend" });
  const after = read(box.p("HANDOVER.md"));
  assert.ok(!/[^\r]\n/.test(after), "every line break is a CRLF");
  assert.ok(after.startsWith(`${mine}\r\n## backend\r\n- Current task: (none yet)\r\n`));
}));

test("a stream that is already there is matched whatever its case, and a second run adds nothing", withBox((box) => {
  runInit(box, { streams: "Backend" });
  const r = runInit(box, { streams: "backend" });
  assert.equal(read(box.p("HANDOVER.md")).split("\n").filter((l) => l.startsWith("## ")).length, 2);
  assert.equal(record(r, box.p("HANDOVER.md")).action, "unchanged");
}));

test("a later run with another stream adds only that section", withBox((box) => {
  runInit(box, { streams: "main" });
  const before = snapshot(box.root);
  const r = runInit(box, { streams: "main, backend" });
  assert.deepEqual(changedFiles(r), [box.p("HANDOVER.md")]);
  const after = snapshot(box.root);
  for (const [f, v] of Object.entries(before)) if (f !== "project/HANDOVER.md") assert.equal(after[f], v, `${f} is untouched`);
  assert.ok(read(box.p("HANDOVER.md")).includes("## backend\n- Current task"));
  assert.equal(read(box.p("DECISIONS.md")).includes("[main]"), true, "DECISIONS.md is not rewritten");
}));

test("an existing DECISIONS.md is left exactly as it is", withBox((box) => {
  const mine = "# Decisions\r\n- 2026-09-01 [main] we chose x\r\n";
  write(box.p("DECISIONS.md"), mine);
  const r = runInit(box);
  assert.equal(read(box.p("DECISIONS.md")), mine);
  assert.equal(record(r, box.p("DECISIONS.md")).action, "kept");
}));

// ---------------------------------------------------------------------------------------------
// .gitignore, and git's view of the four files
// ---------------------------------------------------------------------------------------------

gitTest(".gitignore: an existing file is appended to, with only the lines that are missing", (box) => {
  gitInit(box);
  write(box.p(".gitignore"), "node_modules/\nHANDOVER.md\n");
  const r = runInit(box);
  assert.equal(read(box.p(".gitignore")), "node_modules/\nHANDOVER.md\nCLAUDE.local.md\nDECISIONS.md\nclaude-token-rules.md\n", "only the missing lines, straight after the last line: no blank line, no comment");
  assert.equal(record(r, box.p(".gitignore")).action, "appended");
  assert.equal(runInit(box).changed, false);
});

gitTest(".gitignore: a missing final newline and Windows line endings are respected", (box) => {
  gitInit(box);
  write(box.p(".gitignore"), "dist/\r\nlogs/");
  runInit(box);
  assert.equal(read(box.p(".gitignore")), "dist/\r\nlogs/\r\nCLAUDE.local.md\r\nHANDOVER.md\r\nDECISIONS.md\r\nclaude-token-rules.md\r\n");
});

gitTest(".gitignore: a byte order mark in front of the first line does not hide that line", (box) => {
  gitInit(box);
  const mark = String.fromCharCode(0xfeff);
  write(box.p(".gitignore"), `${mark}CLAUDE.local.md\nHANDOVER.md\n`);
  runInit(box);
  assert.equal(read(box.p(".gitignore")), `${mark}CLAUDE.local.md\nHANDOVER.md\nDECISIONS.md\nclaude-token-rules.md\n`);
});

gitTest(".gitignore: a line with a leading slash or **/ already ignores the file", (box) => {
  gitInit(box);
  write(box.p(".gitignore"), "/CLAUDE.local.md\n**/HANDOVER.md\n  DECISIONS.md  \nclaude-token-rules.md\n");
  const before = read(box.p(".gitignore"));
  const r = runInit(box);
  assert.equal(read(box.p(".gitignore")), before);
  assert.equal(record(r, box.p(".gitignore")).action, "unchanged");
});

gitTest("a personal file that git already tracks is reported with the untrack command, and the index is not touched", (box) => {
  gitInit(box);
  write(box.p("HANDOVER.md"), "# old handover\n");
  write(box.p("README.md"), "hello\n");
  commitAll(box, box.project, "first");
  const indexBefore = fs.readFileSync(path.join(box.project, ".git", "index"));
  const r = runInit(box);
  assert.deepEqual(r.report.gitInfo.tracked, ["HANDOVER.md"]);
  assert.match(flat(r.text), /HANDOVER\.md is already tracked by git, so \.gitignore cannot hide it\. I did not change the index\./);
  assert.match(r.text, /\n {6}git rm --cached HANDOVER\.md\n/, "the command is on a line of its own, so it can be copied");
  assert.ok(!/git rm --cached (CLAUDE\.local\.md|DECISIONS\.md|claude-token-rules\.md)/.test(r.text), "only the tracked file is named");
  assert.ok(fs.readFileSync(path.join(box.project, ".git", "index")).equals(indexBefore), "the index file is byte for byte what it was");
  assert.equal(git(box, box.project, "ls-files").split("\n").sort().join(","), "HANDOVER.md,README.md");
  assert.equal(git(box, box.project, "diff", "--cached", "--name-only"), "", "nothing was staged");
});

gitTest("when git is not on the PATH the files are still written, and the report says the check was skipped", (box) => {
  gitInit(box);
  const r = runInit(box, { env: envWithoutGit(box) });
  assert.equal(r.code, 0, r.text);
  assert.ok(exists(box.p(".gitignore")), ".gitignore does not need git to be written");
  assert.match(r.text, /Could not check: git was not found\./);
  assert.equal(r.report.gitInfo.checked, false);
  assert.equal(r.guardInstalled, true, "the guard needs Node, not git");
});

// ---------------------------------------------------------------------------------------------
// The two skills and the rules card
// ---------------------------------------------------------------------------------------------

test("an existing /handover skill is replaced; a copy that differed is kept next to it", withBox((box) => {
  write(box.c("skills", "handover", "SKILL.md"), "---\nname: handover\n---\nmy own version\n");
  const r = runInit(box);
  const dir = box.c("skills", "handover");
  assert.equal(read(path.join(dir, "SKILL.md")), `${promptBlocks()[BLOCK.skill]}\n`);
  const kept = backups(dir, "SKILL.md.bak-");
  assert.deepEqual(kept, ["SKILL.md.bak-20261004"]);
  assert.equal(read(path.join(dir, kept[0])), "---\nname: handover\n---\nmy own version\n");
  assert.equal(record(r, path.join(dir, "SKILL.md")).action, "replaced");
  assert.equal(runInit(box).changed, false, "the second run leaves the skill alone");
  assert.deepEqual(backups(dir, "SKILL.md.bak-"), kept, "no second backup");
}));

test("a /handover skill that is already ours is not rewritten", withBox((box) => {
  runInit(box);
  const before = fs.statSync(box.c("skills", "handover", "SKILL.md")).mtimeMs;
  const r = runInit(box);
  assert.equal(record(r, box.c("skills", "handover", "SKILL.md")).action, "unchanged");
  assert.equal(fs.statSync(box.c("skills", "handover", "SKILL.md")).mtimeMs, before);
}));

test("the rules card is generated for the models, and an existing copy is replaced", withBox((box) => {
  write(box.p("claude-token-rules.md"), "an old generated card\n");
  const r = runInit(box, { models: "Fable + Opus + Sonnet" });
  assert.equal(read(box.p("claude-token-rules.md")), expectedCard({ multi: true, third: "Fable" }));
  assert.equal(record(r, box.p("claude-token-rules.md")).action, "replaced");
  const again = runInit(box, { models: "Fable + Opus + Sonnet" });
  assert.equal(record(again, box.p("claude-token-rules.md")).action, "unchanged");
  runInit(box, { models: "Opus only" });
  assert.equal(read(box.p("claude-token-rules.md")), expectedCard({ multi: false }), "another list regenerates the card");
}));

test("the card uses Haiku where there is no Sonnet", withBox((box) => {
  runInit(box, { models: "Opus + Haiku" });
  assert.equal(read(box.p("claude-token-rules.md")), expectedCard({ multi: true, first: "Haiku", third: "Opus" }));
}));

// ---------------------------------------------------------------------------------------------
// settings.json
// ---------------------------------------------------------------------------------------------

const MIX_SETTINGS = [
  ["Opus + Sonnet", { effortLevel: "high", modelSettings: { "claude-sonnet-5-5": { effortLevel: "medium" } }, env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" } }],
  ["Fable + Opus + Sonnet", { effortLevel: "high", modelSettings: { "claude-sonnet-5-5": { effortLevel: "medium" } }, env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" } }],
  ["Opus + Haiku", { effortLevel: "high", env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" } }],
  ["Opus + Fable", { effortLevel: "high" }],
  ["Opus only", { effortLevel: "medium", modelSettings: { "claude-opus-5-5": { effortLevel: "medium" } } }],
  ["Sonnet only", { effortLevel: "medium", modelSettings: { "claude-sonnet-5-5": { effortLevel: "medium" } } }],
  ["Fable only", { effortLevel: "medium", modelSettings: { "claude-fable-5-1": { effortLevel: "medium" } } }],
  ["Haiku only", { effortLevel: "medium", modelSettings: { "claude-haiku-4-5-20251001": { effortLevel: "medium" } } }],
];
for (const [models, expected] of MIX_SETTINGS) {
  test(`settings.json for "${models}" holds the block of the prompt for that list, and the hooks`, withBox((box) => {
    const r = runInit(box, { models });
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(readJson(box.settings), { ...expected, cleanupPeriodDays: 365, hooks: expectedHooks(box) });
  }));
}

test("a missing settings.json is created, without a backup, and read back to check that it parses", withBox((box) => {
  const dry = runInit(box, { dryRun: true });
  assert.ok(!/read back/.test(record(dry, box.settings).note), "a dry run writes nothing, so there is nothing to read back");
  const r = runInit(box);
  assert.equal(record(r, box.settings).action, "created");
  assert.match(record(r, box.settings).note, /7 keys merged at key level; every other setting is untouched; read back and checked: it parses as JSON/);
  assert.deepEqual(backups(box.cfg, "settings.json.bak"), []);
}));

test("an existing settings.json is backed up once, merged at key level, and its other settings stay", withBox((box) => {
  const original = {
    theme: "dark",
    permissions: { allow: ["Bash(npm test)"] },
    env: { MY_VAR: "1" },
    modelSettings: { "claude-opus-4-6": { effortLevel: "max" }, "claude-sonnet-5-5": { effortLevel: "high" } },
    hooks: { Stop: [{ hooks: [{ type: "command", command: "node", args: ["-e", "0"] }] }], PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo" }] }] },
    cleanupPeriodDays: 30,
  };
  const text = `${JSON.stringify(original, null, 2)}\n`;
  write(box.settings, text);
  const r = runInit(box);
  const after = readJson(box.settings);
  assert.equal(after.theme, "dark");
  assert.deepEqual(after.permissions, original.permissions);
  assert.deepEqual(after.env, { MY_VAR: "1", CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" });
  assert.deepEqual(after.modelSettings, { "claude-opus-4-6": { effortLevel: "high" }, "claude-sonnet-5-5": { effortLevel: "medium" } });
  assert.equal(after.effortLevel, "high");
  assert.equal(after.cleanupPeriodDays, 365);
  assert.deepEqual(after.hooks.PreToolUse, original.hooks.PreToolUse);
  assert.equal(after.hooks.Stop.length, 2);
  assert.deepEqual(after.hooks.Stop[0], original.hooks.Stop[0]);
  const kept = backups(box.cfg, "settings.json.bak-");
  assert.deepEqual(kept, ["settings.json.bak-20261004"]);
  assert.equal(read(box.c(kept[0])), text, "the backup is the file as it was");
  assert.equal(record(r, box.settings).action, "updated");
  assert.match(r.text, /modelSettings\.claude-opus-4-6\.effortLevel\s+\(now "high", was "max"/);
  assert.match(r.text, /Settings in /);
}));

test("a backup is never overwritten: the next one gets a time suffix, then a counter", withBox((box) => {
  write(box.settings, '{"theme":"dark"}\n');
  write(box.c("settings.json.bak-20261004"), "an older backup of mine\n");
  runInit(box);
  assert.equal(read(box.c("settings.json.bak-20261004")), "an older backup of mine\n");
  assert.equal(read(box.c("settings.json.bak-20261004-120000")), '{"theme":"dark"}\n');
  runInit(box, { models: "Opus only" }); // changes settings again, on the same second
  assert.deepEqual(backups(box.cfg, "settings.json.bak-").sort(), ["settings.json.bak-20261004", "settings.json.bak-20261004-120000", "settings.json.bak-20261004-120000-2"]);
}));

test("the indentation and line endings of settings.json are kept", withBox((box) => {
  write(box.settings, '{\r\n\t"theme": "dark"\r\n}\r\n');
  runInit(box);
  const text = read(box.settings);
  assert.ok(text.startsWith('{\r\n\t"theme": "dark",\r\n\t"effortLevel": "high"'), text.slice(0, 60));
  assert.ok(text.endsWith("}\r\n"));
  assert.ok(!/[^\r]\n/.test(text), "every line break is a CRLF");
}));

test("an empty settings.json is treated as {}", withBox((box) => {
  write(box.settings, "");
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  assert.equal(readJson(box.settings).effortLevel, "high");
  assert.deepEqual(backups(box.cfg, "settings.json.bak"), [], "there was nothing in it worth a backup");
}));

test("a settings.json that is not valid JSON is left alone, the step is skipped and reported, the rest is done", withBox((box) => {
  const broken = '{ "theme": "dark", "env": {\n';
  write(box.settings, broken);
  const r = runInit(box);
  assert.equal(read(box.settings), broken, "not a byte changed");
  assert.deepEqual(backups(box.cfg, "settings.json."), []);
  assert.equal(r.code, 1);
  assert.equal(record(r, box.settings).action, "skipped");
  assert.match(r.problems[0], /is not valid JSON/);
  assert.match(flat(r.text), /Problems ! .*settings\.json is not valid JSON/);
  assert.match(flat(r.text), /Finished with 1 problem/);
  assert.match(flat(r.text), /To do it by hand, merge this block into .*settings\.json once it is valid JSON, keeping any hooks that are already there:/);
  assert.match(r.text, /"args": \[\n\s+".*context-guard\.mjs"\n\s+\]/);
  assert.equal(r.guardInstalled, false);
  assert.match(flat(r.text), /Not installed: the hooks are not registered/);
  assert.ok(exists(box.p("HANDOVER.md")) && exists(box.p("claude-token-rules.md")) && exists(box.c("skills", "handover", "SKILL.md")), "everything that does not need settings.json is done");
  assert.ok(exists(path.join(box.vendor, "scripts", "context-guard.mjs")), "the scripts are in place for the day the hooks are added");
}));

test("settings that are valid JSON but not an object are left alone as well", withBox((box) => {
  write(box.settings, "[1, 2]\n");
  const r = runInit(box);
  assert.equal(read(box.settings), "[1, 2]\n");
  assert.equal(r.code, 1);
  assert.match(r.problems[0], /not a JSON object/);
}));

test("a key that the organisation's managed settings set is skipped and reported", withBox((box) => {
  write(box.managed, JSON.stringify({ effortLevel: "max", env: { OTHER: "1" } }));
  const r = runInit(box);
  const s = readJson(box.settings);
  assert.equal(s.effortLevel, undefined);
  assert.equal(s.cleanupPeriodDays, 365);
  assert.deepEqual(s.env, { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" });
  assert.match(r.text, /skipped\s+effortLevel\s+\(managed settings set it to "max", which outranks this file\)/);
  assert.match(fact(r, "Managed settings"), /managed-settings\.json \(what it sets outranks this file\)/);
  assert.equal(r.code, 0, "a skipped managed key is not an error");
  assert.equal(runInit(box).changed, false, "and the second run still has nothing to do");
}));

test("when managed settings set every key, settings.json is created empty and nothing is overridden", withBox((box) => {
  write(box.managed, JSON.stringify({
    effortLevel: "xhigh", cleanupPeriodDays: 30, env: { CLAUDE_CODE_SUBAGENT_MODEL: "opus" }, modelSettings: { "claude-sonnet-5-5": { effortLevel: "low" } },
  }));
  const r = runInit(box, { noHooks: true });
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(readJson(box.settings), {});
  assert.equal(record(r, box.settings).action, "created");
  assert.equal(r.report.settings.filter((s) => s.action === "skipped").length, 4);
  assert.equal(runInit(box, { noHooks: true }).changed, false);
}));

test("a managed settings file that is not valid JSON is ignored, with a note", withBox((box) => {
  write(box.managed, "{oops");
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  assert.match(fact(r, "Managed settings"), /is not valid JSON \(.+\), so it is ignored/);
  assert.equal(readJson(box.settings).effortLevel, "high");
}));

test("without CLAUDE_CONFIG_DIR the config folder is ~/.claude", withBox((box) => {
  const env = { ...box.env };
  delete env.CLAUDE_CONFIG_DIR;
  const r = runInit(box, { env });
  assert.ok(exists(path.join(box.home, ".claude", "settings.json")));
  assert.match(fact(r, "Config folder"), /the default, ~\/\.claude/);
  assert.equal(readJson(box.settings).hooks.Stop[0].hooks[0].args[0], `${slash(path.join(box.home, ".claude"))}/claude-code-handover/scripts/context-guard.mjs`);
}));

// ---------------------------------------------------------------------------------------------
// The hooks
// ---------------------------------------------------------------------------------------------

test("the three hooks are in exec form with an absolute path that has forward slashes only", withBox((box) => {
  runInit(box);
  const hooks = readJson(box.settings).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ["SessionStart", "Stop", "UserPromptSubmit"]);
  for (const event of Object.keys(hooks)) {
    const h = hooks[event][0].hooks[0];
    assert.equal(h.type, "command");
    assert.equal(h.command, "node");
    assert.equal(h.timeout, 10);
    assert.equal(h.args.length, 1);
    assert.equal(h.args[0], guardScript(box));
    assert.ok(!h.args[0].includes("\\"), "forward slashes only");
    assert.ok(path.isAbsolute(h.args[0]), "absolute");
    assert.ok(fs.existsSync(h.args[0]), "the script is there");
  }
}));

test("hooks that are already there are kept; ours is added once and never doubled", withBox((box) => {
  const mine = { type: "command", command: "node", args: ["/tools/notify.mjs"] };
  write(box.settings, JSON.stringify({ hooks: { Stop: [{ hooks: [mine] }], SessionStart: [{ matcher: "startup", hooks: [mine] }] } }));
  runInit(box);
  runInit(box);
  runInit(box);
  const hooks = readJson(box.settings).hooks;
  assert.deepEqual(hooks.Stop[0], { hooks: [mine] });
  assert.deepEqual(hooks.SessionStart[0], { matcher: "startup", hooks: [mine] });
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
    const ours = hooks[event].flatMap((g) => g.hooks).filter((h) => (h.args || [""])[0].endsWith("claude-code-handover/scripts/context-guard.mjs"));
    assert.equal(ours.length, 1, `${event} runs the guard once`);
  }
  assert.equal(hooks.Stop.length, 2);
  assert.equal(hooks.UserPromptSubmit.length, 1);
}));

test("an older entry of ours that runs the guard another way is rewritten, not doubled", withBox((box) => {
  write(box.settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node ~/.claude/claude-code-handover/scripts/context-guard.mjs", timeout: 5 }] }] } }));
  const r = runInit(box);
  const stop = readJson(box.settings).hooks.Stop;
  assert.equal(stop.length, 1);
  assert.deepEqual(stop[0].hooks, [{ type: "command", command: "node", args: [guardScript(box)], timeout: 10 }]);
  assert.match(r.text, /updated\s+hooks\.Stop/);
}));

test("--no-hooks installs everything except the guard, recall and the hooks", withBox((box) => {
  const r = runInit(box, { noHooks: true });
  assert.equal(r.code, 0, r.text);
  assert.ok(!exists(box.vendor), "no copy of the scripts");
  assert.ok(!exists(box.c("skills", "recall")), "no /recall command");
  assert.ok(exists(box.c("skills", "handover", "SKILL.md")) && exists(box.p("HANDOVER.md")) && exists(box.p("claude-token-rules.md")));
  const s = readJson(box.settings);
  assert.equal(s.hooks, undefined);
  assert.equal(s.effortLevel, "high");
  assert.match(flat(r.text), /Skipped: you passed --no-hooks, so the context guard, automatic recall and the \/recall command were neither installed nor changed/);
  assert.match(flat(r.text), /You passed --no-hooks, so automatic recall and \/recall were not touched; run init without it to install them/);
  assert.equal(r.guardInstalled, false);
  assert.equal(runInit(box, { noHooks: true }).changed, false);
  const later = runInit(box);
  assert.ok(exists(box.vendor) && readJson(box.settings).hooks.Stop, "running again without the flag adds them");
  assert.equal(later.code, 0);
}));

test("--no-hooks on a setup that has the guard leaves the hooks and the copy exactly as they are", withBox((box) => {
  runInit(box);
  const before = snapshot(box.root);
  const r = runInit(box, { noHooks: true });
  assert.equal(r.changed, false);
  assert.deepEqual(snapshot(box.root), before, "nothing is removed by leaving the flag out of a later run");
  assert.ok(readJson(box.settings).hooks.Stop && exists(box.vendor));
}));

test("a folder at the scripts' place that is not ours is left alone, and the hooks are not registered", withBox((box) => {
  write(path.join(box.vendor, "notes.txt"), "someone else's folder\n");
  const r = runInit(box);
  assert.equal(read(path.join(box.vendor, "notes.txt")), "someone else's folder\n");
  assert.deepEqual(names(box.vendor), ["notes.txt"], "nothing was copied into it");
  assert.equal(r.code, 1);
  assert.match(r.problems[0], /exists and is not ours/);
  assert.equal(readJson(box.settings).hooks, undefined);
  assert.equal(r.guardInstalled, false);
  assert.ok(!exists(box.c("skills", "recall")));
}));

// ---------------------------------------------------------------------------------------------
// Running twice, and the dry run
// ---------------------------------------------------------------------------------------------

gitTest("running init twice changes nothing the second time, and says so", (box) => {
  gitInit(box);
  const first = runInit(box);
  assert.equal(first.changed, true);
  const before = snapshot(box.root);
  const second = runInit(box);
  assert.equal(second.code, 0, second.text);
  assert.equal(second.changed, false);
  assert.deepEqual(snapshot(box.root), before, "no file was written, not even with the same bytes");
  assert.deepEqual(changedFiles(second), []);
  assert.match(flat(second.text), /Nothing to do: everything was already in place, and no file was changed\./);
  assert.ok(!/created|appended|replaced/.test(second.report.files.map((f) => f.action).join(" ")));
  assert.deepEqual(backups(box.cfg, "settings.json.bak"), [], "no backup for a run that changes nothing");
  assert.match(second.text, /Installed: the context guard/, "the guard is still reported as installed");
});

for (const [models] of MIX_SETTINGS) {
  test(`init twice changes nothing the second time, for "${models}" and two streams`, withBox((box) => {
    runInit(box, { models, streams: "api, web" });
    const before = snapshot(box.root);
    const second = runInit(box, { models, streams: "api, web" });
    assert.equal(second.code, 0, second.text);
    assert.equal(second.changed, false, second.text);
    assert.deepEqual(snapshot(box.root), before);
  }));
}

test("init leaves no stray files: only what the report lists exists", withBox((box) => {
  const r = runInit(box);
  assert.deepEqual(names(box.root), ["gitconfig", "home", "project"], "nothing next to the project and the home folder");
  assert.deepEqual(names(box.home), [".claude"], "nothing in the home folder but the config folder");
  assert.deepEqual(names(box.cfg), ["claude-code-handover", "settings.json", "skills"]);
  assert.deepEqual(names(box.c("skills")), ["handover", "recall"]);
  assert.deepEqual(names(box.project), ["CLAUDE.md", "DECISIONS.md", "HANDOVER.md", "claude-token-rules.md"]);
  const listed = new Set(r.report.files.map((f) => f.file));
  for (const f of [box.p("CLAUDE.md"), box.p("HANDOVER.md"), box.p("DECISIONS.md"), box.p("claude-token-rules.md"), box.settings, box.vendor]) assert.ok(listed.has(f), `${f} is in the report`);
  assert.ok(!r.text.includes(".tmp"), "no temporary file is mentioned");
}));

test("paths with spaces and accented letters work, in the project and in the config folder", withBox((box) => {
  const accent = String.fromCodePoint(0xe9);
  const project = path.join(box.root, `my project ${accent}`);
  const cfg = path.join(box.root, `claude config ${accent}`);
  fs.mkdirSync(project);
  const env = { ...box.env, CLAUDE_CONFIG_DIR: cfg };
  const r = runInit(box, { dir: project, env });
  assert.equal(r.code, 0, r.text);
  assert.ok(exists(path.join(project, "HANDOVER.md")) && exists(path.join(cfg, "settings.json")));
  const hook = readJson(path.join(cfg, "settings.json")).hooks.SessionStart[0].hooks[0];
  assert.equal(hook.args[0], `${slash(cfg)}/claude-code-handover/scripts/context-guard.mjs`);
  assert.ok(hook.args[0].includes(" "), "the exec form needs no quoting for a path with a space");
  const run = spawnSync(process.execPath, hook.args, {
    cwd: project, env, encoding: "utf8", windowsHide: true,
    input: JSON.stringify({ hook_event_name: "SessionStart", cwd: project, session_id: "s", transcript_path: "" }),
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^Latest entries of DECISIONS\.md/);
  const again = runInit(box, { dir: project, env });
  assert.equal(again.changed, false);
  assert.ok(again.report.settings.every((s) => s.action === "unchanged" || s.action === "skipped"), "no hook is reported as rewritten when nothing changed");
  assert.deepEqual(runStatus(box, { dir: project, env }).info.hooks, { SessionStart: "registered", UserPromptSubmit: "registered", Stop: "registered" });
}));

test("running init twice with transcripts present leaves every file as it was, the index state included", withBox((box) => {
  writeTranscript(box, box.project);
  const first = runInit(box);
  assert.match(first.text, /Index for .*: 2 new entries/);
  const before = snapshot(box.root);
  const second = runInit(box);
  assert.equal(second.changed, false, second.text);
  assert.match(second.text, /Index for .*: 0 new entries/);
  assert.deepEqual(snapshot(box.root), before, "not a byte or a modification time changed, state.json included");
  assert.ok(exists(path.join(box.data, projectKey(box.project), "index.jsonl")), "the index went to the sandbox's data folder");
}));

test("--dry-run writes nothing at all and says what would be done", withBox((box) => {
  const before = snapshot(box.root);
  const r = runInit(box, { dryRun: true });
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(snapshot(box.root), before);
  assert.ok(!exists(box.cfg), "not even the config folder is made");
  assert.ok(!exists(box.data), "no index is built");
  assert.match(r.text, /^claude-handover init \S+  \(dry run: nothing is written\)/);
  assert.match(r.text, /would create\s+.*CLAUDE\.md/);
  assert.match(r.text, /would copy\s+.*claude-code-handover/);
  assert.match(flat(r.text), /Dry run: nothing was written\. Run the same command without --dry-run to do this\./);
  assert.ok(r.changed, "it reports what it would change");
}));

gitTest("--dry-run in a fresh git project writes nothing and says there is nothing for git to check yet", (box) => {
  gitInit(box);
  const before = snapshot(box.root);
  const r = runInit(box, { dryRun: true });
  assert.deepEqual(snapshot(box.root), before, "not even the .gitignore is written");
  assert.match(flat(r.text), /None of the four files exists yet \(a dry run\), so there is nothing to check\./);
  assert.match(flat(r.text), /would create .*\.gitignore/);
  assert.equal(r.report.gitInfo.checked, false);
});

test("--dry-run on a setup that is complete says nothing would change", withBox((box) => {
  runInit(box);
  const before = snapshot(box.root);
  const r = runInit(box, { dryRun: true });
  assert.deepEqual(snapshot(box.root), before);
  assert.equal(r.changed, false);
  assert.match(flat(r.text), /Dry run: nothing would change, everything is already in place\./);
}));

gitTest("--dry-run leaves a half-done setup, a tracked file and the index exactly as they were", (box) => {
  gitInit(box);
  write(box.p("HANDOVER.md"), "# mine\n");
  write(box.p("CLAUDE.local.md"), "mine\n");
  write(box.settings, '{"theme":"dark"}\n');
  commitAll(box, box.project, "first");
  const indexBefore = fs.readFileSync(path.join(box.project, ".git", "index"));
  const before = snapshot(box.root);
  const r = runInit(box, { dryRun: true });
  assert.deepEqual(snapshot(box.root), before);
  assert.ok(fs.readFileSync(path.join(box.project, ".git", "index")).equals(indexBefore));
  assert.match(r.text, /git rm --cached HANDOVER\.md/, "even a dry run tells you what to untrack");
  assert.match(r.text, /would append\s+.*CLAUDE\.local\.md/);
  assert.match(r.text, /would back up\s+.*settings\.json\.bak-20261004/);
});

// ---------------------------------------------------------------------------------------------
// The recall index, and calls that cannot be understood
// ---------------------------------------------------------------------------------------------

test("the recall index is built from the transcripts in the sandbox, and the first lines go in the report", withBox((box) => {
  const file = writeTranscript(box, box.project);
  assert.ok(file.startsWith(box.projects));
  const r = runInit(box);
  assert.match(r.text, new RegExp(`Index for ${projectKey(box.project)}: 2 new entries`));
  assert.match(r.text, /node scripts\/recall\.mjs setup:/);
  assert.ok(exists(path.join(box.data, projectKey(box.project), "state.json")));
}));

test("a check that runs out of time on a very large history is a note, not a failure", withBox((box) => {
  const r = runInit(box, { checkTimeoutMs: 1 });
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.problems, []);
  const text = flat(r.text);
  assert.match(text, /node scripts\/memory-index\.mjs --build: still running after [\d.]+ seconds, so it was stopped\. The history is very large; that is slow, not a failure\./);
  assert.match(text, /node scripts\/recall\.mjs setup: still running after /);
  assert.equal(r.guardInstalled, true, "the guard does not depend on the check");
}));

test("a folder that is not there, the config folder itself, and unreadable --models or --streams are refused before anything is written", withBox((box) => {
  const before = snapshot(box.root);
  assert.throws(() => runInit(box, { dir: path.join(box.root, "nope") }), /is not a folder/);
  fs.mkdirSync(box.cfg, { recursive: true });
  assert.throws(() => runInit(box, { dir: box.cfg }), /Claude Code's own config folder/);
  fs.rmSync(box.cfg, { recursive: true });
  assert.throws(() => runInit(box, { models: "gpt-5" }), /names none of Opus, Sonnet, Fable or Haiku/);
  assert.throws(() => runInit(box, { models: "Opus, no Sonnet" }), /list the models you have/);
  assert.throws(() => runInit(box, { streams: " , " }), /--streams is empty/);
  assert.deepEqual(snapshot(box.root), before);
}));

test("the models you wrote are echoed back as read, and what was not understood is said", withBox((box) => {
  const r = runInit(box, { models: "sonnet,haiku, gpt-5" });
  assert.equal(fact(r, "Models"), 'Sonnet + Haiku: effort high, Sonnet on medium, subagents on Sonnet (read from "sonnet,haiku, gpt-5"); not recognised and ignored: gpt-5');
  assert.equal(readJson(box.settings).env.CLAUDE_CODE_SUBAGENT_MODEL, "sonnet");
  assert.equal(fact(runInit(box, { models: "Opus + Haiku" }), "Models"), "Opus + Haiku: effort high, subagents on Haiku");
  assert.equal(fact(runInit(box, { models: "Opus + Fable" }), "Models"), "Opus + Fable: effort high, no subagent model");
  assert.equal(fact(runInit(box, { models: "Opus only" }), "Models"), "Opus only: effort medium for everything, no subagent model");
  assert.equal(fact(runInit(box, { models: "Fable + Opus + Sonnet" }), "Models"), "Fable + Opus + Sonnet: effort high, Sonnet on medium, subagents on Sonnet");
}));

// ---------------------------------------------------------------------------------------------
// Files that are not plain UTF-8 text, settings of an odd shape, and other edge cases
// ---------------------------------------------------------------------------------------------

const NOT_TEXT = [
  ["CLAUDE.local.md", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])], // an older code page: an accented e is one byte
  ["HANDOVER.md", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# Handover\r\n", "utf16le")])], // UTF-16 with a byte order mark
  [".gitignore", Buffer.from([0x64, 0x69, 0x73, 0x74, 0xff, 0xfe, 0x0a])], // bytes that are not UTF-8
];
for (const [name, bytes] of NOT_TEXT) {
  gitTest(`${name} that is not UTF-8 text is left alone, byte for byte, and init says what to do`, (box) => {
    gitInit(box);
    fs.writeFileSync(box.p(name), bytes);
    const r = runInit(box);
    assert.ok(fs.readFileSync(box.p(name)).equals(bytes), "not a byte changed");
    assert.equal(r.code, 1);
    assert.ok(flat(r.text).includes(`${box.p(name)} is not UTF-8 text (it may be UTF-16 or use an older code page), so it was left alone. Save it as UTF-8 and run init again.`), r.text);
    assert.ok(r.problems.some((p) => p.includes(box.p(name))), "the file is named in the problems");
    assert.ok(exists(box.p("DECISIONS.md")) && exists(box.settings) && exists(box.p("claude-token-rules.md")), "the other steps ran");
  });
}

test("a CLAUDE.local.md that is not UTF-8 text does not stop init where the rules go in CLAUDE.md instead", withBox((box) => {
  const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
  fs.writeFileSync(box.p("CLAUDE.local.md"), bytes); // not a git repository and no CLAUDE.md: the rules go in CLAUDE.md, this file is not touched
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  assert.ok(fs.readFileSync(box.p("CLAUDE.local.md")).equals(bytes));
  assert.equal(read(box.p("CLAUDE.md")), RULES());
}));

test("a UTF-8 file with accents or a byte order mark keeps every byte it had, and new text is written as UTF-8", withBox((box) => {
  const mark = String.fromCharCode(0xfeff);
  const upper = String.fromCodePoint(0xdc);
  const auml = String.fromCodePoint(0xe4);
  const eacute = String.fromCodePoint(0xe9);
  const mine = `${mark}# ${upper}bersicht\n\n## main\n- N${auml}chster Schritt: weiter\n`;
  fs.writeFileSync(box.p("HANDOVER.md"), mine, "utf8");
  runInit(box, { streams: `main, Caf${eacute}` });
  const after = fs.readFileSync(box.p("HANDOVER.md"));
  const original = Buffer.from(mine, "utf8");
  assert.ok(after.subarray(0, original.length).equals(original), "every original byte is still there, in place");
  assert.ok(after.toString("utf8").includes(`## Caf${eacute}\n- Current task: (none yet)`), "a stream name with an accent is written as UTF-8");
}));

gitTest("an empty CLAUDE.local.md that has a byte order mark keeps it when the rules are written into it", (box) => {
  const mark = String.fromCharCode(0xfeff);
  gitInit(box);
  fs.writeFileSync(box.p("CLAUDE.local.md"), `${mark}\n`, "utf8");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), `${mark}${RULES()}`);
});

test("a byte order mark at the start of settings.json is kept when the file is rewritten", withBox((box) => {
  const mark = String.fromCharCode(0xfeff);
  write(box.settings, `${mark}{"theme":"dark"}\n`);
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  const bytes = fs.readFileSync(box.settings);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const s = JSON.parse(bytes.toString("utf8").slice(1));
  assert.equal(s.theme, "dark");
  assert.equal(s.effortLevel, "high");
  assert.equal(runInit(box).changed, false);
}));

test("an existing DECISIONS.md is kept even when it is not UTF-8 text, and an old generated card is replaced whatever it holds", withBox((box) => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("- 2026-09-01 [main] x\r\n", "utf16le")]);
  fs.writeFileSync(box.p("DECISIONS.md"), utf16);
  fs.writeFileSync(box.p("claude-token-rules.md"), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  assert.ok(fs.readFileSync(box.p("DECISIONS.md")).equals(utf16));
  assert.equal(record(r, box.p("DECISIONS.md")).action, "kept");
  assert.equal(read(box.p("claude-token-rules.md")), expectedCard({ multi: true }));
}));

test("a hooks value of the wrong kind is reported, the guard is not claimed as installed, and the rest is done", withBox((box) => {
  write(box.settings, '{"hooks":"none","theme":"dark"}\n');
  const r = runInit(box);
  assert.equal(r.code, 1);
  assert.equal(r.guardInstalled, false);
  assert.match(flat(r.text), /Not installed: the hooks are not registered/);
  assert.ok(!flat(r.text).includes("Installed: the context guard"));
  assert.match(r.problems[0], /^hooks is not an object in settings\.json and was left alone, so the guard hook was not registered there\./);
  const s = readJson(box.settings);
  assert.equal(s.hooks, "none");
  assert.equal(s.theme, "dark");
  assert.equal(s.effortLevel, "high", "the effort keys are still applied");
  fs.rmSync(box.settings);
  write(box.settings, '{"hooks":{"Stop":{}}}\n');
  const r2 = runInit(box);
  assert.equal(r2.guardInstalled, false, "one event of the wrong kind is enough");
  assert.equal(r2.code, 1);
  const hooks = readJson(box.settings).hooks;
  assert.deepEqual(hooks.Stop, {});
  assert.ok(hooks.SessionStart && hooks.UserPromptSubmit, "the other events still get their hook");
  assert.match(r2.problems.join(" "), /hooks\.Stop is not a list in settings\.json and was left alone/);
}));

test("a settings.json whose parse error quotes several lines still gives a complete report", withBox((box) => {
  const broken = '{\n  "theme": dark,\n  "env": {}\n}\n';
  write(box.settings, broken);
  const r = runInit(box);
  assert.equal(r.code, 1);
  assert.match(r.text, /Problems\n {2}! /);
  assert.ok(r.problems.every((p) => !/[\r\n]/.test(p)), "a problem is one line");
  assert.match(r.text, /Keep these four lines/, "the report was not cut short");
  assert.equal(read(box.settings), broken);
  assert.ok(exists(box.p("HANDOVER.md")));
}));

test("a file in managed-settings.d counts as managed settings", withBox((box) => {
  write(path.join(box.root, "managed-settings.d", "10-retention.json"), '{"cleanupPeriodDays":30}');
  const r = runInit(box);
  assert.equal(readJson(box.settings).cleanupPeriodDays, undefined);
  assert.match(flat(r.text), /skipped cleanupPeriodDays \(managed settings set it to 30/);
  assert.match(fact(r, "Managed settings"), /10-retention\.json \(what it sets outranks this file\)/);
}));

gitTest("a project in a sub-folder of a repository: an untracked personal file is found by its path in the project", (box) => {
  gitInit(box, box.root);
  const env = { ...box.env, GIT_CEILING_DIRECTORIES: path.dirname(box.root) };
  write(box.p(".gitignore"), "HANDOVER.md\n!HANDOVER.md\n"); // lists the name, then un-ignores it again
  const r = runInit(box, { env });
  assert.deepEqual(r.report.gitInfo.untracked, ["HANDOVER.md"], r.text);
  assert.match(flat(r.text), /git status still shows HANDOVER\.md as untracked, so \.gitignore is not hiding it\. Check \.gitignore for a line that un-ignores it/);
  assert.ok(!flat(r.text).includes("git status shows none of the four files as untracked"));
});

gitTest("when .gitignore could not be updated, the git line points to the problem instead of only to a '!' line", (box) => {
  gitInit(box);
  fs.writeFileSync(box.p(".gitignore"), Buffer.from([0x64, 0xe9, 0x0a])); // not UTF-8 text, so it is left alone and the files stay untracked
  const r = runInit(box);
  assert.deepEqual(r.report.gitInfo.untracked.sort(), ["CLAUDE.local.md", "DECISIONS.md", "HANDOVER.md", "claude-token-rules.md"]);
  assert.match(flat(r.text), /so \.gitignore is not hiding them\. See Problems below, and check \.gitignore/);
  assert.match(r.problems[0], /\.gitignore is not UTF-8 text/);
});

// ---------------------------------------------------------------------------------------------
// Found in the second review: byte order marks in front of first-line checks, and paths in wrapped text
// ---------------------------------------------------------------------------------------------

test("a HANDOVER.md that holds only a byte order mark gets its sections once, and a second run adds nothing", withBox((box) => {
  const mark = String.fromCharCode(0xfeff);
  for (const content of [mark, `${mark}\n\n`]) {
    fs.writeFileSync(box.p("HANDOVER.md"), content, "utf8");
    const first = runInit(box, { streams: "main, backend" });
    const after = read(box.p("HANDOVER.md"));
    assert.ok(after.startsWith(mark), "the mark is still the first character");
    const headings = after.split("\n").filter((l) => l.replace(mark, "").startsWith("## ")).map((l) => l.replace(mark, ""));
    assert.deepEqual(headings, ["## main", "## backend", "## Pointers (do not re-read the source documents)"], JSON.stringify(content));
    const second = runInit(box, { streams: "main, backend" });
    assert.equal(second.changed, false, second.text);
    assert.equal(read(box.p("HANDOVER.md")), after);
    assert.ok(first.code === 0);
    fs.rmSync(box.p("HANDOVER.md"));
  }
}));

gitTest("a CLAUDE.local.md with a byte order mark keeps it at the very start, and @AGENTS.md is imported once", (box) => {
  const mark = String.fromCharCode(0xfeff);
  gitInit(box);
  write(box.p("AGENTS.md"), "# Agents\n");
  fs.writeFileSync(box.p("CLAUDE.local.md"), `${mark}My own rule.\n`, "utf8");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), `${mark}@AGENTS.md\n\nMy own rule.\n\n${RULES()}`);
  assert.equal(runInit(box).changed, false);
  fs.writeFileSync(box.p("CLAUDE.local.md"), `${mark}@AGENTS.md\nMy own rule.\n`, "utf8");
  runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), `${mark}@AGENTS.md\nMy own rule.\n\n${RULES()}`, "an import that follows the mark is an import that is there");
});

gitTest("our edited rules heading is recognised behind a byte order mark", (box) => {
  const mark = String.fromCharCode(0xfeff);
  gitInit(box);
  const mine = `${mark}# Personal working rules (not committed)\nmy edit\n`;
  fs.writeFileSync(box.p("CLAUDE.local.md"), mine, "utf8");
  const r = runInit(box);
  assert.equal(read(box.p("CLAUDE.local.md")), mine);
  assert.match(record(r, box.p("CLAUDE.local.md")).note, /edited by you/);
});

test("a managed settings path that cannot be read is reported as unreadable, not as invalid JSON", withBox((box) => {
  fs.mkdirSync(box.managed); // a folder where the file should be: the same code path as a file without read permission
  const r = runInit(box);
  assert.equal(r.code, 0, r.text);
  assert.match(fact(r, "Managed settings"), /cannot be read \(EISDIR\), so it is ignored/);
  assert.ok(!/not valid JSON/.test(fact(r, "Managed settings")));
}));

test("the project folder keeps its spaces in wrapped text, in the four lines to keep and in problems", withBox((box) => {
  const project = path.join(box.root, "my  project folder"); // two spaces in a row, on purpose
  fs.mkdirSync(project);
  write(box.settings, "{ broken");
  const r = runInit(box, { dir: project });
  assert.ok(r.text.includes(project), "the project folder appears whole, on one line");
  assert.ok(r.text.includes(`${box.settings}`) || flat(r.text).includes(flat(box.settings)), "and so does the settings file");
  const line = r.text.split("\n").find((l) => l.includes(project));
  assert.ok(line.trim().length > project.length, "it sits in a sentence");
}));
