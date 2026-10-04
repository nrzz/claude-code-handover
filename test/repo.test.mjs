// The repository itself: no dependencies, a thin bin file, and docs that match the code. A change that adds a
// package, a command or an option without telling the README and the changelog fails here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EMOJI, ROOT, cli, withBox } from "./helpers.mjs";
import { OPTIONS } from "../src/cli.mjs";
import { FAMILIES } from "../src/models.mjs";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const pkg = JSON.parse(read("package.json"));

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...sourceFiles(`${dir}/${e.name}`));
    else if (e.name.endsWith(".mjs")) out.push(`${dir}/${e.name}`);
  }
  return out;
}

test("package.json: the command, the version, the test script, and nothing to install", () => {
  assert.equal(pkg.name, "claude-code-handover");
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.bin, { "claude-handover": "bin/claude-handover.mjs" });
  assert.equal(pkg.scripts.test, "node --test && node scripts/selftest.mjs");
  assert.equal(pkg.engines.node, ">=18");
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "bundledDependencies"]) {
    assert.equal(pkg[key], undefined, `${key} must not exist: the project has no dependencies`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, pkg.bin["claude-handover"])));
});

test("package.json lists every folder the installer reads when it runs from npx's copy", () => {
  // Without a "files" list npm warns on every npx run ("gitignore-fallback"); with one, only what is listed is shipped.
  for (const dir of ["bin", "src", "scripts", "skills", "templates"]) {
    assert.ok(pkg.files.includes(dir), `"files" lists ${dir}, which init reads or copies`);
    assert.ok(fs.statSync(path.join(ROOT, dir)).isDirectory());
  }
  for (const f of ["setup-prompt.txt", "SETUP-PROMPT.md"]) assert.ok(pkg.files.includes(f));
  assert.ok(!pkg.files.includes("test"), "the tests are not shipped");
  // npm always adds package.json, README and LICENSE, and init copies package.json and LICENSE.
  for (const f of ["package.json", "LICENSE"]) assert.ok(fs.existsSync(path.join(ROOT, f)));
});

test("the bin file is thin: a shebang, a Node version check, and a call into src/", () => {
  const text = read("bin", "claude-handover.mjs");
  assert.ok(text.startsWith("#!/usr/bin/env node\n"));
  assert.ok(text.split("\n").length < 25, "all the work lives in src/");
  assert.ok(text.includes('import("../src/cli.mjs")'));
});

test("zero dependencies: every import in the code is a node: built-in or a file of this repository", () => {
  const files = [...sourceFiles("src"), ...sourceFiles("bin"), ...sourceFiles("scripts"), ...sourceFiles("test")];
  assert.ok(files.length > 15);
  for (const f of files) {
    const text = read(...f.split("/"));
    for (const m of text.matchAll(/(?:^|[\s;])(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']/gm)) {
      const spec = m[1] || m[2] || m[3];
      assert.ok(spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"), `${f} imports ${spec}`);
    }
  }
});

test("the files are plain text with LF line endings and no emoji", () => {
  for (const f of [...sourceFiles("src"), ...sourceFiles("bin"), ...sourceFiles("test"), "README.md", "CHANGELOG.md", "CONTRIBUTING.md"]) {
    const text = read(...f.split("/"));
    assert.ok(!text.includes("\r"), `${f} has a carriage return`);
    assert.ok(!EMOJI.test(text), `${f} has an emoji`);
  }
});

test("CHANGELOG: the top section is the package version, and it has its compare link", () => {
  const text = read("CHANGELOG.md");
  const top = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/m.exec(text);
  assert.ok(top, "a version heading");
  assert.equal(top[1], pkg.version, "the newest changelog section is the version in package.json");
  const versions = [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
  assert.equal(new Set(versions).size, versions.length);
  const prev = versions[1];
  assert.ok(text.includes(`[${pkg.version}]: https://github.com/nrzz/claude-code-handover/compare/v${prev}...v${pkg.version}`), "the compare link of the newest version");
  assert.ok(text.indexOf(`[${pkg.version}]: `) < text.indexOf(`[${prev}]: `), "newest link first");
});

test("the usage text names every option the parser accepts, and the README documents them", withBox((box) => {
  const help = cli(box, ["--help"]).stdout;
  const readme = read("README.md");
  const options = new Set(Object.values(OPTIONS).flatMap((o) => Object.keys(o)));
  assert.deepEqual([...options].sort(), ["--dir", "--dry-run", "--models", "--no-hooks", "--purge", "--streams"]);
  for (const o of options) {
    assert.ok(help.includes(o), `--help names ${o}`);
    assert.ok(readme.includes(`\`${o}`), `the README documents ${o}`);
  }
  for (const command of Object.keys(OPTIONS)) assert.ok(help.includes(`claude-handover ${command}`), `--help shows ${command}`);
}));

test("README: the one command comes first, the pasted prompt stays as the alternative, and the files are listed", () => {
  const readme = read("README.md");
  const one = readme.indexOf("## Set up in one command");
  const prompt = readme.indexOf("## Or let Claude set it up");
  assert.ok(one > 0 && prompt > one, "the one-command section comes before the prompt route");
  assert.ok(readme.includes("npx -y github:nrzz/claude-code-handover init"));
  assert.ok(readme.includes("npx -y github:nrzz/claude-code-handover uninstall"));
  assert.ok(readme.includes("npx -y github:nrzz/claude-code-handover status"));
  assert.ok(readme.slice(prompt).includes("SETUP-PROMPT.md"));
  const sections = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  for (const s of ["What you get", "Every day", "What was verified, and how", "Files", "Contributing", "License"]) assert.ok(sections.includes(s), `README keeps its "${s}" section`);
  const files = readme.slice(readme.indexOf("## Files"));
  for (const f of ["bin/claude-handover.mjs", "src/", "test/", "templates/CLAUDE.local.md", "scripts/context-guard.mjs"]) assert.ok(files.includes(f), `the Files table lists ${f}`);
});

test("README: what was verified says what the installer's tests cover and what they do not", () => {
  const verified = read("README.md").split("## What was verified, and how")[1].split("\n## ")[0];
  assert.match(verified, /The one-command setup/);
  assert.match(verified, /every code block of `setup-prompt\.txt`/);
  assert.match(verified, /Not covered:/);
});

test("CONTRIBUTING describes bin/, src/ and test/, and how to run the tests", () => {
  const text = read("CONTRIBUTING.md");
  for (const needle of ["`bin/claude-handover.mjs`", "`src/`", "`test/`", "npm test", "node --test", "CLAUDE_HANDOVER_MANAGED_SETTINGS", "setup prompt is authoritative"]) {
    assert.ok(text.includes(needle), `CONTRIBUTING mentions ${needle}`);
  }
});

test("CI runs npm test on Ubuntu, Windows and macOS with Node 20, 22 and 24, and on Ubuntu with Node 18", () => {
  const ci = read(".github", "workflows", "test.yml");
  for (const needle of ["ubuntu-latest", "windows-latest", "macos-latest", "node: [20, 22, 24]", "npm test"]) assert.ok(ci.includes(needle), needle);
  assert.match(ci, /include:\s*\n\s*- os: ubuntu-latest\s*\n\s*node: ["']?18["']?\s*\n/, "one more job: Node 18, the oldest the package supports, on Linux");
  const docs = `${read("CONTRIBUTING.md")}\n${read("README.md")}`;
  assert.ok(docs.includes("Node 18"), "the docs say so");
  assert.ok(!/\b(?:nine|ten|\d+) jobs\b/.test(docs), "and do not count the jobs, which changes when the matrix does");
});

// ---- documents that must match what the code does --------------------------------------------

test("the README documents every HANDOVER_ setting the scripts read, and how the guard's limit follows the window", () => {
  const readme = read("README.md");
  const settings = new Set();
  for (const f of sourceFiles("scripts")) for (const m of read(...f.split("/")).matchAll(/process\.env\.(HANDOVER_[A-Z_]+)/g)) settings.add(m[1]);
  assert.deepEqual([...settings].sort(), [
    "HANDOVER_AUTORECALL", "HANDOVER_CONTEXT_LIMIT", "HANDOVER_CONTEXT_WINDOW", "HANDOVER_DATA_DIR", "HANDOVER_PROJECTS_DIR",
    "HANDOVER_RECALL_STRICTNESS", "HANDOVER_RECALL_WINDOW_MB", "HANDOVER_STALE_MINUTES",
  ], "a new setting in a script needs a line in the README's tuning paragraph, and here");
  for (const name of settings) assert.ok(readme.includes(`\`${name}`), `the README documents ${name}`);
  assert.ok(readme.includes("the limit is 35% of `HANDOVER_CONTEXT_WINDOW`"), "the limit follows the window");
  assert.ok(readme.includes("`HANDOVER_CONTEXT_LIMIT` (tokens) sets the limit itself and wins when it is set"));
});

test("the README names the model id that init writes for one model, for every family", () => {
  const readme = read("README.md");
  for (const family of Object.values(FAMILIES)) assert.ok(readme.includes(family.id), `the README names ${family.id}`);
});

test("no document, message or comment says the guard holds the turn open until the handover is written; they give the real rule", () => {
  const stale = /holds? (?:a|the) turn open|held turn|until the handover is written|will not let a turn end|before the turn can end|forced by the guard|makes Claude write/i;
  const files = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "SETUP-PROMPT.md", "setup-prompt.txt", "templates/claude-token-rules.md", ...sourceFiles("src"), ...sourceFiles("scripts")];
  for (const f of files) assert.ok(!stale.test(read(...f.split("/"))), `${f} still says the guard holds the turn open`);
  for (const f of ["README.md", "SETUP-PROMPT.md", "setup-prompt.txt", "templates/claude-token-rules.md", "src/install.mjs"]) {
    const text = read(...f.split("/"));
    assert.ok(/asks (?:Claude )?once/.test(text), `${f} says the guard asks once`);
    assert.ok(text.includes("30 minutes"), `${f} gives the 30 minutes`);
    assert.ok(text.includes("HANDOVER_CONTEXT_WINDOW"), `${f} says 35% is a share of the window`);
  }
});

test("the scripts open no network connection and start no other program, as SECURITY.md says", () => {
  for (const f of sourceFiles("scripts")) {
    const text = read(...f.split("/"));
    assert.ok(!/node:(?:net|tls|dns|dgram|http|https|http2|child_process)\b|\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b/.test(text), `${f} could reach the network or run another program`);
  }
});

test("SECURITY.md says what reaches Claude and what uninstall keeps", () => {
  const text = read("SECURITY.md");
  assert.ok(!/send nothing anywhere|takes its user-level changes out again/.test(text));
  for (const needle of ["open no network connection", "added to your next prompt", "claude-code-handover-data", "cleanupPeriodDays", "settings.json.bak-"]) assert.ok(text.includes(needle), needle);
});

test("the README says init keeps a rules card that differs, builds the recall index, and what uninstall keeps", () => {
  const readme = read("README.md");
  for (const needle of ["claude-token-rules.md.bak-YYYYMMDD", "**The recall index**", "the recall index (`claude-code-handover-data` in the config folder", "(including `cleanupPeriodDays`)"]) {
    assert.ok(readme.includes(needle), needle);
  }
});

test("CONTRIBUTING tries the installer with exported variables, so a later uninstall cannot reach the real ~/.claude", () => {
  const text = read("CONTRIBUTING.md");
  assert.ok(text.includes('export CLAUDE_CONFIG_DIR="$tmp/claude" HOME="$tmp" USERPROFILE="$tmp"'));
  assert.ok(!/USERPROFILE="\$tmp" node /.test(text), "a variable in front of one command applies to that command only");
  assert.ok(text.includes("That route has no sandbox: it changes your real `~/.claude`"), "the prompt route is said to change the real ~/.claude");
});

test("the setup prompt says what init does: the backup name, a longer cleanupPeriodDays, and a plain copy of the scripts", () => {
  const prompt = read("setup-prompt.txt");
  assert.ok(prompt.includes("settings.json.bak-YYYYMMDD") && !prompt.includes("bak-<today>"));
  assert.ok(prompt.includes("If cleanupPeriodDays is already above 365, keep it."));
  assert.ok(prompt.includes("already exists and has a .git folder, run `git pull`") && prompt.includes("If it exists without one"), "git pull only where there is a checkout");
  assert.ok(prompt.includes("the first row names the model that does the chores (Sonnet, else Haiku, else the cheapest I have)"));
});

test("the project's own .gitignore keeps backups out of the repository", () => {
  assert.ok(read(".gitignore").split("\n").includes("*.bak-*"));
});
