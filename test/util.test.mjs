// The small helpers under every step: appending to a file without changing what is in it, reading a file only when
// writing it back is safe, backup names, dates and paths.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withBox, write } from "./helpers.mjs";
import {
  NotTextError, appendBlock, appendLines, backupPath, bomOf, configDir, eolOf, forwardSlashes, homeDir, listFiles, localDate, makeWriter,
  peekText, readText, samePath, stripBom, toLF,
} from "../src/util.mjs";

const MARK = String.fromCharCode(0xfeff);

test("appendBlock puts the block after a blank line and changes nothing that was there", () => {
  assert.equal(appendBlock("a\n", "B\n"), "a\n\nB\n");
  assert.equal(appendBlock("a", "B\n"), "a\n\nB\n", "a missing final newline is added");
  assert.equal(appendBlock("a\n\n", "B\n"), "a\n\nB\n", "an existing blank line is reused");
  assert.equal(appendBlock("a\r\nb\r\n", "B\nC\n"), "a\r\nb\r\n\r\nB\r\nC\r\n", "the file's line ending is used");
  assert.equal(appendBlock("", "B\n"), "B\n");
  assert.equal(appendBlock("\n\n", "B\n"), "B\n", "a file of blank lines holds nothing to keep");
  assert.equal(appendBlock(`${MARK}\n`, "B\n"), `${MARK}B\n`, "an empty file keeps its byte order mark");
});

test("appendLines adds just the lines: no blank line, no comment", () => {
  assert.equal(appendLines("a\n", ["x", "y"]), "a\nx\ny\n");
  assert.equal(appendLines("a", ["x"]), "a\nx\n");
  assert.equal(appendLines("a\r\nb\r\n", ["x"]), "a\r\nb\r\nx\r\n");
  assert.equal(appendLines("", ["x"]), "x\n");
  assert.equal(appendLines("a\n\n", ["x"]), "a\n\nx\n", "what was there stays, blank line included");
  assert.equal(appendLines("a\n", []), "a\n");
});

test("line endings, byte order marks and slashes", () => {
  assert.equal(eolOf("a\r\nb"), "\r\n");
  assert.equal(eolOf("a\nb"), "\n");
  assert.equal(eolOf(""), "\n");
  assert.equal(toLF("a\r\nb\r\n"), "a\nb\n");
  assert.equal(stripBom(`${MARK}x`), "x");
  assert.equal(stripBom("x"), "x");
  assert.equal(bomOf(`${MARK}x`), MARK);
  assert.equal(bomOf("x"), "");
  assert.equal(forwardSlashes("C:\\a\\b/c"), "C:/a/b/c");
});

test("localDate is the date on the wall clock, with two digits for the month and the day", () => {
  assert.equal(localDate(new Date(2026, 9, 4, 23, 59, 59)), "2026-10-04");
  assert.equal(localDate(new Date(2026, 0, 5, 0, 0, 0)), "2026-01-05");
});

test("readText reads UTF-8 text, keeps a byte order mark, and refuses what writing back would corrupt", withBox((box) => {
  const f = path.join(box.root, "t.txt");
  assert.equal(readText(f), null, "a missing file is null");
  assert.equal(readText(path.join(f, "inside")), null, "so is a path below a file");
  write(f, `${MARK}caf${String.fromCodePoint(0xe9)}\n`);
  assert.equal(readText(f), `${MARK}caf${String.fromCodePoint(0xe9)}\n`);
  write(f, "");
  assert.equal(readText(f), "");
  for (const bytes of [[0x63, 0xe9], [0xff, 0xfe, 0x61, 0x00], [0x61, 0x00, 0x62], [0xc3]]) {
    fs.writeFileSync(f, Buffer.from(bytes));
    assert.throws(() => readText(f), NotTextError, bytes.join(","));
    assert.equal(typeof peekText(f), "string", "peekText still shows something");
  }
  fs.rmSync(f);
  fs.mkdirSync(f);
  assert.throws(() => readText(f), /EISDIR|illegal operation/);
}));

test("peekText returns null for a file that is not there", withBox((box) => {
  assert.equal(peekText(path.join(box.root, "nothing")), null);
}));

test("backup names: the date, then the time, then a counter; never a name that exists", withBox((box) => {
  const f = path.join(box.root, "settings.json");
  const now = new Date(2026, 9, 4, 7, 8, 9);
  assert.equal(backupPath(f, now), `${f}.bak-20261004`);
  write(`${f}.bak-20261004`, "x");
  assert.equal(backupPath(f, now), `${f}.bak-20261004-070809`);
  write(`${f}.bak-20261004-070809`, "x");
  assert.equal(backupPath(f, now), `${f}.bak-20261004-070809-2`);
  write(`${f}.bak-20261004-070809-2`, "x");
  assert.equal(backupPath(f, now), `${f}.bak-20261004-070809-3`);
}));

test("the writer does nothing in a dry run, and writes, copies, backs up and removes otherwise", withBox((box) => {
  const f = path.join(box.root, "a", "b.txt");
  const dry = makeWriter(true);
  dry.write(f, "x");
  dry.copy(f, path.join(box.root, "c.txt"));
  dry.remove(box.root);
  dry.removeIfEmpty(box.root);
  assert.ok(!fs.existsSync(path.join(box.root, "a")), "a dry run made nothing");
  assert.ok(fs.existsSync(box.root), "and removed nothing");
  const w = makeWriter(false);
  w.write(f, "x");
  assert.equal(fs.readFileSync(f, "utf8"), "x", "folders are made as needed");
  w.copy(f, path.join(box.root, "c", "d.txt"));
  assert.equal(fs.readFileSync(path.join(box.root, "c", "d.txt"), "utf8"), "x");
  const b = w.backup(f, new Date(2026, 9, 4));
  assert.equal(b, `${f}.bak-20261004`);
  assert.equal(fs.readFileSync(b, "utf8"), "x");
  w.removeIfEmpty(path.join(box.root, "a")); // not empty: stays
  assert.ok(fs.existsSync(path.join(box.root, "a")));
  w.remove(path.join(box.root, "a"));
  assert.ok(!fs.existsSync(path.join(box.root, "a")));
}));

test("listFiles lists every file under a folder, with forward slashes, sorted", withBox((box) => {
  write(path.join(box.root, "t", "b.txt"), "1");
  write(path.join(box.root, "t", "a", "c.txt"), "2");
  write(path.join(box.root, "t", "a", "d", "e.txt"), "3");
  assert.deepEqual(listFiles(path.join(box.root, "t")), ["a/c.txt", "a/d/e.txt", "b.txt"]);
}));

test("the config folder is CLAUDE_CONFIG_DIR when it is set and not blank, else .claude in the home folder", withBox((box) => {
  assert.equal(configDir({ CLAUDE_CONFIG_DIR: box.cfg }), box.cfg);
  assert.equal(configDir({ CLAUDE_CONFIG_DIR: `  ${box.cfg}  ` }), box.cfg);
  const home = process.platform === "win32" ? { USERPROFILE: box.home } : { HOME: box.home };
  assert.equal(configDir(home), path.join(box.home, ".claude"));
  assert.equal(configDir({ ...home, CLAUDE_CONFIG_DIR: "   " }), path.join(box.home, ".claude"));
  assert.equal(homeDir(home), box.home);
  assert.equal(path.resolve(configDir({ CLAUDE_CONFIG_DIR: "relative/folder" })), path.resolve("relative/folder"));
}));

test("samePath compares places, not spellings", withBox((box) => {
  const dir = path.join(box.root, "x");
  fs.mkdirSync(dir);
  assert.ok(samePath(dir, path.join(dir, ".")));
  assert.ok(samePath(dir, path.join(box.root, "y", "..", "x")));
  assert.ok(!samePath(dir, box.root));
  assert.ok(samePath(path.join(box.root, "missing"), path.join(box.root, "missing")), "a path that is not there still equals itself");
}));
