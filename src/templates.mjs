// The content of every file the setup writes. templates/ and skills/ are the single source: the code here
// only fills in the placeholders (<today>, <stream name>, <first stream>, <the model id from Step 1>, <home>)
// and picks the parts that fit the person's models. test/templates.test.mjs holds the templates to the
// code blocks of setup-prompt.txt, which is authoritative.
import fs from "node:fs";
import path from "node:path";
import { ROOT, isObject, toLF } from "./util.mjs";
import { FAMILIES, ruleRows } from "./models.mjs";

const read = (...rel) => toLF(fs.readFileSync(path.join(ROOT, ...rel), "utf8"));

export const personalRules = () => read("templates", "CLAUDE.local.md");
export const handoverSkill = () => read("skills", "handover", "SKILL.md");
export const recallSkill = () => read("skills", "recall", "SKILL.md");

/** First line of the personal rules: the heading that tells whether a file already has our block. */
export const PERSONAL_RULES_HEADING = "# Personal working rules (not committed)";
/** The four files that stay out of the repository. */
export const PERSONAL_FILES = ["CLAUDE.local.md", "HANDOVER.md", "DECISIONS.md", "claude-token-rules.md"];

// ---- HANDOVER.md and DECISIONS.md -----------------------------------------------------------

const STREAM_HEADING = "## <stream name>";
const trimEnd = (lines) => { while (lines.length && lines[lines.length - 1] === "") lines.pop(); return lines; };

/** The template split into its three parts: the title and Updated line, one stream section, the Pointers block. */
export function handoverParts() {
  const lines = read("templates", "HANDOVER.md").split("\n");
  const s = lines.indexOf(STREAM_HEADING);
  const p = lines.findIndex((l) => l.startsWith("## Pointers"));
  if (s < 0 || p < s) throw new Error("templates/HANDOVER.md no longer has a '## <stream name>' section followed by a '## Pointers' block.");
  return {
    head: trimEnd(lines.slice(0, s)).join("\n"),
    stream: trimEnd(lines.slice(s, p)).join("\n"),
    pointers: trimEnd(lines.slice(p)).join("\n"),
  };
}
export const streamSection = (parts, name) => parts.stream.replace(STREAM_HEADING, () => `## ${name}`);

/** A new HANDOVER.md with one section per stream. */
export function handoverFile(streams, today) {
  const parts = handoverParts();
  const head = parts.head.replace("<today>", () => today);
  return [head, ...streams.map((n) => streamSection(parts, n)), parts.pointers].join("\n\n") + "\n";
}

export const decisionsFile = (today, firstStream) =>
  read("templates", "DECISIONS.md").replace("<today>", () => today).replace("<first stream>", () => firstStream);

// ---- the rules card -------------------------------------------------------------------------

/**
 * claude-token-rules.md with the table that fits the person's models and the other one dropped.
 * With more than one model the three model names come from their list (see ruleRows).
 */
export function rulesCard(keys) {
  const lines = read("templates", "claude-token-rules.md").split("\n");
  const multi = lines.indexOf("## Model and effort by job (more than one model)");
  const one = lines.indexOf("## Effort by job (one model)");
  const tail = lines.findIndex((l) => l.startsWith("Never max as a default"));
  if (multi < 0 || one < multi || tail < one) throw new Error("templates/claude-token-rules.md no longer has the two tables in the expected order.");
  const head = lines.slice(0, multi);
  const rest = lines.slice(tail);
  if (keys.length === 1) return [...head, ...lines.slice(one, tail), ...rest].join("\n");
  const names = ruleRows(keys);
  const section = lines.slice(multi, one).map((l) => {
    if (l.startsWith("| Summaries, ticket updates")) return l.replace("| Sonnet |", () => `| ${names.chores} |`);
    if (l.startsWith("| Writing code")) return l.replace("| Opus |", () => `| ${names.workhorse} |`);
    if (l.startsWith("| Whole-repo audit")) return l.replace("| Fable if available, else Opus |", () => `| ${names.strongest} |`);
    return l;
  });
  return [...head, ...section, ...rest].join("\n");
}

// ---- settings -------------------------------------------------------------------------------

/**
 * The settings keys to merge for these models, from the two settings templates:
 * { effortLevel, modelSettings?, env?, cleanupPeriodDays }.
 * One model: effort medium, that model's entry, no subagent model. More than one: effort high, a Sonnet entry
 * (dropped when there is no Sonnet), subagent model sonnet, or haiku when there is Haiku but no Sonnet, else none.
 */
export function settingsBlock(keys) {
  if (keys.length === 1) {
    const block = JSON.parse(read("templates", "settings-single-model.json"));
    const [placeholder] = Object.keys(block.modelSettings);
    block.modelSettings = { [FAMILIES[keys[0]].id]: block.modelSettings[placeholder] };
    return block;
  }
  const block = JSON.parse(read("templates", "settings-multi-model.json"));
  if (!keys.includes("sonnet")) {
    delete block.modelSettings[FAMILIES.sonnet.id];
    if (keys.includes("haiku")) block.env.CLAUDE_CODE_SUBAGENT_MODEL = "haiku";
    else delete block.env;
  }
  if (!Object.keys(block.modelSettings).length) delete block.modelSettings;
  return block;
}

const mapStrings = (v, fn) =>
  typeof v === "string" ? fn(v) : Array.isArray(v) ? v.map((x) => mapStrings(x, fn)) : isObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)])) : v;

/** The hooks block with <home>/.claude replaced by the config folder (forward slashes). */
export const hooksBlock = (cfgSlash) => mapStrings(JSON.parse(read("templates", "hooks-settings.json")), (s) => s.split("<home>/.claude").join(cfgSlash));
