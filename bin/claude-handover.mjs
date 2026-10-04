#!/usr/bin/env node
// claude-handover: set up the Claude Code handover workflow in one command. All the work lives in src/;
// run `claude-handover --help` for the commands.
const major = Number(process.versions.node.split(".")[0]);
if (major < 18) {
  console.error(`error: claude-handover needs Node 18 or newer; this is Node ${process.versions.node}.`);
  process.exit(1);
}

process.stdout.on("error", () => {}); // `| head` closing the pipe is not worth a stack trace
const { main } = await import("../src/cli.mjs");
process.exitCode = main(process.argv.slice(2));
