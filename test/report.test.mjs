// The report: what counts as a change, how dry-run wording differs, and that long prose is broken at spaces
// (a path or a command is never broken) so the text reads well in a terminal and in a plain-text box.
import test from "node:test";
import assert from "node:assert/strict";
import { Report, wrap } from "../src/report.mjs";
import "./helpers.mjs";

test("wrap breaks at spaces, keeps every word whole and keeps every line within the width when it can", () => {
  const text = "one two three four five six seven eight nine ten";
  for (const width of [10, 16, 25, 100]) {
    const lines = wrap(text, width);
    assert.equal(lines.join(" "), text, "nothing is lost or added");
    assert.ok(lines.every((l) => l.length <= width), `width ${width}: ${JSON.stringify(lines)}`);
  }
  assert.deepEqual(wrap("short", 80), ["short"]);
  assert.deepEqual(wrap("", 80), []);
});

test("a word longer than the width, such as a path, stays on a line of its own, unbroken", () => {
  const path = "C:\\Users\\someone\\AppData\\Local\\Temp\\a-very-long-folder-name\\HANDOVER.md";
  const lines = wrap(`see ${path} for details`, 30);
  assert.deepEqual(lines, ["see", path, "for details"]);
});

test("created, appended, updated, replaced, backups, copies and removals are changes; the rest are not", () => {
  for (const action of ["created", "appended", "updated", "replaced", "backup", "copied", "removed"]) {
    const r = new Report("init");
    r.file(action, "x");
    assert.equal(r.changed, true, action);
  }
  for (const action of ["unchanged", "kept", "skipped"]) {
    const r = new Report("init");
    r.file(action, "x");
    assert.equal(r.changed, false, action);
  }
});

test("written counts files and folders, not the backups made before them", () => {
  const r = new Report("init");
  r.file("backup", "settings.json.bak-1");
  r.file("updated", "settings.json");
  r.file("created", "a");
  r.file("unchanged", "b");
  assert.equal(r.written, 2);
  assert.equal(r.code, 0);
  r.problem("something failed");
  assert.equal(r.code, 1);
});

test("a dry run is worded as what would happen", () => {
  const r = new Report("init", { dryRun: true });
  r.file("created", "/a/b");
  r.file("backup", "/a/b.bak-1");
  r.file("unchanged", "/a/c");
  r.setting("effortLevel", "set", 'now "high", was missing');
  r.settingsFile = "/s.json";
  const text = r.format({ version: "9.9.9", done: "Dry run: nothing was written." });
  assert.match(text, /^claude-handover init 9\.9\.9  \(dry run: nothing is written\)\n/);
  assert.match(text, /\n {2}would create {2}\/a\/b\n/);
  assert.match(text, /\n {2}would back up {1}\/a\/b\.bak-1\n/);
  assert.match(text, /\n {2}unchanged {5}\/a\/c\n/);
  assert.match(text, /\n {2}would set {5}effortLevel {2}\(now "high", was missing\)\n/);
});

test("a note is wrapped under the file name; the numbered lines hang under their text; problems hang under theirs", () => {
  const r = new Report("init");
  const note = "this note is long enough that it has to be broken into more than one line when it is printed in the report";
  r.file("created", "/some/file", note);
  r.closing = ["Keep these four lines", `  1. ${note} and then some more words so that it wraps at least once as well`];
  r.problem(`${note} and a second sentence`);
  const text = r.format({ version: "1.0.0", done: "Done." });
  const lines = text.split("\n");
  const at = lines.indexOf("  created       /some/file");
  assert.ok(at > -1);
  assert.ok(lines[at + 1].startsWith(`${" ".repeat(16)}this note`));
  assert.ok(lines[at + 2].startsWith(" ".repeat(16)) && lines[at + 2].trim().length > 0, "the note continues on a second line");
  assert.ok(lines.every((l) => l.length <= 100 || !l.includes(" ")), "no wrapped line is over 100 columns");
  const one = lines.findIndex((l) => l.startsWith("  1. this note"));
  assert.ok(lines[one + 1].startsWith("     ") && !lines[one + 1].startsWith("      "), "continuation lines of a numbered item start under the text");
  const bang = lines.findIndex((l) => l.startsWith("  ! this note"));
  assert.ok(lines[bang + 1].startsWith("    ") && !lines[bang + 1].startsWith("     "));
});

test("a line break inside any text of the report does not break the report", () => {
  const r = new Report("init");
  r.fact("Settings", "found, but is not valid JSON (Unexpected token\n 'd', \"{\n  \"theme\": dark,\n  \"env\"...\" is not valid JSON)");
  r.file("skipped", "/a/b", "first line\nsecond line");
  r.setting("effortLevel", "skipped", "line one\nline two");
  r.problem("a problem\nover two lines");
  r.git.push("a git line\nover two lines");
  r.guard.push("a guard line\nover two lines");
  r.notes.push("a note\nover two lines");
  r.closing = ["Keep these four lines", "  1. a numbered line\nover two lines, which is longer than the width of a line in the report so that it has to be wrapped as well, at least once"];
  const text = r.format({ version: "1.0.0", done: "Done.\nReally." });
  assert.ok(text.includes("  ! a problem over two lines\n"), "a problem is one line");
  assert.ok(text.includes("Settings  found, but is not valid JSON (Unexpected token 'd',"), "a fact is one line");
  assert.ok(text.includes("  1. a numbered line over two lines, which is longer"), "a numbered line is wrapped under its text");
  assert.ok(text.includes("Done. Really."));
  assert.ok(!/\n\n\n/.test(text), "no stray blank lines");
});

test("a protected path keeps its spaces, even two in a row, and is never broken across lines", () => {
  const dir = "C:\\Users\\Some One\\my  projects\\app";
  const r = new Report("init");
  r.protect(dir);
  r.protect("no-spaces"); // nothing to protect: ignored
  r.problem(`${dir}\\HANDOVER.md is not UTF-8 text, and this explanation is long enough that the line has to be wrapped more than once in the report`);
  r.closing = ["Keep these four lines", `  1. Open a new Claude Code session in ${dir} (close one that is already open) and ask "which memory files loaded, and what is my effort?" It should name CLAUDE.local.md.`];
  r.notes.push(`Kept: the recall index in ${dir}\\data. It is safe to delete, and this sentence goes on for a while so that the path moves to the next line.`);
  const text = r.format({ version: "1.0.0", done: `Done in ${dir}.` });
  assert.equal(text.split(dir).length - 1, 4, "the path is whole, with its spaces as they were, in the problem, the numbered line, the note and the last line");
  assert.ok(!text.includes(String.fromCharCode(1)), "the stand-in for a space never reaches the text");
  assert.ok(text.split("\n").every((l) => l.length <= 100 || l.includes(dir)), "lines stay within 100 columns, except one that holds the path");
  const plain = new Report("init");
  plain.problem(`C:\\Users\\Some One\\my  projects\\app\\HANDOVER.md is not UTF-8 text, and this explanation is long enough that the line has to be wrapped more than once`);
  assert.ok(!plain.format({ version: "1.0.0", done: "Done." }).includes(dir), "without protect, the spaces would be squeezed: that is what protect is for");
});

test("indented lines in the git and guard sections are kept as they are, other lines are wrapped", () => {
  const r = new Report("init");
  r.git.push("A sentence that is long enough to be wrapped because it runs well past the width that the report allows per line, so it must break.");
  r.git.push("    git rm --cached HANDOVER.md");
  r.guard.push('      "args": ["C:/a/very/long/path/that/must/never/be/broken/by/the/report/because/it/is/a/snippet/for/copying.mjs"]');
  const text = r.format({ version: "1.0.0", done: "Done." });
  assert.ok(text.includes("\n      git rm --cached HANDOVER.md\n"), "the command keeps its place on a line of its own");
  assert.ok(text.includes('\n        "args": ["C:/a/very/long/path'), "the snippet is untouched, with the section's indent in front");
  const sentence = text.split("\n").filter((l) => /^ {2}A sentence|^ {4}\S/.test(l) && !l.includes("git rm") && !l.includes("args"));
  assert.ok(sentence.length >= 2, "the long sentence became more than one line");
});
