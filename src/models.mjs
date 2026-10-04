// Which models the person has, and what that means for the settings and the rules card.
// A model list is kept as family keys ("opus", "sonnet", "fable", "haiku") in the order the person wrote them.
import { UsageError } from "./util.mjs";

export const FAMILIES = {
  opus: { name: "Opus", id: "claude-opus-5-5", tier: 3 },
  sonnet: { name: "Sonnet", id: "claude-sonnet-5-5", tier: 2 },
  fable: { name: "Fable", id: "claude-fable-5-1", tier: 4 },
  haiku: { name: "Haiku", id: "claude-haiku-4-5-20251001", tier: 1 },
};
export const DEFAULT_MODELS = "Opus + Sonnet";
export const DEFAULT_STREAMS = "main";

const NAMES = /opus|sonnet|fable|haiku/gi;
const NOISE = /^(only|just|models?|my|i|have|the|a|an|all)$/i;

/**
 * "Opus + Sonnet", "Opus only", "Fable + Opus + Sonnet", "sonnet,haiku", "claude-opus-5-5 and Haiku" ...
 * Returns { keys, ignored }: the families found (no repeats, in order) and the words that were not recognised.
 */
export function parseModels(text) {
  const raw = String(text ?? "").trim();
  if (!raw) throw new UsageError('--models is empty. Name the models you have, for example "Opus + Sonnet" or "Opus only".');
  if (/\b(no|not|without|except|excluding)\b/i.test(raw)) {
    throw new UsageError(`--models "${raw}": list the models you have, not the ones you lack. For example "Opus + Haiku".`);
  }
  const keys = [];
  for (const m of raw.matchAll(NAMES)) if (!keys.includes(m[0].toLowerCase())) keys.push(m[0].toLowerCase());
  if (!keys.length) {
    throw new UsageError(`--models "${raw}" names none of Opus, Sonnet, Fable or Haiku. For example "Opus + Sonnet", "Opus only" or "Fable + Opus + Sonnet".`);
  }
  const ignored = raw
    .split(/[+,&/|;]|\band\b|\bplus\b|\bwith\b/i)
    .map((t) => t.trim())
    .filter((t) => t && !NOISE.test(t) && !/opus|sonnet|fable|haiku/i.test(t));
  return { keys, ignored };
}

/** "Opus + Sonnet" */
export const modelsLabel = (keys) => keys.map((k) => FAMILIES[k].name).join(" + ");

/** "backend, frontend" -> ["backend", "frontend"]. Commas and semicolons separate; repeats (any case) are dropped. */
export function parseStreams(text) {
  const names = [];
  for (const part of String(text ?? "").split(/[,;\n]/)) {
    const s = part.trim().replace(/^["']+|["']+$/g, "").trim().replace(/\s+/g, " ");
    if (s && !names.some((n) => n.toLowerCase() === s.toLowerCase())) names.push(s);
  }
  if (!names.length) throw new UsageError('--streams is empty. Name at least one work stream, for example "main" or "backend, frontend".');
  return names;
}

/** The family of a model id or alias ("claude-sonnet-4-6[1m]" is sonnet), or "other". */
export function familyOf(id) {
  const s = String(id).toLowerCase();
  for (const k of ["sonnet", "haiku", "opus", "fable"]) if (s.includes(k)) return k;
  return "other";
}

/** The model that does the chores: Sonnet, or Haiku when there is no Sonnet, or none. */
export const choresFamily = (keys) => (keys.includes("sonnet") ? "sonnet" : keys.includes("haiku") ? "haiku" : null);

/**
 * The effort a saved per-model entry should have, because it outranks the top-level effortLevel:
 * with one model everything is medium; with more, the chores model is medium and every other model high.
 */
export function effortForModel(keys, id) {
  if (keys.length === 1) return "medium";
  const chores = choresFamily(keys);
  return chores && familyOf(id) === chores ? "medium" : "high";
}

/**
 * The three model names of the rules card's table for more than one model, taken from the person's list:
 * the chores model (Sonnet, else Haiku, else the cheapest they have), the everyday coding model (Opus,
 * else the strongest that is not Fable) and the strongest model they have.
 */
export function ruleRows(keys) {
  const byTier = [...keys].sort((a, b) => FAMILIES[a].tier - FAMILIES[b].tier);
  const strongest = byTier[byTier.length - 1];
  const chores = choresFamily(keys) || byTier[0];
  const workhorse = keys.includes("opus") ? "opus" : byTier.filter((k) => k !== "fable").pop() || strongest;
  return { chores: FAMILIES[chores].name, workhorse: FAMILIES[workhorse].name, strongest: FAMILIES[strongest].name };
}
