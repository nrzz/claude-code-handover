// The project-level steps of init: what is in the folder (Step 1) and the files written there
// (Step 2 personal rules, Step 3 handover and decisions, Step 5 .gitignore, Step 7 rules card, and the git check).
// Nothing here ever modifies an existing CLAUDE.md or AGENTS.md.
import path from "node:path";
import { appendBlock, appendLines, bomOf, eolOf, exists, isFile, peekText, readText, samePath, stripBom, toLF } from "./util.mjs";
import { findGitRoot, trackedAmong, untrackedAmong } from "./git.mjs";
import { FAMILIES, modelsLabel } from "./models.mjs";
import {
  PERSONAL_FILES, PERSONAL_RULES_HEADING, decisionsFile, handoverFile, handoverParts, personalRules, rulesCard, streamSection,
} from "./templates.mjs";

// ---- Step 1: the ground ---------------------------------------------------------------------

/** What the project folder is: inside a git repository or not, which CLAUDE.md files exist, whether it has an AGENTS.md. */
export function inspectProject(dir, env) {
  const gitRoot = findGitRoot(dir, env);
  const claudeMdHere = [path.join(dir, "CLAUDE.md"), path.join(dir, ".claude", "CLAUDE.md")].find(isFile) || null;
  let claudeMdAbove = null;
  for (let cur = path.dirname(dir); ; cur = path.dirname(cur)) {
    const f = path.join(cur, "CLAUDE.md");
    if (isFile(f)) { claudeMdAbove = f; break; }
    if (path.dirname(cur) === cur) break;
  }
  return { dir, gitRoot, isGit: !!gitRoot, claudeMdHere, claudeMdAbove, agentsMd: isFile(path.join(dir, "AGENTS.md")) };
}

/** The first facts of the report. */
export function describeProject(c, info) {
  const { R } = c;
  R.fact("Project folder", c.dir);
  R.fact("Git repository", info.isGit ? (samePath(info.gitRoot, c.dir) ? "yes" : `yes (the repository is at ${info.gitRoot})`) : "no");
  R.fact("CLAUDE.md", info.claudeMdHere ? `${info.claudeMdHere} (never modified)` : info.claudeMdAbove ? `none here; one in a parent folder: ${info.claudeMdAbove}` : "none here or in a parent folder");
  R.fact("AGENTS.md", info.agentsMd ? `found here (never modified)` : "not found here");
}

// ---- Step 2: the personal rules -------------------------------------------------------------

/** "exact" when the LF text holds our whole rules block, "edited" when it holds our heading, else null. A byte order mark in front is ignored. */
export function findBlock(text, block = personalRules()) {
  const body = stripBom(text);
  if (body.includes(block.trimEnd())) return "exact";
  if (body.split("\n").some((l) => l.trimEnd() === PERSONAL_RULES_HEADING)) return "edited";
  return null;
}

/**
 * Our rules go in CLAUDE.local.md; in CLAUDE.md when the folder is not a git repository and has no CLAUDE.md.
 * A file that exists keeps its content and gets the block after a blank line; one that already has the block is left.
 * With an AGENTS.md and no CLAUDE.md, @AGENTS.md is the first line so AGENTS.md keeps loading.
 * Returns the path of the file that holds our rules.
 */
export function personalRulesStep(c, info) {
  const { R, w } = c;
  const block = personalRules();
  const local = path.join(c.dir, "CLAUDE.local.md");
  const md = path.join(c.dir, "CLAUDE.md");
  const localPeek = peekText(local); // only looked at for now: our block is plain ASCII, so a lossy decode finds it
  const mdText = peekText(md); // only looked at: an existing CLAUDE.md is never modified
  const inLocal = localPeek === null ? null : findBlock(toLF(localPeek), block);
  if (inLocal) {
    R.file("unchanged", local, inLocal === "exact" ? "our rules block is already in it" : "it already has our rules block (edited by you, so left as it is)");
    return local;
  }
  const inMd = mdText === null ? null : findBlock(toLF(mdText), block);
  if (inMd) {
    R.file("unchanged", md, "our rules block is already in it (it was put there while this folder was not a git repository)");
    return md;
  }
  const asMd = !info.isGit && !info.claudeMdHere;
  const file = asMd ? md : local;
  const existing = asMd ? null : readText(local); // it will be written back, so it must be UTF-8 text
  const importAgents = info.agentsMd && !info.claudeMdHere;
  const agentsNote = importAgents ? "; its first line imports AGENTS.md so that file keeps loading" : "";

  if (existing === null || !existing.trim()) {
    w.write(file, (existing === null ? "" : bomOf(existing)) + (importAgents ? "@AGENTS.md\n\n" : "") + block);
    const why = asMd
      ? "this folder is not a git repository and has no CLAUDE.md, so the rules go in CLAUDE.md"
      : info.isGit ? "your personal rules, loaded by every session in this folder; .gitignore keeps the file out of git" : "your personal rules, loaded by every session in this folder";
    R.file("created", file, existing === null ? why + agentsNote : "the file existed but was empty; " + why + agentsNote);
    return file;
  }
  let out = appendBlock(existing, block);
  let note = "your own text is untouched; our rules were added after a blank line";
  if (importAgents && !/^@AGENTS\.md[ \t]*$/m.test(toLF(stripBom(existing)))) {
    const eol = eolOf(existing);
    out = `${bomOf(existing)}@AGENTS.md${eol}${eol}${stripBom(out)}`; // a byte order mark stays at the very start
    note += "; @AGENTS.md is now its first line so AGENTS.md keeps loading";
  }
  w.write(file, out);
  R.file("appended", file, note);
  return file;
}

// ---- Step 3: HANDOVER.md and DECISIONS.md ---------------------------------------------------

const POINTERS = /^##\s+Pointers\b/i;

/**
 * One section per stream. An existing HANDOVER.md keeps everything, and only the stream sections and the Pointers
 * block that are missing are appended to it, as Step 3 of the setup prompt says.
 */
export function handoverStep(c) {
  const { R, w } = c;
  const file = path.join(c.dir, "HANDOVER.md");
  const text = readText(file);
  if (text === null) {
    w.write(file, handoverFile(c.streams, c.today));
    R.file("created", file, `${c.streams.length === 1 ? "one section" : `${c.streams.length} sections`}: ${c.streams.join(", ")}; the next session loads it by itself`);
    return;
  }
  const lines = toLF(stripBom(text)).split("\n"); // a byte order mark in front of the first line is not part of it
  const have = new Set(lines.map((l) => /^##\s+(.+?)\s*$/.exec(l)).filter(Boolean).map((m) => m[1].toLowerCase()));
  const missing = c.streams.filter((s) => !have.has(s.toLowerCase()));
  const hasPointers = lines.some((l) => POINTERS.test(l));
  if (!missing.length && hasPointers) {
    R.file("unchanged", file, `it already has ${c.streams.length === 1 ? "the stream section" : "every stream section"} and the Pointers block`);
    return;
  }
  const parts = handoverParts();
  const added = [...missing.map((s) => streamSection(parts, s)), ...(hasPointers ? [] : [parts.pointers])];
  const what = [missing.length ? `${missing.length === 1 ? "the stream section" : "the stream sections"} ${missing.join(", ")}` : "", hasPointers ? "" : "the Pointers block"].filter(Boolean).join(" and ");
  w.write(file, appendBlock(text, `${added.join("\n\n")}\n`));
  R.file("appended", file, `everything in it is kept; added ${what} at the end`);
}

/** Created with today's date and the first stream; an existing DECISIONS.md is left exactly as it is. */
export function decisionsStep(c) {
  const file = path.join(c.dir, "DECISIONS.md");
  if (exists(file)) {
    c.R.file("kept", file, "it already exists; left exactly as it is");
    return;
  }
  c.w.write(file, decisionsFile(c.today, c.streams[0]));
  c.R.file("created", file, "the dated log; the first line says the workflow was set up");
}

// ---- Step 5: .gitignore ---------------------------------------------------------------------

const asIgnoreName = (line) => line.trim().replace(/^\/+/, "").replace(/^\*\*\//, "");

/** In a git repository, .gitignore lists the four personal files: created when missing, otherwise only the missing lines are appended. */
export function gitignoreStep(c, info) {
  const { R, w } = c;
  const file = path.join(c.dir, ".gitignore");
  if (!info.isGit) {
    R.file("skipped", file, "this folder is not a git repository, so there is nothing to ignore");
    return;
  }
  const text = readText(file);
  const listed = new Set(text === null ? [] : toLF(stripBom(text)).split("\n").map(asIgnoreName));
  const missing = PERSONAL_FILES.filter((n) => !listed.has(n));
  if (!missing.length) {
    R.file("unchanged", file, "it already lists the four personal files");
    return;
  }
  if (text === null) {
    w.write(file, `${missing.join("\n")}\n`);
    R.file("created", file, `lists ${missing.join(", ")}`);
  } else {
    w.write(file, appendLines(text, missing));
    R.file("appended", file, `only the missing lines were added: ${missing.join(", ")}`);
  }
}

// ---- Step 7: the rules card -----------------------------------------------------------------

/** Every card this version writes: one per combination of the four families (their order does not change the card). */
function generatedCards() {
  const families = Object.keys(FAMILIES);
  const cards = new Set();
  for (let mask = 1; mask < 1 << families.length; mask++) cards.add(rulesCard(families.filter((_, i) => mask & (1 << i))));
  return cards;
}

/**
 * claude-token-rules.md with the table for the person's models. It is a generated card, so an existing copy is replaced.
 * A copy that is not one of the cards this version writes (it may hold the person's edits, and the card is gitignored)
 * is first kept next to it as claude-token-rules.md.bak-<date>, the naming of the skill backups.
 */
export function rulesCardStep(c) {
  const { R, w } = c;
  const file = path.join(c.dir, "claude-token-rules.md");
  const card = rulesCard(c.keys);
  const text = peekText(file); // only compared: a copy that is not one of ours is kept as a backup, then replaced
  const label = `the table for ${c.keys.length === 1 ? "one model" : modelsLabel(c.keys)}`;
  if (text === null) {
    w.write(file, card);
    R.file("created", file, label);
  } else if (toLF(text) === card) {
    R.file("unchanged", file, `${label}; it is already in place`);
  } else {
    // The card for another model list (the person changed --models) is ours, so it is replaced without a backup.
    if (!generatedCards().has(toLF(text))) R.file("backup", w.backup(file, c.now), "your previous copy of the card, which differed");
    w.write(file, card);
    R.file("replaced", file, `${label}; it is a generated card, so a copy that differed is replaced`);
  }
}

// ---- Step 5, after Step 7: what git says about the four files --------------------------------

/** git status must not show any of the four files as untracked; a file git already tracks gets the command to untrack it. The index is never changed. */
export function gitCheckStep(c, info) {
  const { R } = c;
  if (!info.isGit) {
    R.git.push("This folder is not a git repository, so the .gitignore step was skipped and there is nothing to check.");
    return;
  }
  const names = PERSONAL_FILES.filter((n) => isFile(path.join(c.dir, n)));
  if (!names.length) {
    R.git.push("None of the four files exists yet (a dry run), so there is nothing to check.");
    return;
  }
  const tracked = trackedAmong(c.dir, names, c.env);
  if (tracked.error) {
    R.git.push(`Could not check: ${tracked.error}. Once git works, run "git status" here and make sure none of ${PERSONAL_FILES.join(", ")} shows as untracked.`);
    return;
  }
  R.gitInfo.checked = true;
  R.gitInfo.tracked = tracked.tracked;
  for (const n of tracked.tracked) {
    R.git.push(`${n} is already tracked by git, so .gitignore cannot hide it. I did not change the index. To stop tracking it and keep the file, run this in ${c.dir}:`);
    R.git.push(`    git rm --cached ${n}`);
  }
  if (c.dryRun) {
    R.git.push("Dry run: git status is not checked, because the files are not written.");
    return;
  }
  const status = untrackedAmong(c.dir, names.filter((n) => !tracked.tracked.includes(n)), c.env);
  if (status.error) { R.git.push(`Could not ask git which of the four files are untracked: ${status.error}.`); return; }
  R.gitInfo.untracked = status.untracked;
  if (status.untracked.length) {
    R.git.push(`git status still shows ${status.untracked.join(", ")} as untracked, so .gitignore is not hiding ${status.untracked.length === 1 ? "it" : "them"}. ${R.problems.length ? "See Problems below, and check" : "Check"} .gitignore for a line that un-ignores ${status.untracked.length === 1 ? "it" : "them"} (one that starts with "!").`);
  } else {
    const hidden = names.filter((n) => !tracked.tracked.includes(n));
    if (hidden.length) R.git.push(`git status shows none of the four files as untracked (${hidden.join(", ")} are ignored).`);
  }
}
