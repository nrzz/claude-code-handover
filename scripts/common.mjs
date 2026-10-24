// What the scripts share: where Claude Code keeps its config folder and transcripts, how a setting read from the
// environment is checked, the price list, how a request's token counts are summed, and the text of a message.
// Node built-ins only; init copies this file with the scripts, so they never need anything outside their folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Claude Code's config folder: $CLAUDE_CONFIG_DIR when it is set and not blank, else ~/.claude. */
export function configDir(env = process.env) {
  const custom = (env.CLAUDE_CONFIG_DIR || "").trim();
  return custom ? path.resolve(custom) : path.join(os.homedir(), ".claude");
}

/** The transcripts folder the reports read: --root, else HANDOVER_PROJECTS_DIR, else <config folder>/projects. */
export function projectsRoot(argv = process.argv, env = process.env) {
  const i = argv.indexOf("--root");
  if (i > -1 && argv[i + 1]) return argv[i + 1];
  return env.HANDOVER_PROJECTS_DIR || path.join(configDir(env), "projects");
}

/**
 * A number read from a setting. A value that is not a number, or is below `min`, counts as unset and gives `dflt`,
 * so a typo in a setting falls back to the default instead of turning every comparison false.
 */
export function numberSetting(value, dflt, min = 0) {
  if (value === undefined || value === null || String(value).trim() === "") return dflt;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : dflt;
}
/** A setting that must be above zero. */
export const positiveSetting = (value, dflt) => numberSetting(value, dflt, Number.MIN_VALUE);

/** Every .jsonl file under `dir`, recursively. */
export function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

/** The text parts of a message's content: a string, or the text blocks of a list (tool results are not text). */
export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n");
}

// ---- prices ---------------------------------------------------------------------------------

/** When the list below was read from the pricing page. Dollar figures in the reports are estimates at these list prices. */
export const PRICE_DATE = "2026-10-01";
/** $/MTok: [input, output, cache read, cache write 5 minutes, cache write 1 hour], by model id prefix. */
export const PRICE = {
  "claude-fable-5-1": [10, 50, 0.25, 12.5, 20],
  "claude-fable-5": [10, 50, 1, 12.5, 20],
  "claude-opus-5-5": [4, 20, 0.2, 5, 8],
  "claude-opus-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-8": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-7": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-6": [5, 25, 0.5, 6.25, 10],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5, 4],
  "claude-sonnet-5": [2, 10, 0.2, 2.5, 4],
  "claude-sonnet-4-6": [3, 15, 0.3, 3.75, 6],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25, 2],
};
/** The newest entry of each family: the price a model id the list does not know is weighed at. */
const FAMILY_PRICE = { fable: "claude-fable-5-1", opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-4-5" };
const DEFAULT_PRICE = [5, 25, 0.5, 6.25, 10];

/**
 * The price row for a model id: the exact id, else the longest prefix in the list, else the newest price of its
 * family (a "claude-opus-6" is weighed as the newest Opus), else a middle-of-the-road default.
 */
export function priceFor(model) {
  const id = String(model || "").toLowerCase();
  if (PRICE[id]) return PRICE[id];
  const prefix = Object.keys(PRICE).filter((p) => id.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  if (prefix) return PRICE[prefix];
  const family = Object.keys(FAMILY_PRICE).find((f) => id.includes(f));
  return family ? PRICE[FAMILY_PRICE[family]] : DEFAULT_PRICE;
}

// ---- token counts ---------------------------------------------------------------------------

/**
 * The token counts of one request, summed over its iterations (a request that ran tools in a loop reports one
 * usage per iteration). `ctx` is the context size: the largest single iteration, which is what the model saw.
 */
export function tokensOf(usage) {
  const its = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations : [usage];
  let inp = 0, cw5 = 0, cw1 = 0, cr = 0, out = 0, ctx = 0;
  for (const it of its) {
    const cc = it.cache_creation || {};
    const w5 = cc.ephemeral_5m_input_tokens ?? (it.cache_creation_input_tokens || 0);
    const w1 = cc.ephemeral_1h_input_tokens || 0;
    inp += it.input_tokens || 0; cr += it.cache_read_input_tokens || 0; out += it.output_tokens || 0; cw5 += w5; cw1 += w1;
    ctx = Math.max(ctx, (it.input_tokens || 0) + (it.cache_read_input_tokens || 0) + w5 + w1);
  }
  return { inp, cw5, cw1, cr, out, cw: cw5 + cw1, ctx };
}

/** The estimated weight of one request in dollars at list prices. */
export function costOf(model, t) {
  const [pi, po, pr, pw5, pw1] = priceFor(model);
  return (t.inp * pi + t.out * po + t.cr * pr + t.cw5 * pw5 + t.cw1 * pw1) / 1e6;
}
