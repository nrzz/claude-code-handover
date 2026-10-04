// The repository itself: no dependencies, a thin bin file, and docs that match the code. A change that adds a
// package, a command or an option without telling the README and the changelog fails here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EMOJI, ROOT, cli, withBox } from "./helpers.mjs";
import { OPTIONS } from "../src/cli.mjs";

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

test("CI runs npm test on Ubuntu, Windows and macOS with Node 20, 22 and 24", () => {
  const ci = read(".github", "workflows", "test.yml");
  for (const needle of ["ubuntu-latest", "windows-latest", "macos-latest", "node: [20, 22, 24]", "npm test"]) assert.ok(ci.includes(needle), needle);
});

test("the project's own .gitignore keeps backups out of the repository", () => {
  assert.ok(read(".gitignore").split("\n").includes("*.bak-*"));
});
