// The templates are the single source of the files the installer writes, and setup-prompt.txt is authoritative:
// every code block of the prompt must equal its template, so the two cannot drift apart.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BLOCK, ROOT, promptBlocks } from "./helpers.mjs";
import { decisionsFile, handoverFile, handoverParts, hooksBlock, personalRules, rulesCard, settingsBlock } from "../src/templates.mjs";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const PAIRS = [
  ["rules", "templates/CLAUDE.local.md"],
  ["handover", "templates/HANDOVER.md"],
  ["decisions", "templates/DECISIONS.md"],
  ["skill", "skills/handover/SKILL.md"],
  ["multi", "templates/settings-multi-model.json"],
  ["single", "templates/settings-single-model.json"],
  ["card", "templates/claude-token-rules.md"],
  ["hooks", "templates/hooks-settings.json"],
];

test("setup-prompt.txt has exactly the eight code blocks the templates cover", () => {
  assert.equal(promptBlocks().length, PAIRS.length, "a new code block in setup-prompt.txt needs a template and a pair in this test");
  assert.deepEqual(PAIRS.map(([k]) => BLOCK[k]), PAIRS.map((_, i) => i), "the pairs list the blocks in the order they appear");
});

for (const [key, file] of PAIRS) {
  test(`code block "${key}" of setup-prompt.txt equals ${file}, placeholders included`, () => {
    assert.equal(read(...file.split("/")), `${promptBlocks()[BLOCK[key]]}\n`);
  });
}

test("SETUP-PROMPT.md holds the same text as setup-prompt.txt", () => {
  const md = read("SETUP-PROMPT.md");
  const start = md.indexOf("````\n") + 5;
  const end = md.lastIndexOf("\n````");
  assert.ok(start > 4 && end > start, "SETUP-PROMPT.md has one four-backtick block");
  assert.equal(`${md.slice(start, end)}\n`, read("setup-prompt.txt"));
});

test("the templates keep the placeholders the installer fills in", () => {
  assert.match(read("templates", "HANDOVER.md"), /<today>[\s\S]*## <stream name>/);
  assert.match(read("templates", "DECISIONS.md"), /- <today> \[<first stream>\]/);
  assert.ok(read("templates", "settings-single-model.json").includes('"<the model id from Step 1>"'));
  assert.ok(read("templates", "hooks-settings.json").includes("<home>/.claude/claude-code-handover/scripts/context-guard.mjs"));
});

test("the templates and skills use LF line endings, so what is written matches what is read", () => {
  for (const f of ["templates/CLAUDE.local.md", "templates/HANDOVER.md", "templates/DECISIONS.md", "templates/claude-token-rules.md", "skills/handover/SKILL.md", "skills/recall/SKILL.md"]) {
    assert.ok(!read(...f.split("/")).includes("\r"), `${f} has a carriage return`);
  }
});

// ---- what the code makes of them ------------------------------------------------------------

test("the personal rules are the template and nothing else", () => {
  assert.equal(personalRules(), read("templates", "CLAUDE.local.md"));
});

test("a new HANDOVER.md is the template with today and one section per stream", () => {
  const one = handoverFile(["main"], "2026-10-04");
  assert.equal(one, `${promptBlocks()[BLOCK.handover].replace("<today>", "2026-10-04").replace("<stream name>", "main")}\n`);
  const two = handoverFile(["backend", "frontend"], "2026-10-04");
  assert.deepEqual(two.split("\n").filter((l) => l.startsWith("## ")), ["## backend", "## frontend", "## Pointers (do not re-read the source documents)"]);
  assert.equal(two.split("\n").filter((l) => l.startsWith("- Current task:")).length, 2);
  assert.ok(two.endsWith("Past sessions: /recall <topic>.\n"));
});

test("a stream name is written as it is, even with $ patterns in it", () => {
  assert.ok(handoverFile(["a$&b"], "2026-10-04").includes("## a$&b\n"));
  assert.ok(decisionsFile("2026-10-04", "x$'y").includes("[x$'y]"));
});

test("the handover template splits into a head, one stream section and the Pointers block", () => {
  const p = handoverParts();
  assert.ok(p.head.startsWith("# Handover"));
  assert.ok(p.stream.startsWith("## <stream name>\n- Current task"));
  assert.ok(p.pointers.startsWith("## Pointers"));
});

test("DECISIONS.md carries today's date and the first stream", () => {
  assert.equal(decisionsFile("2026-10-04", "backend"), `${promptBlocks()[BLOCK.decisions].replace("<today>", "2026-10-04").replace("<first stream>", "backend")}\n`);
});

test("the rules card keeps the table that fits and drops the other", () => {
  const one = rulesCard(["opus"]);
  assert.ok(one.includes("## Effort by job (one model)") && !one.includes("(more than one model)"));
  const many = rulesCard(["opus", "sonnet"]);
  assert.ok(many.includes("(more than one model)") && !many.includes("## Effort by job (one model)"));
  for (const card of [one, many]) {
    assert.ok(card.startsWith("# Claude token rules\n\n## "));
    assert.ok(card.includes("\n\nNever max as a default."));
    assert.ok(card.endsWith("End: /handover. Done when HANDOVER.md shows today's date.\n"));
  }
});

test("the settings block comes from the two settings templates", () => {
  assert.deepEqual(settingsBlock(["opus", "sonnet"]), JSON.parse(read("templates", "settings-multi-model.json")));
  const one = settingsBlock(["fable"]);
  assert.deepEqual(one, { effortLevel: "medium", modelSettings: { "claude-fable-5-1": { effortLevel: "medium" } }, cleanupPeriodDays: 365 });
});

test("the hooks block has the three events in exec form with the home placeholder replaced", () => {
  const h = hooksBlock("C:/Users/me/.claude").hooks;
  assert.deepEqual(Object.keys(h), ["SessionStart", "UserPromptSubmit", "Stop"]);
  for (const ev of Object.keys(h)) {
    assert.deepEqual(h[ev], [{ hooks: [{ type: "command", command: "node", args: ["C:/Users/me/.claude/claude-code-handover/scripts/context-guard.mjs"], timeout: 10 }] }]);
  }
});
