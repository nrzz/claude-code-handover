// What every step of a run needs to know: the folders, the date, the person's models and streams, the writer and the report.
import path from "node:path";
import { Report } from "./report.mjs";
import { DEFAULT_MODELS, DEFAULT_STREAMS, parseModels, parseStreams } from "./models.mjs";
import { NotTextError, UsageError, configDir, homeDir, isDir, localDate, makeWriter, samePath } from "./util.mjs";

/**
 * opts: { dir, models, streams, dryRun, noHooks, purge, env, now, checkTimeoutMs }. `env`, `now` and `checkTimeoutMs`
 * (how long the two index and recall checks may run, 120000) are for tests; they default to the real environment and
 * clock. Throws UsageError for a call that cannot be understood.
 */
export function makeContext(command, opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now || new Date();
  const dryRun = !!opts.dryRun;
  const c = {
    command, env, now, dryRun,
    today: localDate(now),
    noHooks: !!opts.noHooks,
    purge: !!opts.purge,
    checkTimeoutMs: Number(opts.checkTimeoutMs) > 0 ? Number(opts.checkTimeoutMs) : 120000,
    cfg: configDir(env),
    home: homeDir(env),
    w: makeWriter(dryRun),
    R: new Report(command, { dryRun }),
  };
  if (command === "init" || command === "status") {
    c.dir = path.resolve(opts.dir || process.cwd());
    if (!isDir(c.dir)) throw new UsageError(`${c.dir} is not a folder. Pass --dir <project folder>, or run the command inside it.`);
  }
  c.R.protect(c.dir, c.cfg, c.home); // wrapped text must not break a path that has spaces
  if (command === "init") {
    if (samePath(c.dir, c.cfg)) throw new UsageError(`${c.dir} is Claude Code's own config folder, not a project. Run init inside your project folder, or pass --dir <project folder>.`);
    c.modelsText = opts.models === undefined ? DEFAULT_MODELS : String(opts.models);
    const { keys, ignored } = parseModels(c.modelsText);
    c.keys = keys;
    c.ignoredModels = ignored;
    c.streams = parseStreams(opts.streams === undefined ? DEFAULT_STREAMS : String(opts.streams));
  }
  return c;
}

/** Run one step; a failure becomes a line in the report instead of stopping the run. Returns the step's result. */
export function attempt(c, name, fn) {
  try {
    return fn();
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    // A file that is not UTF-8 text already names itself and says what to do; the step's name would only repeat it.
    c.R.problem(e instanceof NotTextError ? message : `${name}: ${message}`);
    return undefined;
  }
}
