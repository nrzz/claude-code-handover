// The command line: init, uninstall, status. `main(argv, ctx)` returns the exit code and prints through ctx.io,
// so tests can call it in-process. Exit codes: 0 done (including "already set up"), 1 something could not be
// done (one line on stderr says what, the report says the rest), 2 the command line could not be understood.
import { init, status, uninstall } from "./install.mjs";
import { consoleIO } from "./report.mjs";
import { UsageError, VERSION } from "./util.mjs";

const HELP = `claude-handover ${VERSION}: set up the Claude Code handover workflow in one command. It uses no model, so it costs no tokens, and it asks nothing.

Usage
  claude-handover init [--models "Opus + Sonnet"] [--streams "main"] [--dir <project>] [--dry-run] [--no-hooks]
  claude-handover uninstall [--purge] [--dry-run]
  claude-handover status [--dir <project>]

init       sets up the project folder and Claude Code's config folder. Run it a second time and it changes nothing and says so.
  --models     the models your picker shows: "Opus only", "Fable + Opus + Sonnet", "sonnet,haiku" (default "Opus + Sonnet")
  --streams    your work streams: "backend, frontend" (default "main")
  --dir        the project folder (default: the current folder)
  --dry-run    say what would change, write nothing
  --no-hooks   skip the context guard, automatic recall and /recall
uninstall  takes out the three hooks, the /handover and /recall skills and the copy of the scripts. Your project files and the
           effort settings stay.
  --purge      also remove a git checkout of the scripts that an older setup made
  --dry-run    say what would be removed, remove nothing
status     what is installed where

Environment: CLAUDE_CONFIG_DIR is Claude Code's config folder (default ~/.claude).
Exit codes: 0 done or already set up, 1 something could not be done, 2 the command line was not understood.
https://github.com/nrzz/claude-code-handover`;

/** Options each command takes: "value" options need an argument, "flag" options do not. */
export const OPTIONS = {
  init: { "--models": "value", "--streams": "value", "--dir": "value", "--dry-run": "flag", "--no-hooks": "flag" },
  uninstall: { "--purge": "flag", "--dry-run": "flag" },
  status: { "--dir": "value" },
};
const CAMEL = { "--models": "models", "--streams": "streams", "--dir": "dir", "--dry-run": "dryRun", "--no-hooks": "noHooks", "--purge": "purge" };
const COMMANDS = { init, uninstall, status };

/** ["--models", "Opus only", "--dry-run"] -> { models: "Opus only", dryRun: true }. Throws UsageError for anything unknown. */
export function parseOptions(command, rest) {
  const allowed = OPTIONS[command];
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!arg.startsWith("--")) throw new UsageError(`unexpected argument "${arg}". ${command} takes only options; run claude-handover --help.`);
    const kind = Object.hasOwn(allowed, name) ? allowed[name] : undefined;
    if (!kind) {
      throw new UsageError(`${command} does not take ${name}. Its options: ${Object.keys(allowed).join(", ")}.`);
    }
    if (kind === "flag") {
      if (eq !== -1) throw new UsageError(`${name} does not take a value.`);
      opts[CAMEL[name]] = true;
      continue;
    }
    let value = eq === -1 ? rest[i + 1] : arg.slice(eq + 1);
    if (eq === -1) {
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${name} needs a value, for example ${name} ${name === "--dir" ? "<project folder>" : name === "--models" ? '"Opus + Sonnet"' : '"backend, frontend"'}.`);
      i++;
    }
    opts[CAMEL[name]] = value;
  }
  return opts;
}

/** One line for stderr: the first problem, and how many more there are. */
const oneLine = (command, problems) => {
  const first = String(problems[0]).replace(/\s+/g, " ").trim();
  return `error: ${command} did not finish: ${first}${problems.length > 1 ? ` (and ${problems.length - 1} more; see the report above)` : ""}`;
};

export function main(argv, { env = process.env, cwd = process.cwd(), io = consoleIO, now } = {}) {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") { io.out(HELP); return 0; }
  if (name === "--version" || name === "-v" || name === "version") { io.out(VERSION); return 0; }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!command) {
    io.err(`error: unknown command "${name}". Use init, uninstall or status; claude-handover --help lists the options.`);
    return 2;
  }
  if (rest.includes("--help") || rest.includes("-h")) { io.out(HELP); return 0; }
  try {
    const opts = parseOptions(name, rest);
    if ((name === "init" || name === "status") && opts.dir === undefined) opts.dir = cwd;
    const result = command({ ...opts, env, now }, io);
    if (result.code) io.err(oneLine(name, result.problems));
    return result.code;
  } catch (e) {
    if (e instanceof UsageError) { io.err(`error: ${e.message}`); return 2; }
    io.err(`error: ${name} failed: ${String((e && e.message) || e).split("\n")[0]}`);
    return 1;
  }
}
