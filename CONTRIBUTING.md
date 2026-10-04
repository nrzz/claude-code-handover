# Contributing to Claude Code handover

Thanks for helping. Claude Code handover is a workflow: a one-command installer, the one-paste setup prompt it automates, templates, two skills and dependency-free Node scripts, part of the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit). The bar for a change is the bar the code already meets: it works on Windows, macOS and Linux, it is tested, and it never wastes anyone's tokens.

## Start here

- **Good first issues:** [the issues labelled good first issue](https://github.com/nrzz/claude-code-handover/issues?q=is%3Aopen+label%3A%22good+first+issue%22).
- **Questions and ideas:** [Discussions](https://github.com/nrzz/claude-code-handover/discussions).
- **Bugs:** [open an issue](https://github.com/nrzz/claude-code-handover/issues/new/choose) with the Claude Code version (`claude --version`), your OS, `node --version`, and the exact command and output.

## Set up

There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/nrzz/claude-code-handover
cd claude-code-handover
npm test
```

- `npm test` runs `node --test`, which finds the installer's tests in `test/`, and then `node scripts/selftest.mjs`: synthetic histories with planted facts, and the recall stress test. `--replay` also replays the prompts of the current folder's real history, on your machine only. (The script is `node --test` and not `node --test test/`: given a folder, Node 24 tries to run the folder as a file and fails.)
- Try the installer by hand against a throwaway project and a throwaway config folder, never your own. Set the three variables with `export` first, so that every command after it, `uninstall` included, stays inside the throwaway folder (a variable put in front of one command applies to that command only). They stay set in that terminal, `HOME` included, so close it when you are done:

  ```bash
  tmp=$(mktemp -d) && mkdir "$tmp/project"
  export CLAUDE_CONFIG_DIR="$tmp/claude" HOME="$tmp" USERPROFILE="$tmp"
  node bin/claude-handover.mjs init --dir "$tmp/project"
  ```

  Run it twice (the second run must say there is nothing to do), then `uninstall`. Add `--dry-run` to see a report without writing.
- To try the other route, run the setup from `SETUP-PROMPT.md` in a throwaway project folder, in a new Claude Code session. That route has no sandbox: it changes your real `~/.claude` (the settings file, the two skills and the copy of the scripts), so back that folder up first.

## Where things are

| Path | What it holds |
| --- | --- |
| `bin/claude-handover.mjs` | the entry point of the one command, kept thin: it calls `src/cli.mjs` |
| `src/` | the installer: `cli.mjs` reads the arguments, `install.mjs` runs `init`, `uninstall` and `status`, `project.mjs` and `user.mjs` hold the steps for the project folder and for Claude Code's config folder, `settings.mjs` merges settings.json, `templates.mjs` fills in the templates |
| `test/` | the installer's `node:test` suites, and `helpers.mjs`, which builds a throwaway home, config folder and project for every test |
| `SETUP-PROMPT.md`, `setup-prompt.txt` | the one-paste setup |
| `templates/` | the files the setup writes (CLAUDE.local.md, HANDOVER.md, DECISIONS.md, settings blocks) |
| `skills/` | the `/handover` and `/recall` skills |
| `scripts/` | the context-guard hook, the recall index, the usage and cache audits, and the self-test; `init` copies them into the user's config folder |

## House rules

1. **No dependencies.** Node built-ins only, Node 18 or newer, ES modules (`.mjs`). A pull request that adds a package to `dependencies` will not be merged.
2. **Every change comes with a test**, and `npm test` passes. CI runs the suite on Windows, macOS and Linux with Node 20, 22 and 24, and on Linux with Node 18; a change that only works on one of them is not done.
3. **Token cost is a feature.** Recall adds lines to a prompt only when the match is strong; `node scripts/selftest.mjs --replay` prints what a change adds per prompt. If your change puts anything new in front of Claude, say how many tokens in the pull request and update the README's "What it costs in tokens".
4. **Never touch real user data in tests.** Use a temporary folder and point `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` at it; `test/helpers.mjs` does this, and also points `HANDOVER_PROJECTS_DIR`, `HANDOVER_DATA_DIR` and `CLAUDE_HANDOVER_MANAGED_SETTINGS` (the installer's override for the machine's managed-settings.json) into the temporary folder. Tests never read `~/.claude/projects`; build synthetic transcripts instead. Build any fake secret from pieces (`"gh" + "p_" + ...`) so secret scanners do not flag the source.
5. **Settings files are the user's.** Back them up before writing, change only your own keys or hook entries, and leave a file that is not valid JSON alone.
6. **Keep the README honest.** Its "What was verified, and how" section says what was checked and what was not. If your change affects either, update it in the same pull request.
7. **The setup prompt is authoritative.** `templates/` and `skills/` are the single source of what `init` writes, and every code block of `setup-prompt.txt` must equal its template, placeholders included; `test/templates.test.mjs` checks that. Change the prompt first, then the template, and keep `SETUP-PROMPT.md` the same text. A change to what `init` writes is a change to the prompt too, so the two routes stay the same. Where `init` is deliberately stricter than the prompt about never destroying something, the README says so.

## Pull requests

- One logical change per pull request, with its test. Commit messages in the imperative mood ("Add a rule for gem push").
- Fill in the pull request template; CI must be green on every job.
- Signed commits are welcome but not required.
- Plain, specific writing in docs, messages and comments.

## Releases (maintainers)

Bump the version in `package.json`, add a section to [CHANGELOG.md](CHANGELOG.md), tag `vX.Y.Z` and publish a GitHub release with the changelog section as its notes.

## Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
