# Contributing to Claude Code handover

Thanks for helping. Claude Code handover is a workflow: a one-paste setup prompt, templates, two skills and dependency-free Node scripts, part of the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit). The bar for a change is the bar the code already meets: it works on Windows, macOS and Linux, it is tested, and it never wastes anyone's tokens.

## Start here

- **Good first issues:** [the issues labelled good first issue](https://github.com/nrzz/claude-code-handover/issues?q=is%3Aopen+label%3A%22good+first+issue%22).
- **Questions and ideas:** [Discussions](https://github.com/nrzz/claude-code-handover/discussions).
- **Bugs:** [open an issue](https://github.com/nrzz/claude-code-handover/issues/new/choose) with the Claude Code version (`claude --version`), your OS, `node --version`, and the exact command and output.

## Set up

There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/nrzz/claude-code-handover
cd claude-code-handover
node scripts/selftest.mjs   # or: npm test
```

- Run the setup from `SETUP-PROMPT.md` in a throwaway project folder, in a new Claude Code session.
- `npm test` runs `scripts/selftest.mjs`: synthetic histories with planted facts, and the recall stress test. `--replay` also replays the prompts of the current folder's real history, on your machine only.

## Where things are

| Path | What it holds |
| --- | --- |
| `SETUP-PROMPT.md`, `setup-prompt.txt` | the one-paste setup |
| `templates/` | the files the setup writes (CLAUDE.local.md, HANDOVER.md, DECISIONS.md, settings blocks) |
| `skills/` | the `/handover` and `/recall` skills |
| `scripts/` | the context-guard hook, the recall index, the usage and cache audits, and the self-test |

## House rules

1. **No dependencies.** Node built-ins only, Node 18 or newer, ES modules (`.mjs`). A pull request that adds a package to `dependencies` will not be merged.
2. **Every change comes with a test**, and `npm test` passes. CI runs the suite on Windows, macOS and Linux with Node 20, 22 and 24; a change that only works on one of them is not done.
3. **Token cost is a feature.** Recall adds lines to a prompt only when the match is strong; `node scripts/selftest.mjs --replay` prints what a change adds per prompt. If your change puts anything new in front of Claude, say how many tokens in the pull request and update the README's "What it costs in tokens".
4. **Never touch real user data in tests.** Use a temporary folder and point `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE` at it. Tests never read `~/.claude/projects`; build synthetic transcripts instead. Build any fake secret from pieces (`"gh" + "p_" + ...`) so secret scanners do not flag the source.
5. **Settings files are the user's.** Back them up before writing, change only your own keys or hook entries, and leave a file that is not valid JSON alone.
6. **Keep the README honest.** Its "What was verified, and how" section says what was checked and what was not. If your change affects either, update it in the same pull request.

## Pull requests

- One logical change per pull request, with its test. Commit messages in the imperative mood ("Add a rule for gem push").
- Fill in the pull request template; CI must be green on all nine jobs.
- Signed commits are welcome but not required.
- Plain, specific writing in docs, messages and comments.

## Releases (maintainers)

Bump the version in `package.json`, add a section to [CHANGELOG.md](CHANGELOG.md), tag `vX.Y.Z` and publish a GitHub release with the changelog section as its notes.

## Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
