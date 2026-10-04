// The command line as a child process, the way a person, npx or the toolkit's setup page runs it: exit codes,
// the exact flag spellings, one line on stderr for a failure, and a report that is plain text.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EMOJI, ROOT, cli, exists, flat, names, read, readJson, snapshot, withBox, write } from "./helpers.mjs";
import { parseOptions } from "../src/cli.mjs";
import { UsageError, VERSION, localDate } from "../src/util.mjs";

const oneLine = (s) => s.trim().length > 0 && !s.trim().includes("\n");

test("--help and no arguments print the usage, exit 0 and write nothing", withBox((box) => {
  const before = snapshot(box.root);
  for (const args of [["--help"], ["-h"], [], ["help"], ["init", "--help"]]) {
    const r = cli(box, args);
    assert.equal(r.status, 0, args.join(" "));
    assert.equal(r.stderr, "");
    for (const needle of ["claude-handover init", "claude-handover uninstall", "claude-handover status", "--models", "--streams", "--dir", "--dry-run", "--no-hooks", "--purge", "CLAUDE_CONFIG_DIR"]) {
      assert.ok(r.stdout.includes(needle), `${args.join(" ")} mentions ${needle}`);
    }
  }
  assert.deepEqual(snapshot(box.root), before);
}));

test("--version prints the version of package.json", withBox((box) => {
  const r = cli(box, ["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), readJson(path.join(ROOT, "package.json")).version);
  assert.equal(r.stdout.trim(), VERSION);
}));

test("an unknown command is exit 2 with one line on stderr", withBox((box) => {
  const r = cli(box, ["frobnicate"]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.ok(oneLine(r.stderr));
  assert.match(r.stderr, /^error: unknown command "frobnicate"\. Use init, uninstall or status/);
}));

test("names that every JavaScript object has are not commands", withBox((box) => {
  for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    const r = cli(box, [name]);
    assert.equal(r.status, 2, name);
    assert.equal(r.stdout, "", name);
    assert.ok(oneLine(r.stderr), name);
    assert.match(r.stderr, new RegExp(`^error: unknown command "${name}"`));
  }
}));

test("a settings.json whose parse error quotes several lines is exit 1, a complete report and one line on stderr", withBox((box) => {
  write(box.settings, '{\n  "theme": dark,\n  "env": {}\n}\n');
  const init = cli(box, ["init", "--dir", box.project]);
  assert.equal(init.status, 1);
  assert.ok(oneLine(init.stderr), init.stderr);
  assert.match(init.stdout, /Keep these four lines/);
  const un = cli(box, ["uninstall"]);
  assert.equal(un.status, 1);
  assert.ok(oneLine(un.stderr), un.stderr);
  assert.match(un.stdout, /Problems\n {2}! /);
}));

test("options that do not belong, or are incomplete, are exit 2 with one line and nothing written", withBox((box) => {
  const before = snapshot(box.root);
  const cases = [
    [["init", "--nope"], /^error: init does not take --nope\./],
    [["uninstall", "--models", "Opus"], /^error: uninstall does not take --models\./],
    [["status", "--purge"], /^error: status does not take --purge\./],
    [["init", "--models"], /^error: --models needs a value/],
    [["init", "--dir", "--dry-run"], /^error: --dir needs a value/],
    [["init", "stray"], /^error: unexpected argument "stray"/],
    [["init", "--dry-run=yes"], /^error: --dry-run does not take a value\./],
    [["init", "--models", "gpt-5"], /^error: --models "gpt-5" names none of Opus, Sonnet, Fable or Haiku/],
    [["init", "--models", ""], /^error: --models is empty\./],
    [["init", "--streams", " "], /^error: --streams is empty/],
    [["init", "--dir", path.join(box.root, "missing")], /^error: .* is not a folder/],
  ];
  for (const [args, pattern] of cases) {
    const r = cli(box, args);
    assert.equal(r.status, 2, args.join(" "));
    assert.equal(r.stdout, "", `${args.join(" ")} prints no report`);
    assert.ok(oneLine(r.stderr), `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, pattern);
  }
  assert.deepEqual(snapshot(box.root), before);
}));

test("the options are read the way the usage spells them, with a space or an equals sign", () => {
  assert.deepEqual(parseOptions("init", ["--models", "Opus + Sonnet", "--streams", "backend, frontend", "--dir", "/p", "--dry-run", "--no-hooks"]),
    { models: "Opus + Sonnet", streams: "backend, frontend", dir: "/p", dryRun: true, noHooks: true });
  assert.deepEqual(parseOptions("init", ["--models=Opus only", "--dir=/p"]), { models: "Opus only", dir: "/p" });
  assert.deepEqual(parseOptions("uninstall", ["--purge", "--dry-run"]), { purge: true, dryRun: true });
  assert.deepEqual(parseOptions("status", ["--dir", "x"]), { dir: "x" });
  assert.throws(() => parseOptions("init", ["--purge"]), UsageError);
});

test("the call the toolkit's setup page makes: init --dir --models --streams, exit 0, a plain-text report", withBox((box) => {
  const args = ["init", "--dir", box.project, "--models", "Fable + Opus + Sonnet", "--streams", "backend, frontend"];
  const first = cli(box, args, { cwd: box.root });
  assert.equal(first.status, 0, first.out);
  assert.equal(first.stderr, "");
  assert.match(first.stdout, /^claude-handover init \d+\.\d+\.\d+\n\nGround\n/);
  assert.match(first.stdout, /Models\s+Fable \+ Opus \+ Sonnet: effort high, Sonnet on medium, subagents on Sonnet/);
  assert.match(first.stdout, /Streams\s+backend, frontend/);
  assert.match(flat(first.stdout), / Done: \d+ items written or changed\. /);
  assert.ok(!/\u001b\[/.test(first.stdout), "no colour codes");
  assert.ok(!EMOJI.test(first.stdout), "no emoji");
  assert.ok(first.stdout.split("\n").every((l) => l.length < 400), "no line is a wall of text");
  assert.deepEqual(read(box.p("HANDOVER.md")).split("\n").filter((l) => l.startsWith("## ")).slice(0, 2), ["## backend", "## frontend"]);
  assert.match(read(box.p("claude-token-rules.md")), /\| Whole-repo audit, security review, long autonomous build with a full brief \| Fable \| high \|/);
  const second = cli(box, args, { cwd: box.root });
  assert.equal(second.status, 0, "already set up is a success");
  assert.equal(second.stderr, "");
  assert.match(flat(second.stdout), / Nothing to do: everything was already in place, and no file was changed\. /);
}));

test("--dir may be relative, and without --dir the current folder is the project", withBox((box) => {
  const a = cli(box, ["init", "--dir", "."], { cwd: box.project });
  assert.equal(a.status, 0, a.out);
  assert.ok(exists(box.p("HANDOVER.md")));
  const other = path.join(box.root, "second");
  fs.mkdirSync(other);
  const b = cli(box, ["init"], { cwd: other });
  assert.equal(b.status, 0, b.out);
  assert.ok(exists(path.join(other, "HANDOVER.md")));
  const c = cli(box, ["status"], { cwd: other });
  assert.equal(c.status, 0);
  assert.ok(c.stdout.includes(`Project folder ${other}`));
}));

test("--models=... and --dir=... work as well", withBox((box) => {
  const r = cli(box, ["init", `--dir=${box.project}`, "--models=Opus only"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(readJson(box.settings).effortLevel, "medium");
  assert.ok(exists(box.p("CLAUDE.md")));
}));

test("a problem that stops part of the setup is exit 1, one line on stderr, and the report says the rest", withBox((box) => {
  write(box.settings, "{ broken");
  const r = cli(box, ["init", "--dir", box.project]);
  assert.equal(r.status, 1);
  assert.ok(oneLine(r.stderr), r.stderr);
  assert.match(r.stderr, /^error: init did not finish: .*settings\.json is not valid JSON/);
  assert.match(r.stdout, /Problems\n  ! /);
  assert.match(flat(r.stdout), /Finished with 1 problem/);
  assert.equal(read(box.settings), "{ broken");
  assert.ok(exists(box.p("HANDOVER.md")), "what could be done was done");
}));

test("a step that fails does not stop the others, and the one-line reason names it", withBox((box) => {
  fs.mkdirSync(box.p("HANDOVER.md")); // a folder where the file should be
  const r = cli(box, ["init", "--dir", box.project]);
  assert.equal(r.status, 1);
  assert.ok(oneLine(r.stderr), r.stderr);
  assert.match(r.stderr, /^error: init did not finish: HANDOVER\.md: /);
  assert.ok(exists(box.p("DECISIONS.md")) && exists(box.p("claude-token-rules.md")) && exists(box.settings), "the other steps ran");
  assert.match(r.stdout, /Problems\n  ! HANDOVER\.md: /);
}));

test("several problems give one line that counts the rest", withBox((box) => {
  write(box.settings, "{ broken");
  fs.mkdirSync(box.p("DECISIONS.md"));
  const r = cli(box, ["init", "--dir", box.project]);
  assert.equal(r.status, 1);
  assert.ok(oneLine(r.stderr));
  assert.match(r.stderr, /\(and \d+ more; see the report above\)\n$/);
}));

test("uninstall and status run from the command line, exit 0 and write only what uninstall removes", withBox((box) => {
  cli(box, ["init", "--dir", box.project]);
  const status = cli(box, ["status", "--dir", box.project]);
  assert.equal(status.status, 0, status.out);
  assert.match(status.stdout, /Installed\. Run init in a project folder to set one up\./);
  const dry = cli(box, ["uninstall", "--dry-run"]);
  assert.equal(dry.status, 0, dry.out);
  assert.ok(exists(box.vendor), "a dry run removes nothing");
  const r = cli(box, ["uninstall"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.stderr, "");
  assert.ok(!exists(box.vendor));
  assert.deepEqual(names(box.c("skills")), []);
  assert.ok(exists(box.p("HANDOVER.md")), "project files stay");
  assert.equal(cli(box, ["uninstall"]).status, 0, "nothing to remove is a success");
}));

test("--dry-run from the command line writes nothing and exits 0", withBox((box) => {
  const before = snapshot(box.root);
  const r = cli(box, ["init", "--dry-run", "--dir", box.project, "--models", "Opus only", "--streams", "api"]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(snapshot(box.root), before);
  assert.match(r.stdout, /\(dry run: nothing is written\)/);
}));

test("the files carry today's date from the real clock, in local time", withBox((box) => {
  const before = localDate();
  const r = cli(box, ["init", "--dir", box.project]);
  const after = localDate(); // the run may straddle midnight
  assert.equal(r.status, 0, r.out);
  const date = /Updated: (\d{4}-\d{2}-\d{2}) by the setup session/.exec(read(box.p("HANDOVER.md")))[1];
  assert.ok(date === before || date === after, `${date} is today`);
  assert.ok(read(box.p("DECISIONS.md")).includes(`- ${date} [main] Workflow set up.`));
}));
