// --models and --streams: how they are read, and what the person's models mean for the settings and the rules card.
import test from "node:test";
import assert from "node:assert/strict";
import { FAMILIES, choresFamily, effortForModel, familyOf, modelsLabel, parseModels, parseStreams, ruleRows } from "../src/models.mjs";
import { rulesCard, settingsBlock } from "../src/templates.mjs";
import { UsageError } from "../src/util.mjs";
import { combinationOf, expectedCard, modelCombinations } from "./helpers.mjs";

const keys = (text) => parseModels(text).keys;

test("--models is read leniently", () => {
  assert.deepEqual(keys("Opus + Sonnet"), ["opus", "sonnet"]);
  assert.deepEqual(keys("Opus only"), ["opus"]);
  assert.deepEqual(keys("Fable + Opus + Sonnet"), ["fable", "opus", "sonnet"]);
  assert.deepEqual(keys("sonnet,haiku"), ["sonnet", "haiku"]);
  assert.deepEqual(keys("  OPUS  and  sonnet "), ["opus", "sonnet"]);
  assert.deepEqual(keys("Opus 5.5 / Sonnet 5.5"), ["opus", "sonnet"]);
  assert.deepEqual(keys("claude-opus-5-5, claude-haiku-4-5-20251001"), ["opus", "haiku"]);
  assert.deepEqual(keys("Opus Opus opus"), ["opus"], "a model named twice counts once");
  assert.deepEqual(keys("Haiku; Opus"), ["haiku", "opus"]);
});

test("--models says what it did not recognise, and refuses a list with no known model", () => {
  assert.deepEqual(parseModels("Opus + gpt-5").ignored, ["gpt-5"]);
  assert.deepEqual(parseModels("Opus only").ignored, []);
  assert.throws(() => parseModels(""), UsageError);
  assert.throws(() => parseModels("   "), /is empty/);
  assert.throws(() => parseModels("gpt-5"), /names none of Opus, Sonnet, Fable or Haiku/);
  assert.throws(() => parseModels("Opus, no Sonnet"), /list the models you have/);
  assert.throws(() => parseModels("everything except Haiku"), UsageError);
});

test("model names read back in the order they were written", () => {
  assert.equal(modelsLabel(keys("sonnet,haiku")), "Sonnet + Haiku");
  assert.equal(modelsLabel(keys("Fable + Opus + Sonnet")), "Fable + Opus + Sonnet");
});

test("--streams is split on commas and semicolons, trimmed and de-duplicated", () => {
  assert.deepEqual(parseStreams("main"), ["main"]);
  assert.deepEqual(parseStreams("backend, frontend"), ["backend", "frontend"]);
  assert.deepEqual(parseStreams(" backend ;frontend,, Backend "), ["backend", "frontend"]);
  assert.deepEqual(parseStreams('"web app", api'), ["web app", "api"]);
  assert.deepEqual(parseStreams("a   b"), ["a b"]);
  assert.throws(() => parseStreams(""), /--streams is empty/);
  assert.throws(() => parseStreams(" , ; "), UsageError);
});

test("a model id or alias is placed in its family", () => {
  assert.equal(familyOf("claude-sonnet-5-5"), "sonnet");
  assert.equal(familyOf("claude-sonnet-4-6[1m]"), "sonnet");
  assert.equal(familyOf("claude-3-5-haiku-20241022"), "haiku");
  assert.equal(familyOf("OPUS"), "opus");
  assert.equal(familyOf("claude-fable-5-1"), "fable");
  assert.equal(familyOf("default"), "other");
  assert.equal(familyOf("opusplan"), "opus");
});

test("the model ids of a one-model setup", () => {
  assert.equal(FAMILIES.opus.id, "claude-opus-5-5");
  assert.equal(FAMILIES.sonnet.id, "claude-sonnet-5-5");
  assert.equal(FAMILIES.fable.id, "claude-fable-5-1");
  assert.equal(FAMILIES.haiku.id, "claude-haiku-4-5-20251001");
});

// ---- the settings block for each mix --------------------------------------------------------

const SONNET = { "claude-sonnet-5-5": { effortLevel: "medium" } };
const MIXES = [
  ["Opus + Sonnet", { effortLevel: "high", modelSettings: SONNET, env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" }, cleanupPeriodDays: 365 }],
  ["Fable + Opus + Sonnet", { effortLevel: "high", modelSettings: SONNET, env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" }, cleanupPeriodDays: 365 }],
  ["Sonnet + Haiku", { effortLevel: "high", modelSettings: SONNET, env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" }, cleanupPeriodDays: 365 }],
  ["Opus + Haiku", { effortLevel: "high", env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" }, cleanupPeriodDays: 365 }],
  ["Fable + Haiku", { effortLevel: "high", env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" }, cleanupPeriodDays: 365 }],
  ["Opus + Fable", { effortLevel: "high", cleanupPeriodDays: 365 }],
  ["Sonnet + Fable", { effortLevel: "high", modelSettings: SONNET, env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" }, cleanupPeriodDays: 365 }],
  ["Fable + Opus + Haiku", { effortLevel: "high", env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" }, cleanupPeriodDays: 365 }],
  ["Opus + Sonnet + Haiku", { effortLevel: "high", modelSettings: SONNET, env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" }, cleanupPeriodDays: 365 }],
  ["Fable + Sonnet + Haiku", { effortLevel: "high", modelSettings: SONNET, env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" }, cleanupPeriodDays: 365 }],
  ["Fable + Opus + Sonnet + Haiku", { effortLevel: "high", modelSettings: SONNET, env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" }, cleanupPeriodDays: 365 }],
  ["Opus only", { effortLevel: "medium", modelSettings: { "claude-opus-5-5": { effortLevel: "medium" } }, cleanupPeriodDays: 365 }],
  ["Sonnet only", { effortLevel: "medium", modelSettings: SONNET, cleanupPeriodDays: 365 }],
  ["Fable only", { effortLevel: "medium", modelSettings: { "claude-fable-5-1": { effortLevel: "medium" } }, cleanupPeriodDays: 365 }],
  ["Haiku only", { effortLevel: "medium", modelSettings: { "claude-haiku-4-5-20251001": { effortLevel: "medium" } }, cleanupPeriodDays: 365 }],
];
for (const [text, expected] of MIXES) {
  test(`settings block for "${text}"`, () => assert.deepEqual(settingsBlock(keys(text)), expected));
}

test("the lists above cover every combination of the four models, 15 in all", () => {
  assert.deepEqual([...new Set(MIXES.map(([text]) => combinationOf(keys(text))))].sort(), modelCombinations());
});

test("no subagent model for one model; haiku only when there is Haiku but no Sonnet", () => {
  for (const [text, block] of MIXES) {
    const sub = block.env && block.env.CLAUDE_CODE_SUBAGENT_MODEL;
    const k = keys(text);
    if (k.length === 1) assert.equal(sub, undefined, text);
    else if (k.includes("sonnet")) assert.equal(sub, "sonnet", text);
    else if (k.includes("haiku")) assert.equal(sub, "haiku", text);
    else assert.equal(sub, undefined, text);
  }
});

// ---- which per-model entries get which level ------------------------------------------------

test("the chores model is Sonnet, or Haiku when there is no Sonnet", () => {
  assert.equal(choresFamily(["opus", "sonnet"]), "sonnet");
  assert.equal(choresFamily(["opus", "haiku"]), "haiku");
  assert.equal(choresFamily(["haiku", "sonnet"]), "sonnet");
  assert.equal(choresFamily(["opus", "fable"]), null);
});

test("with one model every entry is medium; with more, the chores model is medium and the rest high", () => {
  assert.equal(effortForModel(["opus"], "claude-opus-4-6"), "medium");
  assert.equal(effortForModel(["opus"], "claude-sonnet-5-5"), "medium");
  assert.equal(effortForModel(["opus", "sonnet"], "claude-sonnet-5-5"), "medium");
  assert.equal(effortForModel(["opus", "sonnet"], "claude-opus-5-5"), "high");
  assert.equal(effortForModel(["opus", "sonnet"], "claude-haiku-4-5"), "high");
  assert.equal(effortForModel(["opus", "sonnet"], "default"), "high");
  assert.equal(effortForModel(["opus", "haiku"], "claude-haiku-4-5-20251001"), "medium");
  assert.equal(effortForModel(["opus", "haiku"], "claude-sonnet-5-5"), "high");
  assert.equal(effortForModel(["opus", "fable"], "claude-opus-5-5"), "high", "no chores model: everything is high");
});

// ---- the rules card names the person's models -----------------------------------------------

const CARDS = [
  ["Opus + Sonnet", { first: "Sonnet", second: "Opus", third: "Opus" }],
  ["Fable + Opus + Sonnet", { first: "Sonnet", second: "Opus", third: "Fable" }],
  ["Opus + Haiku", { first: "Haiku", second: "Opus", third: "Opus" }],
  ["Fable + Opus + Haiku", { first: "Haiku", second: "Opus", third: "Fable" }],
  ["Sonnet + Haiku", { first: "Sonnet", second: "Sonnet", third: "Sonnet" }],
  ["Fable + Sonnet", { first: "Sonnet", second: "Sonnet", third: "Fable" }],
  ["Opus + Fable", { first: "Opus", second: "Opus", third: "Fable" }],
  ["Fable + Haiku", { first: "Haiku", second: "Haiku", third: "Fable" }],
  ["Opus + Sonnet + Haiku", { first: "Sonnet", second: "Opus", third: "Opus" }],
  ["Fable + Sonnet + Haiku", { first: "Sonnet", second: "Sonnet", third: "Fable" }],
  ["Fable + Opus + Sonnet + Haiku", { first: "Sonnet", second: "Opus", third: "Fable" }],
];
for (const [text, names] of CARDS) {
  // The prompt's rule: the first row is the model that does the chores (Sonnet, else Haiku, else the cheapest listed), the
  // second row is Opus (else the strongest listed that is not Fable), the third row is the strongest listed.
  test(`rules card for "${text}": chores model first, Opus or the strongest but Fable second, strongest third`, () => {
    assert.deepEqual(ruleRows(keys(text)), { chores: names.first, workhorse: names.second, strongest: names.third });
    assert.equal(rulesCard(keys(text)), expectedCard({ multi: true, ...names }));
  });
}

test("the cards above cover every combination of more than one model, 11 in all", () => {
  assert.deepEqual([...new Set(CARDS.map(([text]) => combinationOf(keys(text))))].sort(), modelCombinations().filter((c) => c.includes("+")));
});

test("rules card for one model is the one-model table of the prompt, whichever model it is", () => {
  for (const m of ["Opus", "Sonnet", "Fable", "Haiku"]) assert.equal(rulesCard(keys(`${m} only`)), expectedCard({ multi: false }));
});
