// What a run did, kept as data while it runs and printed as plain text at the end.
// Every file the run touched or deliberately left alone is one record; tests read the records, people read the text.

/** past tense, tense of a dry run */
const WORDS = {
  created: ["created", "would create"],
  appended: ["appended", "would append"],
  updated: ["updated", "would update"],
  replaced: ["replaced", "would replace"],
  backup: ["backed up", "would back up"],
  copied: ["copied", "would copy"],
  removed: ["removed", "would remove"],
  unchanged: ["unchanged", "unchanged"],
  kept: ["kept", "kept"],
  skipped: ["skipped", "skipped"],
};
/** Actions that change something on disk. */
const CHANGING = new Set(["created", "appended", "updated", "replaced", "backup", "copied", "removed"]);
/** The longest word ("would back up") plus a space. */
const WORD_WIDTH = 14;
/** Prose is broken at this many columns; a path or a command is never broken. */
const WIDTH = 100;

const SETTING_WORDS = {
  set: ["set", "would set"],
  adjusted: ["adjusted", "would adjust"],
  added: ["added", "would add"],
  updated: ["updated", "would update"],
  removed: ["removed", "would remove"],
  unchanged: ["unchanged", "unchanged"],
  kept: ["kept", "kept"],
  skipped: ["skipped", "skipped"],
};

/** One line: a line break, with the white space around it, becomes a single space. Other spaces stay, so a path keeps its spaces. */
const oneLine = (s) => String(s).replace(/\s*[\r\n]+\s*/g, " ").trim();

/** `text` broken at spaces into lines of at most `width` characters; a word longer than that stays whole. */
export function wrap(text, width) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** A line with a hanging indent: "  1. text" or "  ! text" continue under the text, not under the marker. */
function wrapHanging(line) {
  const [, lead, body] = /^(\s*(?:\d+\.\s+|!\s+)?)([\s\S]*)$/.exec(line);
  return wrap(body, WIDTH - lead.length).map((l, i) => (i === 0 ? lead : " ".repeat(lead.length)) + l);
}

/** Stands for a space inside a path while a line is wrapped; it is not white space, so wrap leaves it in its word. */
const HOLD = String.fromCharCode(1);

export class Report {
  constructor(command, { dryRun = false } = {}) {
    this.command = command;
    this.dryRun = dryRun;
    this.kept = [];       // paths whose spaces must survive wrapping
    this.ground = [];     // [label, value]
    this.files = [];      // { action, file, note }
    this.settingsFile = "";
    this.settings = [];   // { key, action, detail }
    this.git = [];        // lines
    this.gitInfo = { checked: false, tracked: [], untracked: [] };
    this.guard = [];      // lines
    this.notes = [];      // lines after the file list
    this.problems = [];   // things that failed or could not be done: the exit code is 1
    this.closing = [];    // the four lines to keep, and similar
  }
  // Text that comes from an error message (a JSON parse error quotes the file, line breaks included) is
  // flattened to one line, so a line break in it can never break the layout of the report.
  fact(label, value) { this.ground.push([label, oneLine(value)]); }
  file(action, file, note = "") { this.files.push({ action, file, note: oneLine(note) }); }
  setting(key, action, detail = "") { this.settings.push({ key, action, detail: oneLine(detail) }); }
  problem(text) { this.problems.push(oneLine(text)); }
  /** True when the run wrote, or in a dry run would write, anything. */
  get changed() { return this.files.some((f) => CHANGING.has(f.action)); }
  /** How many files and folders were written, changed or removed (backups not counted). */
  get written() { return this.files.filter((f) => CHANGING.has(f.action) && f.action !== "backup").length; }
  get code() { return this.problems.length ? 1 : 0; }
  /** Paths (a project folder, the config folder) that wrapped text must never break at a space or squeeze. */
  protect(...paths) {
    for (const p of paths) if (p && /\s/.test(p) && !this.kept.includes(p)) this.kept.push(p);
    this.kept.sort((a, b) => b.length - a.length);
  }
  shield(text) { return this.kept.reduce((t, p) => t.split(p).join(p.split(" ").join(HOLD)), String(text)); }
  unshield(text) { return text.split(HOLD).join(" "); }
  /** `text` wrapped, with the protected paths kept whole. */
  wrapText(text, width) { return wrap(this.shield(text), width).map((l) => this.unshield(l)); }
  /** A line with a hanging indent, wrapped, with the protected paths kept whole. */
  hang(line) { return wrapHanging(this.shield(line)).map((l) => this.unshield(l)); }
  /** Lines of a section: an indented line is kept as it is (a command, a snippet, a path), any other is wrapped. */
  sectionLines(lines) {
    return lines.flatMap((l) => (/^\s/.test(l) ? [`  ${l}`] : this.wrapText(l, WIDTH - 2).map((x, i) => `${i ? "    " : "  "}${x}`)));
  }
  fileLines(f) {
    const word = WORDS[f.action][this.dryRun ? 1 : 0];
    const lead = " ".repeat(2 + WORD_WIDTH);
    return [`  ${word.padEnd(WORD_WIDTH)}${f.file}`, ...(f.note ? this.wrapText(f.note, WIDTH - lead.length).map((l) => lead + l) : [])];
  }
  settingLine(s) {
    const word = SETTING_WORDS[s.action][this.dryRun ? 1 : 0];
    return `  ${word.padEnd(WORD_WIDTH)}${s.key}${s.detail ? `  (${s.detail})` : ""}`;
  }
  /** The whole report as text. */
  format({ version, done }) {
    const out = [`claude-handover ${this.command} ${version}${this.dryRun ? "  (dry run: nothing is written)" : ""}`, ""];
    if (this.ground.length) {
      out.push("Ground");
      const w = Math.max(...this.ground.map(([k]) => k.length)) + 2;
      for (const [k, v] of this.ground) out.push(`  ${k.padEnd(w)}${v}`);
      out.push("");
    }
    if (this.files.length) {
      out.push("Files");
      for (const f of this.files) out.push(...this.fileLines(f));
      out.push("");
    }
    if (this.settings.length) {
      out.push(`Settings in ${this.settingsFile}`);
      for (const s of this.settings) out.push(this.settingLine(s));
      out.push("");
    }
    if (this.git.length) out.push("Git", ...this.sectionLines(this.git), "");
    if (this.guard.length) out.push("Guard and recall", ...this.sectionLines(this.guard), "");
    if (this.notes.length) out.push(...this.notes.flatMap((l) => this.wrapText(l, WIDTH)), "");
    if (this.problems.length) out.push("Problems", ...this.problems.flatMap((l) => this.hang(`  ! ${l}`)), "");
    out.push(...this.wrapText(done, WIDTH));
    if (this.closing.length) out.push("", ...this.closing.flatMap((l) => this.hang(l)));
    return out.join("\n") + "\n";
  }
}

export const consoleIO = { out: (s = "") => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`), err: (s = "") => process.stderr.write(s.endsWith("\n") ? s : `${s}\n`) };
