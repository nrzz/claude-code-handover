# Changelog

All notable changes to Claude Code handover are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-10-04

- One-command setup: `npx -y github:nrzz/claude-code-handover init` does what the setup prompt tells Claude to do, with the same file contents and the same never-destroy rules, using no model and asking nothing. Options: `--models`, `--streams`, `--dir`, `--dry-run`, `--no-hooks`. Running it twice changes nothing the second time and says so.
- `uninstall` removes only what `init` added at user level (our three hooks, the `/handover` and `/recall` skills, the copy of the scripts) after a backup of `settings.json`, and leaves project files and effort settings alone; `--purge` also removes a git checkout of the scripts that an older setup made. `status` shows what is installed where.
- The guard and recall scripts are copied into `~/.claude/claude-code-handover/` instead of cloned, so the hooks depend on neither git nor npx's cache. An older clone there is updated with `git pull --ff-only`, and copied over when git cannot do it.
- `npm test` now also runs the installer's `node:test` suites, which check every code block of `setup-prompt.txt` against its template.
- Recall (`scripts/recall.mjs`, `scripts/memory-index.mjs`) follows `CLAUDE_CONFIG_DIR`: it reads transcripts from `<config folder>/projects` and keeps its index in `<config folder>/claude-code-handover-data`. With the variable unset nothing changes. The index no longer rewrites its state file when no transcript has anything new.
- `package.json` lists the files to ship, so `npx` no longer prints npm's `gitignore-fallback` warning.
- Fixed three templates that differed from the setup prompt: the first stream in `DECISIONS.md`, the model id placeholder in `settings-single-model.json` and the layout of `hooks-settings.json`. The prompt is authoritative.

## [1.3.1] - 2026-10-01

- Recall that holds up at scale, with a stress test (`scripts/selftest.mjs`).

## [1.3.0] - 2026-10-01

- Recall honours `HANDOVER_PROJECTS_DIR`; a clearer build message; live test notes.
- Recall matches sentence by sentence and unwraps relayed messages; it skips system-injected prompts.

## [1.2.0] - 2026-10-01

- Automatic recall: relevant past lines arrive with each prompt.

## [1.1.0] - 2026-10-01

- The decisions log, the context guard hook and `/recall`.
- A zero-edit setup paste, hardened for existing files and any model mix.

## [1.0.0] - 2026-10-01

- The handover workflow: setup prompt, templates, skill and audit scripts.

[1.4.0]: https://github.com/nrzz/claude-code-handover/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/nrzz/claude-code-handover/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/nrzz/claude-code-handover/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/nrzz/claude-code-handover/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/nrzz/claude-code-handover/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nrzz/claude-code-handover/releases/tag/v1.0.0
