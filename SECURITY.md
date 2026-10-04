# Security policy

## Supported versions

Security fixes go into the latest release on `main`.

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Use GitHub's private reporting: [https://github.com/nrzz/claude-code-handover/security/advisories/new](https://github.com/nrzz/claude-code-handover/security/advisories/new), or the contact in the [nrzz security policy](https://github.com/nrzz/.github/blob/master/SECURITY.md). You can expect a first answer within 72 hours, and credit in the release notes if you want it.

## What this tool can and cannot protect

The context guard and recall read your own transcripts on your machine and send nothing anywhere. The one-command setup (`init`) and the setup prompt write files in your project, and settings in `~/.claude` (or `$CLAUDE_CONFIG_DIR`) after a backup. The command uses no model and makes no network request of its own, with one exception: if an older setup left a git clone in `~/.claude/claude-code-handover`, `init` runs `git pull --ff-only` there. `init --dry-run` shows what it would write, and `uninstall` takes its user-level changes out again.
